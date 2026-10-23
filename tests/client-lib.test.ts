import { afterEach, describe, expect, it, vi } from "vitest";
import { validatePublishedStickers } from "../shared/publishing.ts";
import {
  isDecorStickerType,
  normalizeStickers,
  STICKER_CATEGORIES,
  STICKER_CATEGORY_TYPES,
  STICKER_SIZES,
  STICKER_TYPES,
  STICKER_VARIANTS,
  stickerVariant,
  type StickerVariant,
} from "../shared/stickers.ts";
import { DOODLE_THEMES } from "../shared/themes.ts";
import { fetchPublishedNote } from "../src/api.ts";
import { FORMULA_TEXT, GREEK_LETTERS, layoutText, missingGlyphs } from "../src/stickers/art/glyphs.ts";
import { effectiveScale, MAX_CANVAS_DIMENSION } from "../src/export/scale.ts";
import { builtinDoodle } from "../src/doodles/library.ts";
import { hashString, mulberry32, signedRandom } from "../src/lib/random.ts";
import { parseContentLines, splitHighlights } from "../src/lib/segments.ts";
import { sketchElements, spline } from "../src/lib/sketch.ts";
import { codePointsOf, normalizeFamily, parseUnicodeRange, rangesIntersect } from "../src/lib/unicode-range.ts";
import { DEFAULT_SETTINGS, sanitizeSettings } from "../src/state/settings.ts";

describe("splitHighlights", () => {
  it("marks every non-overlapping occurrence", () => {
    expect(splitHighlights("重点A和重点B，还有重点A", ["重点A", "重点"])).toEqual([
      { text: "重点A", highlight: 0 },
      { text: "和", highlight: null },
      { text: "重点", highlight: 1 },
      { text: "B，还有", highlight: null },
      { text: "重点A", highlight: 0 },
    ]);
  });

  it("keeps earlier highlight priority and all text when a later phrase overlaps", () => {
    expect(splitHighlights("Alpha beta gamma.", ["Alpha beta", "beta gamma"])).toEqual([
      { text: "Alpha beta", highlight: 0 },
      { text: " gamma.", highlight: null },
    ]);
  });

  it("is case-insensitive and keeps original casing", () => {
    expect(splitHighlights("Active Recall works", ["active recall"])).toEqual([
      { text: "Active Recall", highlight: 0 },
      { text: " works", highlight: null },
    ]);
  });

  it("keeps offsets right when lowercasing changes the string length", () => {
    // "İ".toLowerCase() 是两个 UTF-16 单元，按小写串的位置切原文会错位
    expect(splitHighlights("İstanbul city", ["city"])).toEqual([
      { text: "İstanbul ", highlight: null },
      { text: "city", highlight: 0 },
    ]);
  });

  it("treats regex syntax in phrases literally", () => {
    expect(splitHighlights("a+b (c) a.b", ["a+b", "(c)"])).toEqual([
      { text: "a+b", highlight: 0 },
      { text: " ", highlight: null },
      { text: "(c)", highlight: 1 },
      { text: " a.b", highlight: null },
    ]);
  });

  it("returns the whole text when nothing matches", () => {
    expect(splitHighlights("abc", ["x", ""])).toEqual([{ text: "abc", highlight: null }]);
  });
});

describe("parseContentLines", () => {
  it("does not treat decimal numbers as list markers", () => {
    expect(parseContentLines("3.14 is pi\n2. second")).toEqual([
      { kind: "text", text: "3.14 is pi" },
      { kind: "numbered", marker: "2", text: "second" },
    ]);
  });

  it("recognises bullets, numbered items and gaps", () => {
    expect(parseContentLines("开头\n- 要点一\n• 要点二\n\n1. 第一步\n2、第二步\n\n")).toEqual([
      { kind: "text", text: "开头" },
      { kind: "bullet", text: "要点一" },
      { kind: "bullet", text: "要点二" },
      { kind: "gap" },
      { kind: "numbered", marker: "1", text: "第一步" },
      { kind: "numbered", marker: "2", text: "第二步" },
    ]);
  });
});

describe("unicode-range helpers", () => {
  it("parses single code points, ranges and wildcards", () => {
    expect(parseUnicodeRange("U+0025-00FF, u+4??, U+30")).toEqual([
      [0x25, 0xff],
      [0x400, 0x4ff],
      [0x30, 0x30],
    ]);
  });

  it("detects whether a font slice is needed for the text", () => {
    const ranges = parseUnicodeRange("U+4e00-4e10");
    expect(rangesIntersect(ranges, codePointsOf("一"))).toBe(true);
    expect(rangesIntersect(ranges, codePointsOf("abc"))).toBe(false);
    expect(rangesIntersect([], codePointsOf("abc"))).toBe(true);
  });

  it("normalises font family names", () => {
    expect(normalizeFamily(` "Ma Shan Zheng" `)).toBe("ma shan zheng");
    expect(normalizeFamily("'Caveat'")).toBe("caveat");
  });
});

