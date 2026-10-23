import type { CSSProperties, ReactNode } from "react";
import { STICKER_SIZES, type StickerPattern, type StickerType, type StickerVariant } from "../types.ts";

/** 每个装饰贴纸组件的输入：color 已解析为可用的 CSS 颜色，seed 由贴纸 ID 得到，保证预览与导出形状一致。 */
export type ArtProps = { color: string; variant: StickerVariant; seed: number };

/** 变体颜色 "ink" / "paper" 跟随笔记的墨水色与纸张底色（由 .note-page 或贴纸面板提供变量）。 */
export function paint(color: string): string {
  return color === "ink" ? "var(--ink)" : color === "paper" ? "var(--paper)" : color;
}

/** 与黑色混合，得到同色系的深色描边。 */
export const shade = (color: string, percent: number) => `color-mix(in srgb, ${color} ${percent}%, #000)`;

export const pt = (x: number, y: number) => `${x.toFixed(1)} ${y.toFixed(1)}`;

/** 笔画：圆头圆角、不填充。 */
export const pen = (color: string, width: number): CSSProperties => ({
  fill: "none",
  stroke: color,
  strokeWidth: width,
  strokeLinecap: "round",
  strokeLinejoin: "round",
});

/** 投影：同一形状向右下偏移后铺一层浅灰。 */
export const SHADOW: CSSProperties = { fill: "rgba(0, 0, 0, 0.13)" };

/** 用相邻点的中点作端点、原始点作控制点，把一圈点连成平滑的闭合曲线。 */
export function smoothClosed(points: Array<[number, number]>): string {
  const mid = (a: [number, number], b: [number, number]) => pt((a[0] + b[0]) / 2, (a[1] + b[1]) / 2);
  let d = `M${mid(points[points.length - 1], points[0])}`;
  points.forEach((p, i) => {
    d += ` Q${pt(p[0], p[1])} ${mid(p, points[(i + 1) % points.length])}`;
  });
  return `${d} Z`;
}

export function Frame({ type, children }: { type: StickerType; children: ReactNode }) {
  const { w, h } = STICKER_SIZES[type];
  return (
    <svg viewBox={`0 0 ${w} ${h}`} width={w} height={h} aria-hidden="true">
      {children}
    </svg>
  );
}

const range = (from: number, to: number, step: number) =>
  Array.from({ length: Math.max(0, Math.floor((to - from) / step) + 1) }, (_, i) => from + i * step);

/**
 * 在矩形内画胶带花纹或纸片格线。直接画图形而不用 <pattern>：
 * 同一页面有多张贴纸时，SVG 的 id 会互相冲突。
 */
export function PatternMarks({ pattern, x, y, w, h }: { pattern: StickerPattern; x: number; y: number; w: number; h: number }) {
  switch (pattern) {
    case "dots":
      return (
        <g style={{ fill: "rgba(255, 255, 255, 0.85)" }}>
          {range(y + 3, y + h - 3, 9).flatMap((cy, row) =>
            range(x + (row % 2 ? 9 : 4.5), x + w - 3, 9).map((cx) => <circle key={`${cx}-${cy}`} cx={cx} cy={cy} r={2.4} />),
          )}
        </g>
      );
    case "checks":
      // 横竖两组半透明白条交叠，交叉处更亮，形成格纹
      return (
        <g style={{ fill: "rgba(255, 255, 255, 0.4)" }}>
          {range(x, x + w - 6, 12).map((bx) => <rect key={`v${bx}`} x={bx} y={y} width={6} height={h} />)}
          {range(y, y + h - 6, 12).map((by) => <rect key={`h${by}`} x={x} y={by} width={w} height={6} />)}
        </g>
      );
    case "stripes":
      return (
        <g style={{ fill: "rgba(255, 255, 255, 0.7)" }}>
          {range(x, x + w - 5, 12).map((bx) => <rect key={bx} x={bx} y={y} width={5} height={h} />)}
        </g>
      );
    case "grid":
      return (
        <g style={{ stroke: "rgba(96, 165, 250, 0.4)", strokeWidth: 1 }}>
          {range(x, x + w, 12).map((lx) => <path key={`v${lx}`} d={`M${lx} ${y} L${lx} ${y + h}`} />)}
          {range(y, y + h, 12).map((ly) => <path key={`h${ly}`} d={`M${x} ${ly} L${x + w} ${ly}`} />)}
        </g>
      );
    case "lines":
      return (
        <g style={{ stroke: "rgba(96, 165, 250, 0.45)", strokeWidth: 1.2 }}>
          {range(y, y + h, 14).map((ly) => <path key={ly} d={`M${x} ${ly} L${x + w} ${ly}`} />)}
        </g>
      );
  }
}
