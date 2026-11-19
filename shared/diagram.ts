import { cleanText } from "./text.ts";

/** Structured, dimensionless note diagrams. All values use a 1000 x 750 (4:3) coordinate plane. */
export const DIAGRAM_LIMITS = {
  width: 1000, height: 750, maxBlocks: 2, maxPrimitives: 40,
  maxPoints: 40, maxCaption: 40, maxLabel: 40,
} as const;

/** Rendered as a localized figure note; attached to arrow for D3 conversion. */
export const SHORT_FORCE_SCALE_NOTE = "Short force arrow not to scale.";

export const FUNCTION_PRESETS = ["none", "linear", "quadratic", "sine", "cosine", "exponential", "logarithm"] as const;
export type FunctionPreset = (typeof FUNCTION_PRESETS)[number];

export const DIAGRAM_TEMPLATES = ["inclined-plane", "right-triangle", "number-line", "coordinate-plane"] as const;
export type DiagramTemplate = (typeof DIAGRAM_TEMPLATES)[number];
export type DiagramPoint = [number, number];

type Line = { type: "line" | "arrow"; from: DiagramPoint; to: DiagramPoint; label?: string; dashed?: boolean; double?: boolean; guide?: boolean };
type Polyline = { type: "polyline"; points: DiagramPoint[]; dashed?: boolean; guide?: boolean };
type Rect = { type: "rect"; at: DiagramPoint; width: number; height: number; rotation?: number };
type Circle = { type: "circle"; center: DiagramPoint; r: number };
type Ellipse = { type: "ellipse"; center: DiagramPoint; rx: number; ry: number; rotation?: number };
type Arc = { type: "arc"; center: DiagramPoint; radius: number; startDeg: number; sweepDeg: number; label?: string };
type Label = { type: "label"; at: DiagramPoint; text: string };
export type DiagramPrimitive = Line | Polyline | Rect | Circle | Ellipse | Arc | Label;

type DiagramBase = { afterSection: number; caption?: string; handDrawn?: boolean; jitterPx?: number };
export type DiagramBlock = DiagramBase & (
  | { template: "inclined-plane"; params: { thetaDeg: number; friction: boolean }; primitives?: never }
  | { template: "right-triangle"; params: { legRatio: number }; primitives?: never }
  | { template: "number-line"; params: { start: number; end: number; step: number }; primitives?: never }
  | { template: "coordinate-plane"; params: { grid: boolean; quadrants: "all" | "first"; function?: FunctionPreset; keyPoints?: boolean }; primitives?: never }
  | { template?: never; params?: never; primitives: DiagramPrimitive[] }
);

const point = (x: number, y: number): DiagramPoint => [Number(x.toFixed(4)), Number(y.toFixed(4))];
const add = (a: DiagramPoint, b: DiagramPoint): DiagramPoint => point(a[0] + b[0], a[1] + b[1]);
const scale = (a: DiagramPoint, n: number): DiagramPoint => point(a[0] * n, a[1] * n);
const line = (from: DiagramPoint, to: DiagramPoint, extra: Partial<Line> = {}): Line => ({ type: "line", from, to, ...extra });
const arrow = (from: DiagramPoint, to: DiagramPoint, label?: string): Line => ({ type: "arrow", from, to, ...(label ? { label } : {}) });
const label = (at: DiagramPoint, text: string): Label => ({ type: "label", at, text });

/** The two gravity components add to (0, gravity) even for non-right-angle slopes. */
export function inclinedPlaneForces(thetaDeg: number, gravity = 160): {
  gravity: DiagramPoint; parallel: DiagramPoint; perpendicular: DiagramPoint; support: DiagramPoint;
} {
  const theta = thetaDeg * Math.PI / 180;
  const sine = Math.sin(theta);
  const cosine = Math.cos(theta);
  const parallel = point(-gravity * sine * cosine, gravity * sine * sine);
  const perpendicular = point(gravity * sine * cosine, gravity * cosine * cosine);
  return { gravity: point(0, gravity), parallel, perpendicular, support: scale(perpendicular, -1) };
}

