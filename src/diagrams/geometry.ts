import {
  DIAGRAM_LIMITS, expandDiagram, inclineTextBounds, segmentTouchesLabel, validDiagramPrimitive,
  type DiagramBlock, type DiagramPoint, type DiagramPrimitive,
} from "../../shared/diagram.ts";
import { diagramLabelLayout } from "./svg-geometry.ts";

export const DIAGRAM_GRID = DIAGRAM_LIMITS.width / 40; // 25 normalized units
export const DIAGRAM_HISTORY_LIMIT = 30;
type Point = DiagramPoint;
type Shape = DiagramPrimitive;
/** The only valid shape-edit result: template/params fields are absent. */
type PrimitiveDiagram = {
  afterSection: number;
  caption?: string;
  handDrawn?: boolean;
  jitterPx?: number;
  primitives: DiagramPrimitive[];
  template?: never;
  params?: never;
};
export type ShapeHandle = { id: string; point: Point; kind: "resize" | "rotate" };

const round = (n: number) => Number(n.toFixed(4));
const point = (x: number, y: number): Point => [round(x), round(y)];
const safe = (p: Point): Point => point(
  Math.max(0, Math.min(DIAGRAM_LIMITS.width, p[0])),
  Math.max(0, Math.min(DIAGRAM_LIMITS.height, p[1])),
);
const mean = (points: Point[]): Point => point(
  points.reduce((sum, p) => sum + p[0], 0) / points.length,
  points.reduce((sum, p) => sum + p[1], 0) / points.length,
);
const polar = (at: Point, radius: number, angleDeg: number): Point => {
  const angle = angleDeg * Math.PI / 180;
  return point(at[0] + radius * Math.cos(angle), at[1] + radius * Math.sin(angle));
};
const rotation = (from: Point, center: Point, angleDeg: number): Point => {
  const x = from[0] - center[0], y = from[1] - center[1], a = angleDeg * Math.PI / 180;
  return point(center[0] + x * Math.cos(a) - y * Math.sin(a),
    center[1] + x * Math.sin(a) + y * Math.cos(a));
};
const normAngle = (n: number) => {
  const angle = ((n + 180) % 360 + 360) % 360 - 180;
  return round(angle === -180 ? 180 : angle);
};
// Pointer angles are modulo 360, whereas an authored arc may span a full turn.
// Choose the equivalent pointer angle nearest its previous unwrapped endpoint.
const unwrapNear = (angle: number, reference: number) =>
  angle + 360 * Math.round((reference - angle) / 360);
const boundedSweep = (sweep: number, previous: number) => {
  const bounded = Math.max(-360, Math.min(360, round(sweep)));
  return Math.abs(bounded) < 0.1 ? (previous > 0 ? 0.1 : -0.1) : bounded;
};
export const snapAngle = (degrees: number): number => Math.round(degrees / 15) * 15;
export const snapToGrid = (at: Point): Point => point(
  Math.round(at[0] / DIAGRAM_GRID) * DIAGRAM_GRID,
  Math.round(at[1] / DIAGRAM_GRID) * DIAGRAM_GRID,
);

/** Converting on first *actual* edit protects the original parameterized template. */
export function materializeDiagram(block: DiagramBlock): PrimitiveDiagram {
  if (block.primitives) return block as PrimitiveDiagram;
  const { afterSection, caption, handDrawn, jitterPx } = block;
  return {
    afterSection,
    ...(caption !== undefined ? { caption } : {}),
    ...(handDrawn !== undefined ? { handDrawn } : {}),
    ...(jitterPx !== undefined ? { jitterPx } : {}),
    primitives: expandDiagram(block),
  };
}

export function shapeCenter(shape: Shape): Point {
  switch (shape.type) {
    case "line":
    case "arrow": return mean([shape.from, shape.to]);
    case "polyline": return mean(shape.points);
    case "rect": return point(shape.at[0] + shape.width / 2, shape.at[1] + shape.height / 2);
    case "circle":
    case "ellipse":
    case "arc": return shape.center;
    case "label": return diagramLabelLayout(shape.at, shape.text).at;
  }
}

/** Maps all centers and vertices of a primitive with immutable point transforms. */
function mapShape(shape: Shape, fn: (p: Point) => Point): Shape {
  switch (shape.type) {
    case "line":
    case "arrow": return { ...shape, from: fn(shape.from), to: fn(shape.to) };
    case "polyline": return { ...shape, points: shape.points.map(fn) };
    case "rect": return { ...shape, at: fn(shape.at) };
    case "circle":
    case "ellipse":
    case "arc": return { ...shape, center: fn(shape.center) };
    case "label": return { ...shape, at: fn(shape.at) };
  }
}

