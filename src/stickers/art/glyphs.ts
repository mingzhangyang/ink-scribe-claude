/**
 * 手写笔画字形：公式贴纸和图示中的标注都用笔画绘制，而不是文字。
 * 手写字体没有希腊字母和数学符号，用文字会退回系统字体，换设备或导出后样子不同；
 * 画成笔画则与其他贴纸一样，预览与导出完全一致。
 *
 * 坐标以基线为 y = 0：大写字母与数字高 16，小写字母高 10；w 为字宽，
 * top / bottom 为字形上下边界（缺省为 -16 / 0）。
 */
type Glyph = { d: string; w: number; top?: number; bottom?: number };

export const GLYPHS: Record<string, Glyph> = {
  "0": { d: "M4.5 -16 C-0.5 -16 -0.5 0 4.5 0 C9.5 0 9.5 -16 4.5 -16 Z", w: 9 },
  "1": { d: "M1 -12.5 L5 -16 L5 0", w: 7 },
  "2": { d: "M0.8 -12 C1 -16.5 9 -17 9 -11.5 C9 -7 2 -4 0.5 0 L9.5 0", w: 10 },
  "6": { d: "M8 -15 C4 -16.5 0.5 -12 0.5 -6 C0.5 -1.5 3 0 5 0 C8 0 9.5 -2 9.5 -5 C9.5 -8 7.5 -10 5 -10 C2.5 -10 0.8 -8 0.6 -6", w: 10 },
  a: { d: "M8 -8.5 C6.5 -10.5 0.5 -10.5 0.5 -4.5 C0.5 0.5 6.5 0.5 8 -3.5 M8 -10 L8 0", w: 9, top: -10.5 },
  b: { d: "M1 -17 L1 0 M1 -5 C1 -9 3.5 -10 5 -10 C8 -10 9 -7.5 9 -5 C9 -2 7.5 0 5 0 C3 0 1 -1.5 1 -4", w: 9.5, top: -17 },
  c: { d: "M8 -8.5 C6.5 -10.5 0.5 -10.5 0.5 -5 C0.5 0.5 6.5 0.5 8.2 -1.8", w: 8.5, top: -10.5 },
  d: { d: "M8 -8.5 C6.5 -10.5 0.5 -10.5 0.5 -4.5 C0.5 0.5 6.5 0.5 8 -3.5 M8 -17 L8 0", w: 9, top: -17 },
  e: { d: "M1 -5 L8.5 -5 C8.5 -9 6.5 -10.2 4.6 -10.2 C2 -10.2 0.5 -8 0.5 -5 C0.5 -1.5 2.5 0.2 4.8 0.2 C6.4 0.2 7.7 -0.5 8.5 -1.8", w: 9, top: -10.5 },
  f: { d: "M8 -16 C6.5 -17.5 3.5 -17 3.5 -13 L3.5 0 M0.5 -10 L7 -10", w: 7.5, top: -17 },
  i: { d: "M2 -10 L2 0 M2 -14.2 L2 -14", w: 4, top: -14.5 },
  l: { d: "M2 -17 L2 0", w: 4, top: -17 },
  m: { d: "M1 -10 L1 0 M1 -6.5 C1 -10.5 7 -11 7 -6.5 L7 0 M7 -6.5 C7 -10.5 13 -11 13 -6.5 L13 0", w: 14, top: -10.5 },
  n: { d: "M1 -10 L1 0 M1 -6.5 C1 -10.5 8 -11 8 -6.5 L8 0", w: 9, top: -10.5 },
  x: { d: "M0.5 -10 L8.5 0 M8.5 -10 L0.5 0", w: 9, top: -10 },
  y: { d: "M0.5 -10 L4.8 -1 M9 -10 L3.5 4 Q2.5 6 0.5 5.5", w: 9.5, top: -10, bottom: 6 },
  C: { d: "M11 -13.5 C9.5 -16.5 1 -17.5 0.8 -8 C0.6 1.5 9.5 0.8 11.2 -2.5", w: 12 },
  E: { d: "M10 -16 L1 -16 L1 0 L10 0 M1 -8 L8 -8", w: 11 },
  F: { d: "M10 -16 L1 -16 L1 0 M1 -8 L8 -8", w: 10.5 },
  H: { d: "M1 -16 L1 0 M11 -16 L11 0 M1 -8 L11 -8", w: 12 },
  I: { d: "M0.5 -16 L6.5 -16 M3.5 -16 L3.5 0 M0.5 0 L6.5 0", w: 7 },
  N: { d: "M1 0 L1 -16 L11 0 L11 -16", w: 12 },
  O: { d: "M7 -16 C1.5 -16 0.5 -11 0.5 -8 C0.5 -3 3 0 7 0 C11 0 13.5 -3 13.5 -8 C13.5 -13 11 -16 7 -16 Z", w: 14 },
  R: { d: "M1 0 L1 -16 L6.5 -16 C11 -16 11 -8.5 6.5 -8.5 L1 -8.5 M5.5 -8.5 L10.5 0", w: 11.5 },
  S: { d: "M10 -13.5 C9 -16.5 1.5 -17 1.5 -12.5 C1.5 -8 10.5 -9 10.5 -4 C10.5 0.5 2 0.5 0.8 -2.5", w: 11.5 },
  U: { d: "M1 -16 L1 -5 C1 1.5 11 1.5 11 -5 L11 -16", w: 12 },
  π: { d: "M0.5 -9 C2 -10.5 3 -10 5 -10 L12 -10 M3.5 -10 C3.5 -5 3 -2 1.5 0 M8.5 -10 L8.5 -2 C8.5 0 10 0.3 11.5 -0.8", w: 12, top: -10.5 },
  Σ: { d: "M13 -16 L1 -16 L8 -8 L1 0 L13 0", w: 14 },
  "∞": { d: "M8 -6 C5 -10 1 -10 1 -6 C1 -2 5 -2 8 -6 C11 -10 15 -10 15 -6 C15 -2 11 -2 8 -6 Z", w: 16, top: -10.5 },
  "∫": { d: "M9 -21 C7.5 -23.5 5 -23 4.5 -18 L3.5 2 C3 7 0.5 7.5 -1 5.5", w: 8, top: -23.5, bottom: 7 },
  "+": { d: "M1 -6 L11 -6 M6 -11 L6 -1", w: 12, top: -11 },
  "=": { d: "M1 -8.5 L11 -8.5 M1 -3.5 L11 -3.5", w: 12, top: -9 },
  "(": { d: "M5 -18 C1 -13 1 -1 5 4", w: 6, top: -18, bottom: 4 },
  ")": { d: "M1 -18 C5 -13 5 -1 1 4", w: 6, top: -18, bottom: 4 },
};