type Bounds = [number, number, number, number];
/** Approximate painted glyph extents in normalized SVG units, including paper outline. */
export function inclineTextBounds(text: string, at: DiagramPoint): Bounds {
  const units = Array.from(text).reduce((sum, ch) => sum + (ch.charCodeAt(0) < 128 ? 1.1 : 1.3), 0);
  const half = Math.max(19, units * 14);
  return [at[0] - half, at[1] - 32, at[0] + half, at[1] + 32];
}
function boxesIntersect(a: Bounds, b: Bounds, gap = 10): boolean {
  return a[0] < b[2] + gap && a[2] + gap > b[0] && a[1] < b[3] + gap && a[3] + gap > b[1];
}
/** Exact segment-vs-expanded-rectangle intersection (Liang-Barsky clipping). */
export function segmentTouchesLabel(a: DiagramPoint, b: DiagramPoint, rect: Bounds): boolean {
  const x0 = a[0], y0 = a[1], dx = b[0] - x0, dy = b[1] - y0;
  const minX = rect[0] - 9, minY = rect[1] - 9, maxX = rect[2] + 9, maxY = rect[3] + 9;
  const tests: [number, number][] = [
    [-dx, x0 - minX], [dx, maxX - x0],
    [-dy, y0 - minY], [dy, maxY - y0],
  ];
  let start = 0, end = 1;
  for (const [p, q] of tests) {
    if (p === 0) { if (q < 0) return false; continue; }
    const r = q / p;
    if (p < 0) start = Math.max(start, r);
    else end = Math.min(end, r);
    if (start > end) return false;
  }
  return true;
}

/** Labels retain independent SVG primitives, so no arrow can dictate their anchor. */
function placeInclineLabels(
  specs: { text: string; near: DiagramPoint }[],
  strokes: [DiagramPoint, DiagramPoint][],
): Label[] {
  const chosen: Label[] = [];
  for (const spec of specs) {
    let result: DiagramPoint | null = null;
    // Search increasingly larger rings around the vector tip. This considers
    // text/text and text/line clearance, not just anchor-point distance.
    for (let ring = 0; ring < 20 && !result; ring++) {
      const candidates: { distance: number; at: DiagramPoint }[] = [];
      for (let dx = -ring; dx <= ring; dx++) {
        for (let dy = -ring; dy <= ring; dy++) {
          if (Math.max(Math.abs(dx), Math.abs(dy)) !== ring) continue;
          const at = point(Math.round(spec.near[0] + dx * 30), Math.round(spec.near[1] + dy * 30));
          const rect = inclineTextBounds(spec.text, at);
          // The label layout helper clamps by its estimated string width. Keep
          // positions inside the same safe region to avoid a render-time jump.
          const units = Array.from(spec.text).reduce((sum, ch) => sum + (ch.charCodeAt(0) < 128 ? 1.1 : 1.3), 0);
          const minX = Math.max(90, 20 + Math.min(960, units * 30) / 2);
          if (at[0] < minX || at[0] > DIAGRAM_LIMITS.width - minX
            || rect[0] < 23 || rect[2] > 977 || rect[1] < 56 || rect[3] > 695) continue;
          if (chosen.some((existing) => boxesIntersect(rect, inclineTextBounds(existing.text, existing.at)))) continue;
          if (strokes.some(([from, to]) => segmentTouchesLabel(from, to, rect))) continue;
          candidates.push({ distance: dx * dx + dy * dy, at });
        }
      }
      candidates.sort((a, b) => a.distance - b.distance);
      if (candidates[0]) result = candidates[0].at;
    }
    // Valid template inputs always have room; the fallback is defensive for
    // unexpected geometry rather than silently omitting physics annotations.
    chosen.push(label(result ?? point(500, 375), spec.text));
  }
  return chosen;
}

