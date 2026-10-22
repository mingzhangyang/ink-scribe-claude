/** 字符串清理工具：去除控制字符、HTML 标签与 Markdown 强调符号，并按码点安全截断。 */

const CONTROL_CHARS = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F\u200B\uFEFF\u2028\u2029]/g;
// 只移除常见的 HTML 元素标签。不能匹配任意 <标识符>，否则 Promise<string>、Vec<u8> 这类代码会被吞掉
const HTML_TAG =
  /<\/?(?:a|abbr|article|b|blockquote|br|code|del|div|em|font|footer|h[1-6]|header|hr|i|iframe|img|ins|li|mark|nav|ol|p|pre|s|script|section|small|span|strong|style|sub|sup|svg|table|tbody|td|th|thead|tr|u|ul)(?=[\s/>])[^<>]*>/gi;
// 不移除 __：会破坏 __init__ 这类标识符
const MD_EMPHASIS = /(\*\*|~~|`)/g;

export type CleanOptions = {
  /** 是否保留换行（段落正文需要保留，标题等单行字段不保留）。 */
  multiline?: boolean;
  /** 保留 HTML 标签与 Markdown 符号（用户原文交给模型理解，不应改写其中的代码与标记）。 */
  keepMarkup?: boolean;
};

export function cleanText(value: unknown, maxChars: number, options: CleanOptions = {}): string {
  if (typeof value !== "string" && typeof value !== "number") return "";
  let text = String(value)
    .replace(/\r\n?/g, "\n")
    .replace(/\t/g, " ")
    .replace(CONTROL_CHARS, "");
  if (!options.keepMarkup) text = text.replace(HTML_TAG, "").replace(MD_EMPHASIS, "");

  if (options.multiline) {
    text = text
      .split("\n")
      .map((line) => line.replace(/ {2,}/g, " ").trimEnd())
      .join("\n")
      .replace(/\n{3,}/g, "\n\n");
  } else {
    text = text.replace(/\s+/g, " ");
  }
  return truncate(text.trim(), maxChars);
}

/** 按 Unicode 码点截断，避免把代理对拆成乱码。 */
export function truncate(text: string, maxChars: number): string {
  const chars = Array.from(text);
  if (chars.length <= maxChars) return text;
  return chars.slice(0, Math.max(0, maxChars - 1)).join("").trimEnd() + "…";
}

export function charLength(text: string): number {
  let count = 0;
  for (const _ of text) count++;
  return count;
}

const CJK = /[㐀-鿿豈-﫿぀-ヿ가-힯]/g;

/** 粗略判断文本主语言：中日韩字符占比超过 20% 视为中文。 */
export function detectLanguage(text: string): "zh" | "en" {
  const sample = text.slice(0, 4000);
  const cjk = sample.match(CJK)?.length ?? 0;
  const letters = sample.match(/[A-Za-z]/g)?.length ?? 0;
  if (cjk === 0) return "en";
  return cjk / Math.max(1, cjk + letters / 4) > 0.2 ? "zh" : "en";
}
