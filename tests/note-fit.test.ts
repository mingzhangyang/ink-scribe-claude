import { afterEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_SETTINGS, sanitizeSettings } from "../shared/settings.ts";
import { ensureFontsLoaded } from "../src/export/fontEmbed.ts";
import { fitCandidates, fitNote, fitNoteTitle, measureNoteOverflow } from "../src/lib/note-fit.ts";

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

describe("near-fitting handwritten titles", () => {
  type TitleHarnessOptions = {
    flexWidth?: (size: number, available: number) => number;
    initialAlign?: string;
    initialWhiteSpace?: string;
    initialTransform?: string;
    noMeasuredText?: boolean;
    lineWidths?: number[];
    fragments?: Array<[number, number, number]>;
  };

  function titleHarness(initialAvailable: number, intrinsicWidth: number, options: TitleHarnessOptions = {}) {
    let available = initialAvailable;
    const baseSize = 39;
    const style = {
      fontSize: "",
      whiteSpace: options.initialWhiteSpace ?? "",
      textAlign: options.initialAlign ?? "",
      transform: options.initialTransform ?? "",
      removeProperty(name: string) { if (name === "font-size") this.fontSize = ""; },
    };
    const size = () => Number.parseFloat(style.fontSize || String(baseSize));
    const width = () => options.flexWidth?.(size(), available) ?? available;
    const text = {
      // Reconstruct natural line fragments at the current size and flex width,
      // including per-character jitter spans in the handwritten title.
      getClientRects: () => {
        if (options.initialAlign === "center") expect(style.textAlign).toBe("left");
        if (options.initialTransform) expect(style.transform).toBe("none");
        if (options.fragments) return options.fragments.map(([left, top, lineWidth]) => ({
          left, right: left + lineWidth, top, bottom: top + 40, width: lineWidth, height: 40,
        }));
        const currentWidth = width();
        if (currentWidth <= 0) return [];
        const widths = options.lineWidths ?? (() => {
          const parts: number[] = [];
          let remaining = intrinsicWidth * size() / baseSize;
          while (remaining > 0 && parts.length < 20) {
            const part = Math.min(currentWidth, remaining);
            parts.push(part);
            remaining -= part;
          }
          return parts;
        })();
        return widths.map((lineWidth, i) => ({
          left: 0, right: lineWidth, top: i * 50, bottom: i * 50 + 40, width: lineWidth, height: 40,
        }));
      },
      getBoundingClientRect: () => ({ width: intrinsicWidth * size() / baseSize }),
    };
    const title = {
      style,
      get clientWidth() { return Math.round(width()); },
      get scrollWidth() { return Math.max(this.clientWidth, Math.round(intrinsicWidth * size() / baseSize)); },
      getBoundingClientRect: () => ({ width: width() }),
      querySelector: (selector: string) => selector === "[data-fit-text]" && !options.noMeasuredText ? text : null,
    };
    vi.stubGlobal("getComputedStyle", () => ({ fontSize: `${baseSize}px` }));
    const page = { querySelector: (selector: string) => selector === ".note-title" ? title : null } as unknown as HTMLElement;
    return { page, title, style, size, width, intrinsicWidth, baseSize, setAvailable: (w: number) => { available = w; } };
  }

  function expectFitted(h: ReturnType<typeof titleHarness>) {
    expect(h.style.fontSize).not.toBe("");
    expect(h.size()).toBeGreaterThanOrEqual(h.baseSize * 0.8 - 1e-8);
    expect(h.size()).toBeLessThan(h.baseSize);
    expect(h.intrinsicWidth * h.size() / h.baseSize).toBeLessThanOrEqual(h.width() + 1e-7);
  }

  it("keeps a near-fitting Chinese title on one line without shrinking the rest", () => {
    const h = titleHarness(558, 632);
    fitNoteTitle(h.page);
    expectFitted(h);
    expect(h.size()).toBeGreaterThan(34.3);
    expect(h.style.whiteSpace).toBe("");
  });

  it("preserves authored font size when the title fits, is genuinely long, or has no width", () => {
    for (const [available, required] of [[558, 400], [420, 950], [0, 600]]) {
      const h = titleHarness(available, required);
      fitNoteTitle(h.page);
      expect(h.style.fontSize).toBe("");
    }
  });

  it("recalculates from authored size when the canvas becomes wider", () => {
    const h = titleHarness(558, 632);
    fitNoteTitle(h.page);
    expectFitted(h);
    h.setAvailable(700);
    fitNoteTitle(h.page);
    expect(h.style.fontSize).toBe("");
  });

  it("remeasures the current flex width when the date reclaims space", () => {
    const h = titleHarness(558, 632, { flexWidth: (size, available) => size < 39 ? 550 : available });
    fitNoteTitle(h.page);
    expectFitted(h);
  });

  it("measures centered journal text at the left edge and restores inline styles", () => {
    const h = titleHarness(558, 632, {
      initialAlign: "center", initialWhiteSpace: "normal", initialTransform: "translateX(1px) rotate(.2deg)",
    });
    fitNoteTitle(h.page);
    expectFitted(h);
    expect(h.style.textAlign).toBe("center");
    expect(h.style.whiteSpace).toBe("normal");
    expect(h.style.transform).toBe("translateX(1px) rotate(.2deg)");
  });

  it("accepts a title fitting exactly at the 80 percent boundary", () => {
    const h = titleHarness(560, 700);
    fitNoteTitle(h.page);
    expectFitted(h);
    expect(h.size()).toBeCloseTo(39 * 0.8, 6);
  });

  it("applies later corrections when flex width changes near the cutoff", () => {
    const h = titleHarness(558, 632, { flexWidth: (size, available) => size < 35 ? 550 : available });
    fitNoteTitle(h.page);
    expectFitted(h);
  });

  it("uses fractional widths when rounded scrollWidth hides a wrap", () => {
    const h = titleHarness(567.828125, 568.125);
    expect(h.title.scrollWidth).toBe(h.title.clientWidth);
    fitNoteTitle(h.page);
    expectFitted(h);
  });

  it("preserves typography when reliable line fragments are unavailable", () => {
    const h = titleHarness(558, 632, { noMeasuredText: true });
    fitNoteTitle(h.page);
    expect(h.style.fontSize).toBe("");
  });

  it("does not shrink two balanced word lines even when a 20 percent reduction would fit", () => {
    const h = titleHarness(568, 612, { lineWidths: [300, 300] });
    fitNoteTitle(h.page);
    expect(h.style.fontSize).toBe("");
    expect(h.style.whiteSpace).toBe("");
  });

  it("preserves balanced centered titles and restores their alignment", () => {
    const h = titleHarness(568, 612, {
      lineWidths: [300, 300], initialAlign: "center", initialWhiteSpace: "normal",
    });
    fitNoteTitle(h.page);
    expect(h.style.fontSize).toBe("");
    expect(h.style.textAlign).toBe("center");
    expect(h.style.whiteSpace).toBe("normal");
  });

  it("merges jittered per-character rectangles into two visual lines", () => {
    const fragments: Array<[number, number, number]> = Array.from(
      { length: 14 }, (_, i) => [i * 39, i % 3, 39],
    );
    fragments.push([0, 51, 39], [39, 52, 39]);
    const h = titleHarness(558, 632, { fragments });
    fitNoteTitle(h.page);
    expectFitted(h);
  });

  it("preserves a short orphan that cannot fit within the 20 percent limit", () => {
    const h = titleHarness(560, 900, { lineWidths: [540, 50] });
    fitNoteTitle(h.page);
    expect(h.style.fontSize).toBe("");
  });

  it("preserves multi-line titles even if the last line is short", () => {
    const h = titleHarness(568, 900, { lineWidths: [540, 330, 20] });
    fitNoteTitle(h.page);
    expect(h.style.fontSize).toBe("");
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