export function moveShape(shape: Shape, dx: number, dy: number): Shape {
  if (dx === 0 && dy === 0) return shape;
  return mapShape(shape, (p) => point(p[0] + dx, p[1] + dy));
}

export function rotateShape(shape: Shape, degrees: number): Shape {
  const angle = snapAngle(degrees);
  if (angle === 0) return shape;
  switch (shape.type) {
    case "rect":
    case "ellipse": return { ...shape, rotation: normAngle((shape.rotation ?? 0) + angle) };
    case "arc": return { ...shape, startDeg: normAngle(shape.startDeg + angle) };
    case "line":
    case "arrow":
    case "polyline": {
      const center = shapeCenter(shape);
      return mapShape(shape, (p) => rotation(p, center, angle));
    }
    default: return shape; // circles and text labels have no meaningful stroke orientation
  }
}

export function shapeHandles(shape: Shape): ShapeHandle[] {
  const center = shapeCenter(shape);
  let handles: ShapeHandle[];
  switch (shape.type) {
    case "line":
    case "arrow":
      handles = [{ id: "from", kind: "resize", point: shape.from },
        { id: "to", kind: "resize", point: shape.to }];
      break;
    case "polyline":
      handles = shape.points.map((p, index) => ({ id: "p:" + index, kind: "resize", point: p }));
      break;
    case "rect": {
      const angle = shape.rotation ?? 0;
      handles = [{ id: "size", kind: "resize", point: rotation(
        point(center[0] + shape.width / 2, center[1] + shape.height / 2), center, angle) }];
      break;
    }
    case "circle":
      handles = [{ id: "radius", kind: "resize", point: point(center[0] + shape.r, center[1]) }];
      break;
    case "ellipse": {
      const angle = shape.rotation ?? 0;
      handles = [
        { id: "rx", kind: "resize", point: rotation(point(center[0] + shape.rx, center[1]), center, angle) },
        { id: "ry", kind: "resize", point: rotation(point(center[0], center[1] + shape.ry), center, angle) },
      ];
      break;
    }
    case "arc":
      handles = [
        { id: "start", kind: "resize", point: polar(center, shape.radius, shape.startDeg) },
        { id: "end", kind: "resize", point: polar(center, shape.radius, shape.startDeg + shape.sweepDeg) },
        { id: "radius", kind: "resize", point: polar(center, shape.radius, shape.startDeg + shape.sweepDeg / 2) },
      ];
      break;
    case "label":
      handles = [{ id: "at", kind: "resize", point: center }];
      break;
  }
  if (["line", "arrow", "polyline", "rect", "ellipse", "arc"].includes(shape.type)) {
    handles.push({
      id: "rotate", kind: "rotate", point: safe(point(center[0], center[1] - 100)),
    });
  }
  return handles;
}

export function resizeShape(shape: Shape, handle: string, at: Point, snapping = true): Shape {
  const next = snapping ? snapToGrid(safe(at)) : safe(at);
  switch (shape.type) {
    case "line":
    case "arrow":
      return handle === "from" ? { ...shape, from: next }
        : handle === "to" ? { ...shape, to: next } : shape;
    case "polyline": {
      if (!handle.startsWith("p:")) return shape;
      const index = Number(handle.slice(2));
      if (!Number.isInteger(index) || index < 0 || index >= shape.points.length) return shape;
      return { ...shape, points: shape.points.map((p, i) => i === index ? next : p) };
    }
    case "rect": {
      if (handle !== "size") return shape;
      const center = shapeCenter(shape);
      const local = rotation(next, center, -(shape.rotation ?? 0));
      const width = round(2 * Math.abs(local[0] - center[0]));
      const height = round(2 * Math.abs(local[1] - center[1]));
      return { ...shape, at: point(center[0] - width / 2, center[1] - height / 2), width, height };
    }
    case "circle":
      return handle === "radius" ? { ...shape, r: round(Math.hypot(next[0] - shape.center[0], next[1] - shape.center[1])) } : shape;
    case "ellipse": {
      const local = rotation(next, shape.center, -(shape.rotation ?? 0));
      if (handle === "rx") return { ...shape, rx: round(Math.abs(local[0] - shape.center[0])) };
      if (handle === "ry") return { ...shape, ry: round(Math.abs(local[1] - shape.center[1])) };
      return shape;
    }
    case "arc": {
      const angle = Math.atan2(next[1] - shape.center[1], next[0] - shape.center[0]) * 180 / Math.PI;
      if (handle === "radius") return { ...shape, radius: round(Math.hypot(next[0] - shape.center[0], next[1] - shape.center[1])) };
      if (handle === "start") {
        const end = shape.startDeg + shape.sweepDeg;
        const start = unwrapNear(angle, shape.startDeg);
        return { ...shape, startDeg: normAngle(start), sweepDeg: boundedSweep(end - start, shape.sweepDeg) };
      }
      if (handle === "end") {
        const end = unwrapNear(angle, shape.startDeg + shape.sweepDeg);
        return { ...shape, sweepDeg: boundedSweep(end - shape.startDeg, shape.sweepDeg) };
      }
      return shape;
    }
    case "label":
      return handle === "at" ? { ...shape, at: next } : shape;
  }
}

