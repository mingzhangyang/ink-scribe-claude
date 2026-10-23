import type { Messages } from "../i18n/index.ts";
import { decodeTextBytes, docxXmlToText, joinPdfTextItems, normalizeExtractedText } from "./decode.ts";

/**
 * 在浏览器本地把上传的文件转换为纯文本。文件本身不会上传到服务器，
 * 之后只有提取出的文字会像粘贴的文本一样发送给整理接口。
 */

export const MAX_FILE_BYTES = 20 * 1024 * 1024;
export const ACCEPTED_EXTENSIONS = [".txt", ".md", ".markdown", ".html", ".htm", ".docx", ".pdf"] as const;
const MAX_PDF_PAGES = 200;

export type FileKind = "text" | "html" | "docx" | "pdf";

export type ExtractResult = {
  text: string;
  kind: FileKind;
  /** PDF 的总页数。 */
  pages?: number;
  /** 实际读取的页数；超过上限的 PDF 只读取前面的页。 */
  pagesRead?: number;
};

export type ImportErrorKey = keyof Messages["importErrors"];

/** 导入失败的原因。界面按 key 翻译，切换界面语言后提示也随之切换。 */
export class FileImportError extends Error {
  readonly key: ImportErrorKey;
  constructor(key: ImportErrorKey) {
    super(key);
    this.key = key;
  }
}

export function detectKind(file: { name: string; type: string }): FileKind | null {
  const name = file.name.toLowerCase();
  if (name.endsWith(".pdf") || file.type === "application/pdf") return "pdf";
  if (name.endsWith(".docx") || file.type === "application/vnd.openxmlformats-officedocument.wordprocessingml.document") return "docx";
  if (/\.html?$/.test(name) || file.type === "text/html") return "html";
  if (/\.(txt|md|markdown)$/.test(name) || file.type.startsWith("text/")) return "text";
  return null;
}

const BLOCK_TAGS = new Set(["P", "DIV", "LI", "TR", "H1", "H2", "H3", "H4", "H5", "H6", "BLOCKQUOTE", "PRE", "SECTION", "ARTICLE", "HEADER", "FOOTER", "TABLE", "UL", "OL"]);

function htmlToText(html: string): string {
  // DOMParser 生成的是惰性文档：不会执行脚本，也不会加载图片等外部资源
  const doc = new DOMParser().parseFromString(html, "text/html");
  doc.querySelectorAll("script, style, noscript, template, iframe, svg, nav").forEach((el) => el.remove());
  const root = doc.querySelector("article, main") ?? doc.body;
  let text = "";
  // 列表符号推迟到列表项的第一段文字前再写入：<li><p>…</p></li> 中段落开头的换行不能把符号和内容拆开
  let pendingMarker = false;
  const emit = (chunk: string) => {
    if (!chunk) return;
    if (pendingMarker) {
      text += "- ";
      pendingMarker = false;
    }
    text += chunk;
  };
  const walk = (node: Node, pre: boolean) => {
    if (node.nodeType === Node.TEXT_NODE) {
      const raw = node.textContent ?? "";
      if (pre) {
        // <pre> 中的换行与缩进是内容的一部分（例如代码），原样保留
        if (pendingMarker && !raw.trim()) return;
        emit(raw);
        return;
      }
      let chunk = raw.replace(/\s+/g, " ");
      // 普通文本在行首的空白来自 HTML 排版，去掉
      if (/(^|\n|\t)$/.test(text)) chunk = chunk.replace(/^ +/, "");
      emit(chunk);
      return;
    }
    if (!(node instanceof Element)) return;
    if (node.tagName === "BR") {
      text += "\n";
      return;
    }
    const block = BLOCK_TAGS.has(node.tagName);
    if (block) text += "\n";
    if (node.tagName === "LI") pendingMarker = true;
    const childPre = pre || node.tagName === "PRE";
    node.childNodes.forEach((child) => walk(child, childPre));
    // 没有文字的列表项不输出符号
    if (node.tagName === "LI") pendingMarker = false;
    // 单元格之间用制表符分隔，否则 <td>Tea</td><td>10</td> 会连成 “Tea10”
    if (node.tagName === "TD" || node.tagName === "TH") text += "\t";
    if (block) text += "\n";
  };
  if (root) walk(root, false);
  return normalizeExtractedText(text);
}

/** word/document.xml 解压后的大小上限；上传大小只限制了压缩后的字节数。 */
const MAX_DOCX_XML_BYTES = 50 * 1024 * 1024;

async function docxToText(bytes: Uint8Array): Promise<string> {
  const [{ strFromU8 }, { readZipEntry, ZipEntryTooLargeError }] = await Promise.all([import("fflate"), import("./zip.ts")]);
  let xml: Uint8Array | null;
  try {
    xml = readZipEntry(bytes, "word/document.xml", MAX_DOCX_XML_BYTES);
  } catch (error) {
    if (error instanceof ZipEntryTooLargeError) throw new FileImportError("docxTooLarge");
    throw new FileImportError("docxUnreadable");
  }
  if (!xml) throw new FileImportError("docxEmpty");
  return docxXmlToText(strFromU8(xml));
}

async function pdfToText(bytes: Uint8Array): Promise<{ text: string; pages: number; pagesRead: number }> {
  const pdfjs = await import("pdfjs-dist");
  const { default: workerUrl } = await import("pdfjs-dist/build/pdf.worker.min.mjs?url");
  pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;
  let doc;
  try {
    doc = await pdfjs.getDocument({
      data: bytes,
      // CMap 用于解析中文等 CID 字体，随静态资源同源提供（见 vite.config.ts）
      cMapUrl: `${import.meta.env.BASE_URL}pdfjs/cmaps/`,
      cMapPacked: true,
      disableFontFace: true,
      useSystemFonts: false,
    }).promise;
  } catch (error) {
    const name = (error as { name?: string })?.name;
    throw new FileImportError(name === "PasswordException" ? "pdfEncrypted" : "pdfUnreadable");
  }
  try {
    const pages: string[] = [];
    const count = Math.min(doc.numPages, MAX_PDF_PAGES);
    for (let i = 1; i <= count; i++) {
      const page = await doc.getPage(i);
      const content = await page.getTextContent();
      pages.push(joinPdfTextItems(content.items.flatMap((item) => ("str" in item ? [item] : []))));
      page.cleanup();
    }
    return { text: normalizeExtractedText(pages.join("\n\n")), pages: doc.numPages, pagesRead: count };
  } finally {
    void doc.loadingTask.destroy();
  }
}

export async function extractTextFromFile(file: File): Promise<ExtractResult> {
  const kind = detectKind(file);
  if (!kind) throw new FileImportError("unsupported");
  if (file.size > MAX_FILE_BYTES) throw new FileImportError("tooLarge");
  const bytes = new Uint8Array(await file.arrayBuffer());

  let result: ExtractResult;
  switch (kind) {
    case "text":
      result = { kind, text: normalizeExtractedText(decodeTextBytes(bytes)) };
      break;
    case "html":
      result = { kind, text: htmlToText(decodeTextBytes(bytes)) };
      break;
    case "docx":
      result = { kind, text: await docxToText(bytes) };
      break;
    case "pdf": {
      const { text, pages, pagesRead } = await pdfToText(bytes);
      result = { kind, text, pages, pagesRead };
      break;
    }
  }
  if (!result.text.trim()) {
    throw new FileImportError(kind === "pdf" ? "pdfNoText" : "noText");
  }
  return result;
}