function inclinedPlane(thetaDeg: number, friction: boolean): DiagramPrimitive[] {
  const angle = thetaDeg * Math.PI / 180;
  const tangent = point(Math.cos(angle), -Math.sin(angle));
  const outward = point(-Math.sin(angle), -Math.cos(angle));
  const base = point(170, 620);
  const top = add(base, scale(tangent, 520));
  const groundEnd = point(base[0] + 260, base[1]);
  const center = add(add(base, scale(tangent, 305)), scale(outward, 36));
  const vectors = inclinedPlaneForces(thetaDeg);
  const along = add(center, vectors.parallel);
  const across = add(center, vectors.perpendicular);
  const down = add(center, vectors.gravity);
  const support = add(center, vectors.support); // N balances mg cosθ: same magnitude, opposite direction.
  const frictionTip = add(center, scale(tangent, 110));
  const MIN_VISIBLE_PARALLEL = 64;
  const shortParallel = Math.hypot(...vectors.parallel) < MIN_VISIBLE_PARALLEL;
  const downhill = scale(tangent, -1);
  // Keep along as the TRUE decomposition point; only the displayed arrow moves.
  const parallelFrom = shortParallel
    ? add(add(center, scale(downhill, 76)), scale(outward, 24)) : center;
  // point() rounds to 4 decimals; 0.5 SVG units ensure >=64 after rounding.
  const parallelTo = shortParallel
    ? add(parallelFrom, scale(downhill, MIN_VISIBLE_PARALLEL + 0.5)) : along;
  const elements: DiagramPrimitive[] = [
    line(base, top),
    line(base, groundEnd),
    { type: "rect", at: point(center[0] - 36, center[1] - 27), width: 72, height: 54, rotation: -thetaDeg },
    arrow(center, down),
    arrow(parallelFrom, parallelTo, shortParallel ? SHORT_FORCE_SCALE_NOTE : undefined),
    arrow(center, across),
    line(along, down, { dashed: true }),
    line(across, down, { dashed: true }),
    arrow(center, support),
    { type: "arc", center: base, radius: 65, startDeg: -thetaDeg, sweepDeg: thetaDeg },
  ];
  const strokes: [DiagramPoint, DiagramPoint][] = [
    [base, top], [base, groundEnd], [center, down], [parallelFrom, parallelTo], [center, across],
    [along, down], [across, down], [center, support],
  ];
  // Include the rotated block and the angle arc in collision detection.
  const corners: DiagramPoint[] = [[-36, -27], [36, -27], [36, 27], [-36, 27]].map(([x, y]) =>
    point(center[0] + x * Math.cos(-angle) - y * Math.sin(-angle),
      center[1] + x * Math.sin(-angle) + y * Math.cos(-angle)));
  for (let i = 0; i < corners.length; i++) strokes.push([corners[i], corners[(i + 1) % corners.length]]);
  const wedge = Array.from({ length: 21 }, (_, i) =>
    point(base[0] + 65 * Math.cos(angle * (i / 20 - 1)),
      base[1] + 65 * Math.sin(angle * (i / 20 - 1))));
  for (let i = 1; i < wedge.length; i++) strokes.push([wedge[i - 1], wedge[i]]);
  if (friction) {
    elements.push(arrow(center, frictionTip));
    strokes.push([center, frictionTip]);
  }
  const labels = [
    { text: "mg sinθ", near: shortParallel
      ? add(add(parallelTo, scale(outward, 90)), scale(downhill, -16))
      : add(along, point(-140, -90)) },
    { text: "mg cosθ", near: add(across, point(140, 0)) },
    { text: "N", near: add(support, point(-90, -65)) },
    { text: "mg", near: add(down, point(-65, -35)) },
    ...(friction ? [{ text: "f", near: add(frictionTip, point(90, -90)) }] : []),
    // A close-to-arc anchor below the new horizontal ground avoids crowding the narrow wedge.
    { text: "θ = " + thetaDeg + "°", near: add(base, point(120, 42)) },
  ];
  return [...elements, ...placeInclineLabels(labels, strokes)];
}

function rightTriangle(legRatio: number): DiagramPrimitive[] {
  const width = Math.min(500, 460 / legRatio);
  const height = width * legRatio;
  const left = point(235, 595);
  const right = point(left[0] + width, left[1]);
  const upper = point(right[0], right[1] - height);
  return [
    { type: "polyline", points: [left, right, upper, left] },
    { type: "polyline", points: [point(right[0] - 35, right[1]), point(right[0] - 35, right[1] - 35), point(right[0], right[1] - 35)] },
    label(point((left[0] + right[0]) / 2, right[1] + 49), "a"),
    label(point(right[0] + 48, (right[1] + upper[1]) / 2), "b"),
    label(point((left[0] + upper[0]) / 2 - 36, (left[1] + upper[1]) / 2 - 36), "c"),
  ];
}

