import { cleanText } from "./text.ts";

/** Structured, dimensionless note diagrams. All values use a 1000 x 750 (4:3) coordinate plane. */
export const DIAGRAM_LIMITS = {
  width: 1000, height: 750, maxBlocks: 2, maxPrimitives: 40,
  maxPoints: 40, maxCaption: 40, maxLabel: 40,
} as const;

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
  | { template: "coordinate-plane"; params: { grid: boolean; quadrants: "all" | "first" }; primitives?: never }
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
function inclineTextBounds(text: string, at: DiagramPoint): Bounds {
  const units = Array.from(text).reduce((sum, ch) => sum + (ch.charCodeAt(0) < 128 ? 1.1 : 1.3), 0);
  const half = Math.max(19, units * 14);
  return [at[0] - half, at[1] - 32, at[0] + half, at[1] + 32];
}
function boxesIntersect(a: Bounds, b: Bounds, gap = 10): boolean {
  return a[0] < b[2] + gap && a[2] + gap > b[0] && a[1] < b[3] + gap && a[3] + gap > b[1];
}
/** Exact segment-vs-expanded-rectangle intersection (Liang-Barsky clipping). */
function segmentTouchesLabel(a: DiagramPoint, b: DiagramPoint, rect: Bounds): boolean {
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
  const center = add(add(base, scale(tangent, 305)), scale(outward, 36));
  const vectors = inclinedPlaneForces(thetaDeg);
  const along = add(center, vectors.parallel);
  const across = add(center, vectors.perpendicular);
  const down = add(center, vectors.gravity);
  const support = add(center, vectors.support); // N balances mg cosθ: same magnitude, opposite direction.
  const frictionTip = add(center, scale(tangent, 110));
  const elements: DiagramPrimitive[] = [
    line(base, top),
    { type: "rect", at: point(center[0] - 36, center[1] - 27), width: 72, height: 54, rotation: -thetaDeg },
    arrow(center, down),
    arrow(center, along),
    arrow(center, across),
    line(along, down, { dashed: true }),
    line(across, down, { dashed: true }),
    arrow(center, support),
    { type: "arc", center: base, radius: 65, startDeg: -thetaDeg, sweepDeg: thetaDeg },
  ];
  const strokes: [DiagramPoint, DiagramPoint][] = [
    [base, top], [center, down], [center, along], [center, across],
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
    { text: "mg sinθ", near: add(along, point(-140, -90)) },
    { text: "mg cosθ", near: add(across, point(140, 0)) },
    { text: "N", near: add(support, point(-90, -65)) },
    { text: "mg", near: add(down, point(-65, -35)) },
    ...(friction ? [{ text: "f", near: add(frictionTip, point(90, -90)) }] : []),
    { text: "θ = " + thetaDeg + "°", near: add(base, point(105, 80)) },
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
  // Compare exact endpoints: a step-sized absolute epsilon can erase a valid tiny range.
  if (ticks[last] === end) {
    ticks[last] = end;
  } else {
    // Drop a near-duplicate terminal tick so the end label remains readable.
    while (ticks.length > 1 && (end - ticks[ticks.length - 1]) / (end - start) * (right - left - 85) < 60) ticks.pop();
    if (ticks.length < 19) ticks.push(end);
    else ticks[ticks.length - 1] = end; // Defensive cap for direct callers with invalid parameters.
  }
  const labels = numberLineTickLabels(ticks);
  const positions = ticks.map((value) => left + 34 + (right - left - 85) * (value - start) / (end - start));
  // Preserve every tick mark and both endpoint values. Show intermediate
  // labels only when their estimated text extents have sufficient separation.
  const width = (text: string) => Array.from(text).reduce((sum, char) => sum + (char.charCodeAt(0) < 128 ? 27 : 32), 0);
  const visible = new Set([0, ticks.length - 1]);
  let previous = 0;
  for (let i = 1; i < ticks.length - 1; i++) {
    if (positions[i] - positions[previous] < (width(labels[i]) + width(labels[previous])) / 2 + 20) continue;
    if (positions[ticks.length - 1] - positions[i]
      < (width(labels[i]) + width(labels[ticks.length - 1])) / 2 + 20) continue;
    visible.add(i);
    previous = i;
  }
  for (let i = 0; i < ticks.length; i++) {
    const x = positions[i];
    result.push(line(point(x, y - 16), point(x, y + 16)));
    if (visible.has(i)) result.push(label(point(x, y + 62), labels[i]));
  }
  return result;
}

function coordinatePlane(grid: boolean, quadrants: "all" | "first"): DiagramPrimitive[] {
  const origin = quadrants === "all" ? point(490, 390) : point(175, 610);
  const left = quadrants === "all" ? 110 : origin[0];
  const bottom = quadrants === "all" ? 655 : origin[1];
  const result: DiagramPrimitive[] = [];
  if (grid) {
    for (let x = left; x <= 890; x += 78) result.push(line(point(x, 95), point(x, bottom), { guide: true, dashed: true }));
    for (let y = 110; y <= bottom; y += 76) result.push(line(point(left, y), point(900, y), { guide: true, dashed: true }));
  }
  result.push(arrow(point(left, origin[1]), point(905, origin[1])));
  result.push(arrow(point(origin[0], bottom), point(origin[0], 80)));
  result.push(label(point(930, origin[1] + 50), "x"));
  result.push(label(point(origin[0] + 45, 65), "y"));
  result.push(label(point(origin[0] - 40, origin[1] + 50), "O"));
  return result;
}

/** Pure expansion: authored template parameters are never replaced by generated primitives. */
export function expandDiagram(block: DiagramBlock): DiagramPrimitive[] {
  if (block.primitives) return block.primitives;
  switch (block.template) {
    case "inclined-plane": return inclinedPlane(block.params.thetaDeg, block.params.friction);
    case "right-triangle": return rightTriangle(block.params.legRatio);
    case "number-line": return numberLine(block.params.start, block.params.end, block.params.step);
    case "coordinate-plane": return coordinatePlane(block.params.grid, block.params.quadrants);
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
        return keys(p, ["grid", "quadrants"]) && typeof p.grid === "boolean" && ["all", "first"].includes(String(p.quadrants));
      default:
        return false;
    }
  });
}
