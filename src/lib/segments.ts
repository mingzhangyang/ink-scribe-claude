/** 把正文切分为普通片段与重点片段，供手写渲染器分别着色。 */

export type TextRun = { text: string; highlight: number | null };

export function splitHighlights(text: string, highlights: string[]): TextRun[] {
  const ranges: Array<{ start: number; end: number; index: number }> = [];
  const lower = text.toLowerCase();
  highlights.forEach((phrase, index) => {
    if (!phrase) return;
    const needle = phrase.toLowerCase();
    let from = 0;
    for (;;) {
      const start = lower.indexOf(needle, from);
      if (start < 0) break;
      const end = start + needle.length;
      if (!ranges.some((r) => start < r.end && end > r.start)) ranges.push({ start, end, index });
      from = end;
    }
  });
  ranges.sort((a, b) => a.start - b.start);

  const runs: TextRun[] = [];
  let cursor = 0;
  for (const range of ranges) {
    if (range.start > cursor) runs.push({ text: text.slice(cursor, range.start), highlight: null });
    runs.push({ text: text.slice(range.start, range.end), highlight: range.index });
    cursor = range.end;
  }
  if (cursor < text.length) runs.push({ text: text.slice(cursor), highlight: null });
  return runs;
}

export type ContentLine =
  | { kind: "text"; text: string }
  | { kind: "bullet"; text: string }
  | { kind: "numbered"; marker: string; text: string }
  | { kind: "gap" };

/** 识别以“- ”“• ”或“1.”开头的列表行，其余作为普通段落行。 */
export function parseContentLines(content: string): ContentLine[] {
  const lines: ContentLine[] = [];
  for (const raw of content.split("\n")) {
    const line = raw.trim();
    if (!line) {
      if (lines.length > 0 && lines[lines.length - 1].kind !== "gap") lines.push({ kind: "gap" });
      continue;
    }
    const bullet = line.match(/^[-*•·]\s+(.*)$/);
    if (bullet) {
      lines.push({ kind: "bullet", text: bullet[1] });
      continue;
    }
    const numbered = line.match(/^(\d{1,2})[.、)）]\s*(.*)$/);
    if (numbered && numbered[2]) {
      lines.push({ kind: "numbered", marker: numbered[1], text: numbered[2] });
      continue;
    }
    lines.push({ kind: "text", text: line });
  }
  while (lines.length > 0 && lines[lines.length - 1].kind === "gap") lines.pop();
  return lines;
}

/** 按字素切分（兼容 emoji 与组合字符），不支持 Intl.Segmenter 时退化为码点。 */
export function graphemes(text: string): string[] {
  if (typeof Intl !== "undefined" && "Segmenter" in Intl) {
    const segmenter = new Intl.Segmenter(undefined, { granularity: "grapheme" });
    return Array.from(segmenter.segment(text), (s) => s.segment);
  }
  return Array.from(text);
}