/** Display the shortest precise tick labels without hiding small endpoint differences. */
function numberLineTickLabels(ticks: number[]): string[] {
  const smallestGap = ticks.slice(1).reduce((gap, value, index) =>
    Math.min(gap, Math.abs(value - ticks[index])), Infinity);
  // Label rounding must stay well below the smallest visible interval.
  const maxError = smallestGap * 1e-6;
  for (let digits = 1; digits <= 17; digits++) {
    const labels = ticks.map((value) => String(Number(value.toPrecision(digits))));
    if (new Set(labels).size === ticks.length && labels.every((text, index) =>
      Math.abs(Number(text) - ticks[index]) <= maxError)) return labels;
  }
  return ticks.map(String);
}

function numberLine(start: number, end: number, step: number): DiagramPrimitive[] {
  const left = 125, right = 885, y = 365;
  const result: DiagramPrimitive[] = [arrow(point(left, y), point(right, y))];
  // Reserve room for the requested end if the step does not divide the range.
  // At most 19 ticks: one axis arrow plus 2 primitives per tick stays under 40.
  const count = Math.max(1, Math.min(19, Math.floor((end - start) / step + 1e-9) + 1));
  const ticks = Array.from({ length: count }, (_, i) => start + step * i);
  const last = ticks.length - 1;
  // start + step * i accumulates binary rounding error (0.1 * 12 = 1.2000000000000002).
  // Snap a final tick within a step-relative epsilon of the end; never snap the
  // start tick itself, which keeps publish-valid tiny ranges (end < step) intact.
  if (ticks[last] === end || (last > 0 && Math.abs(ticks[last] - end) <= step * 1e-9)) {
    ticks[last] = end;
  } else {
    // Drop a near-duplicate terminal tick so the end label remains readable.
    while (ticks.length > 1 && (end - ticks[ticks.length - 1]) / (end - start) * (right - left - 85) < 60) ticks.pop();
    if (ticks.length < 19) ticks.push(end);
    else ticks[ticks.length - 1] = end; // Defensive cap for direct callers with invalid parameters.
  }
  // Preserve a true zero when binary floating-point arithmetic only approximates it.
  // Never snap a requested endpoint: tiny valid user ranges must stay lossless.
  if (start < 0 && end > 0) {
    for (let i = 1; i < ticks.length - 1; i++) {
      if (Math.abs(ticks[i]) <= step * 1e-9) ticks[i] = 0;
    }
  }
  const labels = numberLineTickLabels(ticks);
  const positions = ticks.map((value) => left + 34 + (right - left - 85) * (value - start) / (end - start));
  // Keep every tick mark; thin only the labels at one regular index stride.
  // Greedy left-to-right collision filtering used to create irregular 0, .2, .5,
  // .8, 1 patterns. Prefer zero as the sampling origin whenever it is a real tick.
  const width = (text: string) => Array.from(text).reduce((sum, char) => sum + (char.charCodeAt(0) < 128 ? 27 : 32), 0);
  const lastIndex = ticks.length - 1;
  const zeroIndex = ticks.findIndex((value) => value === 0);
  const required = new Set([0, lastIndex, ...(zeroIndex >= 0 ? [zeroIndex] : [])]);
  const fits = (selected: Set<number>) => {
    const ordered = [...selected].sort((a, b) => a - b);
    return ordered.slice(1).every((current, i) => {
      const previous = ordered[i];
      return positions[current] - positions[previous]
        >= (width(labels[current]) + width(labels[previous])) / 2 + 20;
    });
  };
  let visible: Set<number> | null = null;
  const origin = zeroIndex >= 0 ? zeroIndex : 0;
  for (let stride = 1; stride <= ticks.length; stride++) {
    const selected = new Set(required);
    for (let i = 1; i < lastIndex; i++) {
      if ((i - origin) % stride === 0) selected.add(i);
    }
    if (fits(selected)) { visible = selected; break; }
  }
  if (!visible) {
    // Extremely tiny ranges may not fit three mandatory labels. Endpoints win;
    // show zero as well only where it remains legible.
    visible = new Set([0, lastIndex]);
    if (zeroIndex > 0 && zeroIndex < lastIndex) {
      const withZero = new Set([...visible, zeroIndex]);
      if (fits(withZero)) visible = withZero;
    }
  }
  for (let i = 0; i < ticks.length; i++) {
    const x = positions[i];
    result.push(line(point(x, y - 16), point(x, y + 16)));
    if (visible.has(i)) result.push(label(point(x, y + 62), labels[i]));
  }
  return result;
}