describe("deterministic randomness", () => {
  it("produces the same sequence for the same seed", () => {
    const a = mulberry32(42);
    const b = mulberry32(42);
    expect([a(), a(), a()]).toEqual([b(), b(), b()]);
    const s = signedRandom(hashString("note"));
    for (let i = 0; i < 100; i++) {
      const v = s();
      expect(v).toBeGreaterThanOrEqual(-1);
      expect(v).toBeLessThan(1);
    }
  });
});

describe("doodle rendering", () => {
  it("ships a valid builtin doodle for every theme", () => {
    for (const theme of DOODLE_THEMES) {
      const spec = builtinDoodle(theme);
      expect(spec.elements.length).toBeGreaterThan(2);
    }
  });

  it("generates only path data made of safe characters", () => {
    for (const theme of DOODLE_THEMES) {
      const shape = sketchElements(builtinDoodle(theme).elements, signedRandom(1), 0.8);
      for (const { d } of [...shape.fills, ...shape.strokes]) {
        expect(d).toMatch(/^[MLQCZ0-9 .\-]+$/);
      }
    }
  });

  it("builds smooth closed splines through the given points", () => {
    const d = spline(
      [
        [0, 0],
        [10, 0],
        [10, 10],
      ],
      true,
    );
    expect(d.startsWith("M0 0")).toBe(true);
    expect(d.endsWith("Z")).toBe(true);
    expect(d.match(/C/g)).toHaveLength(3);
  });
});

describe("sanitizeSettings", () => {
  it("falls back to defaults for unknown or malformed values", () => {
    expect(sanitizeSettings({ layout: "bogus", paper: 42, fontSize: "huge", naturalness: null, seed: 1.5 })).toEqual(DEFAULT_SETTINGS);
    expect(sanitizeSettings(undefined)).toEqual(DEFAULT_SETTINGS);
    expect(sanitizeSettings("garbage")).toEqual(DEFAULT_SETTINGS);
  });

  it("keeps valid values and clamps numbers into range", () => {
    const settings = sanitizeSettings({ layout: "minimal", paper: "kraft", ink: "green", fontSize: 99, naturalness: -1, seed: 42 });
    expect(settings).toMatchObject({ layout: "minimal", paper: "kraft", ink: "green", fontSize: 28, naturalness: 0, seed: 42 });
  });
});

describe("normalizeStickers", () => {
  it("regenerates duplicate ids so each sticker can be edited on its own", () => {
    const stickers = normalizeStickers([
      { id: "dup", type: "star", x: 10, y: 10 },
      { id: "dup", type: "star", x: 20, y: 20 },
      { id: "other", type: "star", x: 30, y: 30 },
    ]);
    const ids = stickers.map((s) => s.id);
    expect(ids[0]).toBe("dup");
    expect(ids[2]).toBe("other");
    expect(new Set(ids).size).toBe(3);
  });

  it("keeps positions far down a long page", () => {
    const [sticker] = normalizeStickers([{ id: "low", type: "star", x: 100, y: 5000 }]);
    expect(sticker.y).toBe(5000);
  });

  it("keeps a horizontal flip only when it is true", () => {
    const stickers = normalizeStickers([
      { id: "a", type: "arrow", x: 1, y: 1, flip: true },
      { id: "b", type: "arrow", x: 1, y: 1, flip: "yes" },
      { id: "c", type: "arrow", x: 1, y: 1, flip: false },
    ]);
    expect(stickers.map((s) => s.flip)).toEqual([true, undefined, undefined]);
  });

  it("keeps the newer sticker types with their own variants and drops variants of other types", () => {
    const stickers = normalizeStickers([
      { id: "flower", type: "pressed-flower", x: 10, y: 10, variant: "ginkgo" },
      { id: "tape", type: "tape", x: 20, y: 20, variant: "checks" },
      { id: "seal", type: "seal", x: 30, y: 30, variant: "ginkgo" },
    ]);
    expect(stickers.map((s) => [s.type, s.variant])).toEqual([
      ["pressed-flower", "ginkgo"],
      ["tape", "checks"],
      ["seal", undefined],
    ]);
  });
});

