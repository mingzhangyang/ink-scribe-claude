import { createContext, memo, useContext } from "react";
import {
  expandDiagram, SHORT_FORCE_CALLOUT, SHORT_FORCE_SCALE_NOTE, type DiagramBlock, type DiagramPoint, type DiagramPrimitive,
} from "../../../shared/diagram.ts";
import { hashString, signedRandom } from "../../lib/random.ts";
import { useT } from "../../i18n/index.ts";
import { diagramArcPath, diagramArrowLabelPosition, diagramLabelFontSize, diagramLabelLayout, diagramViewport, type DiagramViewport } from "../../diagrams/svg-geometry.ts";

export const PendingDiagramContext = createContext<readonly DiagramBlock[]>([]);
type Props = { block: DiagramBlock; seed: number; viewport?: DiagramViewport; pending?: boolean };
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
const templateNames: Record<NonNullable<DiagramBlock["template"]>, string> = {
  "inclined-plane": "Inclined plane forces",
  "right-triangle": "Right triangle",
  "number-line": "Number line",
  "coordinate-plane": "Coordinate axes",
};

function InkLabel({ at, children }: { at: DiagramPoint; children: string }) {
  // Positions may be valid at the canvas boundary, but text and its paper outline need room.
  // Keep the natural font size whenever possible and cap it only if the text cannot fit.
  const { at: [x, y], fontCap } = diagramLabelLayout(at, children);
  const fontSize = diagramLabelFontSize(fontCap);
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
      return <g data-diagram-primitive={shape.type}>
        <path d={d} className={shape.guide ? "diagram-guide" : undefined} strokeDasharray={shape.dashed ? "13 12" : undefined} />
        {shape.label && shape.label !== SHORT_FORCE_SCALE_NOTE
          ? <InkLabel at={diagramArrowLabelPosition(shape.from, shape.to)}>{shape.label}</InkLabel> : null}
      </g>;
    }
    case "polyline":
      return <path d={polyPath(shape.points, seed, jitter)} className={shape.guide ? "diagram-guide" : undefined}
        strokeDasharray={shape.dashed ? "13 12" : undefined} />;
    case "rect": {
      const [x, y] = shape.at, w = shape.width, h = shape.height;
      const points: DiagramPoint[] = [[x, y], [x + w, y], [x + w, y + h], [x, y + h], [x, y]];
      return <path data-diagram-primitive="rect" d={polyPath(points, seed, jitter)} transform={shape.rotation ? "rotate(" + shape.rotation + " " + (x + w / 2) + " " + (y + h / 2) + ")" : undefined} />;
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
        <path d={diagramArcPath(shape.center, shape.radius, shape.startDeg, shape.sweepDeg)} />
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
export const DiagramBlockView = memo(function DiagramBlockView({ block, seed, viewport, pending }: Props) {
  const pendingBlocks = useContext(PendingDiagramContext);
  const t = useT().content.diagrams;
  const unapplied = pending ?? pendingBlocks.includes(block);
  const elements = expandDiagram(block);
  const hasShortForceNote = elements.some((shape) => shape.type === "arrow"
    && (shape.callout === SHORT_FORCE_CALLOUT || shape.label === SHORT_FORCE_SCALE_NOTE));
  const view = viewport ?? diagramViewport(block);
  const jitter = block.handDrawn === false ? 0 : block.jitterPx ?? 1.2;
  const caption = block.caption || "";
  const accessible = caption || (block.template ? templateNames[block.template] : "Notebook diagram");
  // Keep the hand-drawn jitter stable while a primitive moves or a template
  // materializes; the original full-block hash made every stroke flicker per pointermove.
  const baseSeed = seed ^ hashString(`inline-diagram:${block.afterSection}`);
  return (
    <figure className={"diagram-block" + (unapplied ? " is-unapplied" : "")}
      data-fit data-diagram-after-section={block.afterSection}
      data-diagram-unapplied={unapplied ? "true" : undefined}>
      <svg className="diagram-art" viewBox={view.join(" ")}
        role="img" aria-label={accessible} preserveAspectRatio="xMidYMid meet">
        <g className="diagram-ink" fill="none" stroke="currentColor" strokeWidth={5.5}
          strokeLinecap="round" strokeLinejoin="round">
          {elements.map((shape, i) => <Element key={i} shape={shape} seed={baseSeed + i * 7919} jitter={jitter} />)}
        </g>
      </svg>
      {hasShortForceNote ? <p className="diagram-scale-note" role="note">{t.shortForceNote}</p> : null}
      {unapplied ? <span className="diagram-unapplied-badge" role="status">{t.unappliedBadge}</span> : null}
      {caption ? <figcaption>{caption}</figcaption> : null}
    </figure>
  );
});
