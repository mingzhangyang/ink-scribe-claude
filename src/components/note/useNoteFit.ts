import { useCallback, useLayoutEffect, useMemo, useState } from "react";
import type { DoodleSpec } from "../../../shared/doodle.ts";
import type { NoteStructure } from "../../../shared/note.ts";
import type { Settings } from "../../../shared/settings.ts";
import type { StickerItem } from "../../../shared/stickers.ts";
import { byId, PAGE_SIZES, usedFamilies } from "../../config/appearance.ts";
import { ensureFontsLoaded } from "../../export/fontEmbed.ts";
import { loadFontCss } from "../../fonts.ts";
import { fitNote, measureNoteOverflow, type FitResult } from "../../lib/note-fit.ts";

export type NoteFitState = {
  status: "pending" | "ready" | "overflow" | "font-error";
  settings: Settings;
  expanded: boolean;
  retry: () => void;
};

const GENERATED_CHARS = "0123456789.?✦";
const FONT_TIMEOUT_MS = 15_000;

/** Local measurement only: the submitted note and persisted appearance remain unchanged. */
function applyMeasurementSettings(node: HTMLElement, settings: Settings): void {
  const height = byId(PAGE_SIZES, settings.pageSize).height;
  node.style.height = height === null ? "" : `${height}px`;
  node.style.minHeight = `${height ?? 1188}px`;
  node.classList.toggle("is-long", height === null);
  node.style.setProperty("--fs", `${settings.fontSize}px`);
  node.style.setProperty("--lh", String(settings.lineHeight));
  node.style.setProperty("--rule", `${Math.round(settings.fontSize * settings.lineHeight)}px`);
}

function waitForFonts(families: string[], text: string, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const finish = (error?: Error) => {
      clearTimeout(timer);
      signal.removeEventListener("abort", abort);
      if (error) reject(error);
      else resolve();
    };
    const abort = () => finish(new Error("Layout superseded"));
    const timer = setTimeout(() => finish(new Error("Font loading timed out")), FONT_TIMEOUT_MS);
    signal.addEventListener("abort", abort, { once: true });
    void Promise.all(families.map(loadFontCss))
      .then(() => ensureFontsLoaded(families, text))
      .then(() => finish(), (error: unknown) => finish(error instanceof Error ? error : new Error("Font loading failed")));
  });
}

export function useNoteFit(
  node: HTMLElement | null,
  note: NoteStructure,
  settings: Settings,
  stickers: StickerItem[],
  aiDoodle: DoodleSpec | null,
): NoteFitState {
  const input = useMemo(() => ({ note, settings, stickers, aiDoodle }), [note, settings, stickers, aiDoodle]);
  const [attempt, setAttempt] = useState(0);
  const retry = useCallback(() => setAttempt((value) => value + 1), []);
  const [completed, setCompleted] = useState<{
    input: typeof input;
    attempt: number;
    result: Omit<NoteFitState, "retry">;
  } | null>(null);

  useLayoutEffect(() => {
    if (!node) return;
    const controller = new AbortController();
    applyMeasurementSettings(node, settings);
    const run = async () => {
      try {
        await waitForFonts(usedFamilies(settings.zhFont, settings.enFont), `${node.textContent ?? ""}${GENERATED_CHARS}`, controller.signal);
        if (controller.signal.aborted) return;
        const result: FitResult = fitNote(settings, (candidate) => {
          applyMeasurementSettings(node, candidate);
          // Reading dimensions forces layout after the font and typography changes.
          return !measureNoteOverflow(node);
        });
        if (!controller.signal.aborted) setCompleted({ input, attempt, result });
      } catch {
        if (!controller.signal.aborted) {
          applyMeasurementSettings(node, settings);
          setCompleted({ input, attempt, result: { status: "font-error", settings, expanded: false } });
        }
      }
    };
    void run();
    return () => controller.abort();
  }, [node, input, settings, attempt]);

  // Invalidate synchronously when props change, before effects can complete another layout.
  const result = useMemo(() => completed?.input === input && completed.attempt === attempt
    ? completed.result
    : { status: "pending" as const, settings, expanded: false }, [completed, input, attempt, settings]);
  return useMemo(() => ({ ...result, retry }), [result, retry]);
}
