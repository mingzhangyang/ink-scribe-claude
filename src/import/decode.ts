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

/**
 * 从 Word 文档的 word/document.xml 中提取纯文本：每个段落一行，保留制表符与手动换行，
 * 列表项加 “- ” 前缀，忽略样式、批注与修订删除的文字。
 */
export function docxXmlToText(xml: string): string {
  const body = xml.replace(/<w:del\b[\s\S]*?<\/w:del>/g, "");
  const paragraphs = body.match(/<w:p[\s>][\s\S]*?<\/w:p>/g) ?? [];
  const lines = paragraphs.map((paragraph) => {
    const isList = /<w:numPr\b/.test(paragraph);
    let line = "";
    for (const token of paragraph.match(/<w:t(?:\s[^>]*)?>[\s\S]*?<\/w:t>|<w:tab\/>|<w:br\/>|<w:br\s[^>]*\/>/g) ?? []) {
      if (token.startsWith("<w:tab")) line += "\t";
      else if (token.startsWith("<w:br")) line += "\n";
      else line += decodeXmlEntities(token.replace(/^<w:t(?:\s[^>]*)?>|<\/w:t>$/g, ""));
    }
    return isList && line.trim() ? `- ${line.trim()}` : line;
  });
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