/**
 * Put a key-point annotation at the first candidate around its dot whose
 * estimated text box crosses neither axis, the plotted curve, its own dot,
 * nor an earlier annotation.
 */
function keyPointLabelAnchor(
  text: string, at: DiagramPoint, origin: DiagramPoint, placed: Bounds[], curve: [DiagramPoint, DiagramPoint][],
): DiagramPoint {
  const units = Array.from(text).reduce((sum, ch) => sum + (ch.charCodeAt(0) < 128 ? 1.1 : 1.3), 0);
  // Same horizontal safe region as the label renderer, so the checked box is the painted one.
  const minX = Math.max(90, 20 + Math.min(960, units * 30) / 2);
  const clamp = (p: DiagramPoint) => point(Math.max(minX, Math.min(DIAGRAM_LIMITS.width - minX, p[0])),
    Math.max(95, Math.min(DIAGRAM_LIMITS.height - 70, p[1])));
  // Shift wide labels so their near edge, not their center, sits beside the dot.
  const dx = Math.max(65, units * 14 + 12);
  const candidates = [[dx, -42], [-dx, -42], [dx, 42], [-dx, 42],
    [dx, -84], [-dx, -84], [dx, 84], [-dx, 84]].map(([x, y]) => clamp(point(at[0] + x, at[1] + y)));
  const clear = (p: DiagramPoint) => {
    const box = inclineTextBounds(text, p);
    const crossesAxis = (box[0] < origin[0] && box[2] > origin[0])
      || (box[1] < origin[1] && box[3] > origin[1]);
    // Edge clamping can slide a wide label back over its own dot.
    const coversDot = boxesIntersect(box, [at[0], at[1], at[0], at[1]], 6);
    return !crossesAxis && !coversDot && !placed.some((other) => boxesIntersect(box, other, 4))
      && !curve.some(([from, to]) => segmentTouchesLabel(from, to, box));
  };
  return candidates.find(clear) ?? candidates[0];
}

