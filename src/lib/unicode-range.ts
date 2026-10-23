/** 解析 CSS @font-face 的 unicode-range，用于导出时只嵌入实际用到的字体分片。 */

export type CodeRange = [number, number];

export function parseUnicodeRange(value: string): CodeRange[] {
  const ranges: CodeRange[] = [];
  for (const part of value.split(",")) {
    const token = part.trim().replace(/^u\+/i, "");
    if (!token) continue;
    if (token.includes("?")) {
      const start = parseInt(token.replace(/\?/g, "0"), 16);
      const end = parseInt(token.replace(/\?/g, "f"), 16);
      if (Number.isFinite(start) && Number.isFinite(end)) ranges.push([start, end]);
      continue;
    }
    const [a, b] = token.split("-");
    const start = parseInt(a, 16);
    const end = b ? parseInt(b, 16) : start;
    if (Number.isFinite(start) && Number.isFinite(end)) ranges.push([start, end]);
  }
  return ranges;
}

export function codePointsOf(text: string): Set<number> {
  const set = new Set<number>();
  for (const ch of text) set.add(ch.codePointAt(0)!);
  return set;
}

export function rangesIntersect(ranges: CodeRange[], codePoints: Set<number>): boolean {
  if (ranges.length === 0) return true;
  for (const cp of codePoints) {
    for (const [start, end] of ranges) {
      if (cp >= start && cp <= end) return true;
    }
  }
  return false;
}

/** 规范化 font-family 名称：去掉引号并转小写，便于比较。 */
export function normalizeFamily(family: string): string {
  return family.trim().replace(/^["']|["']$/g, "").toLowerCase();
}
