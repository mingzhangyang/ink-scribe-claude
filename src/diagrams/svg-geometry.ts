import { DIAGRAM_LIMITS, expandDiagram, SHORT_FORCE_SCALE_NOTE, type DiagramBlock, type DiagramPoint } from "../../shared/diagram.ts";

/** The visible arc and its editing hit path must use identical SVG geometry. */
export function diagramArcPath(center: DiagramPoint, radius: number, start: number, sweep: number): string {
  const coords = (p: DiagramPoint) => p.map((v) => +v.toFixed(3)).join(" ");
  const xy = (angle: number): DiagramPoint => [
    center[0] + Math.cos(angle * Math.PI / 180) * radius,
    center[1] + Math.sin(angle * Math.PI / 180) * radius,
  ];
  const pieces = Math.max(1, Math.ceil(Math.abs(sweep) / 150));
  const step = sweep / pieces;
  let path = "M" + coords(xy(start));
  for (let i = 1; i <= pieces; i++) {
    path += " A" + radius + " " + radius + " 0 0 " + (sweep > 0 ? 1 : 0) + " " + coords(xy(start + step * i));
  }
  return path;
}

/** Shared text layout for rendered labels, selectable centers and edit handles. */
export function diagramLabelLayout(at: DiagramPoint, children: string): {
  at: DiagramPoint; fontCap: number;
} {
  const inset = 20;
  const units = Array.from(children).reduce((sum, character) => sum + (character.charCodeAt(0) < 128 ? 1.1 : 1.3), 0);
  const estimatedWidth = Math.min(DIAGRAM_LIMITS.width - 2 * inset, units * 30);
  const minX = Math.max(90, inset + estimatedWidth / 2);
  const x = Math.max(minX, Math.min(DIAGRAM_LIMITS.width - minX, at[0]));
  const y = Math.max(70, Math.min(DIAGRAM_LIMITS.height - 70, at[1]));
  const horizontalRoom = 2 * (Math.min(x, DIAGRAM_LIMITS.width - x) - inset);
  const verticalRoom = 2 * (Math.min(y, DIAGRAM_LIMITS.height - y) - inset);
  const fontCap = Math.max(1, Math.floor(100 * Math.min(horizontalRoom / units, verticalRoom / 1.5)) / 100);
  return { at: [x, y], fontCap };
}

/** Keep the editor's text hit region scaled exactly like exported SVG text. */
export const diagramLabelFontSize = (fontCap: number): string =>
  `min(calc(var(--fs) * var(--diagram-label-scale, 2.4)), ${fontCap}px)`;

/** The same arrow-label anchor is used by painted SVG and content bounds. */
export function diagramArrowLabelPosition(from: DiagramPoint, to: DiagramPoint): DiagramPoint {
  const dx = to[0] - from[0], dy = to[1] - from[1];
  const length = Math.hypot(dx, dy) || 1;
  return [(from[0] + to[0]) / 2 - dy / length * 55,
    (from[1] + to[1]) / 2 + dx / length * 55 - 8];
}

export type DiagramViewport = [number, number, number, number];
/** Content-aware 4:3 framing improves small diagrams without mutating author data. */
export function diagramViewport(block: DiagramBlock): DiagramViewport {
  const points: DiagramPoint[] = [];
  const add = (at: DiagramPoint) => points.push(at);
  const text = (at: DiagramPoint, value: string) => {
    const center = diagramLabelLayout(at, value).at;
    const units = Array.from(value).reduce((sum, ch) => sum + (ch.charCodeAt(0) < 128 ? 1.1 : 1.3), 0);
    const half = Math.max(26, units * 15);
    add([center[0] - half, center[1] - 37]);
    add([center[0] + half, center[1] + 37]);
  };
  for (const shape of expandDiagram(block)) {
    switch (shape.type) {
      case "line":
      case "arrow":
        add(shape.from); add(shape.to);
        if (shape.label && shape.label !== SHORT_FORCE_SCALE_NOTE)
          text(diagramArrowLabelPosition(shape.from, shape.to), shape.label);
        break;
      case "polyline": shape.points.forEach(add); break;
      case "rect": {
        const x = shape.at[0] + shape.width / 2, y = shape.at[1] + shape.height / 2;
        const a = (shape.rotation ?? 0) * Math.PI / 180;
        const dx = Math.abs(shape.width / 2 * Math.cos(a)) + Math.abs(shape.height / 2 * Math.sin(a));
        const dy = Math.abs(shape.width / 2 * Math.sin(a)) + Math.abs(shape.height / 2 * Math.cos(a));
        add([x - dx, y - dy]); add([x + dx, y + dy]);
        break;
      }
      case "circle":
        add([shape.center[0] - shape.r, shape.center[1] - shape.r]);
        add([shape.center[0] + shape.r, shape.center[1] + shape.r]);
        break;
      case "ellipse": {
        const a = (shape.rotation ?? 0) * Math.PI / 180;
        const dx = Math.hypot(shape.rx * Math.cos(a), shape.ry * Math.sin(a));
        const dy = Math.hypot(shape.rx * Math.sin(a), shape.ry * Math.cos(a));
        add([shape.center[0] - dx, shape.center[1] - dy]);
        add([shape.center[0] + dx, shape.center[1] + dy]); break;
      }
      case "arc": {
        for (let i = 0; i <= 48; i++) {
          const angle = (shape.startDeg + shape.sweepDeg * i / 48) * Math.PI / 180;
          add([shape.center[0] + shape.radius * Math.cos(angle),
            shape.center[1] + shape.radius * Math.sin(angle)]);
        }
        if (shape.label) {
          const angle = (shape.startDeg + shape.sweepDeg / 2) * Math.PI / 180;
          text([shape.center[0] + (shape.radius + 58) * Math.cos(angle),
            shape.center[1] + (shape.radius + 58) * Math.sin(angle)], shape.label);
        }
        break;
      }
      case "label": text(shape.at, shape.text); break;
    }
  }
  if (!points.length) return [0, 0, DIAGRAM_LIMITS.width, DIAGRAM_LIMITS.height];
  const minX = Math.min(...points.map((p) => p[0]));
  const maxX = Math.max(...points.map((p) => p[0]));
  const minY = Math.min(...points.map((p) => p[1]));
  const maxY = Math.max(...points.map((p) => p[1]));
  // Preserve headroom for paper outlines; never zoom so far that a very
  // small handwritten stroke fills the whole page.
  const width = Math.min(DIAGRAM_LIMITS.width, Math.max(680,
    maxX - minX + 100, (maxY - minY + 100) * 4 / 3));
  const height = width * 3 / 4;
  const x = Math.max(0, Math.min(DIAGRAM_LIMITS.width - width, (minX + maxX - width) / 2));
  const y = Math.max(0, Math.min(DIAGRAM_LIMITS.height - height, (minY + maxY - height) / 2));
  const round = (n: number) => Number(n.toFixed(3));
  return [round(x), round(y), round(width), round(height)];
}
