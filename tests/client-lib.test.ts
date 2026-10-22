import { describe, expect, it } from "vitest";
import { DOODLE_THEMES } from "../shared/themes.ts";
import { builtinDoodle } from "../src/doodles/library.ts";
import { hashString, mulberry32, signedRandom } from "../src/lib/random.ts";
import { parseContentLines, splitHighlights } from "../src/lib/segments.ts";
import { sketchElements, spline } from "../src/lib/sketch.ts";
import { codePointsOf, normalizeFamily, parseUnicodeRange, rangesIntersect } from "../src/lib/unicode-range.ts";

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

  it("is case-insensitive and keeps original casing", () => {
    expect(splitHighlights("Active Recall works", ["active recall"])).toEqual([
      { text: "Active Recall", highlight: 0 },
      { text: " works", highlight: null },
    ]);
  });

  it("returns the whole text when nothing matches", () => {
    expect(splitHighlights("abc", ["x", ""])).toEqual([{ text: "abc", highlight: null }]);
  });
});

describe("parseContentLines", () => {
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
