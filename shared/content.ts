export type ContentLine =
  | { kind: "text"; text: string }
  | { kind: "bullet"; text: string }
  | { kind: "numbered"; marker: string; text: string }
  | { kind: "gap" };

/** The renderer and publication validator share the same visible content lines. */
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
    // “3.14” 这类小数不是列表序号：句点后紧跟数字时不当作序号
    const numbered = line.match(/^(\d{1,2})(?:\.(?!\d)|[、)）])\s*(.*)$/);
    if (numbered && numbered[2]) {
      lines.push({ kind: "numbered", marker: numbered[1], text: numbered[2] });
      continue;
    }
    lines.push({ kind: "text", text: line });
  }
  while (lines.length > 0 && lines[lines.length - 1].kind === "gap") lines.pop();
  return lines;
}

export type TextRun = { text: string; highlight: number | null };

/** Earlier phrases keep overlapping matches; later phrases only add non-overlapping ones. */
export function splitHighlights(text: string, highlights: string[]): TextRun[] {
  const ranges: Array<{ start: number; end: number; index: number }> = [];
  highlights.forEach((phrase, index) => {
    if (!phrase) return;
    // Match the original text: lowercasing can change its length and invalidate offsets (e.g. “İ”).
    const pattern = new RegExp(phrase.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "giu");
    for (const match of text.matchAll(pattern)) {
      const start = match.index;
      const end = start + match[0].length;
      if (!ranges.some((r) => start < r.end && end > r.start)) ranges.push({ start, end, index });
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
