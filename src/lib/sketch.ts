import type { DoodleElement, DoodleFill, DoodleStroke } from "../../shared/doodle.ts";

/**
 * 受控的 SVG 生成器：把已校验的 DoodleElement 转为带轻微抖动的手绘路径数据。
 * 输出只有路径字符串与调色板名称，由 React 组件渲染为 <path>，不会产生任意标签或属性。
 */

export type SketchStroke = {
  d: string;
  stroke: DoodleStroke;
  width: number;
  opacity: number;
};

export type SketchFill = {
  d: string;
  fill: Exclude<DoodleFill, "none">;
};

export type SketchShape = { fills: SketchFill[]; strokes: SketchStroke[] };

type Point = [number, number];
type Rand = () => number;

const fmt = (n: number) => (Math.round(n * 10) / 10).toString();
const pt = (p: Point) => `${fmt(p[0])} ${fmt(p[1])}`;

function jitterPoint(p: Point, rand: Rand, amount: number): Point {
  return [p[0] + rand() * amount, p[1] + rand() * amount];
}

export function polyline(points: Point[], closed: boolean): string {
  const [first, ...rest] = points;
  return `M${pt(first)}${rest.map((p) => ` L${pt(p)}`).join("")}${closed ? " Z" : ""}`;
}

/** Catmull-Rom 样条转三次贝塞尔，曲线经过每一个控制点。 */
export function spline(points: Point[], closed: boolean): string {
  if (points.length < 3) return polyline(points, closed);
  const n = points.length;
  const at = (i: number): Point =>
    closed ? points[((i % n) + n) % n] : points[Math.max(0, Math.min(n - 1, i))];
  const segments = closed ? n : n - 1;
  let d = `M${pt(points[0])}`;
  for (let i = 0; i < segments; i++) {
    const p0 = at(i - 1);
    const p1 = at(i);
    const p2 = at(i + 1);
    const p3 = at(i + 2);
    const c1: Point = [p1[0] + (p2[0] - p0[0]) / 6, p1[1] + (p2[1] - p0[1]) / 6];
    const c2: Point = [p2[0] - (p3[0] - p1[0]) / 6, p2[1] - (p3[1] - p1[1]) / 6];
    d += ` C${pt(c1)} ${pt(c2)} ${pt(p2)}`;
  }
  return closed ? `${d} Z` : d;
}

function sketchLine(a: Point, b: Point, rand: Rand, rough: number, overshoot = 0): string {
  const len = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
  const ux = (b[0] - a[0]) / len;
  const uy = (b[1] - a[1]) / len;
  const start: Point = [a[0] - ux * overshoot, a[1] - uy * overshoot];
  const end: Point = [b[0] + ux * overshoot, b[1] + uy * overshoot];
  const bow = Math.min(2.2, len * 0.035) * rough;
  const mid: Point = [(a[0] + b[0]) / 2 - uy * bow * rand(), (a[1] + b[1]) / 2 + ux * bow * rand()];
  return `M${pt(jitterPoint(start, rand, 0.7 * rough))} Q${pt(mid)} ${pt(jitterPoint(end, rand, 0.7 * rough))}`;
}

function ellipsePoints(cx: number, cy: number, r: number, rand: Rand, rough: number, overshoot: number): Point[] {
  const count = 10;
  const start = rand() * Math.PI;
  const points: Point[] = [];
  const total = Math.PI * 2 + overshoot;
  for (let i = 0; i <= count; i++) {
    const angle = start + (total * i) / count;
    const radius = r * (1 + rand() * 0.035 * rough);
    points.push([cx + Math.cos(angle) * radius, cy + Math.sin(angle) * radius]);
  }
  return points;
}

function roundedRectPoints(x: number, y: number, w: number, h: number, rx: number): Point[] {
  const r = Math.min(rx, w / 2, h / 2);
  const corners: Array<[number, number, number]> = [
    [x + w - r, y + r, -Math.PI / 2],
    [x + w - r, y + h - r, 0],
    [x + r, y + h - r, Math.PI / 2],
    [x + r, y + r, Math.PI],
  ];
  const points: Point[] = [];
  for (const [cx, cy, a0] of corners) {
    for (let i = 0; i <= 2; i++) {
      const angle = a0 + (Math.PI / 2) * (i / 2);
      points.push([cx + Math.cos(angle) * r, cy + Math.sin(angle) * r]);
    }
  }
  return points;
}

