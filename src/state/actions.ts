import { structureLocally } from "../../shared/heuristic.ts";
import type { NoteStructure } from "../../shared/note.ts";
import { detectLanguage } from "../../shared/text.ts";
import { ApiRequestError, structureText } from "../api.ts";
import { useNoteStore } from "./store.ts";

let controller: AbortController | null = null;

function todayLabel(note: NoteStructure): string {
  const sample = `${note.title}\n${note.sections.map((s) => s.content).join("\n")}`;
  const now = new Date();
  return detectLanguage(sample) === "zh"
    ? `${now.getFullYear()}年${now.getMonth() + 1}月${now.getDate()}日`
    : now.toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric" });
}

/** 原文没有日期时，用今天的日期作为笔记日期（可在“内容”中修改）。 */
function withDate(note: NoteStructure): NoteStructure {
  return note.date ? note : { ...note, date: todayLabel(note) };
}

export async function generateNote(): Promise<void> {
  const { input, settings, startLoading, setResult, setError, clearError } = useNoteStore.getState();
  controller?.abort();
  const current = new AbortController();
  controller = current;
  startLoading();
  try {
    const response = await structureText(
      {
        text: input.text,
        template: input.template,
        language: input.language,
        style: settings.layout,
        detail: input.detail,
      },
      current.signal,
    );
    if (controller !== current) return;
    setResult(withDate(response.note), response.meta, "ai");
  } catch (error) {
    if (current.signal.aborted && controller !== current) return;
    if (current.signal.aborted) {
      clearError();
      return;
    }
    setError(
      error instanceof ApiRequestError
        ? error.detail
        : { code: "INTERNAL_ERROR", message: "生成失败，请稍后重试。" },
    );
  } finally {
    if (controller === current) controller = null;
  }
}

export function cancelGeneration(): void {
  controller?.abort();
  controller = null;
  useNoteStore.getState().clearError();
}

/** 不调用 AI，按段落与关键词在本地快速排版。 */
export function generateLocally(): void {
  const { input, setResult } = useNoteStore.getState();
  if (!input.text.trim()) return;
  const note = structureLocally(input.text, { template: input.template, detail: input.detail });
  setResult(withDate(note), null, "local");
}
