import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { DiagramBlockView } from "../src/components/note/DiagramBlock.tsx";
import { PrimitiveEditor } from "../src/components/PrimitiveEditor.tsx";
import { diagramArcPath, diagramLabelLayout } from "../src/diagrams/svg-geometry.ts";
import { expandDiagram, validDiagramBlocks, validDiagramPrimitive, type DiagramBlock, type DiagramPrimitive } from "../shared/diagram.ts";
import { validatePublishRequest } from "../shared/publishing.ts";
import {
  DIAGRAM_GRID, DIAGRAM_HISTORY_LIMIT, addShape, defaultShape, deleteShape,
  editShape, materializeDiagram, moveFromPointers, moveShape,
  resizeShape, rotateFromPointers, rotateShape, shapeCenter, shapeHandles,
  snapAngle, snapToGrid,
} from "../src/diagrams/geometry.ts";

const plane: DiagramBlock = {
  afterSection: 0, template: "inclined-plane", params: { thetaDeg: 30, friction: false },
  caption: "坡度与重力",
};
const triangle: DiagramBlock = {
  afterSection: 0, template: "right-triangle", params: { legRatio: 0.65 },
};
const line: DiagramPrimitive = { type: "line", from: [200, 375], to: [800, 375] };

describe("D3 shapes and geometry", () => {
  it("preserves D1 template representation until the first real shape change", () => {
    expect(materializeDiagram(plane).primitives).toEqual(expandDiagram(plane));
    expect(materializeDiagram(plane).template).toBeUndefined();
    expect(materializeDiagram(plane).caption).toBe(plane.caption);
    expect(editShape(plane, 0, expandDiagram(plane)[0])).toBe(plane);
    const moved = editShape(plane, 0, moveShape(expandDiagram(plane)[0], 25, 0));
    expect(moved).not.toBe(plane);
    expect(moved.template).toBeUndefined();
    expect(moved.primitives?.length).toBe(expandDiagram(plane).length);
    expect(validDiagramBlocks([moved], 1)).toBe(true);
    expect(validatePublishRequest({
      schemaVersion: 1,
      note: { title: "Forces", cues: [], sections: [{ content: "Example", highlights: [] }], summary: "", diagrams: [moved] },
    }).ok).toBe(true);
    expect(plane.template).toBe("inclined-plane");
  });

  it("keeps unedited SVG ink unchanged on template-to-primitives conversion", () => {
    const original = renderToStaticMarkup(createElement(DiagramBlockView, { block: plane, seed: 1978 }));
    const converted = renderToStaticMarkup(createElement(DiagramBlockView, {
      block: materializeDiagram(plane), seed: 1978,
    }));
    expect(converted).toBe(original);
  });

  it("snaps to the 1/40-width grid and supports disabling snapping", () => {
    expect(DIAGRAM_GRID).toBe(25);
    expect(snapToGrid([38, 61])).toEqual([50, 50]);
    expect(moveFromPointers(line, [200, 250], [238, 261])).toEqual({
      ...line, from: [250, 375], to: [850, 375],
    });
    expect(moveFromPointers(line, [200, 250], [238, 261], false)).toEqual({
      ...line, from: [238, 386], to: [838, 386],
    });
    expect(moveShape(line, 0, 0)).toBe(line);
  });

  it("resizes endpoints, polyline vertices, and both ellipse axes without corrupting other points", () => {
    const arrow: DiagramPrimitive = { type: "arrow", from: [200, 200], to: [800, 200] };
    const reshaped = resizeShape(arrow, "to", [730, 285]);
    expect(reshaped).toEqual({ ...arrow, to: [725, 275] });
    expect(validDiagramPrimitive(reshaped)).toBe(true);
    const poly: DiagramPrimitive = { type: "polyline", points: [[200, 200], [500, 350], [700, 200]] };
    expect(resizeShape(poly, "p:1", [499, 402])).toEqual({
      ...poly, points: [[200, 200], [500, 400], [700, 200]],
    });
    const ellipse: DiagramPrimitive = { type: "ellipse", center: [500, 375], rx: 150, ry: 100 };
    expect(resizeShape(ellipse, "rx", [670, 375])).toEqual({ ...ellipse, rx: 175 });
    expect(resizeShape(ellipse, "ry", [500, 475])).toEqual(ellipse);
    const rect: DiagramPrimitive = { type: "rect", at: [350, 300], width: 200, height: 120 };
    const result = resizeShape(rect, "size", [600, 500]);
    expect(result).toMatchObject({ width: 300, height: 280 });
    expect(validDiagramPrimitive(result)).toBe(true);
  });

  it("snaps all supported orientation changes in 15-degree increments", () => {
    expect(snapAngle(8)).toBe(15);
    expect(snapAngle(7)).toBe(0);
    expect(snapAngle(-23)).toBe(-30);
    const rect: DiagramPrimitive = { type: "rect", at: [350, 300], width: 200, height: 120 };
    expect(rotateShape(rect, 22)).toMatchObject({ rotation: 15 });
    const tilted = rotateFromPointers(line, [800, 375], [750, 475]);
    expect(tilted.type).toBe("line");
    expect(shapeHandles(rect).some((handle) => handle.kind === "rotate")).toBe(true);
    expect(shapeCenter(rect)).toEqual([450, 360]);
    expect(DIAGRAM_HISTORY_LIMIT).toBe(30);
  });

  it("offers per-primitive handles for all geometries", () => {
    const data = [
      defaultShape("line"), defaultShape("arrow"), defaultShape("polyline"), defaultShape("rect"),
      defaultShape("circle"), defaultShape("ellipse"), defaultShape("arc"), defaultShape("label"),
    ];
    for (const shape of data) {
      expect(validDiagramPrimitive(shape)).toBe(true);
      expect(shapeHandles(shape).length).toBeGreaterThanOrEqual(1);
      for (const handle of shapeHandles(shape)) {
        expect(handle.point[0]).toBeGreaterThanOrEqual(0);
        expect(handle.point[0]).toBeLessThanOrEqual(1000);
        expect(handle.point[1]).toBeGreaterThanOrEqual(0);
        expect(handle.point[1]).toBeLessThanOrEqual(750);
      }
    }
  });

  it("prevents off-canvas/non-degenerate shape edits without changing the template", () => {
    const original = expandDiagram(triangle);
    const rejected = editShape(triangle, 0, {
      type: "line", from: [999, 999], to: [800, 900],
    });
    expect(rejected).toBe(triangle);
    const invalidEnd = resizeShape(line, "to", [200, 375]);
    expect(validDiagramPrimitive(invalidEnd)).toBe(false);
    const authored: DiagramBlock = { afterSection: 0, primitives: [line] };
    expect(editShape(authored, 0, invalidEnd)).toBe(authored);
    // Invalid shape does not materialize the authored parameterized representation.
    expect(triangle.template).toBe("right-triangle");
    expect(expandDiagram(triangle)).toEqual(original);
  });

  it("moves explicit text labels at least 48 units clear of nearby strokes", () => {
    const base: DiagramBlock = { afterSection: 0, primitives: [
      line, { type: "label", at: [500, 375], text: "L" },
    ] };
    const result = editShape(base, 1, { type: "label", at: [525, 375], text: "L" });
    const label = result.primitives?.[1];
    expect(label?.type).toBe("label");
    if (!label || label.type !== "label") throw new Error("Expected label");
    expect(Math.abs(label.at[1] - 375)).toBeGreaterThanOrEqual(48);
    const movedLine = editShape(result, 0, moveShape(line, 0, 50));
    expect(validDiagramBlocks([movedLine], 1)).toBe(true);
  });

  it("adds/removes primitives within publication limits and never leaves an empty block", () => {
    const base: DiagramBlock = { afterSection: 0, primitives: [line] };
    expect(deleteShape(base, 0)).toBe(base);
    const added = addShape(base, defaultShape("circle"));
    expect(added.primitives).toHaveLength(2);
    const removed = deleteShape(added, 0);
    expect(removed.primitives).toHaveLength(1);
    expect(validDiagramBlocks([removed], 1)).toBe(true);
    const full: DiagramBlock = {
      afterSection: 0,
      primitives: Array.from({ length: 40 }, (_, i) => ({
        type: "label", at: [100 + i * 10, 150], text: "a",
      })),
    };
    expect(addShape(full, defaultShape("arc"))).toBe(full);
    expect(validDiagramBlocks([full], 1)).toBe(true);
  });
  it("uses the displayed (clamped) label anchor for selection and edit handles", () => {
    const boundary: DiagramPrimitive = { type: "label", at: [0, 375], text: "A" };
    const long: DiagramPrimitive = { type: "label", at: [0, 750], text: "非常长的中文文字标签用于边界测试" };
    for (const shape of [boundary, long]) {
      if (shape.type !== "label") throw new Error("Expected label");
      const layout = diagramLabelLayout(shape.at, shape.text);
      expect(shapeCenter(shape)).toEqual(layout.at);
      expect(shapeHandles(shape)[0].point).toEqual(layout.at);
      const block: DiagramBlock = { afterSection: 0, primitives: [shape] };
      const rendered = renderToStaticMarkup(createElement(DiagramBlockView, { block, seed: 1978 }));
      const editor = renderToStaticMarkup(createElement(PrimitiveEditor, { block, index: 0 }));
      expect(rendered).toContain(`<text x="${layout.at[0]}" y="${layout.at[1]}"`);
      expect(editor).toContain(`cx="${layout.at[0]}" cy="${layout.at[1]}" r="75"`);
      expect(editor).toContain("data-label-hit-target");
      expect(editor).toContain(`<text x="${layout.at[0]}" y="${layout.at[1]}" text-anchor="middle"`);
    }
    expect(shapeCenter(boundary)).toEqual([90, 375]);
    expect(moveFromPointers(boundary, [0, 0], [25, 0])).toEqual({ ...boundary, at: [115, 375] });
    expect(moveFromPointers(boundary, [0, 0], [-25, 0])).toBe(boundary);
    expect(moveFromPointers(boundary, [0, 0], [0, 0])).toBe(boundary);
    expect(shapeCenter(long)[0]).toBeGreaterThan(90);
    expect(shapeCenter(long)[1]).toBe(680);
  });

  it("uses only the rendered arc sweep for the transparent touch target", () => {
    const arc: DiagramPrimitive = { type: "arc", center: [500, 375], radius: 160, startDeg: -90, sweepDeg: 75 };
    const block: DiagramBlock = { afterSection: 0, primitives: [arc] };
    const d = diagramArcPath(arc.center, arc.radius, arc.startDeg, arc.sweepDeg);
    const visible = renderToStaticMarkup(createElement(DiagramBlockView, { block, seed: 1978 }));
    const editor = renderToStaticMarkup(createElement(PrimitiveEditor, { block, index: 0 }));
    expect(visible).toContain(`d="${d}"`);
    expect(editor).toContain(`<path d="${d}" fill="none" stroke="transparent" stroke-width="75" pointer-events="stroke"`);
    expect(editor).not.toContain(`<circle cx="500" cy="375" r="160" fill="none" stroke="transparent"`);
    // The omitted 285-degree span is absent from the single 75-degree SVG arc.
    expect(d.match(/ A/g)).toHaveLength(1);
    expect(d).toContain(" 0 0 1 ");
  });

  it("preserves signed arcs longer than 180 degrees when moving either endpoint", () => {
    const fromAngle = (deg: number): [number, number] => [
      500 + 160 * Math.cos(deg * Math.PI / 180),
      375 + 160 * Math.sin(deg * Math.PI / 180),
    ];
    const positive: DiagramPrimitive = {
      type: "arc", center: [500, 375], radius: 160, startDeg: -90, sweepDeg: 270,
    };
    const shorterEnd = resizeShape(positive, "end", fromAngle(175), false);
    expect(shorterEnd.type).toBe("arc");
    if (shorterEnd.type !== "arc") throw new Error("Expected arc");
    expect(shorterEnd.sweepDeg).toBeCloseTo(265, 3);
    const laterStart = resizeShape(positive, "start", fromAngle(-85), false);
    if (laterStart.type !== "arc") throw new Error("Expected arc");
    expect(laterStart.sweepDeg).toBeCloseTo(265, 3);
    const wrappedEnd = resizeShape(positive, "end", fromAngle(-179), false);
    if (wrappedEnd.type !== "arc") throw new Error("Expected arc");
    expect(wrappedEnd.sweepDeg).toBeCloseTo(271, 3);

    const negative: DiagramPrimitive = { ...positive, startDeg: 90, sweepDeg: -270 };
    const movedNegative = resizeShape(negative, "end", fromAngle(-175), false);
    if (movedNegative.type !== "arc") throw new Error("Expected arc");
    expect(movedNegative.sweepDeg).toBeCloseTo(-265, 3);
    const negStart = resizeShape(negative, "start", fromAngle(85), false);
    if (negStart.type !== "arc") throw new Error("Expected arc");
    expect(negStart.sweepDeg).toBeCloseTo(-265, 3);

    const seam: DiagramPrimitive = { ...positive, startDeg: 170, sweepDeg: 270 };
    const crossingStart = resizeShape(seam, "start", fromAngle(-175), false);
    if (crossingStart.type !== "arc") throw new Error("Expected arc");
    expect(crossingStart.startDeg).toBe(-175);
    expect(crossingStart.sweepDeg).toBeCloseTo(255, 3);

    const nearFull: DiagramPrimitive = { ...positive, sweepDeg: 355 };
    const clamped = resizeShape(nearFull, "end", fromAngle(-80), false);
    expect(validDiagramPrimitive(clamped)).toBe(true);
    if (clamped.type !== "arc") throw new Error("Expected arc");
    expect(clamped.sweepDeg).toBe(360);
  });

});

