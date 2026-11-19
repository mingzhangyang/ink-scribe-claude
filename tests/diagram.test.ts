import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  expandDiagram, inclinedPlaneForces, SHORT_FORCE_CALLOUT, SHORT_FORCE_SCALE_NOTE, validDiagramBlocks, validJitterPx,
  type DiagramBlock, type DiagramPrimitive,
} from "../shared/diagram.ts";
import { readDocument } from "../shared/document.ts";
import { normalizeNoteStructure, type NoteStructure } from "../shared/note.ts";
import { validatePublishRequest, validatePublishedNote } from "../shared/publishing.ts";
import { DEFAULT_SETTINGS } from "../shared/settings.ts";
import { DiagramBlockView } from "../src/components/note/DiagramBlock.tsx";
import { diagramLabelLayout, diagramViewport } from "../src/diagrams/svg-geometry.ts";
import { editShape, materializeDiagram, moveShape } from "../src/diagrams/geometry.ts";
import { LAYOUTS } from "../src/components/note/layouts.tsx";
import { labelsFor } from "../src/components/note/parts.tsx";

const template: DiagramBlock = {
  afterSection: 0, caption: "重力分解", template: "inclined-plane", params: { thetaDeg: 30, friction: false },
};
const primitive: DiagramBlock = {
  afterSection: 0, primitives: [
    { type: "arrow", from: [120, 650], to: [460, 650], label: "x" },
    { type: "label", at: [500, 120], text: "N = mgcosθ" },
  ],
};
const note = (diagrams?: DiagramBlock[]): NoteStructure => ({
  title: "斜面分解重力",
  cues: [{ keyword: "重力", note: "mg" }],
  sections: [{ heading: "分析", content: "重力可以沿斜面与法线方向分解。", highlights: [] }],
  summary: "合力仍然是重力。",
  ...(diagrams ? { diagrams } : {}),
});
const request = (diagrams?: DiagramBlock[]) => ({ schemaVersion: 1, note: note(diagrams) });
function errors(value: unknown) {
  const result = validatePublishRequest(value);
  if (result.ok) throw new Error("Expected invalid diagram");
  return result.issues;
}

describe("diagram blocks: immutable, backwards-compatible data", () => {
  it("accepts unchanged legacy documents and both mutually-exclusive diagram representations", () => {
    expect(validatePublishRequest(request()).ok).toBe(true);
    expect(validatePublishRequest(request([template, primitive])).ok).toBe(true);
    expect(validatePublishedNote(note([template])).ok).toBe(true);
    expect(normalizeNoteStructure(note([template]))).toMatchObject({ ok: true, value: { diagrams: [template] } });
  });

  it("preserves diagrams through the local draft reader without turning them into a bitmap", () => {
    const document = {
      input: { text: "physics", template: "general", language: "auto", detail: "standard" },
      note: note([template, primitive]), settings: DEFAULT_SETTINGS, stickers: [], aiDoodle: null, source: "local",
    };
    expect(readDocument(JSON.parse(JSON.stringify(document))).note?.diagrams).toEqual([template, primitive]);
    expect(() => readDocument({ ...document, note: note([{ ...template, afterSection: 10 }]) })).toThrow("Invalid draft note");
  });

  it("reports exact, actionable API paths for invalid location, canvas coordinates and captions", () => {
    const invalidSection = { ...template, afterSection: 1 };
    expect(errors(request([invalidSection]))).toEqual(expect.arrayContaining([
      expect.objectContaining({ path: "note.diagrams[0].afterSection", code: "OUT_OF_RANGE" }),
    ]));
    const invalidCoords = { ...primitive, primitives: [{ type: "arrow", from: [120, 650], to: [460, 800] }] };
    expect(errors(request([invalidCoords as DiagramBlock]))).toEqual(expect.arrayContaining([
      expect.objectContaining({ path: "note.diagrams[0].primitives[0].to[1]", code: "OUT_OF_RANGE" }),
    ]));
    expect(errors(request([{ ...template, caption: "c".repeat(41) }]))).toEqual(expect.arrayContaining([
      expect.objectContaining({ path: "note.diagrams[0].caption", code: "TOO_LONG" }),
    ]));
    expect(errors(request([template, primitive, template]))).toEqual(expect.arrayContaining([
      expect.objectContaining({ path: "note.diagrams", code: "TOO_MANY_ITEMS" }),
    ]));
  });

  it("rejects illegal template parameters, null alternatives, empty labels and malformed geometry", () => {
    expect(errors(request([{ ...template, params: { thetaDeg: 4, friction: true } }]))).toEqual(expect.arrayContaining([
      expect.objectContaining({ path: "note.diagrams[0].params.thetaDeg", code: "OUT_OF_RANGE" }),
    ]));
    expect(errors(request([{ ...template, primitives: null } as unknown as DiagramBlock]))).toEqual(expect.arrayContaining([
      expect.objectContaining({ path: "note.diagrams[0].primitives", code: "UNKNOWN_FIELD" }),
    ]));
    expect(errors(request([{ afterSection: 0, primitives: [{ type: "label", at: [50, 100], text: "" }] }]))).toEqual(expect.arrayContaining([
      expect.objectContaining({ path: "note.diagrams[0].primitives[0].text", code: "TOO_SHORT" }),
    ]));
    expect(errors(request([{ afterSection: 0, primitives: [{ type: "line", from: [100, 100], to: [100, 100] }] }]))).toEqual(expect.arrayContaining([
      expect.objectContaining({ path: "note.diagrams[0].primitives[0]", code: "INVALID_GEOMETRY" }),
    ]));
    expect(errors(request([{ afterSection: 0, template: "number-line",
      params: { start: -10, end: 10, step: 0.5 } }]))).toEqual(expect.arrayContaining([
      expect.objectContaining({ path: "note.diagrams[0].params.step", code: "TOO_MANY_TICKS" }),
    ]));
  });
  it("keeps existing sticker and doodle discriminator errors on .type", () => {
    expect(errors({ ...request(), stickers: [{ id: "s1", x: 0, y: 0, rotation: 0, scale: 1 }] }))
      .toEqual(expect.arrayContaining([
        expect.objectContaining({ path: "stickers[0].type", code: "INVALID_TYPE" }),
      ]));
    expect(errors({ ...request(), note: { ...note(), doodleSpec: { concept: "sketch", elements: [{}] } } }))
      .toEqual(expect.arrayContaining([
        expect.objectContaining({ path: "note.doodleSpec.elements[0].type", code: "INVALID_TYPE" }),
      ]));
    expect(errors(request([{ afterSection: 0, params: { thetaDeg: 30, friction: false } } as unknown as DiagramBlock])))
      .toEqual(expect.arrayContaining([
        expect.objectContaining({ path: "note.diagrams[0].template", code: "INVALID_TYPE" }),
      ]));
  });
});

