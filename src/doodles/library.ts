import { normalizeDoodleSpec, type DoodleElement, type DoodleSpec } from "../../shared/doodle.ts";
import type { DoodleTheme } from "../../shared/themes.ts";

/**
 * 经过人工审核的内置插图库。每个插图都使用与 AI 图元规格相同的受限图元描述，
 * 由同一个受控生成器绘制，保证风格统一。
 */

type El = DoodleElement;
type P = [number, number];

const line = (x1: number, y1: number, x2: number, y2: number, extra: Partial<El> = {}): El =>
  ({ type: "line", x1, y1, x2, y2, stroke: "ink", width: 2, ...extra }) as El;
const arrow = (x1: number, y1: number, x2: number, y2: number, extra: Partial<El> = {}): El =>
  ({ type: "arrow", x1, y1, x2, y2, stroke: "ink", width: 2, ...extra }) as El;
const circle = (cx: number, cy: number, r: number, extra: Partial<El> = {}): El =>
  ({ type: "circle", cx, cy, r, fill: "none", stroke: "ink", width: 2, ...extra }) as El;
const rect = (x: number, y: number, w: number, h: number, extra: Partial<El> = {}): El =>
  ({ type: "rect", x, y, w, h, rx: 0, fill: "none", stroke: "ink", width: 2, ...extra }) as El;
const path = (points: P[], extra: Partial<El> = {}): El =>
  ({ type: "path", points, closed: false, smooth: true, fill: "none", stroke: "ink", width: 2, ...extra }) as El;
const shape = (points: P[], extra: Partial<El> = {}): El => path(points, { closed: true, ...extra } as Partial<El>);

function starPoints(cx: number, cy: number, outer: number, inner: number): P[] {
  return Array.from({ length: 10 }, (_, i): P => {
    const a = -Math.PI / 2 + (i * Math.PI) / 5;
    const r = i % 2 === 0 ? outer : inner;
    return [Math.round(cx + Math.cos(a) * r), Math.round(cy + Math.sin(a) * r)];
  });
}

function rays(cx: number, cy: number, r1: number, r2: number, count: number): El[] {
  return Array.from({ length: count }, (_, i) => {
    const a = (i / count) * Math.PI * 2;
    return line(
      Math.round(cx + Math.cos(a) * r1),
      Math.round(cy + Math.sin(a) * r1),
      Math.round(cx + Math.cos(a) * r2),
      Math.round(cy + Math.sin(a) * r2),
    );
  });
}