const closestSegment = (at: Point, a: Point, b: Point): number => {
  const dx = b[0] - a[0], dy = b[1] - a[1], lenSq = dx * dx + dy * dy;
  const t = lenSq === 0 ? 0 : Math.max(0, Math.min(1, ((at[0] - a[0]) * dx + (at[1] - a[1]) * dy) / lenSq));
  return Math.hypot(at[0] - (a[0] + t * dx), at[1] - (a[1] + t * dy));
};
function strokes(shape: Shape): Point[][] {
  switch (shape.type) {
    case "line":
    case "arrow": return [[shape.from, shape.to]];
    case "polyline": return shape.points.slice(1).map((p, i) => [shape.points[i], p]);
    case "rect": {
      const c = shapeCenter(shape), r = shape.rotation ?? 0;
      const [x, y] = shape.at;
      const pts = [point(x,y),point(x+shape.width,y),point(x+shape.width,y+shape.height),
        point(x,y+shape.height),point(x,y)].map((p) => rotation(p,c,r));
      return pts.slice(1).map((p, i) => [pts[i],p]);
    }
    case "circle":
    case "ellipse": {
      const rx = shape.type === "circle" ? shape.r : shape.rx;
      const ry = shape.type === "circle" ? shape.r : shape.ry;
      const rot = shape.type === "ellipse" ? shape.rotation ?? 0 : 0;
      const pts = Array.from({ length: 25 }, (_, i) => {
        const a = i * 15 * Math.PI / 180;
        const local = point(shape.center[0] + Math.cos(a) * rx, shape.center[1] + Math.sin(a) * ry);
        return rotation(local, shape.center, rot);
      });
      return pts.slice(1).map((p,i)=>[pts[i],p]);
    }
    case "arc": {
      const pts = Array.from({length:17},(_,i)=>polar(shape.center,shape.radius,
        shape.startDeg+shape.sweepDeg*i/16));
      return pts.slice(1).map((p,i)=>[pts[i],p]);
    }
    case "label": return [];
  }
}

const LABEL_CLEARANCE = 48;
/** Test the painted text box, not just its anchor, against an edited stroke. */
function touchesPaintedLabel(label: Extract<Shape, { type: "label" }>, stroke: Shape): boolean {
  const bounds = inclineTextBounds(label.text, diagramLabelLayout(label.at, label.text).at);
  return strokes(stroke).some(([from, to]) => segmentTouchesLabel(from, to, bounds));
}
/** Distance from a label anchor to the nearest stroke of one shape (Infinity for text). */
function strokeDistance(at: Point, shape: Shape): number {
  return strokes(shape).reduce((best, [a, b]) => Math.min(best, closestSegment(at, a, b)), Infinity);
}

/**
 * Enforce a minimum text-anchor-to-stroke clearance (~4 rendered px at normal scale,
 * plus room for the outline/handwritten glyph). D1 still paints a paper-color outline.
 */
export function clearLabel(
  shape: Shape, others: Shape[], clearance = LABEL_CLEARANCE, avoidPaintedStroke?: Shape,
): Shape {
  if (shape.type !== "label") return shape;
  const lines = others.flatMap(strokes);
  if (!lines.length && !avoidPaintedStroke) return shape;
  const valid = (p: Point) => p[0] >= 60 && p[0] <= 940 && p[1] >= 60 && p[1] <= 690
    && lines.every(([a,b])=>closestSegment(p,a,b)>=clearance)
    && (!avoidPaintedStroke || !touchesPaintedLabel({ ...shape, at: p }, avoidPaintedStroke));
  if (valid(shape.at)) return shape;
  const base = snapToGrid(shape.at);
  for(let ring=0;ring<=20;ring++){
    for(let y=-ring;y<=ring;y++){
      for(let x=-ring;x<=ring;x++){
        if(Math.max(Math.abs(x),Math.abs(y))!==ring)continue;
        const next=point(base[0]+x*DIAGRAM_GRID,base[1]+y*DIAGRAM_GRID);
        if(valid(next))return {...shape,at:next};
      }
    }
  }
  return shape; // caller still checks the strict geometry schema
}

