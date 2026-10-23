import { codePointsOf, normalizeFamily, parseUnicodeRange, rangesIntersect } from "../lib/unicode-range.ts";

/**
 * 导出图片时，浏览器在隔离环境中渲染 SVG foreignObject，必须把字体以 data URL 形式内嵌。
 * 中文手写字体有上百个 unicode-range 分片，这里只挑出与笔记文字有交集的分片，
 * 避免一次导出下载并编码数 MB 的字体。
 */

type FontFaceSource = {
  rule: CSSFontFaceRule;
  base: string;
  family: string;
  style: string;
  weight: string;
  stretch: string;
  unicodeRange: string;
  url: string;
  format: string;
};

const dataUrlCache = new Map<string, Promise<string>>();
const retrySources = new WeakMap<CSSFontFaceRule, { src: string; attempt: number }>();

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
        rule,
        base,
        family: family.trim().replace(/^["']|["']$/g, ""),
        style: rule.style.getPropertyValue("font-style") || "normal",
        weight: rule.style.getPropertyValue("font-weight") || "normal",
        stretch: rule.style.getPropertyValue("font-stretch") || "normal",
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

function sameFace(source: FontFaceSource, face: FontFace): boolean {
  const range = (value: string) => (value || "U+0-10FFFF").replace(/\s/g, "").toUpperCase();
  return normalizeFamily(source.family) === normalizeFamily(face.family)
    && source.style === face.style && source.weight === face.weight && source.stretch === face.stretch
    && range(source.unicodeRange) === range(face.unicodeRange);
}

/** A CSS-connected FontFace in error cannot reload. Changing src creates a new face. */
function resetFailedFontFaces(families: string[], text: string): void {
  const failed = Array.from(document.fonts).filter((face) => face.status === "error");
  if (!failed.length) return;
  for (const source of findFontFaces(families, text)) {
    if (!failed.some((face) => sameFace(source, face))) continue;
    const retry = retrySources.get(source.rule) ?? { src: source.rule.style.getPropertyValue("src"), attempt: 0 };
    retry.attempt++;
    retrySources.set(source.rule, retry);
    // Keep the original fallbacks and descriptors; a fresh URL also bypasses failed font-resource caches.
    const src = retry.src.replace(/url\(\s*(['"]?)([^'")]+)\1\s*\)/g, (match, _quote: string, path: string) => {
      const url = new URL(path, source.base);
      if (url.protocol !== "http:" && url.protocol !== "https:") return match;
      url.searchParams.set("ink-font-retry", String(retry.attempt));
      return `url("${url.href}")`;
    });
    source.rule.style.setProperty("src", src);
  }
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
export async function ensureFontsLoaded(families: string[], text: string, options: { retryFailed?: boolean } = {}): Promise<void> {
  if (!("fonts" in document)) return;
  if (options.retryFailed) resetFailedFontFaces(families, text);
  await Promise.all(families.map((family) => document.fonts.load(`20px "${family}"`, text)));
  await document.fonts.ready;
}

export async function buildFontEmbedCss(families: string[], text: string): Promise<string> {
  const faces = findFontFaces(families, text);
  const css = await Promise.all(
    faces.map(async (face) => {
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
    }),
  );
  return css.join("\n");
}
