export { parseContentLines, splitHighlights, type ContentLine, type TextRun } from "../../shared/content.ts";

/** 按字素切分（兼容 emoji 与组合字符），不支持 Intl.Segmenter 时退化为码点。 */
export function graphemes(text: string): string[] {
  if (typeof Intl !== "undefined" && "Segmenter" in Intl) {
    const segmenter = new Intl.Segmenter(undefined, { granularity: "grapheme" });
    return Array.from(segmenter.segment(text), (s) => s.segment);
  }
  return Array.from(text);
}
