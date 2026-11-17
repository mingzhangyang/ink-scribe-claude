import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  expandDiagram, inclinedPlaneForces, validDiagramBlocks,
  type DiagramBlock, type DiagramPrimitive,
} from "../shared/diagram.ts";
import { readDocument } from "../shared/document.ts";
import { normalizeNoteStructure, type NoteStructure } from "../shared/note.ts";
import { validatePublishRequest, validatePublishedNote } from "../shared/publishing.ts";
import { DEFAULT_SETTINGS } from "../shared/settings.ts";
import { DiagramBlockView } from "../src/components/note/DiagramBlock.tsx";
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
});

describe("diagram template geometry", () => {
  it("decomposes gravity into slope-parallel and slope-normal vectors at 30 degrees (<1 unit error)", () => {
    const { gravity, parallel, perpendicular } = inclinedPlaneForces(30);
    const sum = parallel.map((v, i) => v + perpendicular[i]);
    expect(Math.hypot(sum[0] - gravity[0], sum[1] - gravity[1])).toBeLessThan(1);
    expect(expandDiagram(template)).toEqual(expandDiagram(structuredClone(template)));
    expect(expandDiagram({ ...template, params: { thetaDeg: 30, friction: true } })).toHaveLength(expandDiagram(template).length + 1);
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

  it("renders the same deterministic SVG and flow placement across all four layouts", () => {
    const content = note([template]);
    const first = renderToStaticMarkup(createElement(DiagramBlockView, { block: template, seed: 41 }));
    const second = renderToStaticMarkup(createElement(DiagramBlockView, { block: structuredClone(template), seed: 41 }));
    expect(first).toBe(second);
    expect(first).toContain('viewBox="0 0 1000 750"');
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
