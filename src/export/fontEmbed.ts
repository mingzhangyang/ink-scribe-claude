import { codePointsOf, normalizeFamily, parseUnicodeRange, rangesIntersect } from "../lib/unicode-range.ts";

/**
 * 导出图片时，浏览器在隔离环境中渲染 SVG foreignObject，必须把字体以 data URL 形式内嵌。
 * 中文手写字体有上百个 unicode-range 分片，这里只挑出与笔记文字有交集的分片，
 * 避免一次导出下载并编码数 MB 的字体。
 */

type FontFaceSource = {
  family: string;
  style: string;
  weight: string;
  unicodeRange: string;
  url: string;
  format: string;
};

const dataUrlCache = new Map<string, Promise<string>>();

function pickUrl(src: string, base: string): { url: string; format: string } | undefined {
  const candidates = [...src.matchAll(/url\(\s*(['"]?)([^'")]+)\1\s*\)\s*(?:format\(\s*['"]?([\w-]+)['"]?\s*\))?/g)].map((m) => ({
    url: m[2],
    format: m[3] ?? "",
  }));
  const chosen = candidates.find((c) => c.format === "woff2" || c.url.endsWith(".woff2")) ?? candidates[0];
  if (!chosen) return undefined;
  try {
    return { url: new URL(chosen.url, base).href, format: chosen.format || "woff2" };
  } catch {
    return undefined;
  }
}

function collectRules(rules: CSSRuleList, base: string, families: Set<string>, out: FontFaceSource[]): void {
  for (const rule of Array.from(rules)) {
    if (rule instanceof CSSFontFaceRule) {
      const family = rule.style.getPropertyValue("font-family");
      if (!families.has(normalizeFamily(family))) continue;
      const source = pickUrl(rule.style.getPropertyValue("src"), base);
      if (!source) continue;
      out.push({
        family: family.trim().replace(/^["']|["']$/g, ""),
        style: rule.style.getPropertyValue("font-style") || "normal",
        weight: rule.style.getPropertyValue("font-weight") || "400",
        unicodeRange: rule.style.getPropertyValue("unicode-range"),
        ...source,
      });
    } else if (rule instanceof CSSImportRule && rule.styleSheet) {
      try {
        collectRules(rule.styleSheet.cssRules, rule.styleSheet.href ?? base, families, out);
      } catch {
        // 跨域样式表无法读取，跳过
      }
    } else if ("cssRules" in rule && (rule as CSSGroupingRule).cssRules) {
      collectRules((rule as CSSGroupingRule).cssRules, base, families, out);
    }
  }
}

export function findFontFaces(families: string[], text: string): FontFaceSource[] {
  const wanted = new Set(families.map(normalizeFamily));
  const all: FontFaceSource[] = [];
  for (const sheet of Array.from(document.styleSheets)) {
    let rules: CSSRuleList;
    try {
      rules = sheet.cssRules;
    } catch {
      continue;
    }
    collectRules(rules, sheet.href ?? document.baseURI, wanted, all);
  }
  const codePoints = codePointsOf(text);
  return all.filter((face) => rangesIntersect(parseUnicodeRange(face.unicodeRange), codePoints));
}

async function toDataUrl(url: string): Promise<string> {
  let pending = dataUrlCache.get(url);
  if (!pending) {
    pending = (async () => {
      const response = await fetch(url, { cache: "force-cache" });
      if (!response.ok) throw new Error(`Font request failed: ${response.status}`);
      const blob = await response.blob();
      return await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result));
        reader.onerror = () => reject(reader.error);
        reader.readAsDataURL(blob);
      });
    })();
    dataUrlCache.set(url, pending);
    pending.catch(() => dataUrlCache.delete(url));
  }
  return pending;
}

/** 等待页面用到的字形全部加载完成（包括按需加载的 unicode-range 分片）。 */
export async function ensureFontsLoaded(families: string[], text: string): Promise<void> {
  if (!("fonts" in document)) return;
  const sample = text.length > 20_000 ? text.slice(0, 20_000) : text;
  await Promise.all(families.map((family) => document.fonts.load(`20px "${family}"`, sample).catch(() => [])));
  await document.fonts.ready;
}

export async function buildFontEmbedCss(families: string[], text: string): Promise<string> {
  const faces = findFontFaces(families, text);
  const css = await Promise.all(
    faces.map(async (face) => {
      try {
        const data = await toDataUrl(face.url);
        return [
          "@font-face{",
          `font-family:"${face.family}";`,
          `font-style:${face.style};`,
          `font-weight:${face.weight};`,
          `src:url(${data}) format("${face.format}");`,
          face.unicodeRange ? `unicode-range:${face.unicodeRange};` : "",
          "}",
        ].join("");
      } catch {
        return "";
      }
    }),
  );
  return css.join("\n");
}
