/**
 * 不依赖 DOM 的文件解析工具（可在 Node 中单元测试）。
 */

/** 识别 BOM；无 BOM 时先按 UTF-8 严格解码，失败再按 GB18030（兼容 GBK/GB2312 的中文文本）解码。 */
export function decodeTextBytes(bytes: Uint8Array): string {
  if (bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) return new TextDecoder("utf-8").decode(bytes.subarray(3));
  if (bytes[0] === 0xff && bytes[1] === 0xfe) return new TextDecoder("utf-16le").decode(bytes.subarray(2));
  if (bytes[0] === 0xfe && bytes[1] === 0xff) return new TextDecoder("utf-16be").decode(bytes.subarray(2));
  try {
    return new TextDecoder("utf-8", { fatal: true, ignoreBOM: false }).decode(bytes);
  } catch {
    return new TextDecoder("gb18030").decode(bytes);
  }
}

const XML_ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" };

function decodeXmlEntities(text: string): string {
  return text.replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos);/gi, (_, entity: string) => {
    if (entity[0] === "#") {
      const code = entity[1].toLowerCase() === "x" ? parseInt(entity.slice(2), 16) : parseInt(entity.slice(1), 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : "";
    }
    return XML_ENTITIES[entity.toLowerCase()] ?? "";
  });
}

// 只关心段落、文字、制表符、换行、列表标记与修订删除这几种标签
const DOCX_TAG = /<(\/?)w:(p|t|tab|br|numPr|del)(?=[\s/>])[^>]*>/g;

/**
 * 从 Word 文档的 word/document.xml 中提取纯文本：每个段落一行，保留制表符与手动换行，
 * 列表项加 “- ” 前缀，忽略样式、批注与修订删除的文字。
 * 单遍扫描标签（不回溯），缺少闭合标签的畸形文档也只需线性时间。
 */
export function docxXmlToText(xml: string): string {
  const lines: string[] = [];
  const emit = (paragraph: { line: string; isList: boolean }) =>
    lines.push(paragraph.isList && paragraph.line.trim() ? `- ${paragraph.line.trim()}` : paragraph.line);
  // 段落可以嵌套（文本框中的段落位于外层段落的 run 内）
  const stack: Array<{ line: string; isList: boolean }> = [];
  let deleted = 0;
  let textStart = -1;
  for (const match of xml.matchAll(DOCX_TAG)) {
    const [tag, closing, name] = match;
    const selfClosing = tag.endsWith("/>");
    const current = stack[stack.length - 1];
    if (textStart >= 0) {
      // <w:t> 内不会出现其他标签（XML 中的 “<” 已转义），遇到闭合标签时取出文字
      if (name === "t" && closing) {
        if (current && deleted === 0) current.line += decodeXmlEntities(xml.slice(textStart, match.index));
        textStart = -1;
      }
      continue;
    }
    switch (name) {
      case "del":
        if (!selfClosing) deleted = closing ? Math.max(0, deleted - 1) : deleted + 1;
        break;
      case "p":
        if (closing) {
          const paragraph = stack.pop();
          if (paragraph) emit(paragraph);
        } else if (selfClosing) {
          lines.push("");
        } else {
          stack.push({ line: "", isList: false });
        }
        break;
      case "t":
        if (!closing && !selfClosing) textStart = match.index + tag.length;
        break;
      case "numPr":
        if (current && !closing) current.isList = true;
        break;
      case "tab":
        // 带属性的 <w:tab w:val=… w:pos=…/> 是段落的制表位定义，不是正文中的制表符
        if (current && deleted === 0 && /^<w:tab\s*\/>$/.test(tag)) current.line += "\t";
        break;
      case "br":
        if (current && deleted === 0 && selfClosing) current.line += "\n";
        break;
    }
  }
  // 缺少闭合标签的段落也保留已读到的文字
  stack.forEach(emit);
  return normalizeExtractedText(lines.join("\n"));
}

/** 统一换行、去掉行尾空白并压缩多余空行。 */
export function normalizeExtractedText(text: string): string {
  return text
    .replace(/\r\n?/g, "\n")
    .replace(/ /g, " ")
    .split("\n")
    .map((line) => line.replace(/[ \t]+$/g, ""))
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/**
 * 拼接 PDF 文本片段：pdf.js 按绘制顺序给出片段，hasEOL 表示行尾。
 * 中文行与行之间直接相连，英文行之间补一个空格；行末是句末标点或空行时保留换行。
 */
export function joinPdfTextItems(items: Array<{ str: string; hasEOL?: boolean }>): string {
  let text = "";
  for (const item of items) {
    text += item.str;
    if (item.hasEOL) text += "\n";
  }
  const lines = text.split("\n");
  let out = "";
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trimEnd();
    out += line;
    if (i === lines.length - 1) break;
    const next = lines[i + 1].trim();
    if (!line.trim() || !next || /[。！？!?；;：:.」』”"]$/.test(line) || /^([-*•·]|\d+[.、)])\s*/.test(next)) {
      out += "\n";
    } else if (/[㐀-鿿，、]$/.test(line) || /^[㐀-鿿]/.test(next)) {
      // 中文自动换行：直接拼接
    } else {
      out += /-$/.test(line) ? "" : " ";
    }
  }
  return out;
}