/** Coordinate axes use 78 SVG units per x unit and 76 per y unit. */
function graphFunction(
  preset: Exclude<FunctionPreset, "none">, origin: DiagramPoint, left: number, bottom: number,
  showKeyPoints: boolean,
): DiagramPrimitive[] {
  const map = (x: number, y: number) => point(origin[0] + x * 78, origin[1] - y * 76);
  const xmin = (left - origin[0]) / 78, xmax = (900 - origin[0]) / 78;
  const ymin = (origin[1] - bottom) / 76, ymax = (origin[1] - 95) / 76;
  const f = (x: number): number => {
    switch (preset) {
      case "linear": return x + 1;
      case "quadratic": return x * x - 2 * x - 2;
      case "sine": return Math.sin(x);
      case "cosine": return Math.cos(x);
      case "exponential": return 2 ** x;
      case "logarithm": return Math.log2(x);
    }
  };
  const primitives: DiagramPrimitive[] = [];
  // Segment clipping avoids drawing through the axes' boundaries or across x=0 for log.
  const samples = 240, segments: DiagramPoint[][] = [];
  let current: DiagramPoint[] = [];
  const clip = (a: [number, number], b: [number, number]): [number, number][] => {
    let lo = 0, hi = 1;
    const dx = b[0] - a[0], dy = b[1] - a[1];
    for (const [p, q] of [[-dx, a[0] - xmin], [dx, xmax - a[0]],
      [-dy, a[1] - ymin], [dy, ymax - a[1]]] as [number, number][]) {
      if (p === 0) { if (q < 0) return []; continue; }
      const t = q / p;
      if (p < 0) lo = Math.max(lo, t); else hi = Math.min(hi, t);
      if (lo > hi) return [];
    }
    return [[a[0] + dx * lo, a[1] + dy * lo], [a[0] + dx * hi, a[1] + dy * hi]];
  };
  for (let i = 1; i <= samples; i++) {
    const x0 = xmin + (xmax - xmin) * (i - 1) / samples;
    const x1 = xmin + (xmax - xmin) * i / samples;
    // Do not evaluate the logarithm outside its mathematical domain.
    if (preset === "logarithm" && x1 <= 0) continue;
    const a: [number, number] = [Math.max(x0, preset === "logarithm" ? 1e-8 : xmin),
      f(Math.max(x0, preset === "logarithm" ? 1e-8 : xmin))];
    const b: [number, number] = [x1, f(x1)];
    if (!Number.isFinite(a[1]) || !Number.isFinite(b[1])) continue;
    const clipped = clip(a, b);
    if (!clipped.length) {
      if (current.length > 1) segments.push(current);
      current = []; continue;
    }
    const [from, to] = clipped.map(([x, y]) => map(x, y));
    if (current.length && (current[current.length - 1][0] !== from[0] ||
      current[current.length - 1][1] !== from[1])) {
      if (current.length > 1) segments.push(current);
      current = [];
    }
    if (!current.length) current.push(from);
    current.push(to);
  }
  if (current.length > 1) segments.push(current);
  for (const segment of segments) {
    // Existing primitive contract caps polylines at 40 points. Decimate uniformly.
    const count = Math.min(DIAGRAM_LIMITS.maxPoints, segment.length);
    const points = Array.from({ length: count }, (_, i) =>
      segment[Math.round(i * (segment.length - 1) / (count - 1))]);
    primitives.push({ type: "polyline", points });
  }
  if (!showKeyPoints) return primitives;
  const marks: Record<Exclude<FunctionPreset, "none">, [number, number, string][]> = {
    linear: [[-1, 0, "(-1,0)"], [0, 1, "(0,1)"]],
    quadratic: [[1 - Math.sqrt(3), 0, "(1-√3,0)"], [1, -3, "(1,-3)"],
      [1 + Math.sqrt(3), 0, "(1+√3,0)"]],
    sine: [[0, 0, "O"], [Math.PI / 2, 1, "(π/2,1)"], [Math.PI, 0, "(π,0)"],
      [3 * Math.PI / 2, -1, "(3π/2,-1)"]],
    cosine: [[0, 1, "(0,1)"], [Math.PI / 2, 0, "(π/2,0)"], [Math.PI, -1, "(π,-1)"]],
    exponential: [[0, 1, "(0,1)"]],
    logarithm: [[1, 0, "(1,0)"], [2, 1, "(2,1)"]],
  };
  const placed: Bounds[] = [];
  const curve = primitives.flatMap((shape) => shape.type === "polyline"
    ? shape.points.slice(1).map((p, i): [DiagramPoint, DiagramPoint] => [shape.points[i], p]) : []);
  for (const [x, y, text] of marks[preset]) {
    if (x < xmin + 0.2 || x > xmax - 0.2 || y < ymin + 0.2 || y > ymax - 0.2) continue;
    const at = map(x, y);
    primitives.push({ type: "circle", center: at, r: 5 });
    // The origin is already annotated by the axes' "O".
    if (text === "O") continue;
    const anchor = keyPointLabelAnchor(text, at, origin, placed, curve);
    placed.push(inclineTextBounds(text, anchor));
    primitives.push(label(anchor, text));
  }
  return primitives;
}

function coordinatePlane(grid: boolean, quadrants: "all" | "first",
  preset: FunctionPreset = "none", keyPoints = true): DiagramPrimitive[] {
  const origin = quadrants === "all" ? point(490, 390) : point(175, 610);
  const left = quadrants === "all" ? 110 : origin[0];
  const bottom = quadrants === "all" ? 655 : origin[1];
  const result: DiagramPrimitive[] = [];
  if (grid) {
    // Grid lines pass through integer coordinates (origin + k units), the same
    // 78/76-unit scale graphFunction uses, so plotted key points sit on intersections.
    // Lines that would coincide with an axis are omitted.
    for (let x = origin[0] - Math.floor((origin[0] - left) / 78) * 78; x <= 890; x += 78)
      if (x !== origin[0]) result.push(line(point(x, 95), point(x, bottom), { guide: true, dashed: true }));
    for (let y = origin[1] - Math.floor((origin[1] - 95) / 76) * 76; y <= bottom; y += 76)
      if (y !== origin[1]) result.push(line(point(left, y), point(900, y), { guide: true, dashed: true }));
  }
  result.push(arrow(point(left, origin[1]), point(905, origin[1])));
  result.push(arrow(point(origin[0], bottom), point(origin[0], 80)));
  result.push(label(point(930, origin[1] + 50), "x"));
  result.push(label(point(origin[0] + 45, 65), "y"));
  result.push(label(point(origin[0] - 40, origin[1] + 50), "O"));
  if (preset !== "none") result.push(...graphFunction(preset, origin, left, bottom, keyPoints));
  return result;
}

