import { DIAGRAM_LIMITS, type DiagramPoint } from "../../shared/diagram.ts";

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
  const estimatedWidth = Math.min(DIAGRAM_LIMITS.width - 2 * inset, units * 48);
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