describe("diagram template geometry", () => {
  it("decomposes gravity into slope-parallel and slope-normal vectors at 30 degrees (<1 unit error)", () => {
    const { gravity, parallel, perpendicular } = inclinedPlaneForces(30);
    const sum = parallel.map((v, i) => v + perpendicular[i]);
    expect(Math.hypot(sum[0] - gravity[0], sum[1] - gravity[1])).toBeLessThan(1);
    expect(expandDiagram(template)).toEqual(expandDiagram(structuredClone(template)));
    expect(expandDiagram({ ...template, params: { thetaDeg: 30, friction: true } })).toHaveLength(expandDiagram(template).length + 2);
  });

  it("keeps triangle right angle and all generated geometry inside the canvas", () => {
    const triangle: DiagramBlock = { afterSection: 0, template: "right-triangle", params: { legRatio: 0.65 } };
    const shapes = expandDiagram(triangle);
    const outline = shapes[0] as Extract<DiagramPrimitive, { type: "polyline" }>;
    const [left, right, top] = outline.points;
    expect(left[1]).toBe(right[1]);
    expect(right[0]).toBe(top[0]);
    for (const block of [triangle, template,
      { afterSection: 0, template: "number-line", params: { start: -9, end: 9, step: 1 } },
      { afterSection: 0, template: "coordinate-plane", params: { grid: true, quadrants: "all" } },
    ] as DiagramBlock[]) {
      const elements = expandDiagram(block);
      expect(elements.length).toBeLessThanOrEqual(40);
      expect(validDiagramBlocks([{ afterSection: 0, primitives: elements }], 1)).toBe(true);
    }
  });

  it("always marks the requested number-line end without exceeding the 40-primitive cap", () => {
    const cases = [
      { params: { start: 0, end: 10, step: 20 }, labels: ["0", "10"] },
      { params: { start: 0, end: 10, step: 6 }, labels: ["0", "6", "10"] },
      { params: { start: 0, end: 10, step: 9.9 }, labels: ["0", "10"] },
      { params: { start: -9, end: 9, step: 1 }, labels: Array.from({ length: 19 }, (_, i) => String(i - 9)) },
      { params: { start: 0, end: 18, step: 1.05 }, labels: [...Array.from({ length: 16 }, (_, i) => String(Number((i * 1.05).toFixed(5)))), "18"] },
      // Shortest-precision labels must preserve endpoints of publish-valid tiny ranges.
      { params: { start: 0, end: 0.000001, step: 0.1 }, labels: ["0", "0.000001"] },
      { params: { start: 0, end: 1e-9, step: 0.1 }, labels: ["0", "1e-9"] },
      { params: { start: -1e-9, end: 0, step: 0.1 }, labels: ["-1e-9", "0"] },
      { params: { start: 999.9999999999999, end: 1000, step: 0.1 }, labels: ["999.9999999999999", "1000"] },
      { params: { start: 0, end: 5e-324, step: 0.1 }, labels: ["0", "5e-324"] },
      { params: { start: 0.1, end: 0.3, step: 0.1 }, labels: ["0.1", "0.2", "0.3"] },
    ];
    for (const { params, labels } of cases) {
      const block: DiagramBlock = { afterSection: 0, template: "number-line", params };
      expect(validDiagramBlocks([block], 1)).toBe(true);
      expect(validatePublishRequest(request([block])).ok).toBe(true);
      expect(validatePublishedNote(note([block])).ok).toBe(true);
      const shapes = expandDiagram(block);
      const visible = shapes.filter((shape) => shape.type === "label")
        .map((shape) => (shape as Extract<DiagramPrimitive, { type: "label" }>).text);
      expect(visible[0]).toBe(labels[0]);
      expect(visible[visible.length - 1]).toBe(labels[labels.length - 1]);
      expect(visible.every((text) => labels.includes(text))).toBe(true);
      if (labels.length <= 3) expect(visible).toEqual(labels);
      expect(shapes.length).toBeLessThanOrEqual(40);
      expect(validDiagramBlocks([{ afterSection: 0, primitives: shapes }], 1)).toBe(true);
    }
  });

  it("balances the perpendicular gravity component and support vector", () => {
    for (const thetaDeg of [5, 30, 60]) {
      for (const friction of [false, true]) {
        const block: DiagramBlock = { afterSection: 0, template: "inclined-plane",
          params: { thetaDeg, friction } };
        const arrows = expandDiagram(block).filter(
          (shape): shape is Extract<DiagramPrimitive, { type: "arrow" | "line" }> =>
            shape.type === "arrow",
        );
        // Template order: gravity, parallel, perpendicular, N, optionally friction.
        const perpendicular = arrows[2], normal = arrows[3];
        if (!perpendicular || !normal) throw new Error("Missing force vectors");
        const v = [perpendicular.to[0] - perpendicular.from[0],
          perpendicular.to[1] - perpendicular.from[1]];
        const n = [normal.to[0] - normal.from[0], normal.to[1] - normal.from[1]];
        const expectedLength = 160 * Math.cos(thetaDeg * Math.PI / 180);
        // Coordinates are quantized to 4 decimal places by point().
        expect(Math.hypot(...v)).toBeCloseTo(expectedLength, 3);
        expect(Math.hypot(...n)).toBeCloseTo(expectedLength, 3);
        expect(Math.hypot(...v)).toBeCloseTo(Math.hypot(...n), 3);
        expect(v[0] + n[0]).toBeCloseTo(0, 3);
        expect(v[1] + n[1]).toBeCloseTo(0, 3);
        expect(normal.from).toEqual(perpendicular.from);
        expect(validDiagramBlocks([{ afterSection: 0, primitives: expandDiagram(block) }], 1)).toBe(true);
      }
    }
  });

  it("keeps inclined-plane labels separate from strokes at three key angles", () => {
    for (const thetaDeg of [5, 30, 60]) {
      for (const friction of [false, true]) {
        const block: DiagramBlock = { afterSection: 0, template: "inclined-plane",
          params: { thetaDeg, friction } };
        const shapes = expandDiagram(block);
        const labels = shapes.filter((shape): shape is Extract<DiagramPrimitive, { type: "label" }> =>
          shape.type === "label");
        expect(labels).toHaveLength(friction ? 6 : 5);
        const bounds = labels.map(({ at, text }) => {
          const [x, y] = diagramLabelLayout(at, text).at;
          const half = Math.max(19, Array.from(text).reduce((n, c) =>
            n + (c.charCodeAt(0) < 128 ? 1.1 : 1.3) * 14, 0));
          return { text, rect: [x - half, y - 32, x + half, y + 32] };
        });
        for (let i = 0; i < bounds.length; i++) {
          for (let j = i + 1; j < bounds.length; j++) {
            const a = bounds[i].rect, b = bounds[j].rect;
            expect(a[2] + 10 <= b[0] || b[2] + 10 <= a[0]
              || a[3] + 10 <= b[1] || b[3] + 10 <= a[1]).toBe(true);
          }
        }
        expect(validDiagramBlocks([{ afterSection: 0, primitives: shapes }], 1)).toBe(true);
      }
    }
  });

  it("keeps all six function presets valid and editable as existing primitives", () => {
    for (const fn of ["linear", "quadratic", "sine", "cosine", "exponential", "logarithm"] as const) {
      for (const quadrants of ["all", "first"] as const) {
        const block: DiagramBlock = { afterSection: 0, template: "coordinate-plane",
          params: { grid: true, quadrants, function: fn, keyPoints: true } };
        const shapes = expandDiagram(block);
        expect(shapes.some((shape) => shape.type === "polyline")).toBe(true);
        expect(shapes.every((shape) => shape.type !== "polyline" || shape.points.length <= 40)).toBe(true);
        expect(validDiagramBlocks([block], 1)).toBe(true);
        expect(validDiagramBlocks([{ afterSection: 0, primitives: shapes }], 1)).toBe(true);
        expect(validatePublishRequest(request([block])).ok).toBe(true);
        const noMarks = expandDiagram({ ...block, params: { ...block.params, keyPoints: false } });
        expect(noMarks.filter((shape) => shape.type === "circle")).toHaveLength(0);
      }
    }
    const legacy: DiagramBlock = { afterSection: 0, template: "coordinate-plane",
      params: { grid: false, quadrants: "all" } };
    expect(expandDiagram(legacy).some((shape) => shape.type === "polyline")).toBe(false);
  });

  it("publishes legacy coordinate axes and fresh presets with omitted optional fields", () => {
    const legacy: DiagramBlock = { afterSection: 0, template: "coordinate-plane",
      params: { grid: true, quadrants: "all" } };
    const fresh: DiagramBlock = { afterSection: 0, template: "coordinate-plane",
      params: { grid: true, quadrants: "all", function: "quadratic" } };
    for (const block of [legacy, fresh,
      { ...fresh, params: { ...fresh.params, keyPoints: false } } as DiagramBlock]) {
      expect(validatePublishRequest(request([block])).ok).toBe(true);
      expect(validatePublishedNote(note([block])).ok).toBe(true);
    }
    expect(errors(request([{ ...fresh, params: { ...fresh.params, keyPoints: "yes" } } as unknown as DiagramBlock])))
      .toEqual(expect.arrayContaining([
        expect.objectContaining({ path: "note.diagrams[0].params.keyPoints", code: "INVALID_TYPE" }),
      ]));
  });

  it("marks the actual x-intercepts of the quadratic function", () => {
    const block: DiagramBlock = { afterSection: 0, template: "coordinate-plane",
      params: { grid: false, quadrants: "all", function: "quadratic", keyPoints: true } };
    const shapes = expandDiagram(block);
    const xs = shapes.filter((shape): shape is Extract<DiagramPrimitive, { type: "circle" }> =>
      shape.type === "circle" && Math.abs(shape.center[1] - 390) < 0.001)
      .map((shape) => (shape.center[0] - 490) / 78);
    expect(xs).toHaveLength(2);
    for (const x of xs) expect(x * x - 2 * x - 2).toBeCloseTo(0, 4);
    const labels = shapes.filter((shape): shape is Extract<DiagramPrimitive, { type: "label" }> =>
      shape.type === "label").map((shape) => shape.text);
    expect(labels).toEqual(expect.arrayContaining(["(1-√3,0)", "(1+√3,0)"]));
  });

  it("marks force and block SVG primitives for stable browser QA selectors", () => {
    const html = renderToStaticMarkup(createElement(DiagramBlockView, {
      block: { ...template, handDrawn: false }, seed: 41,
    }));
    expect(html.match(/data-diagram-primitive="arrow"/g)).toHaveLength(4);
    expect(html.match(/data-diagram-primitive="rect"/g)).toHaveLength(1);
  });

  it("renders a legible off-block downhill arrow only when the physical component is short", () => {
    for (let thetaDeg = 5; thetaDeg <= 60; thetaDeg++) {
      for (const friction of [false, true]) {
        const block: DiagramBlock = { afterSection: 0, template: "inclined-plane",
          params: { thetaDeg, friction } };
        const shapes = expandDiagram(block);
        const arrows = shapes.filter((shape): shape is Extract<DiagramPrimitive, { type: "line" | "arrow" }> =>
          shape.type === "arrow");
        const [gravity, parallel, perpendicular, normal] = arrows;
        const vectors = inclinedPlaneForces(thetaDeg);
        const direction = [parallel.to[0] - parallel.from[0], parallel.to[1] - parallel.from[1]];
        const length = Math.hypot(...direction);
        const physicalLength = Math.hypot(...vectors.parallel);
        const theta = thetaDeg * Math.PI / 180;
        const trueAlong: [number, number] = [
          Number((gravity.from[0] + vectors.parallel[0]).toFixed(4)),
          Number((gravity.from[1] + vectors.parallel[1]).toFixed(4)),
        ];
        expect(shapes.some((shape) => shape.type === "line" && shape.dashed
          && shape.from[0] === trueAlong[0] && shape.from[1] === trueAlong[1])).toBe(true);
        expect(direction[0] * Math.cos(theta) - direction[1] * Math.sin(theta))
          .toBeCloseTo(-length, 1);
        expect(Math.hypot(perpendicular.to[0] - perpendicular.from[0] + normal.to[0] - normal.from[0],
          perpendicular.to[1] - perpendicular.from[1] + normal.to[1] - normal.from[1]))
          .toBeLessThan(0.002);
        if (physicalLength < 64) {
          expect(length).toBeGreaterThanOrEqual(64);
          expect(parallel.callout).toBe(SHORT_FORCE_CALLOUT);
          expect(parallel.label).toBeUndefined();
          expect(parallel.from).not.toEqual(gravity.from);
          const displacement = [parallel.from[0] - gravity.from[0], parallel.from[1] - gravity.from[1]];
          expect(displacement[0] * Math.cos(theta) - displacement[1] * Math.sin(theta))
            .toBeCloseTo(-76, 1);
          expect(-displacement[0] * Math.sin(theta) - displacement[1] * Math.cos(theta))
            .toBeCloseTo(24, 1);
        } else {
          expect(parallel.from).toEqual(gravity.from);
          expect(parallel.to).toEqual(trueAlong);
          expect(length).toBeCloseTo(physicalLength, 2);
          expect(parallel.label).toBeUndefined();
        }
        expect(arrows).toHaveLength(friction ? 5 : 4);
        expect(validDiagramBlocks([{ afterSection: 0, primitives: shapes }], 1)).toBe(true);
      }
    }
    for (const thetaDeg of [5, 15, 30, 60]) {
      const block: DiagramBlock = { afterSection: 0, template: "inclined-plane",
        params: { thetaDeg, friction: true } };
      const converted = materializeDiagram(block);
      const fromTemplate = renderToStaticMarkup(createElement(DiagramBlockView, { block, seed: 41 }));
      const fromPrimitives = renderToStaticMarkup(createElement(DiagramBlockView, { block: converted, seed: 41 }));
      const short = thetaDeg < 24;
      expect(fromTemplate.includes('class="diagram-scale-note"')).toBe(short);
      expect(fromPrimitives.includes('class="diagram-scale-note"')).toBe(short);
      expect(fromPrimitives.includes("mg sinθ")).toBe(true);
      if (short) expect(converted.primitives.some((shape) => shape.type === "arrow"
        && shape.callout === SHORT_FORCE_CALLOUT)).toBe(true);
    }
  });

  it("keeps inclined-plane labels separate from strokes at four key angles", () => {
    for (const thetaDeg of [5, 15, 30, 60]) {
      for (const friction of [false, true]) {
        const block: DiagramBlock = { afterSection: 0, template: "inclined-plane",
          params: { thetaDeg, friction } };
        const shapes = expandDiagram(block);
        const labels = shapes.filter((shape): shape is Extract<DiagramPrimitive, { type: "label" }> =>
          shape.type === "label");
        expect(labels).toHaveLength(friction ? 6 : 5);
        const bounds = labels.map(({ at, text }) => {
          const [x, y] = diagramLabelLayout(at, text).at;
          const half = Math.max(19, Array.from(text).reduce((n, c) =>
            n + (c.charCodeAt(0) < 128 ? 1.1 : 1.3) * 14, 0));
          return { text, rect: [x - half, y - 32, x + half, y + 32] };
        });
        for (let i = 0; i < bounds.length; i++) {
          for (let j = i + 1; j < bounds.length; j++) {
            const a = bounds[i].rect, b = bounds[j].rect;
            expect(a[2] + 10 <= b[0] || b[2] + 10 <= a[0]
              || a[3] + 10 <= b[1] || b[3] + 10 <= a[1]).toBe(true);
          }
        }
        expect(validDiagramBlocks([{ afterSection: 0, primitives: shapes }], 1)).toBe(true);
      }
    }
  });

  it("thins dense number-line annotations without removing marks or endpoints", () => {
    const block: DiagramBlock = { afterSection: 0, template: "number-line",
      params: { start: 0, end: 1, step: 0.1 } };
    const parts = expandDiagram(block);
    expect(parts.filter((shape) => shape.type === "line")).toHaveLength(11);
    const texts = parts.filter((shape): shape is Extract<DiagramPrimitive, { type: "label" }> =>
      shape.type === "label").map((shape) => shape.text);
    expect(texts[0]).toBe("0");
    expect(texts[texts.length - 1]).toBe("1");
    expect(texts.length).toBeLessThan(11);
    expect(diagramViewport(block)[2]).toBeLessThanOrEqual(1000);
  });

  it("keeps labels and their font-size bounds inside all four canvas edges", () => {
    const shapes: DiagramPrimitive[] = [
      { type: "arrow", from: [100, 15], to: [900, 15], label: "F" },
      { type: "arrow", from: [100, 735], to: [900, 735], label: "F" },
      { type: "arrow", from: [15, 100], to: [15, 650], label: "F" },
      { type: "arrow", from: [985, 650], to: [985, 100], label: "F" },
      { type: "arc", center: [625, 375], radius: 375, startDeg: -60, sweepDeg: 120, label: "east" },
      { type: "arc", center: [375, 375], radius: 375, startDeg: 120, sweepDeg: 120, label: "west" },
      { type: "arc", center: [500, 375], radius: 375, startDeg: -120, sweepDeg: 60, label: "north" },
      { type: "arc", center: [500, 375], radius: 375, startDeg: 60, sweepDeg: 60, label: "south" },
      { type: "label", at: [0, 0], text: "重".repeat(40) },
    ];
    expect(validDiagramBlocks([{ afterSection: 0, primitives: shapes }], 1)).toBe(true);
    expect(validatePublishRequest(request([{ afterSection: 0, primitives: shapes }])).ok).toBe(true);
    expect(validatePublishedNote(note([{ afterSection: 0, primitives: shapes }])).ok).toBe(true);
    const html = renderToStaticMarkup(createElement(DiagramBlockView, {
      block: { afterSection: 0, primitives: shapes }, seed: 2,
    }));
    const positions = [...html.matchAll(/<text x="([0-9.]+)" y="([0-9.]+)"/g)];
    expect(positions).toHaveLength(shapes.length);
    for (const [, rawX, rawY] of positions) {
      const x = Number(rawX), y = Number(rawY);
      expect(x).toBeGreaterThanOrEqual(70);
      expect(x).toBeLessThanOrEqual(930);
      expect(y).toBeGreaterThanOrEqual(70);
      expect(y).toBeLessThanOrEqual(680);
    }
    expect(html).toContain("font-size:min(calc(");
  });

  it("renders the same deterministic SVG and flow placement across all four layouts", () => {
    const content = note([template]);
    const first = renderToStaticMarkup(createElement(DiagramBlockView, { block: template, seed: 41 }));
    const second = renderToStaticMarkup(createElement(DiagramBlockView, { block: structuredClone(template), seed: 41 }));
    expect(first).toBe(second);
    expect(first).toContain('viewBox="' + diagramViewport(template).join(" ") + '"');
    expect(first).toContain("重力分解");
    expect(first).not.toContain("<canvas");
    for (const name of ["hybrid-cornell", "classic-cornell", "free-journal", "minimal"] as const) {
      const html = renderToStaticMarkup(createElement(LAYOUTS[name], {
        note: content, labels: labelsFor(content), seed: 41, naturalness: 0.5, doodle: null,
      }));
      expect(html).toContain("diagram-block");
      expect(html).toContain('data-diagram-after-section="0"');
      expect(html.indexOf("hand-content")).toBeLessThan(html.indexOf("diagram-block"));
    }
  });
});

