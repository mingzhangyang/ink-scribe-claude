import { describe, expect, it } from "vitest";
import { EN_FONTS, INKS, PAPERS, ZH_FONTS, fontStack } from "../shared/appearance.ts";
import { DEFAULT_SETTINGS, sanitizeSettings } from "../shared/settings.ts";
import { nextHandwritingStyle } from "../src/lib/handwriting-style.ts";

const newInks = {
  magenta: "#86198F",
  teal: "#0D5552",
  violet: "#5B21B6",
  graphite: "#465058",
} as const;

function luminance(color: string) {
  const rgb = [1, 3, 5].map((i) => Number.parseInt(color.slice(i, i + 2), 16) / 255)
    .map((x) => x <= 0.04045 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4);
  return 0.2126 * rgb[0] + 0.7152 * rgb[1] + 0.0722 * rgb[2];
}
function contrast(a: string, b: string) {
  const x = luminance(a), y = luminance(b);
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
}

describe("InkScribe nine-ink palette", () => {
  it("preserves original ink IDs, adds three colorful inks and graphite, and sanitizes all IDs", () => {
    expect(INKS.map((ink) => ink.id)).toEqual([
      "carbon", "blue", "brown", "green", "bordeaux",
      "magenta", "teal", "violet", "graphite",
    ]);
    expect(new Set(INKS.map((ink) => ink.color))).toHaveProperty("size", 9);
    for (const [id, color] of Object.entries(newInks)) {
      expect(INKS.find((ink) => ink.id === id)?.color).toBe(color);
      expect(sanitizeSettings({ ink: id }).ink).toBe(id);
    }
    expect(sanitizeSettings({ ink: "unknown" }).ink).toBe(DEFAULT_SETTINGS.ink);
  });

  it("keeps each new ink legible on every shipped paper, including kraft", () => {
    for (const [id, color] of Object.entries(newInks)) {
      for (const paper of PAPERS) {
        expect(contrast(color, paper.base), id + " on " + paper.id).toBeGreaterThanOrEqual(4.5);
      }
    }
  });
});

describe("Try another handwriting", () => {
  it("changes both handwritten font families on every consecutive click", () => {
    let current = DEFAULT_SETTINGS;
    const pairs = new Set<string>();
    for (let i = 0; i < 10; i++) {
      const next = { ...current, ...nextHandwritingStyle(current) };
      expect(next.zhFont).not.toBe(current.zhFont);
      expect(next.enFont).not.toBe(current.enFont);
      expect(next.seed).not.toBe(current.seed);
      expect(ZH_FONTS.some((f) => f.id === next.zhFont)).toBe(true);
      expect(EN_FONTS.some((f) => f.id === next.enFont)).toBe(true);
      expect(fontStack(next.zhFont, next.enFont)).not.toBe(fontStack(current.zhFont, current.enFont));
      pairs.add(next.zhFont + "/" + next.enFont);
      current = next;
    }
    expect(pairs.size).toBe(5);
  });

  it("avoids random repeats and respects a manually chosen font combination", () => {
    const manuallyChosen = {
      ...DEFAULT_SETTINGS,
      zhFont: "zcool-kuaile" as const,
      enFont: "kalam" as const,
    };
    const first = nextHandwritingStyle(manuallyChosen);
    const second = nextHandwritingStyle(manuallyChosen);
    expect(first).toEqual(second);
    expect(first.zhFont).not.toBe(manuallyChosen.zhFont);
    expect(first.enFont).not.toBe(manuallyChosen.enFont);
  });

  it("changes only fonts and the jitter seed, leaving the note style and ink untouched", () => {
    const settings = { ...DEFAULT_SETTINGS, ink: "graphite" as const, naturalness: 0 };
    const next = { ...settings, ...nextHandwritingStyle(settings) };
    expect(next.ink).toBe("graphite");
    expect(next.naturalness).toBe(0);
    expect(next.paper).toBe(settings.paper);
    expect(next.layout).toBe(settings.layout);
    expect(next.fontSize).toBe(settings.fontSize);
    expect(next.lineHeight).toBe(settings.lineHeight);
  });
});
