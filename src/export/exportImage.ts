import { domToBlob } from "modern-screenshot";
import { loadFontCss } from "../fonts.ts";
import { getMessages } from "../i18n/index.ts";
import { buildFontEmbedCss, ensureFontsLoaded } from "./fontEmbed.ts";
import { effectiveScale } from "./scale.ts";
import { preparePaperTexture } from "./paperTexture.ts";
import { measureNoteOverflow } from "../lib/note-fit.ts";

export type ExportFormat = "png" | "jpeg";
export type ExportScale = 1 | 2 | 3;

export type ExportOptions = {
  format: ExportFormat;
  scale: ExportScale;
  families: string[];
  background: string;
};

export { effectiveScale };

/** 由 CSS content 生成、不在 textContent 中的字符（列表序号、线索问号、区块标记）。 */
const CSS_GENERATED_CHARS = "0123456789.?✦";

function excludeEditorChrome(node: Node): boolean {
  return !(node instanceof Element && node.getAttribute("data-export-ignore") === "true");
}

/**
 * 导出开始时把画布复制为一份快照，放在视口外渲染。等待字体加载期间用户可能继续编辑、
 * 改样式或生成新笔记，快照保证导出的内容、样式与开始时选定的字体一致。
 */
function snapshotNode(node: HTMLElement): HTMLElement {
  const clone = node.cloneNode(true) as HTMLElement;
  clone.setAttribute("aria-hidden", "true");
  clone.setAttribute("inert", "");
  Object.assign(clone.style, { position: "fixed", left: "-100000px", top: "0", pointerEvents: "none" });
  document.body.appendChild(clone);
  return clone;
}

const AUTO_SIZE_ATTRIBUTE = "data-export-auto-size";
const REPLACED_ELEMENTS = new Set(["IMG", "CANVAS", "VIDEO", "IFRAME", "OBJECT", "EMBED"]);

/**
 * modern-screenshot 把每个元素的计算样式写成内联样式，其中 width/height 是预览里量出的像素值。
 * 对于尺寸本来由内容决定（auto）的盒子，这会把导出锁死在预览的测量结果上：导出的 SVG 环境里
 * 文字只要宽出一丝（iOS Safari 上会发生），刚好容纳文字的盒子就会多折一行并叠到后面的内容上；
 * 被固定高度的父级还会吞掉子元素本应折叠出去的外边距。这里记录哪些盒子的尺寸是 auto，
 * 导出时放开它们，让导出按与预览相同的规则重新排版。
 *
 * 元素不渲染时，getComputedStyle 返回的是计算值（auto、百分比）而不是布局后的像素值。
 */
function markAutoSizes(snapshot: HTMLElement): void {
  const display = snapshot.style.display;
  snapshot.style.display = "none";
  try {
    for (const element of snapshot.querySelectorAll<HTMLElement>("*")) {
      if (!(element instanceof HTMLElement) || REPLACED_ELEMENTS.has(element.tagName)) continue;
      const style = getComputedStyle(element);
      const axes = `${style.width === "auto" ? "w" : ""}${style.height === "auto" ? "h" : ""}`;
      if (axes) element.setAttribute(AUTO_SIZE_ATTRIBUTE, axes);
    }
  } finally {
    snapshot.style.display = display;
  }
}

function releaseAutoSizes(cloned: Node): void {
  if (!(cloned instanceof HTMLElement)) return;
  const axes = cloned.getAttribute(AUTO_SIZE_ATTRIBUTE);
  if (!axes) return;
  cloned.removeAttribute(AUTO_SIZE_ATTRIBUTE);
  // 笔记只使用横排书写，逻辑尺寸与物理尺寸一一对应。
  if (axes.includes("w")) for (const name of ["width", "inline-size"]) cloned.style.removeProperty(name);
  if (axes.includes("h")) for (const name of ["height", "block-size"]) cloned.style.removeProperty(name);
}

export async function renderNoteBlob(node: HTMLElement, options: ExportOptions): Promise<{ blob: Blob; scale: number }> {
  if (node.dataset.renderStatus !== "ready") throw new Error("Note layout is not ready for export");
  const snapshot = snapshotNode(node);
  try {
    const text = `${snapshot.textContent ?? ""}${CSS_GENERATED_CHARS}`;
    await Promise.all(options.families.map(loadFontCss));
    await ensureFontsLoaded(options.families, text);
    if (measureNoteOverflow(snapshot)) throw new Error("Note content does not fit the export canvas");
    const [cssText] = await Promise.all([buildFontEmbedCss(options.families, text), preparePaperTexture(snapshot)]);
    const width = snapshot.offsetWidth;
    const height = snapshot.offsetHeight;
    markAutoSizes(snapshot);
    const scale = effectiveScale(width, height, options.scale);
    const blob = await domToBlob(snapshot, {
      width,
      height,
      scale,
      type: options.format === "jpeg" ? "image/jpeg" : "image/png",
      quality: 0.92,
      backgroundColor: options.background,
      filter: excludeEditorChrome,
      font: { cssText },
      timeout: 30_000,
      onCloneEachNode: releaseAutoSizes,
      // 快照位于视口外，渲染时去掉定位样式
      style: { position: "static", left: "auto", top: "auto" },
    });
    return { blob, scale };
  } finally {
    snapshot.remove();
  }
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
    return { supported: false, reason: getMessages().export.clipboardNeedsHttps };
  }
  if (typeof ClipboardItem === "undefined" || !navigator.clipboard?.write) {
    return { supported: false, reason: getMessages().export.clipboardUnsupported };
  }
  if (typeof ClipboardItem.supports === "function" && !ClipboardItem.supports("image/png")) {
    return { supported: false, reason: getMessages().export.clipboardNoPng };
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