describe("template math regressions (review fixes)", () => {
  type Line = Extract<DiagramPrimitive, { type: "line" | "arrow" }>;
  type Label = Extract<DiagramPrimitive, { type: "label" }>;
  const tickXs = (block: DiagramBlock) => expandDiagram(block)
    .filter((shape): shape is Line => shape.type === "line").map((shape) => shape.from[0]);

  it("keeps every number-line tick when start + step * i accumulates float error", () => {
    // 0.1 * 12 === 1.2000000000000002, which previously dropped the 1.1 tick.
    for (const [start, end, expected] of [
      [0, 1.2, 13], [0, 1.4, 15], [0, 1.7, 18], [0.1, 1.8, 18], [-1.2, 0.5, 18], [0, 0.7, 8],
    ] as const) {
      const block: DiagramBlock = { afterSection: 0, template: "number-line", params: { start, end, step: 0.1 } };
      expect(validDiagramBlocks([block], 1)).toBe(true);
      const xs = tickXs(block);
      expect(xs, `${start}..${end}`).toHaveLength(expected);
      const gaps = xs.slice(1).map((x, i) => x - xs[i]);
      // Uniform spacing: no doubled gap at the end of the axis.
      expect(Math.max(...gaps) - Math.min(...gaps), `${start}..${end}`).toBeLessThan(0.01);
      const labels = expandDiagram(block).filter((shape): shape is Label => shape.type === "label");
      expect(labels.at(-1)?.text).toBe(String(end));
    }
  });

  it("still appends a distinct end tick when the step does not divide the range", () => {
    const block: DiagramBlock = { afterSection: 0, template: "number-line", params: { start: 0, end: 10, step: 3 } };
    const labels = expandDiagram(block).filter((shape): shape is Label => shape.type === "label").map((s) => s.text);
    expect(labels).toEqual(["0", "3", "6", "9", "10"].filter((text) => labels.includes(text)));
    expect(labels.at(-1)).toBe("10");
    expect(tickXs(block)).toHaveLength(5);
  });

  it("aligns the coordinate grid with the axes and the plotted unit scale", () => {
    for (const quadrants of ["all", "first"] as const) {
      const block: DiagramBlock = { afterSection: 0, template: "coordinate-plane",
        params: { grid: true, quadrants, function: "linear", keyPoints: true } };
      const shapes = expandDiagram(block);
      const [xAxis, yAxis] = shapes.filter((shape): shape is Line => shape.type === "arrow");
      const originX = yAxis.from[0], originY = xAxis.from[1];
      const grid = shapes.filter((shape): shape is Line => shape.type === "line" && !!shape.guide);
      const vertical = grid.filter((shape) => shape.from[0] === shape.to[0]).map((shape) => shape.from[0]);
      const horizontal = grid.filter((shape) => shape.from[1] === shape.to[1]).map((shape) => shape.from[1]);
      expect(vertical.length).toBeGreaterThan(3);
      expect(horizontal.length).toBeGreaterThan(3);
      // 78 SVG units per x unit and 76 per y unit, measured from the origin.
      for (const x of vertical) expect(Math.abs(((x - originX) / 78) % 1), `x=${x}`).toBeLessThan(1e-9);
      for (const y of horizontal) expect(Math.abs(((y - originY) / 76) % 1), `y=${y}`).toBeLessThan(1e-9);
      // No grid line is drawn on top of an axis.
      expect(vertical).not.toContain(originX);
      expect(horizontal).not.toContain(originY);
      // Every key point lies on a grid intersection or an axis when it has integer coordinates.
      const dots = shapes.filter((shape) => shape.type === "circle");
      for (const dot of dots) {
        if (dot.type !== "circle") continue;
        expect([originX, ...vertical].some((x) => Math.abs(x - dot.center[0]) < 1e-6)).toBe(true);
        expect([originY, ...horizontal].some((y) => Math.abs(y - dot.center[1]) < 1e-6)).toBe(true);
      }
    }
  });

  it("keeps function key-point labels off the axes, the curve and each other", () => {
    const half = (text: string) => Math.max(19, Array.from(text)
      .reduce((sum, ch) => sum + (ch.charCodeAt(0) < 128 ? 1.1 : 1.3), 0) * 14);
    for (const fn of ["linear", "quadratic", "sine", "cosine", "exponential", "logarithm"] as const) {
      for (const quadrants of ["all", "first"] as const) {
        for (const grid of [true, false]) {
          const block: DiagramBlock = { afterSection: 0, template: "coordinate-plane",
            params: { grid, quadrants, function: fn, keyPoints: true } };
          const shapes = expandDiagram(block);
          expect(shapes.length).toBeLessThanOrEqual(40);
          expect(validDiagramBlocks([materializeDiagram(block)], 1)).toBe(true);
          const [xAxis, yAxis] = shapes.filter((shape): shape is Line => shape.type === "arrow");
          const originX = yAxis.from[0], originY = xAxis.from[1];
          const boxes = shapes.filter((shape): shape is Label => shape.type === "label" && shape.text.startsWith("("))
            .map((shape) => ({ text: shape.text, box: [shape.at[0] - half(shape.text), shape.at[1] - 32,
              shape.at[0] + half(shape.text), shape.at[1] + 32] }));
          const curve = shapes.flatMap((shape) => shape.type === "polyline" ? shape.points : []);
          for (const [i, { text, box }] of boxes.entries()) {
            const where = `${fn}/${quadrants}/${grid} ${text}`;
            expect(box[0] < originX && box[2] > originX, where + " crosses y-axis").toBe(false);
            expect(box[1] < originY && box[3] > originY, where + " crosses x-axis").toBe(false);
            expect(curve.some(([x, y]) => x > box[0] && x < box[2] && y > box[1] && y < box[3]),
              where + " covers the curve").toBe(false);
            for (const other of boxes.slice(i + 1)) {
              const b = other.box;
              expect(box[0] < b[2] && b[0] < box[2] && box[1] < b[3] && b[1] < box[3],
                where + " overlaps " + other.text).toBe(false);
            }
          }
        }
      }
    }
  });
});