/** Pure expansion: authored template parameters are never replaced by generated primitives. */
export function expandDiagram(block: DiagramBlock): DiagramPrimitive[] {
  if (block.primitives) return block.primitives;
  switch (block.template) {
    case "inclined-plane": return inclinedPlane(block.params.thetaDeg, block.params.friction);
    case "right-triangle": return rightTriangle(block.params.legRatio);
    case "number-line": return numberLine(block.params.start, block.params.end, block.params.step);
    case "coordinate-plane": return coordinatePlane(block.params.grid, block.params.quadrants,
      block.params.function ?? "none", block.params.keyPoints ?? true);
  }
}


const obj = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === "object" && !Array.isArray(value);
const keys = (value: Record<string, unknown>, allowed: readonly string[]) => Object.keys(value).every((key) => allowed.includes(key));
const finite = (value: unknown, min: number, max: number): value is number => typeof value === "number" && Number.isFinite(value) && value >= min && value <= max;
const isPoint = (value: unknown): value is DiagramPoint => Array.isArray(value) && value.length === 2
  && finite(value[0], 0, DIAGRAM_LIMITS.width) && finite(value[1], 0, DIAGRAM_LIMITS.height);
const text = (value: unknown, max: number, allowEmpty = false): value is string =>
  typeof value === "string" && (allowEmpty || value.length > 0)
  && Array.from(value).length <= max && cleanText(value, max) === value;
const boolOrMissing = (value: unknown) => value === undefined || typeof value === "boolean";
const labelOrMissing = (value: unknown) => value === undefined || text(value, DIAGRAM_LIMITS.maxLabel);

export function validDiagramPrimitive(value: unknown): value is DiagramPrimitive {
  if (!obj(value)) return false;
  switch (value.type) {
    case "line":
    case "arrow":
      return keys(value, ["type", "from", "to", "label", "dashed", "double", "guide"])
        && isPoint(value.from) && isPoint(value.to)
        && (value.from[0] !== value.to[0] || value.from[1] !== value.to[1])
        && labelOrMissing(value.label) && boolOrMissing(value.dashed)
        && boolOrMissing(value.double) && boolOrMissing(value.guide);
    case "polyline": {
      // Store the narrowed array locally: TS does not preserve narrowing on
      // a mutable Record<string, unknown> property inside Array.some callbacks.
      const points = value.points;
      return keys(value, ["type", "points", "dashed", "guide"])
        && Array.isArray(points) && points.length >= 2 && points.length <= DIAGRAM_LIMITS.maxPoints
        && points.every(isPoint) && points.some((p, i) => i > 0
          && (p[0] !== points[i - 1][0] || p[1] !== points[i - 1][1]))
        && boolOrMissing(value.dashed) && boolOrMissing(value.guide);
    }
    case "rect":
      if (!keys(value, ["type", "at", "width", "height", "rotation"]) || !isPoint(value.at)
        || !finite(value.width, 1, DIAGRAM_LIMITS.width) || !finite(value.height, 1, DIAGRAM_LIMITS.height)
        || (value.rotation !== undefined && !finite(value.rotation, -180, 180))) return false;
      return rectCornersWithin(value.at, value.width, value.height, value.rotation ?? 0);
    case "circle":
      return keys(value, ["type", "center", "r"]) && isPoint(value.center)
        && finite(value.r, 1, DIAGRAM_LIMITS.height / 2)
        && isPoint([value.center[0] - value.r, value.center[1] - value.r])
        && isPoint([value.center[0] + value.r, value.center[1] + value.r]);
    case "ellipse":
      if (!keys(value, ["type", "center", "rx", "ry", "rotation"]) || !isPoint(value.center)
        || !finite(value.rx, 1, DIAGRAM_LIMITS.width / 2) || !finite(value.ry, 1, DIAGRAM_LIMITS.height / 2)
        || (value.rotation !== undefined && !finite(value.rotation, -180, 180))) return false;
      const a = (value.rotation ?? 0) * Math.PI / 180;
      const dx = Math.hypot(value.rx * Math.cos(a), value.ry * Math.sin(a));
      const dy = Math.hypot(value.rx * Math.sin(a), value.ry * Math.cos(a));
      return isPoint([value.center[0] - dx, value.center[1] - dy]) && isPoint([value.center[0] + dx, value.center[1] + dy]);
    case "arc":
      return keys(value, ["type", "center", "radius", "startDeg", "sweepDeg", "label"])
        && isPoint(value.center) && finite(value.radius, 1, 375)
        && finite(value.startDeg, -360, 360) && finite(value.sweepDeg, -360, 360) && value.sweepDeg !== 0
        && isPoint([value.center[0] - value.radius, value.center[1] - value.radius])
        && isPoint([value.center[0] + value.radius, value.center[1] + value.radius])
        && labelOrMissing(value.label);
    case "label":
      return keys(value, ["type", "at", "text"]) && isPoint(value.at) && text(value.text, DIAGRAM_LIMITS.maxLabel);
    default:
      return false;
  }
}

