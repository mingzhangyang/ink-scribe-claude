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

export class FileImportError extends Error {}

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
  const walk = (node: Node) => {
    if (node.nodeType === Node.TEXT_NODE) {
      text += (node.textContent ?? "").replace(/\s+/g, " ");
      return;
    }
    if (!(node instanceof Element)) return;
    if (node.tagName === "BR") {
      text += "\n";
      return;
    }
    const block = BLOCK_TAGS.has(node.tagName);
    if (block) text += "\n";
    if (node.tagName === "LI") text += "- ";
    node.childNodes.forEach(walk);
    if (block) text += "\n";
  };
  if (root) walk(root);
  return normalizeExtractedText(text.split("\n").map((l) => l.trim()).join("\n"));
}

async function docxToText(bytes: Uint8Array): Promise<string> {
  const { unzipSync, strFromU8 } = await import("fflate");
  let files: Record<string, Uint8Array>;
  try {
    files = unzipSync(bytes, { filter: (f) => f.name === "word/document.xml" });
  } catch {
    throw new FileImportError("无法读取该 Word 文件，请确认是 .docx 格式（不支持旧版 .doc）。");
  }
  const xml = files["word/document.xml"];
  if (!xml) throw new FileImportError("Word 文件中没有找到正文内容。");
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
    throw new FileImportError(name === "PasswordException" ? "该 PDF 已加密，请先解除密码保护。" : "无法读取该 PDF 文件。");
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
  if (!kind) throw new FileImportError("暂不支持该文件类型，请上传 TXT、Markdown、HTML、Word（.docx）或 PDF 文件。");
  if (file.size > MAX_FILE_BYTES) throw new FileImportError("文件超过 20MB，请先压缩或拆分后再上传。");
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
    throw new FileImportError(
      kind === "pdf" ? "没有从 PDF 中读到文字，它可能是扫描件或图片，目前不支持识别图片中的文字。" : "文件中没有可用的文字内容。",
    );
  }
  return result;
}
