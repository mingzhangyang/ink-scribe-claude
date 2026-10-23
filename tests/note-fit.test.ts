import { afterEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_SETTINGS, sanitizeSettings } from "../shared/settings.ts";
import { ensureFontsLoaded } from "../src/export/fontEmbed.ts";
import { fitCandidates, fitNote, measureNoteOverflow } from "../src/lib/note-fit.ts";

afterEach(() => vi.unstubAllGlobals());

describe("complete note fitting", () => {
  it("keeps an already fitting document and authored settings unchanged", () => {
    const authored = Object.freeze({ ...DEFAULT_SETTINGS });
    const result = fitNote(authored, () => true);
    expect(result).toEqual({ status: "ready", settings: authored, expanded: false });
    expect(result.settings).toBe(authored);
  });

  it("finds a fitting size without crossing the readable floor", () => {
    const authored = { ...DEFAULT_SETTINGS, fontSize: 28, lineHeight: 2.4, overflow: "error" as const };
    const measured: typeof authored[] = [];
    const result = fitNote(authored, (candidate) => {
      measured.push(candidate as typeof authored);
      return candidate.fontSize <= 16 && candidate.lineHeight <= 1.5;
    });
    expect(result.status).toBe("ready");
    expect(result.settings).toMatchObject({ fontSize: 16, lineHeight: 1.5, pageSize: "a4" });
    expect(measured.at(-1)).toEqual(result.settings);
    expect(measured.length).toBeLessThan(12);
    expect(measured.every((settings) => settings.fontSize >= 12 && settings.lineHeight >= 1.5)).toBe(true);
    expect(authored).toMatchObject({ fontSize: 28, lineHeight: 2.4 });
  });

  it("expands a dense note at authored typography instead of shrinking it forever", () => {
    const authored = { ...DEFAULT_SETTINGS, fontSize: 21, lineHeight: 1.9 };
    const measured: string[] = [];
    const result = fitNote(authored, (candidate) => {
      measured.push(candidate.pageSize);
      return candidate.pageSize === "long";
    });
    expect(result).toMatchObject({ status: "ready", expanded: true, settings: { fontSize: 21, lineHeight: 1.9, pageSize: "long" } });
    expect(measured).toEqual(["a4", "a4", "long"]);
  });

  it("reports strict overflow without replacing content or changing the page size", () => {
    const authored = { ...DEFAULT_SETTINGS, overflow: "error" as const };
    const result = fitNote(authored, () => false);
    expect(result).toMatchObject({ status: "overflow", expanded: false, settings: { pageSize: "a4", fontSize: 12, lineHeight: 1.5 } });
  });

  it("still checks long-page geometry and blocks horizontal or regional clipping", () => {
    expect(fitNote({ ...DEFAULT_SETTINGS, pageSize: "long" }, () => false).status).toBe("overflow");
    expect(fitNote(DEFAULT_SETTINGS, () => false)).toMatchObject({ status: "overflow", expanded: true });
  });

  it("preserves an explicitly tighter line height and bounds the number of candidates", () => {
    const candidates = fitCandidates({ ...DEFAULT_SETTINGS, fontSize: 12, lineHeight: 1.3 });
    expect(candidates).toHaveLength(1);
    expect(candidates[0]).toMatchObject({ fontSize: 12, lineHeight: 1.3 });
    expect(fitCandidates({ ...DEFAULT_SETTINGS, fontSize: 28, lineHeight: 2.4 }).length).toBeLessThan(45);
  });

  it("defaults older saved appearances to expansion and keeps the explicit strict policy", () => {
    expect(sanitizeSettings({}).overflow).toBe("expand");
    expect(sanitizeSettings({ overflow: "error" }).overflow).toBe("error");
    expect(sanitizeSettings({ overflow: "discard" }).overflow).toBe("expand");
  });
});

describe("font readiness", () => {
  it("propagates a failed font load instead of fitting or exporting fallback glyphs", async () => {
    vi.stubGlobal("document", { fonts: { load: vi.fn().mockRejectedValue(new Error("Network failure")), ready: Promise.resolve() } });
    await expect(ensureFontsLoaded(["Kalam"], "Full note")).rejects.toThrow("Network failure");
  });

  it("loads all note characters, including text beyond the old prefix limit", async () => {
    const load = vi.fn().mockResolvedValue([]);
    vi.stubGlobal("document", { fonts: { load, ready: Promise.resolve() } });
    const content = "a".repeat(20_001) + "尾";
    await ensureFontsLoaded(["Kalam"], content);
    expect(load).toHaveBeenCalledWith('20px "Kalam"', content);
  });
});

describe("canvas geometry", () => {
  const paper = { left: 0, top: 0, right: 840, bottom: 1188, width: 840 };
  function pageWith(regions: object[], textRects: object[]): HTMLElement {
    return {
      offsetWidth: 840,
      getBoundingClientRect: () => paper,
      querySelectorAll: (selector: string) => selector === "[data-fit]"
        ? regions
        : [{ getClientRects: () => textRects }],
    } as unknown as HTMLElement;
  }

  it("allows visible handwritten rotation inside the paper padding", () => {
    vi.stubGlobal("getComputedStyle", () => ({ overflowX: "visible", overflowY: "visible" }));
    const page = pageWith(
      [{ clientWidth: 728, scrollWidth: 739, clientHeight: 900, scrollHeight: 914 }],
      [{ left: 48, right: 791, top: 42, bottom: 1160 }],
    );
    expect(measureNoteOverflow(page)).toBe(false);
  });

  it("detects hidden extra columns even if the visible text stays on the paper", () => {
    vi.stubGlobal("getComputedStyle", () => ({ overflowX: "hidden", overflowY: "hidden" }));
    const page = pageWith(
      [{ clientWidth: 728, scrollWidth: 1100, clientHeight: 900, scrollHeight: 900 }],
      [{ left: 56, right: 784, top: 50, bottom: 1000 }],
    );
    expect(measureNoteOverflow(page)).toBe(true);
  });

  it("still rejects visible text outside any paper edge on long pages", () => {
    vi.stubGlobal("getComputedStyle", () => ({ overflowX: "visible", overflowY: "visible" }));
    for (const rect of [
      { left: -3, right: 100, top: 50, bottom: 100 },
      { left: 56, right: 843, top: 50, bottom: 100 },
      { left: 56, right: 100, top: -3, bottom: 100 },
      { left: 56, right: 100, top: 50, bottom: 1191 },
    ]) expect(measureNoteOverflow(pageWith([], [rect]))).toBe(true);
  });
});