function rectCornersWithin(at: DiagramPoint, width: number, height: number, rotation: number): boolean {
  const cx = at[0] + width / 2, cy = at[1] + height / 2, a = rotation * Math.PI / 180;
  const dx = Math.abs(width / 2 * Math.cos(a)) + Math.abs(height / 2 * Math.sin(a));
  const dy = Math.abs(width / 2 * Math.sin(a)) + Math.abs(height / 2 * Math.cos(a));
  return isPoint([cx - dx, cy - dy]) && isPoint([cx + dx, cy + dy]);
}

/** Strict draft-reader guard; the publication schema supplies user-facing paths and issue codes. */
export function validDiagramBlocks(value: unknown, sectionCount: number): value is DiagramBlock[] {
  if (!Array.isArray(value) || value.length > DIAGRAM_LIMITS.maxBlocks) return false;
  return value.every((block: unknown) => {
    if (!obj(block) || !keys(block, ["afterSection", "caption", "handDrawn", "jitterPx", "template", "params", "primitives"])
      || !Number.isSafeInteger(block.afterSection) || !finite(block.afterSection, 0, sectionCount - 1)
      || (block.caption !== undefined && !text(block.caption, DIAGRAM_LIMITS.maxCaption, true))
      || !boolOrMissing(block.handDrawn)
      || (block.jitterPx !== undefined && !finite(block.jitterPx, 0, 3))) return false;

    if (Object.hasOwn(block, "primitives")) {
      return !Object.hasOwn(block, "template") && !Object.hasOwn(block, "params")
        && Array.isArray(block.primitives) && block.primitives.length >= 1
        && block.primitives.length <= DIAGRAM_LIMITS.maxPrimitives
        && block.primitives.every(validDiagramPrimitive);
    }
    if (!Object.hasOwn(block, "template") || !obj(block.params)) return false;
    const p = block.params;
    switch (block.template) {
      case "inclined-plane":
        return keys(p, ["thetaDeg", "friction"]) && finite(p.thetaDeg, 5, 60) && typeof p.friction === "boolean";
      case "right-triangle":
        return keys(p, ["legRatio"]) && finite(p.legRatio, 0.25, 4);
      case "number-line":
        return keys(p, ["start", "end", "step"])
          && finite(p.start, -1000, 1000) && finite(p.end, -1000, 1000) && finite(p.step, 0.1, 1000)
          && p.end > p.start && (p.end - p.start) / p.step <= 18 + 1e-8;
      case "coordinate-plane":
        return keys(p, ["grid", "quadrants", "function", "keyPoints"])
          && typeof p.grid === "boolean" && ["all", "first"].includes(String(p.quadrants))
          && (p.function === undefined || FUNCTION_PRESETS.includes(p.function as FunctionPreset))
          && boolOrMissing(p.keyPoints);
      default:
        return false;
    }
  });
}
