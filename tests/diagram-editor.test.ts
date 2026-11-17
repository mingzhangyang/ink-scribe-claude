import { describe, expect, it } from "vitest";
import { DIAGRAM_TEMPLATES, validDiagramBlocks, type DiagramBlock } from "../shared/diagram.ts";
import type { NoteStructure } from "../shared/note.ts";
import { validatePublishRequest, validatePublishedNote } from "../shared/publishing.ts";
import {
  editDiagram, insertDiagram, newTemplateDiagram, removeDiagram, removeSection, reorderSection,
  setDiagramCaption, updateTemplateParams,
} from "../src/diagrams/editor.ts";

function note(): NoteStructure {
  return {
    title: "Physics",
    cues: [{ keyword: "force", note: "" }],
    sections: [
      { heading: "Step A", content: "Slope.", highlights: [] },
      { heading: "Step B", content: "Coordinates.", highlights: [] },
      { heading: "Step C", content: "Next.", highlights: [] },
    ],
    summary: "End.",
  };
}

function published(current: NoteStructure): boolean {
  return validatePublishRequest({ schemaVersion: 1, note: current }).ok
    && validatePublishedNote(current).ok
    && validDiagramBlocks(current.diagrams ?? [], current.sections.length);
}

describe("D2 diagram authoring commands", () => {
  it("makes all four default templates immediately publishable", () => {
    for (const template of DIAGRAM_TEMPLATES) {
      const diagram = newTemplateDiagram(template, 0);
      const current = insertDiagram(note(), 0, template);
      expect(current.diagrams).toEqual([diagram]);
      expect(published(current)).toBe(true);
      expect(current.sections).toHaveLength(3);
    }
  });

  it("adds no more than two diagrams, including separate diagrams on the same section", () => {
    const start = note();
    const first = insertDiagram(start, 0, "inclined-plane");
    const second = insertDiagram(first, 0, "number-line");
    expect(first).not.toBe(start);
    expect(second.diagrams).toHaveLength(2);
    expect(second.diagrams?.map((item) => item.afterSection)).toEqual([0, 0]);
    expect(insertDiagram(second, 1, "coordinate-plane")).toBe(second);
    expect(insertDiagram(start, -1, "number-line")).toBe(start);
    expect(insertDiagram(start, 3, "number-line")).toBe(start);
    expect(insertDiagram(start, Number.NaN, "number-line")).toBe(start);
    expect(published(second)).toBe(true);
  });

  it("updates inclined-plane angle/friction without losing template identity", () => {
    const current = insertDiagram(note(), 0, "inclined-plane");
    const angled = updateTemplateParams(current, 0, "inclined-plane", { thetaDeg: 60 });
    const friction = updateTemplateParams(angled, 0, "inclined-plane", { friction: true });
    expect(friction.diagrams?.[0]).toMatchObject({
      template: "inclined-plane", params: { thetaDeg: 60, friction: true }, afterSection: 0,
    });
    expect(updateTemplateParams(friction, 0, "inclined-plane", { thetaDeg: 61 })).toBe(friction);
    expect(updateTemplateParams(friction, 0, "inclined-plane", { thetaDeg: 4 })).toBe(friction);
    expect(updateTemplateParams(friction, 0, "right-triangle", { legRatio: 1 })).toBe(friction);
    expect(published(friction)).toBe(true);
  });

  it("changes triangle ratio, coordinate grid and quadrants without introducing extra fields", () => {
    const triangle = insertDiagram(note(), 1, "right-triangle");
    const changed = updateTemplateParams(triangle, 0, "right-triangle", { legRatio: 0.25 });
    expect(changed.diagrams?.[0]).toMatchObject({ params: { legRatio: 0.25 } });
    expect(updateTemplateParams(changed, 0, "right-triangle", { legRatio: 0.24 })).toBe(changed);

    const axis = insertDiagram(changed, 2, "coordinate-plane");
    const hideGrid = updateTemplateParams(axis, 1, "coordinate-plane", { grid: false });
    const quadrant = updateTemplateParams(hideGrid, 1, "coordinate-plane", { quadrants: "first" });
    expect(quadrant.diagrams?.[1]).toMatchObject({ params: { grid: false, quadrants: "first" } });
    expect(published(quadrant)).toBe(true);
  });

  it("rejects invalid number-line edits rather than losing endpoints in drafts", () => {
    const base = insertDiagram(note(), 0, "number-line");
    const small = updateTemplateParams(base, 0, "number-line", { end: -4 });
    expect(published(small)).toBe(true);
    expect(updateTemplateParams(small, 0, "number-line", { start: -3 })).toBe(small);
    expect(updateTemplateParams(small, 0, "number-line", { step: 0.1 })).toBe(small);
    expect(updateTemplateParams(small, 0, "number-line", { step: 0 })).toBe(small);
    const wider = updateTemplateParams(base, 0, "number-line", { end: 12 });
    expect(updateTemplateParams(wider, 0, "number-line", { start: -30 })).toBe(wider);
    expect(updateTemplateParams(base, 0, "number-line", { end: 100, step: 1 })).toBe(base);
    expect(published(wider)).toBe(true);
  });

  it("edits a caption without losing the referenced section or custom shapes", () => {
    const current = insertDiagram(note(), 2, "number-line");
    const captioned = setDiagramCaption(current, 0, "  力 与 位 移   ");
    expect(captioned.diagrams?.[0]).toMatchObject({
      afterSection: 2, template: "number-line", caption: "力 与 位 移",
    });
    const extended = setDiagramCaption(captioned, 0, "力".repeat(50));
    expect(Array.from(extended.diagrams?.[0].caption ?? "")).toHaveLength(40);
    expect(published(extended)).toBe(true);

    const custom: DiagramBlock = { afterSection: 0, primitives: [
      { type: "arrow", from: [100, 200], to: [900, 200], label: "F" },
    ] };
    const assembled: NoteStructure = { ...note(), diagrams: [custom] };
    const renamed = setDiagramCaption(assembled, 0, "My force diagram");
    expect(renamed.diagrams?.[0]).toMatchObject({ primitives: custom.primitives, caption: "My force diagram" });
    expect(published(renamed)).toBe(true);
  });

  it("updates handwriting independently, preserves other blocks and validates before saving", () => {
    const first = insertDiagram(note(), 0, "inclined-plane");
    const second = insertDiagram(first, 1, "coordinate-plane");
    const updated = editDiagram(second, 1, (block) => ({ ...block, handDrawn: false }));
    expect(updated.diagrams?.[1].handDrawn).toBe(false);
    expect(updated.diagrams?.[0]).toEqual(second.diagrams?.[0]);
    expect(editDiagram(updated, 0, (block) => ({ ...block, afterSection: 2 }))).toBe(updated);
    expect(editDiagram(updated, -1, (block) => block)).toBe(updated);
    expect(published(updated)).toBe(true);
  });

  it("maintains attachments when sections reorder and remove", () => {
    let current = insertDiagram(note(), 0, "inclined-plane");
    current = insertDiagram(current, 2, "coordinate-plane");
    const moved = reorderSection(current, 0, 1);
    expect(moved.sections.map((s) => s.heading)).toEqual(["Step B", "Step A", "Step C"]);
    expect(moved.diagrams?.map((d) => d.afterSection)).toEqual([1, 2]);
    expect(reorderSection(moved, 0, -1)).toBe(moved);
    const removed = removeSection(moved, 1);
    expect(removed.sections.map((s) => s.heading)).toEqual(["Step B", "Step C"]);
    expect(removed.diagrams?.map((d) => d.afterSection)).toEqual([1]);
    expect(published(removed)).toBe(true);
  });

  it("removes one diagram at a time, and returns to the legacy absent-field shape", () => {
    const first = insertDiagram(note(), 0, "inclined-plane");
    const second = insertDiagram(first, 1, "right-triangle");
    const deleted = removeDiagram(second, 0);
    expect(deleted.diagrams?.[0].template).toBe("right-triangle");
    expect(deleted.diagrams?.[0].afterSection).toBe(1);
    const clean = removeDiagram(deleted, 0);
    expect(Object.hasOwn(clean, "diagrams")).toBe(false);
    expect(clean).toEqual(note());
    expect(removeDiagram(clean, 0)).toBe(clean);
    expect(published(clean)).toBe(true);
  });

  it("never mutates an existing note or its source arrays", () => {
    const base = note();
    const original = structuredClone(base);
    const inserted = insertDiagram(base, 1, "inclined-plane");
    const changed = updateTemplateParams(inserted, 0, "inclined-plane", { thetaDeg: 45 });
    expect(base).toEqual(original);
    expect(inserted.diagrams?.[0]).toMatchObject({ params: { thetaDeg: 30 } });
    expect(changed.diagrams?.[0]).toMatchObject({ params: { thetaDeg: 45 } });
  });
});
