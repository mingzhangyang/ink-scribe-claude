/// <reference types="vite/client" />
import { domToCanvas } from "modern-screenshot";
import { graphemes } from "../lib/segments.ts";

/**
 * 导出图片在 SVG foreignObject 中重新排版。部分浏览器（iOS Safari）在那里量出的文字
 * 比页面内宽一丝，而导出内部的几何信息脚本读不到。这里用同一条导出路径渲染几行“探针”：
 * 每行文字后面跟一个色块，从画布像素读出色块位置，就得到导出环境里文字的实际宽度。
 *
 * 有偏差时用 letter-spacing 逐字号抵消，使导出与已通过溢出检查的预览排版一致；
 * 抵消不掉的残差交还给调用方，在页面内模拟出同样的排版后再做一次溢出检查。
 */

/** 每个字符多出的宽度（px），按字号分组。 */
export type DriftBySize = Map<number, number>;

type TextGroup = { element: HTMLElement; size: number; base: number };

const LETTER_SPACING_ATTRIBUTE = "data-export-letter-spacing";
/**
 * 浏览器在导出图里把色块对齐到整像素，单次读数有 ±0.5px 的误差。探针行排上几百个字符，
 * 分摊到每个字符的误差约 0.003px，一行正文（约 40 字）累计约 0.1px。
 */
const PROBE_WIDTH = 3000;
const MARKER_WIDTH = 8;
const MAX_PROBE_SIZES = 4;
/** 色块位置的偏移超过整像素对齐的误差才算数。 */
export const DRIFT_TOLERANCE = 0.75;
/** 超过该值更像是字体没有生效，而不是排版偏差；不据此调整。 */
const MAX_PLAUSIBLE_DRIFT = 0.5;
const INHERITED_TEXT_PROPERTIES = [
  "font-family", "font-weight", "font-style", "font-synthesis", "font-kerning", "font-feature-settings",
  "font-variant-ligatures", "text-rendering", "-webkit-font-smoothing",
];

const roundSize = (size: number) => Math.round(size * 100) / 100;

/**
 * 仅用于验收测试（mock 构建）：模拟一个把文字排得更宽的导出环境。
 * ignoreCompensation 模拟 letter-spacing 抵消不了的偏差。
 */
type SimulatedDrift = { px: number; ignoreCompensation?: boolean };

function environmentLetterSpacing(base: number, requested: number): number {
  if (import.meta.env.MODE !== "mock") return requested;
  const simulated = (globalThis as { __inkExportTextDrift?: SimulatedDrift }).__inkExportTextDrift;
  if (!simulated) return requested;
  return (simulated.ignoreCompensation ? base : requested) + simulated.px;
}

/** 色块左边缘（CSS 像素）。用墨量重心定位，抗锯齿的半透明边缘不影响亚像素精度。 */
export function markerLeft(darkness: ArrayLike<number>, scale: number, markerWidth: number): number | null {
  let total = 0;
  let moment = 0;
  for (let x = 0; x < darkness.length; x++) {
    total += darkness[x];
    moment += darkness[x] * (x + 0.5);
  }
  if (total < markerWidth * scale * 0.9 || total > markerWidth * scale * 1.1) return null;
  return moment / total / scale - markerWidth / 2;
}

export function driftFor(drift: DriftBySize, size: number): number {
  let best = 0;
  let distance = Infinity;
  for (const [candidate, value] of drift) {
    const d = Math.abs(candidate - size);
    if (d < distance) {
      distance = d;
      best = value;
    }
  }
  return best;
}

/** 探针行上累计的偏移超过测量误差才算数。 */
export function significantDrift(drift: DriftBySize | null, base = 0): boolean {
  if (!drift) return false;
  for (const [size, value] of drift) if (Math.abs(value) * probeLength(size, base) >= DRIFT_TOLERANCE) return true;
  return false;
}

/** 字符按一个 em 加字距估宽（中文字符的上限），保证整行不超出探针宽度。 */
export function probeLength(size: number, base: number): number {
  return Math.max(8, Math.floor((PROBE_WIDTH - 80) / (size + Math.max(0, base) + 1)));
}

/** 直接包含文字的元素；逐字抖动的 .j 由父元素代表。 */
function textGroups(snapshot: HTMLElement): TextGroup[] {
  const groups: TextGroup[] = [];
  for (const element of snapshot.querySelectorAll<HTMLElement>("*")) {
    if (!(element instanceof HTMLElement) || element.classList.contains("j")) continue;
    const ownsText = element.hasAttribute("data-fit-text")
      || Array.from(element.childNodes).some((node) => node.nodeType === Node.TEXT_NODE && /\S/.test(node.nodeValue ?? ""));
    if (!ownsText) continue;
    const style = getComputedStyle(element);
    const size = Number.parseFloat(style.fontSize);
    if (!Number.isFinite(size) || size <= 0) continue;
    groups.push({ element, size: roundSize(size), base: Number.parseFloat(style.letterSpacing) || 0 });
  }
  return groups;
}

/** 导出库逐个克隆节点时调用：把标记的字距写到克隆上（它的内联样式会盖过继承）。 */
export function applyExportLetterSpacing(cloned: Node): void {
  if (!(cloned instanceof HTMLElement)) return;
  const value = cloned.getAttribute(LETTER_SPACING_ATTRIBUTE);
  if (value === null) return;
  cloned.removeAttribute(LETTER_SPACING_ATTRIBUTE);
  cloned.style.letterSpacing = value;
  for (const child of cloned.children) {
    if (child instanceof HTMLElement && child.classList.contains("j")) child.style.letterSpacing = value;
  }
}

