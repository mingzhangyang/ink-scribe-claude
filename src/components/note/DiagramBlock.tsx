import { memo } from "react";
import {
  DIAGRAM_LIMITS, expandDiagram, type DiagramBlock, type DiagramPoint, type DiagramPrimitive,
} from "../../../shared/diagram.ts";
import { hashString, signedRandom } from "../../lib/random.ts";

type Props = { block: DiagramBlock; seed: number };
const add = (a: DiagramPoint, b: DiagramPoint): DiagramPoint => [a[0] + b[0], a[1] + b[1]];
const midpoint = (a: DiagramPoint, b: DiagramPoint): DiagramPoint => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
const coords = (p: DiagramPoint) => p.map((v) => +v.toFixed(3)).join(" ");
const segment = (start: DiagramPoint, end: DiagramPoint, seed: number, jitter: number): string => {
  const dx = end[0] - start[0], dy = end[1] - start[1], length = Math.hypot(dx, dy);
  if (!length || jitter <= 0) return "M" + coords(start) + " L" + coords(end);
  const random = signedRandom(seed);
  const count = Math.max(2, Math.min(15, Math.ceil(length / 70)));
  const normal: DiagramPoint = [-dy / length, dx / length];
  let d = "M" + coords(start);
  for (let i = 1; i < count; i++) {
    const t = i / count, drift = random() * jitter * 2;
    d += " L" + coords([start[0] + t * dx + drift * normal[0], start[1] + t * dy + drift * normal[1]]);
  }
  return d + " L" + coords(end);
};
const polyPath = (points: DiagramPoint[], seed: number, jitter: number): string =>
  points.slice(1).map((p, i) => segment(points[i], p, seed + i * 101, jitter)).join(" ");
const arrowHead = (from: DiagramPoint, to: DiagramPoint): string => {
  const dx = to[0] - from[0], dy = to[1] - from[1], len = Math.hypot(dx, dy);
  if (!len) return "";
  const ux = dx / len, uy = dy / len, size = Math.min(26, len * 0.34);
  const a: DiagramPoint = [to[0] - ux * size - uy * size * 0.42, to[1] - uy * size + ux * size * 0.42];
  const b: DiagramPoint = [to[0] - ux * size + uy * size * 0.42, to[1] - uy * size - ux * size * 0.42];
  return "M" + coords(a) + " L" + coords(to) + " L" + coords(b);
};
const arcPath = (center: DiagramPoint, radius: number, start: number, sweep: number): string => {
  const xy = (angle: number): DiagramPoint => [
    center[0] + Math.cos(angle * Math.PI / 180) * radius,
    center[1] + Math.sin(angle * Math.PI / 180) * radius,
  ];
  const pieces = Math.ceil(Math.abs(sweep) / 150);
  const step = sweep / pieces;
  let path = "M" + coords(xy(start));
  for (let i = 1; i <= pieces; i++) {
    path += " A" + radius + " " + radius + " 0 0 " + (sweep > 0 ? 1 : 0) + " " + coords(xy(start + step * i));
  }
  return path;
};
const ellipsePath = (center: DiagramPoint, rx: number, ry: number, seed: number, jitter: number): string => {
  const random = signedRandom(seed);
  const points: DiagramPoint[] = [];
  for (let i = 0; i <= 32; i++) {
    const a = 2 * Math.PI * i / 32, delta = i === 0 || i === 32 ? 0 : random() * jitter * 2;
    points.push([center[0] + Math.max(0.5, rx + delta) * Math.cos(a),
      center[1] + Math.max(0.5, ry + delta) * Math.sin(a)]);
  }
  return points.map((p, i) => (i ? "L" : "M") + coords(p)).join(" ") + " Z";
};
const textPosition = (from: DiagramPoint, to: DiagramPoint): DiagramPoint => {
  const mid = midpoint(from, to), dx = to[0] - from[0], dy = to[1] - from[1];
  const length = Math.hypot(dx, dy) || 1;
  return add(mid, [-dy / length * 55, dx / length * 55 - 8]);
};
const templateNames: Record<NonNullable<DiagramBlock["template"]>, string> = {
  "inclined-plane": "Inclined plane forces",
  "right-triangle": "Right triangle",
  "number-line": "Number line",
  "coordinate-plane": "Coordinate axes",
};