describe("diagram polish: ground reference and regular number labels", () => {
  it("draws a horizontal ground reference from the incline vertex for supported angles", () => {
    for (const thetaDeg of [5, 15, 30, 60]) {
      for (const friction of [false, true]) {
        const block: DiagramBlock = { afterSection: 0, template: "inclined-plane",
          params: { thetaDeg, friction } };
        const shapes = expandDiagram(block);
        const ground = shapes.find((shape) => shape.type === "line"
          && shape.from[0] === 170 && shape.from[1] === 620
          && shape.to[1] === 620 && shape.to[0] > shape.from[0]);
        expect(ground, `ground at ${thetaDeg}° friction=${friction}`).toBeDefined();
        const arc = shapes.find((shape) => shape.type === "arc");
        expect(arc).toMatchObject({ center: [170, 620], startDeg: -thetaDeg, sweepDeg: thetaDeg });
        expect(validDiagramBlocks([{ afterSection: 0, primitives: shapes }], 1)).toBe(true);
      }
    }
  });

  it("places the 30-degree label close to the angle reference", () => {
    const shapes = expandDiagram({ afterSection: 0, template: "inclined-plane",
      params: { thetaDeg: 30, friction: false } });
    const theta = shapes.find((shape) => shape.type === "label" && shape.text === "θ = 30°");
    expect(theta?.type).toBe("label");
    if (theta?.type !== "label") return;
    const arcMid: [number, number] = [170 + 65 * Math.cos(Math.PI / 12), 620 - 65 * Math.sin(Math.PI / 12)];
    expect(Math.hypot(theta.at[0] - arcMid[0], theta.at[1] - arcMid[1])).toBeLessThan(110);
  });

  it("uses a constant index stride for internal number-line labels and preserves all tick strokes", () => {
    const shapes = expandDiagram({ afterSection: 0, template: "number-line",
      params: { start: 0, end: 1.8, step: 0.1 } });
    const tickLines = shapes.filter((shape) => shape.type === "line");
    expect(tickLines).toHaveLength(19);
    const visibleLabels = shapes.filter((shape): shape is Extract<DiagramPrimitive, { type: "label" }> =>
      shape.type === "label");
    const indices = visibleLabels.map((label) =>
      tickLines.findIndex((tick) => tick.type === "line" && Math.abs(tick.from[0] - label.at[0]) < 0.001));
    expect(indices[0]).toBe(0);
    expect(indices[indices.length - 1]).toBe(18);
    expect(indices.every((index) => index >= 0)).toBe(true);
    const gaps = indices.slice(1).map((value, index) => value - indices[index]);
    expect(new Set(gaps).size).toBe(1);
  });

  it("prioritizes a true zero on a symmetric number line", () => {
    const shapes = expandDiagram({ afterSection: 0, template: "number-line",
      params: { start: -0.9, end: 0.9, step: 0.1 } });
    const labels = shapes.filter((shape): shape is Extract<DiagramPrimitive, { type: "label" }> =>
      shape.type === "label").map((shape) => shape.text);
    expect(labels).toContain("0");
    expect(labels[0]).toBe("-0.9");
    expect(labels[labels.length - 1]).toBe("0.9");
    expect(shapes.filter((shape) => shape.type === "line")).toHaveLength(19);
  });
});