describe("first shape edit preserves untouched template labels (review fix)", () => {
  type Label = Extract<DiagramPrimitive, { type: "label" }>;
  const labels = (shapes: DiagramPrimitive[]) =>
    shapes.filter((shape): shape is Label => shape.type === "label");
  const cases: { name: string; block: DiagramBlock; pick: (shape: DiagramPrimitive) => boolean }[] = [
    { name: "number line axis", block: { afterSection: 0, template: "number-line", params: { start: -5, end: 5, step: 1 } },
      pick: (shape) => shape.type === "arrow" },
    { name: "sine curve", block: { afterSection: 0, template: "coordinate-plane",
      params: { grid: false, quadrants: "all", function: "sine" } }, pick: (shape) => shape.type === "polyline" },
    { name: "axes x label", block: { afterSection: 0, template: "coordinate-plane",
      params: { grid: true, quadrants: "all" } }, pick: (shape) => shape.type === "label" && shape.text === "x" },
    { name: "inclined block", block: { afterSection: 0, template: "inclined-plane",
      params: { thetaDeg: 30, friction: true } }, pick: (shape) => shape.type === "rect" },
  ];
  for (const { name, block, pick } of cases) {
    it(`moving the ${name} leaves every other primitive unchanged`, () => {
      const before = expandDiagram(block);
      const index = before.findIndex(pick);
      const target = before[index];
      const moved = target.type === "label"
        ? { ...target, at: [target.at[0] - 100, target.at[1] - 100] as [number, number] }
        : moveShape(target, 0, -25);
      const result = editShape(block, index, moved);
      expect(result).not.toBe(block);
      const after = result.primitives!;
      expect(after).toHaveLength(before.length);
      before.forEach((shape, i) => { if (i !== index) expect(after[i], `${name} #${i}`).toEqual(shape); });
    });
  }

  it("never stacks two number-line values onto one anchor after a nudge", () => {
    const block: DiagramBlock = { afterSection: 0, template: "number-line", params: { start: -5, end: 5, step: 1 } };
    const axis = expandDiagram(block).findIndex((shape) => shape.type === "arrow");
    const result = editShape(block, axis, moveShape(expandDiagram(block)[axis], 0, -DIAGRAM_GRID));
    const anchors = labels(result.primitives!).map((label) => label.at.join(","));
    expect(new Set(anchors).size).toBe(anchors.length);
  });

  it("still reflows a label that the edited shape is moved onto", () => {
    const base: DiagramBlock = { afterSection: 0, primitives: [
      { type: "line", from: [200, 200], to: [800, 200] },
      { type: "label", at: [500, 375], text: "L" },
    ] };
    const result = editShape(base, 0, moveShape(base.primitives![0], 0, 175));
    const label = result.primitives![1];
    if (label.type !== "label") throw new Error("Expected label");
    expect(Math.abs(label.at[1] - 375)).toBeGreaterThanOrEqual(48);
  });
});