const LIBRARY: Record<DoodleTheme, El[]> = {
  lightbulb: [
    shape([[50, 14], [68, 22], [74, 40], [64, 58], [60, 68], [40, 68], [36, 58], [26, 40], [32, 22]], { fill: "yellow" }),
    rect(40, 70, 20, 12, { rx: 3 }),
    line(41, 75, 59, 75, { width: 1.5 }),
    line(46, 87, 54, 87),
    path([[44, 60], [46, 46], [50, 52], [54, 46], [56, 60]], { smooth: false, width: 1.5 }),
    line(14, 30, 21, 33),
    line(86, 30, 79, 33),
    line(22, 10, 28, 16),
    line(78, 10, 72, 16),
  ],
  book: [
    shape([[50, 30], [36, 24], [16, 26], [16, 74], [36, 72], [50, 78]], { smooth: false, fill: "yellow" }),
    shape([[50, 30], [64, 24], [84, 26], [84, 74], [64, 72], [50, 78]], { smooth: false }),
    line(50, 30, 50, 78),
    line(22, 37, 42, 38, { width: 1.5 }),
    line(22, 47, 42, 48, { width: 1.5 }),
    line(22, 57, 38, 58, { width: 1.5 }),
    line(58, 48, 78, 46, { width: 1.5 }),
    line(58, 58, 76, 56, { width: 1.5 }),
    shape([[66, 25], [66, 41], [70, 37], [74, 41], [74, 25]], { smooth: false, fill: "orange" }),
  ],
  coffee: [
    shape([[24, 40], [76, 40], [72, 78], [62, 84], [38, 84], [28, 78]], { smooth: false }),
    shape([[25, 41], [50, 47], [75, 41], [50, 36]], { fill: "orange" }),
    path([[74, 50], [86, 52], [86, 64], [72, 68]]),
    path([[12, 88], [50, 95], [88, 88]]),
    path([[40, 30], [36, 22], [42, 14], [38, 6]], { stroke: "muted", width: 1.5 }),
    path([[56, 30], [52, 22], [58, 14], [54, 6]], { stroke: "muted", width: 1.5 }),
  ],
  rocket: [
    shape([[50, 8], [62, 24], [64, 56], [36, 56], [38, 24]]),
    circle(50, 32, 6, { fill: "yellow" }),
    shape([[38, 42], [26, 60], [37, 58]], { smooth: false, fill: "orange" }),
    shape([[62, 42], [74, 60], [63, 58]], { smooth: false, fill: "orange" }),
    shape([[42, 58], [50, 84], [58, 58], [50, 64]], { fill: "yellow", stroke: "accent" }),
    line(28, 70, 31, 84, { stroke: "muted" }),
    line(72, 70, 69, 84, { stroke: "muted" }),
    circle(18, 20, 1.5, { fill: "ink" }),
    circle(82, 30, 1.5, { fill: "ink" }),
  ],
  brain: [
    shape([[50, 20], [38, 16], [26, 22], [20, 36], [24, 48], [20, 58], [28, 70], [40, 74], [50, 70]], { fill: "orange" }),
    shape([[50, 20], [62, 16], [74, 22], [80, 36], [76, 48], [80, 58], [72, 70], [60, 74], [50, 70]]),
    line(50, 22, 50, 70, { width: 1.5 }),
    path([[30, 32], [38, 38], [34, 46]], { width: 1.5 }),
    path([[70, 32], [62, 38], [66, 46]], { width: 1.5 }),
    path([[30, 58], [40, 56], [44, 62]], { width: 1.5 }),
    path([[70, 58], [60, 56], [56, 62]], { width: 1.5 }),
    path([[50, 72], [52, 82], [57, 88]]),
  ],
  heart: [
    shape([[50, 84], [26, 60], [16, 40], [24, 22], [40, 20], [50, 32], [60, 20], [76, 22], [84, 40], [74, 60]], { fill: "orange" }),
    path([[28, 38], [31, 30], [38, 27]], { width: 1.5 }),
    line(84, 12, 88, 6, { stroke: "muted" }),
    line(88, 18, 95, 16, { stroke: "muted" }),
  ],
  clock: [
    circle(50, 52, 34, { fill: "yellow" }),
    line(50, 21, 50, 26),
    line(81, 52, 76, 52),
    line(50, 83, 50, 78),
    line(19, 52, 24, 52),
    line(50, 52, 50, 32, { width: 2.5 }),
    line(50, 52, 64, 60, { width: 2.5 }),
    circle(50, 52, 2, { fill: "ink" }),
    line(30, 82, 24, 92),
    line(70, 82, 76, 92),
  ],
  target: [
    circle(46, 54, 36),
    circle(46, 54, 24, { fill: "orange" }),
    circle(46, 54, 12, { fill: "yellow" }),
    circle(46, 54, 3, { fill: "ink" }),
    arrow(90, 10, 49, 51, { width: 2.5 }),
    line(80, 10, 86, 4),
    line(84, 14, 90, 8),
  ],
  chart: [
    arrow(14, 86, 92, 86),
    arrow(14, 86, 14, 8),
    rect(22, 62, 10, 24, { fill: "green" }),
    rect(38, 50, 10, 36, { fill: "yellow" }),
    rect(54, 38, 10, 48, { fill: "orange" }),
    rect(70, 26, 10, 60, { fill: "green" }),
    arrow(22, 50, 84, 14, { stroke: "accent" }),
  ],
  leaf: [
    shape([[18, 82], [22, 48], [44, 24], [82, 16], [76, 52], [54, 76]], { fill: "green" }),
    path([[14, 88], [40, 58], [60, 38], [76, 22]]),
    line(38, 60, 34, 44, { width: 1.5 }),
    line(38, 60, 54, 64, { width: 1.5 }),
    line(52, 46, 50, 32, { width: 1.5 }),
    line(52, 46, 66, 50, { width: 1.5 }),
  ],
  pencil: [
    shape([[22, 70], [66, 26], [78, 38], [34, 82]], { smooth: false, fill: "yellow" }),
    shape([[22, 70], [34, 82], [12, 92]], { smooth: false }),
    shape([[16, 84], [20, 88], [12, 92]], { smooth: false, fill: "ink" }),
    shape([[66, 26], [72, 20], [84, 32], [78, 38]], { smooth: false, fill: "orange" }),
    line(28, 76, 72, 32, { width: 1.5 }),
  ],
  globe: [
    circle(50, 50, 34),
    path([[16, 50], [50, 58], [84, 50]], { width: 1.5 }),
    shape([[50, 16], [64, 50], [50, 84], [36, 50]], { width: 1.5 }),
    path([[22, 32], [50, 38], [78, 32]], { width: 1.5 }),
    path([[22, 68], [50, 74], [78, 68]], { width: 1.5 }),
    shape([[28, 30], [40, 26], [44, 38], [34, 42]], { fill: "green" }),
    shape([[56, 56], [68, 54], [70, 66], [60, 70]], { fill: "green" }),
  ],
  magnifier: [
    circle(42, 42, 24, { fill: "yellow" }),
    path([[30, 36], [33, 29], [41, 26]], { width: 1.5 }),
    line(60, 60, 86, 86, { width: 4 }),
    line(58, 64, 64, 58, { width: 2 }),
  ],
  puzzle: [
    rect(22, 32, 46, 46, { fill: "green" }),
    circle(45, 26, 7, { fill: "green" }),
    circle(74, 55, 7, { fill: "green" }),
    rect(60, 10, 26, 18, { rx: 2, stroke: "muted", width: 1.5 }),
    line(30, 86, 60, 86, { stroke: "muted" }),
  ],
  mountain: [
    shape([[8, 84], [36, 34], [50, 54], [64, 30], [92, 84]], { smooth: false }),
    path([[29, 46], [34, 43], [37, 48], [42, 44]], { smooth: false, width: 1.5 }),
    path([[57, 42], [62, 39], [65, 44], [70, 40]], { smooth: false, width: 1.5 }),
    line(64, 30, 64, 12),
    shape([[64, 12], [77, 16], [64, 20]], { smooth: false, fill: "orange" }),
    circle(20, 22, 7, { fill: "yellow" }),
  ],
  chat: [
    rect(8, 12, 52, 30, { rx: 10, fill: "yellow" }),
    shape([[20, 41], [16, 52], [32, 41]], { smooth: false, fill: "yellow" }),
    line(18, 24, 48, 24, { width: 1.5 }),
    line(18, 31, 40, 31, { width: 1.5 }),
    rect(40, 50, 52, 30, { rx: 10, fill: "green" }),
    shape([[78, 79], [84, 90], [68, 79]], { smooth: false, fill: "green" }),
    circle(56, 65, 2, { fill: "ink" }),
    circle(66, 65, 2, { fill: "ink" }),
    circle(76, 65, 2, { fill: "ink" }),
  ],
  calendar: [
    rect(16, 20, 68, 64, { rx: 4 }),
    rect(16, 20, 68, 14, { fill: "orange" }),
    line(32, 13, 32, 26, { width: 2.5 }),
    line(68, 13, 68, 26, { width: 2.5 }),
    ...[44, 56, 68].flatMap((y) => [28, 42, 56, 70].map((x) => circle(x, y, 1.5, { fill: "ink", width: 1 }))),
    circle(56, 68, 8, { stroke: "accent" }),
    path([[24, 77], [28, 81], [36, 72]], { smooth: false, stroke: "accent" }),
  ],
  music: [
    circle(30, 72, 8, { fill: "ink" }),
    circle(70, 64, 8, { fill: "ink" }),
    line(37, 70, 37, 26),
    line(77, 62, 77, 20),
    shape([[37, 26], [77, 20], [77, 28], [37, 34]], { smooth: false, fill: "ink" }),
    path([[10, 40], [16, 34], [22, 40], [28, 34]], { stroke: "muted", width: 1.5 }),
  ],
  star: [
    shape(starPoints(50, 54, 38, 16), { smooth: false, fill: "yellow" }),
    line(84, 12, 84, 26, { width: 1.5 }),
    line(77, 19, 91, 19, { width: 1.5 }),
    circle(16, 20, 2, { fill: "ink" }),
    circle(20, 88, 1.5, { fill: "ink" }),
  ],
  sun: [
    circle(50, 50, 18, { fill: "yellow" }),
    ...rays(50, 50, 26, 38, 8),
    path([[42, 54], [50, 60], [58, 54]], { width: 1.5 }),
    circle(44, 46, 1.5, { fill: "ink" }),
    circle(56, 46, 1.5, { fill: "ink" }),
  ],
};

const cache = new Map<DoodleTheme, DoodleSpec>();

/** 返回经过校验的内置插图规格（与 AI 输出走同一套规范化流程）。 */
export function builtinDoodle(theme: DoodleTheme): DoodleSpec {
  const cached = cache.get(theme);
  if (cached) return cached;
  const result = normalizeDoodleSpec({ concept: theme, elements: LIBRARY[theme] });
  if (!result.ok) throw new Error(`Invalid builtin doodle: ${theme}`);
  cache.set(theme, result.value);
  return result.value;
}