export function editShape(block: DiagramBlock, index: number, next: Shape): DiagramBlock {
  if (!validDiagramPrimitive(next)) return block;
  const editable = materializeDiagram(block);
  const primitives = editable.primitives!;
  if (index < 0 || index >= primitives.length) return block;
  const adapted = clearLabel(next, primitives.filter((_, i) => i !== index));
  if (JSON.stringify(primitives[index]) === JSON.stringify(adapted)) return block;
  const changed = primitives.map((shape, i) => i === index ? adapted : shape);
  // Preserve intentional template spacing (notably number-line tick values).
  // Reflow only if the edited stroke newly crowds an anchor or newly/more deeply
  // crosses the painted glyph box. Existing near-clearance is not a veto.
  const before = primitives[index];
  const adjusted = changed.map((shape, i) => {
    if (shape.type !== "label" || i === index) return shape;
    const beforeDistance = strokeDistance(shape.at, before);
    const afterDistance = strokeDistance(shape.at, adapted);
    const newlyCrowded = beforeDistance >= LABEL_CLEARANCE && afterDistance < LABEL_CLEARANCE;
    const worsenedInk = touchesPaintedLabel(shape, adapted)
      && (!touchesPaintedLabel(shape, before) || beforeDistance - afterDistance >= DIAGRAM_GRID / 2);
    if (!newlyCrowded && !worsenedInk) return shape;
    // Decorative guide lines sit close together by design; forcing 48 units
    // from every grid line makes a valid relocation impossible.
    const obstacles = changed.filter((other, j) => j !== i && !("guide" in other && other.guide));
    return clearLabel(shape, obstacles, LABEL_CLEARANCE, adapted);
  });
  if (!adjusted.every(validDiagramPrimitive)) return block;
  return { ...editable, primitives: adjusted };
}

export function addShape(block: DiagramBlock, shape: Shape): DiagramBlock {
  if (!validDiagramPrimitive(shape)) return block;
  const editable = materializeDiagram(block);
  if (editable.primitives!.length >= DIAGRAM_LIMITS.maxPrimitives) return block;
  const next = clearLabel(shape, editable.primitives!);
  return { ...editable, primitives: [...editable.primitives!, next] };
}
export function deleteShape(block: DiagramBlock, index: number): DiagramBlock {
  const editable = materializeDiagram(block);
  if (editable.primitives!.length <= 1 || index < 0 || index >= editable.primitives!.length) return block;
  return { ...editable, primitives: editable.primitives!.filter((_, i) => i !== index) };
}

export function defaultShape(type: Shape["type"]): Shape {
  switch(type) {
    case "line": return {type,from:[250,375],to:[750,375]};
    case "arrow": return {type,from:[250,375],to:[750,375]};
    case "polyline": return {type,points:[[200,500],[450,275],[750,500]]};
    case "rect": return {type,at:[330,245],width:340,height:250};
    case "circle": return {type,center:[500,375],r:125};
    case "ellipse": return {type,center:[500,375],rx:225,ry:115};
    case "arc": return {type,center:[500,375],radius:160,startDeg:-90,sweepDeg:75};
    case "label": return {type,at:[500,375],text:"A"};
  }
}

export function rotateFromPointers(shape:Shape,start:Point,end:Point):Shape{
  const center=shapeCenter(shape);
  const a=Math.atan2(end[1]-center[1],end[0]-center[0]);
  const b=Math.atan2(start[1]-center[1],start[0]-center[0]);
  return rotateShape(shape,(a-b)*180/Math.PI);
}
export function moveFromPointers(shape:Shape,start:Point,end:Point,snapping=true):Shape{
  const raw=point(end[0]-start[0],end[1]-start[1]);
  const delta=snapping?snapToGrid(raw):raw;
  if (shape.type === "label") {
    // Move from the displayed anchor, not a raw off-screen/boundary coordinate.
    // An outward nudge that leaves the visible glyph unchanged is a no-op.
    const center = shapeCenter(shape);
    const next = diagramLabelLayout(point(center[0] + delta[0], center[1] + delta[1]), shape.text).at;
    return next[0] === center[0] && next[1] === center[1] ? shape : { ...shape, at: next };
  }
  return moveShape(shape,delta[0],delta[1]);
}