function outline(el: DoodleElement, rand: Rand, rough: number, pass: number): string {
  switch (el.type) {
    case "line":
      return sketchLine([el.x1, el.y1], [el.x2, el.y2], rand, rough);
    case "arrow": {
      const shaft = sketchLine([el.x1, el.y1], [el.x2, el.y2], rand, rough);
      const angle = Math.atan2(el.y2 - el.y1, el.x2 - el.x1);
      const len = Math.min(9, Math.hypot(el.x2 - el.x1, el.y2 - el.y1) * 0.3);
      const head = [-1, 1]
        .map((side) => {
          const a = angle + Math.PI + side * 0.45;
          return sketchLine([el.x2, el.y2], [el.x2 + Math.cos(a) * len, el.y2 + Math.sin(a) * len], rand, rough * 0.5);
        })
        .join(" ");
      return `${shaft} ${head}`;
    }
    case "circle":
      return spline(ellipsePoints(el.cx, el.cy, el.r, rand, rough, pass === 0 ? 0.35 * rough : 0.2 * rough), false);
    case "rect": {
      if (el.rx > 0) {
        return spline(roundedRectPoints(el.x, el.y, el.w, el.h, el.rx).map((p) => jitterPoint(p, rand, 0.5 * rough)), true);
      }
      const corners: Point[] = [
        [el.x, el.y],
        [el.x + el.w, el.y],
        [el.x + el.w, el.y + el.h],
        [el.x, el.y + el.h],
      ];
      return corners.map((c, i) => sketchLine(c, corners[(i + 1) % 4], rand, rough, 1.2 * rough)).join(" ");
    }
    case "path": {
      const points = el.points.map((p) => jitterPoint(p, rand, 0.6 * rough));
      return el.smooth ? spline(points, el.closed) : polyline(points, el.closed);
    }
  }
}

function fillShape(el: DoodleElement): string | undefined {
  const offset = 1.4;
  switch (el.type) {
    case "circle":
      return spline(
        Array.from({ length: 12 }, (_, i): Point => {
          const a = (i / 12) * Math.PI * 2;
          return [el.cx + offset + Math.cos(a) * el.r * 0.96, el.cy + offset + Math.sin(a) * el.r * 0.96];
        }),
        true,
      );
    case "rect":
      return el.rx > 0
        ? spline(roundedRectPoints(el.x + offset, el.y + offset, el.w, el.h, el.rx), true)
        : polyline(
            [
              [el.x + offset, el.y + offset],
              [el.x + el.w + offset, el.y + offset],
              [el.x + el.w + offset, el.y + el.h + offset],
              [el.x + offset, el.y + el.h + offset],
            ],
            true,
          );
    case "path": {
      if (!el.closed) return undefined;
      const shifted = el.points.map((p): Point => [p[0] + offset, p[1] + offset]);
      return el.smooth ? spline(shifted, true) : polyline(shifted, true);
    }
    default:
      return undefined;
  }
}

/**
 * @param roughness 0 表示规整线条，1 表示明显的手绘感
 */
export function sketchElements(elements: DoodleElement[], rand: Rand, roughness: number): SketchShape {
  const rough = 0.25 + roughness * 0.9;
  const fills: SketchFill[] = [];
  const strokes: SketchStroke[] = [];
  for (const el of elements) {
    if ("fill" in el && el.fill !== "none") {
      const d = fillShape(el);
      if (d) fills.push({ d, fill: el.fill });
    }
    strokes.push({ d: outline(el, rand, rough, 0), stroke: el.stroke, width: el.width, opacity: 0.95 });
    if (roughness > 0.35) {
      strokes.push({ d: outline(el, rand, rough * 0.8, 1), stroke: el.stroke, width: el.width * 0.55, opacity: 0.45 });
    }
  }
  return { fills, strokes };
}