describe("sticker catalog", () => {
  const decor = STICKER_TYPES.filter(isDecorStickerType);

  it("lists every decoration in exactly one panel category", () => {
    const listed = STICKER_CATEGORIES.flatMap((category) => STICKER_CATEGORY_TYPES[category]);
    expect([...listed].sort()).toEqual([...decor].sort());
  });

  it("gives every decoration a size and distinct variant ids", () => {
    for (const type of decor) {
      const ids = STICKER_VARIANTS[type].map((v: StickerVariant) => v.id);
      expect(new Set(ids).size, type).toBe(ids.length);
      expect(STICKER_SIZES[type].w * STICKER_SIZES[type].h, type).toBeGreaterThan(0);
    }
  });

  it("falls back to the first variant for a missing or unknown id", () => {
    expect(stickerVariant("face", undefined).id).toBe("happy");
    expect(stickerVariant("face", "grumpy").id).toBe("happy");
    expect(stickerVariant("face", "surprised").id).toBe("surprised");
  });

  it("accepts the newer types in the publishing contract and rejects another type's variant", () => {
    const sticker = { id: "s1", type: "wavy-underline", x: 40, y: 50, rotation: 0, scale: 1 };
    expect(validatePublishedStickers([{ ...sticker, variant: "blue" }]).ok).toBe(true);
    expect(validatePublishedStickers([{ ...sticker, variant: "lavender" }]).ok).toBe(false);
    expect(validatePublishedStickers([{ ...sticker, flip: true }]).ok).toBe(true);
    expect(validatePublishedStickers([{ ...sticker, flip: "yes" }]).ok).toBe(false);
  });
});

describe("handwritten formula glyphs", () => {
  it("has a stroke glyph for every character in the formulas, Greek letters and diagram labels", () => {
    // 求和、根号、坐标轴与各图示的标注（见 src/stickers/art/formulas.tsx、science.tsx）
    const labels = ["n", "i=1", "a_i", "2", "x", "y", "O", "H", "CH_2OH", "OH", "HO", "N", "S", "F", "+", "Σ"];
    for (const text of [...Object.values(FORMULA_TEXT), ...Object.values(GREEK_LETTERS), ...labels]) {
      expect(missingGlyphs(text), text).toEqual([]);
    }
  });

  it("raises superscripts, lowers subscripts and keeps the following glyph on the baseline", () => {
    const squared = layoutText("c^2");
    expect(squared.glyphs[1].y).toBeLessThan(0);
    expect(squared.glyphs[1].scale).toBeLessThan(1);
    const water = layoutText("H_2O");
    expect(water.glyphs[1].y).toBeGreaterThan(0);
    expect(water.glyphs[2]).toMatchObject({ y: 0, scale: 1 });
    expect(water.width).toBeGreaterThan(water.glyphs[2].x);
    expect(layoutText("C_6H_{12}O_6").glyphs.map((g) => g.scale)).toEqual([1, 0.6, 1, 0.6, 0.6, 1, 0.6]);
  });
});

describe("effectiveScale", () => {
  it("keeps exports within the canvas pixel budget, going below 1x when needed", () => {
    expect(effectiveScale(840, 1188, 3)).toBe(3);
    const tall = effectiveScale(840, 100_000, 2);
    expect(tall).toBeLessThan(0.5);
    expect(840 * tall * 100_000 * tall).toBeLessThanOrEqual(16_000_000);
    expect(100_000 * tall).toBeLessThanOrEqual(MAX_CANVAS_DIMENSION);
    expect(840 * tall).toBeLessThanOrEqual(MAX_CANVAS_DIMENSION);
  });
});

describe("fetchPublishedNote", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("still displays a version 1 note from a newer contract than the page knows", async () => {
    const note = { title: "标题", cues: [], sections: [{ content: "正文", highlights: [] }], summary: "" };
    const body = {
      id: "A".repeat(22), title: "标题", summary: "", language: "zh", template: "general", layout: "hybrid-cornell",
      visibility: "unlisted", createdAt: "2026-10-23T00:00:00.000Z", updatedAt: "2026-10-23T00:00:00.000Z",
      schemaVersion: 1, note, settings: { ...DEFAULT_SETTINGS, settingFromLaterRelease: true }, stickers: [],
    };
    vi.stubGlobal("fetch", vi.fn(async () => Response.json(body)));
    const viewable = await fetchPublishedNote("A".repeat(22));
    expect(viewable.note).toEqual(note);
    expect(viewable.settings).toEqual(DEFAULT_SETTINGS);
  });
});