function InkLabel({ at, children }: { at: DiagramPoint; children: string }) {
  // Positions may be valid at the canvas boundary, but text and its paper outline need room.
  // Keep the natural font size whenever possible and cap it only if the text cannot fit.
  const inset = 20;
  const units = Array.from(children).reduce((sum, character) => sum + (character.charCodeAt(0) < 128 ? 1.1 : 1.3), 0);
  const estimatedWidth = Math.min(DIAGRAM_LIMITS.width - 2 * inset, units * 48);
  const minX = Math.max(90, inset + estimatedWidth / 2);
  const x = Math.max(minX, Math.min(DIAGRAM_LIMITS.width - minX, at[0]));
  const y = Math.max(70, Math.min(DIAGRAM_LIMITS.height - 70, at[1]));
  const horizontalRoom = 2 * (Math.min(x, DIAGRAM_LIMITS.width - x) - inset);
  const verticalRoom = 2 * (Math.min(y, DIAGRAM_LIMITS.height - y) - inset);
  const fontCap = Math.max(1, Math.floor(100 * Math.min(horizontalRoom / units, verticalRoom / 1.5)) / 100);
  const fontSize = `min(calc(var(--fs) * var(--diagram-label-scale, 2.4)), ${fontCap}px)`;
  return (
    <text x={x} y={y} textAnchor="middle" dominantBaseline="middle" className="diagram-label"
      style={{ fontSize }}>
      {children}
    </text>
  );
}

function Element({ shape, seed, jitter }: { shape: DiagramPrimitive; seed: number; jitter: number }) {
  switch (shape.type) {
    case "line":
    case "arrow": {
      const d = shape.type === "arrow"
        ? segment(shape.from, shape.to, seed, 0) + " " + arrowHead(shape.from, shape.to)
          + (shape.double ? " " + arrowHead(shape.to, shape.from) : "")
        : segment(shape.from, shape.to, seed, jitter);
      return <g>
        <path d={d} className={shape.guide ? "diagram-guide" : undefined} strokeDasharray={shape.dashed ? "13 12" : undefined} />
        {shape.label ? <InkLabel at={textPosition(shape.from, shape.to)}>{shape.label}</InkLabel> : null}
      </g>;
    }
    case "polyline":
      return <path d={polyPath(shape.points, seed, jitter)} className={shape.guide ? "diagram-guide" : undefined}
        strokeDasharray={shape.dashed ? "13 12" : undefined} />;
    case "rect": {
      const [x, y] = shape.at, w = shape.width, h = shape.height;
      const points: DiagramPoint[] = [[x, y], [x + w, y], [x + w, y + h], [x, y + h], [x, y]];
      return <path d={polyPath(points, seed, jitter)} transform={shape.rotation ? "rotate(" + shape.rotation + " " + (x + w / 2) + " " + (y + h / 2) + ")" : undefined} />;
    }
    case "circle":
      return <path d={ellipsePath(shape.center, shape.r, shape.r, seed, jitter)} />;
    case "ellipse":
      return <path d={ellipsePath(shape.center, shape.rx, shape.ry, seed, jitter)}
        transform={shape.rotation ? "rotate(" + shape.rotation + " " + shape.center[0] + " " + shape.center[1] + ")" : undefined} />;
    case "arc": {
      const mid = (shape.startDeg + shape.sweepDeg / 2) * Math.PI / 180;
      const place: DiagramPoint = [
        shape.center[0] + Math.cos(mid) * (shape.radius + 58),
        shape.center[1] + Math.sin(mid) * (shape.radius + 58),
      ];
      return <g>
        <path d={arcPath(shape.center, shape.radius, shape.startDeg, shape.sweepDeg)} />
        {shape.label ? <InkLabel at={place}>{shape.label}</InkLabel> : null}
      </g>;
    }
    case "label":
      return <InkLabel at={shape.at}>{shape.text}</InkLabel>;
  }
}

/**
 * Pure SVG, shared by editor canvas and published-note viewer.
 * PNG export snapshots this exact NotePage DOM (no image-generation fallback).
 */
export const DiagramBlockView = memo(function DiagramBlockView({ block, seed }: Props) {
  const elements = expandDiagram(block);
  const jitter = block.handDrawn === false ? 0 : block.jitterPx ?? 1.2;
  const caption = block.caption || "";
  const accessible = caption || (block.template ? templateNames[block.template] : "Notebook diagram");
  // Keep the hand-drawn jitter stable while a primitive moves or a template
  // materializes; the original full-block hash made every stroke flicker per pointermove.
  const baseSeed = seed ^ hashString(`inline-diagram:${block.afterSection}`);
  return (
    <figure className="diagram-block" data-fit data-diagram-after-section={block.afterSection}>
      <svg className="diagram-art" viewBox={"0 0 " + DIAGRAM_LIMITS.width + " " + DIAGRAM_LIMITS.height}
        role="img" aria-label={accessible} preserveAspectRatio="xMidYMid meet">
        <g className="diagram-ink" fill="none" stroke="currentColor" strokeWidth={5.5}
          strokeLinecap="round" strokeLinejoin="round">
          {elements.map((shape, i) => <Element key={i} shape={shape} seed={baseSeed + i * 7919} jitter={jitter} />)}
        </g>
      </svg>
      {caption ? <figcaption>{caption}</figcaption> : null}
    </figure>
  );
});
