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
