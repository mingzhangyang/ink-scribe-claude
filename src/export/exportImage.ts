import { domToBlob } from "modern-screenshot";
import { loadFontCss } from "../fonts.ts";
import { buildFontEmbedCss, ensureFontsLoaded } from "./fontEmbed.ts";
import { effectiveScale } from "./scale.ts";

export type ExportFormat = "png" | "jpeg";
export type ExportScale = 1 | 2 | 3;

export type ExportOptions = {
  format: ExportFormat;
  scale: ExportScale;
  families: string[];
  background: string;
};

export { effectiveScale };

function excludeEditorChrome(node: Node): boolean {
  return !(node instanceof Element && node.getAttribute("data-export-ignore") === "true");
}

export async function renderNoteBlob(node: HTMLElement, options: ExportOptions): Promise<{ blob: Blob; scale: number }> {
  const text = node.textContent ?? "";
  await Promise.all(options.families.map(loadFontCss));
  await ensureFontsLoaded(options.families, text);
  const cssText = await buildFontEmbedCss(options.families, text);
  const scale = effectiveScale(node.offsetWidth, node.offsetHeight, options.scale);
  const blob = await domToBlob(node, {
    width: node.offsetWidth,
    height: node.offsetHeight,
    scale,
    type: options.format === "jpeg" ? "image/jpeg" : "image/png",
    quality: 0.92,
    backgroundColor: options.background,
    filter: excludeEditorChrome,
    font: { cssText },
    timeout: 30_000,
  });
  return { blob, scale };
}

export function fileNameFor(title: string, format: ExportFormat): string {
  const slug =
    title
      .replace(/[\\/:*?"<>|\s]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 40) || "note";
  const stamp = new Date().toISOString().slice(0, 10);
  return `inkscribe-${slug}-${stamp}.${format === "jpeg" ? "jpg" : "png"}`;
}

export function downloadBlob(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

export type ClipboardSupport = { supported: true } | { supported: false; reason: string };

export function clipboardSupport(): ClipboardSupport {
  if (typeof window === "undefined" || !window.isSecureContext) {
    return { supported: false, reason: "复制图片需要 HTTPS 安全连接" };
  }
  if (typeof ClipboardItem === "undefined" || !navigator.clipboard?.write) {
    return { supported: false, reason: "当前浏览器不支持复制图片" };
  }
  if (typeof ClipboardItem.supports === "function" && !ClipboardItem.supports("image/png")) {
    return { supported: false, reason: "当前浏览器不支持复制 PNG 图片" };
  }
  return { supported: true };
}

/**
 * 必须在用户手势中同步调用：Safari 要求 ClipboardItem 在点击事件内创建，
 * 图片内容以 Promise 形式延迟提供。剪贴板只支持 PNG。
 */
export function copyToClipboard(blob: Promise<Blob>): Promise<void> {
  const item = new ClipboardItem({ "image/png": blob });
  return navigator.clipboard.write([item]);
}