function tag(element: HTMLElement, base: number, compensation: number): void {
  element.setAttribute(LETTER_SPACING_ATTRIBUTE, `${environmentLetterSpacing(base, base - compensation)}px`);
}

type ProbeRow = { size: number; count: number; row: HTMLElement; marker: HTMLElement };

function buildProbe(snapshot: HTMLElement, groups: TextGroup[], sizes: number[], compensation: DriftBySize): { container: HTMLElement; rows: ProbeRow[] } {
  const characters = graphemes(snapshot.textContent ?? "").filter((character) => /\S/.test(character));
  const perCharacter = snapshot.querySelector(".j") !== null;
  const container = document.createElement("div");
  container.setAttribute("aria-hidden", "true");
  container.setAttribute("inert", "");
  const source = getComputedStyle(groups[0].element);
  for (const name of INHERITED_TEXT_PROPERTIES) {
    const value = source.getPropertyValue(name);
    if (value) container.style.setProperty(name, value);
  }
  Object.assign(container.style, {
    position: "fixed", left: "-100000px", top: "0", width: `${PROBE_WIDTH}px`, background: "#fff", color: "transparent", pointerEvents: "none",
  });
  const rows = sizes.map((size, index) => {
    const base = groups.find((group) => group.size === size)?.base ?? 0;
    const count = probeLength(size, base);
    const row = document.createElement("div");
    Object.assign(row.style, {
      height: `${Math.ceil(size * 3)}px`, lineHeight: `${Math.ceil(size * 3)}px`, fontSize: `${size}px`,
      letterSpacing: `${base}px`, whiteSpace: "nowrap", overflow: "hidden",
    });
    tag(row, base, driftFor(compensation, size));
    const text = Array.from({ length: count }, (_, i) => characters[(index * 7 + i) % characters.length]);
    if (perCharacter) {
      for (const character of text) {
        const span = document.createElement("span");
        span.className = "j";
        span.style.position = "relative";
        span.textContent = character;
        row.appendChild(span);
      }
    } else {
      row.appendChild(document.createTextNode(text.join("")));
    }
    const marker = document.createElement("span");
    Object.assign(marker.style, {
      display: "inline-block", width: `${MARKER_WIDTH}px`, height: "100%", verticalAlign: "top", background: "#000", letterSpacing: "0",
    });
    row.appendChild(marker);
    container.appendChild(row);
    return { size, count, row, marker };
  });
  return { container, rows };
}

/** 导出环境里每个字符比页面内多出的宽度；测不出来时返回 null（按没有偏差处理）。 */
async function probeDrift(snapshot: HTMLElement, groups: TextGroup[], sizes: number[], compensation: DriftBySize, fontCss: string): Promise<DriftBySize | null> {
  const { container, rows } = buildProbe(snapshot, groups, sizes, compensation);
  document.body.appendChild(container);
  try {
    const origin = container.getBoundingClientRect();
    const expected = rows.map(({ row, marker }) => ({
      left: marker.getBoundingClientRect().left - origin.left,
      top: row.getBoundingClientRect().top - origin.top,
    }));
    const canvas = await domToCanvas(container, {
      width: PROBE_WIDTH,
      height: container.offsetHeight,
      scale: 1,
      backgroundColor: "#fff",
      font: { cssText: fontCss },
      timeout: 30_000,
      onCloneEachNode: applyExportLetterSpacing,
      style: { position: "static", left: "auto", top: "auto" },
    });
    const context = canvas.getContext("2d");
    if (!context) return null;
    const scale = canvas.width / PROBE_WIDTH;
    const drift: DriftBySize = new Map();
    for (const [index, { size, count }] of rows.entries()) {
      // 文字在三倍行高的中间，色块占满整行：靠近行顶的扫描线上只有色块。
      const y = Math.min(canvas.height - 1, Math.round((expected[index].top + 1.5) * scale));
      const { data } = context.getImageData(0, y, canvas.width, 1);
      const darkness = Array.from({ length: canvas.width }, (_, x) => 1 - data[x * 4] / 255);
      const left = markerLeft(darkness, scale, MARKER_WIDTH);
      if (left === null) return null;
      const perCharacter = (left - expected[index].left) / count;
      if (Math.abs(perCharacter) > MAX_PLAUSIBLE_DRIFT) return null;
      drift.set(size, perCharacter);
    }
    return drift;
  } catch {
    return null;
  } finally {
    container.remove();
  }
}

/**
 * 测量并抵消导出环境的文字宽度偏差。返回 true 表示仍有抵消不掉的残差，且已在 snapshot 上
 * 模拟出导出的实际排版：调用方必须重新做溢出检查，并以 snapshot 当前的尺寸出图。
 */
export async function correctTextDrift(snapshot: HTMLElement, fontCss: string): Promise<boolean> {
  const groups = textGroups(snapshot);
  if (!groups.length || !(snapshot.textContent ?? "").trim()) return false;
  const weight = new Map<number, number>();
  for (const group of groups) weight.set(group.size, (weight.get(group.size) ?? 0) + (group.element.textContent?.length ?? 0));
  const sizes = [...weight].sort((a, b) => b[1] - a[1]).slice(0, MAX_PROBE_SIZES).map(([size]) => size);

  const base = groups[0].base;
  const drift = await probeDrift(snapshot, groups, sizes, new Map(), fontCss);
  if (!drift || !significantDrift(drift, base)) return false;
  for (const group of groups) tag(group.element, group.base, driftFor(drift, group.size));

  const residual = await probeDrift(snapshot, groups, sizes, drift, fontCss);
  if (!residual || !significantDrift(residual, base)) return false;
  for (const group of groups) group.element.style.letterSpacing = `${group.base + driftFor(residual, group.size)}px`;
  return true;
}