describe("diagram callout metadata and jitter import compatibility", () => {
  const shortArrow = { type: "arrow" as const, from: [100, 100] as [number, number],
    to: [170, 100] as [number, number] };
  it("stores scale metadata separate from user text and publishes the new format", () => {
    const block: DiagramBlock = { afterSection: 0,
      primitives: [{ ...shortArrow, callout: SHORT_FORCE_CALLOUT }] };
    expect(validDiagramBlocks([block], 1)).toBe(true);
    expect(validatePublishRequest(request([block])).ok).toBe(true);
    const html = renderToStaticMarkup(createElement(DiagramBlockView, { block, seed: 41 }));
    expect(html).toContain('class="diagram-scale-note"');
    expect(html).not.toContain("Short force arrow not to scale.</text>");
  });

  it("still shows legacy scale notes and migrates their marker on shape editing", () => {
    const legacy: DiagramBlock = { afterSection: 0,
      primitives: [{ ...shortArrow, label: SHORT_FORCE_SCALE_NOTE }] };
    expect(validatePublishRequest(request([legacy])).toMatchObject({ ok: true });
    expect(renderToStaticMarkup(createElement(DiagramBlockView, { block: legacy, seed: 9 })))
      .toContain('class="diagram-scale-note"');
    const converted = materializeDiagram(legacy);
    const first = converted.primitives[0];
    expect(first.type).toBe("arrow");
    if (first.type !== "arrow") return;
    expect(first.label).toBeUndefined();
    expect(first.callout).toBe(SHORT_FORCE_CALLOUT);
    expect(validatePublishRequest(request([converted])).ok).toBe(true);
    // A move carries the old arrow object as its source. It must not overwrite
    // the migrated field with the legacy English sentinel again.
    const dragged = editShape(legacy, 0, moveShape(legacy.primitives[0], 25, 0));
    expect(dragged.primitives?.[0].type).toBe("arrow");
    const draggedArrow = dragged.primitives?.[0];
    if (draggedArrow?.type !== "arrow") throw new Error("Expected arrow after edit");
    expect(draggedArrow.label).toBeUndefined();
    expect(draggedArrow.callout).toBe(SHORT_FORCE_CALLOUT);
    expect(validatePublishRequest(request([dragged])).ok).toBe(true);
  });

  it("applies the same 0.1 precision rule to local JSON drafts and API publication", () => {
    for (const jitterPx of [0, 0.1, 1.2, 3]) {
      const block: DiagramBlock = { ...template, jitterPx };
      expect(validJitterPx(jitterPx)).toBe(true);
      expect(validDiagramBlocks([block], 1)).toBe(true);
      expect(validatePublishRequest(request([block])).ok).toBe(true);
    }
    for (const jitterPx of [-0.1, 1.25, 3.1, NaN]) {
      const block: DiagramBlock = { ...template, jitterPx };
      expect(validJitterPx(jitterPx)).toBe(false);
      expect(validDiagramBlocks([block], 1)).toBe(false);
      expect(validatePublishRequest(request([block])).ok).toBe(false);
      const document = { input: { text: "physics", template: "general", language: "auto", detail: "standard" },
        note: note([block]), settings: DEFAULT_SETTINGS, stickers: [], aiDoodle: null, source: "local" };
      expect(() => readDocument(document)).toThrow("Invalid draft note");
    }
    expect(errors(request([{ ...template, jitterPx: 1.25 }]))).toEqual(expect.arrayContaining([
      expect.objectContaining({ path: "note.diagrams[0].jitterPx", code: "INVALID_PRECISION" }),
    ]));
  });
});