/** 公式贴纸的内容：^ 为上标、_ 为下标，多个字符用 {} 括起。 */
export const FORMULA_TEXT = {
  pi: "π",
  pythagorean: "a^2+b^2=c^2",
  euler: "e^{iπ}+1=0",
  integral: "∫f(x)dx",
  infinity: "∞",
  emc2: "E=mc^2",
  fma: "F=ma",
  ohm: "U=IR",
  h2o: "H_2O",
  co2: "CO_2",
  nacl: "NaCl",
  "glucose-formula": "C_6H_{12}O_6",
} as const;

const SCRIPT_SCALE = 0.6;
const SCRIPT_SHIFT = { sup: -9, sub: 4 } as const;
const OPERATORS = new Set(["+", "="]);
const GAP = 1.8;

export type PlacedGlyph = { d: string; x: number; y: number; scale: number };
export type TextLayout = { glyphs: PlacedGlyph[]; width: number; top: number; bottom: number };

/** 拆出每个字符及其上下标位置。 */
function parse(text: string): Array<{ ch: string; script?: keyof typeof SCRIPT_SHIFT }> {
  const chars = [...text];
  const result: Array<{ ch: string; script?: keyof typeof SCRIPT_SHIFT }> = [];
  for (let i = 0; i < chars.length; i++) {
    const ch = chars[i];
    if (ch !== "^" && ch !== "_") {
      result.push({ ch });
      continue;
    }
    const script = ch === "^" ? "sup" : "sub";
    const end = chars[i + 1] === "{" ? chars.indexOf("}", i + 2) : i + 1;
    const group = chars[i + 1] === "{" ? chars.slice(i + 2, end) : [chars[i + 1]];
    for (const c of group) result.push({ ch: c, script });
    i = end;
  }
  return result;
}

/** 字形里没有的字符；用于测试所有公式都能完整绘制。 */
export function missingGlyphs(text: string): string[] {
  return parse(text)
    .map(({ ch }) => ch)
    .filter((ch) => !GLYPHS[ch]);
}

/** 按字宽从左到右排列，返回各字形的位置与整行的宽度、上下边界（基线 y = 0）。 */
export function layoutText(text: string): TextLayout {
  const glyphs: PlacedGlyph[] = [];
  let x = 0;
  let width = 0;
  let top = 0;
  let bottom = 0;
  for (const { ch, script } of parse(text)) {
    const glyph = GLYPHS[ch];
    if (!glyph) continue;
    const scale = script ? SCRIPT_SCALE : 1;
    const y = script ? SCRIPT_SHIFT[script] : 0;
    const pad = OPERATORS.has(ch) ? 3 : 0;
    x += pad;
    glyphs.push({ d: glyph.d, x, y, scale });
    width = x + glyph.w * scale;
    top = Math.min(top, y + (glyph.top ?? -16) * scale);
    bottom = Math.max(bottom, y + (glyph.bottom ?? 0) * scale);
    x = width + pad + GAP * scale;
  }
  return { glyphs, width, top, bottom };
}
