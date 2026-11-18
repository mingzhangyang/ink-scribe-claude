import { beforeEach, describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { NoteStructure } from "../shared/note.ts";
import { validatePublishRequest } from "../shared/publishing.ts";
import { DiagramBlockView, PendingDiagramContext } from "../src/components/note/DiagramBlock.tsx";
import { updateTemplateParams } from "../src/diagrams/editor.ts";
import {
  activeNumberLineDraft, hasUnappliedNumberLines, numberLineFields,
  parseNumberLineFields, unappliedNumberLineBlocks, useNumberLineDrafts,
} from "../src/diagrams/numberLineDrafts.ts";
import { useNoteStore } from "../src/state/store.ts";

function note(): NoteStructure {
  return {
    title: "Number line",
    cues: [],
    sections: [{ content: "Draw an axis.", highlights: [] }],
    summary: "",
    diagrams: [{ afterSection: 0, template: "number-line",
      params: { start: 0, end: 1, step: 0.1 } }],
  };
}
function active() {
  const state = useNoteStore.getState();
  return activeNumberLineDraft(state.note, state.noteSerial, 0, useNumberLineDrafts.getState().drafts);
}
function hasPending() {
  const state = useNoteStore.getState();
  return hasUnappliedNumberLines(state.note, state.noteSerial, useNumberLineDrafts.getState().drafts);
}

describe("D4/D5: atomic number-line editor and non-exportable drafts", () => {
  beforeEach(() => {
    useNumberLineDrafts.setState({ drafts: {} });
    useNoteStore.setState({
      note: note(), noteSerial: 100, diagramUndo: [], diagramRedo: [],
    });
  });

  it("shares the 19-tick API limit and permits steps larger than the range", () => {
    expect(parseNumberLineFields({ start: "0", end: "5", step: "10" }))
      .toEqual({ start: 0, end: 5, step: 10 });
    expect(parseNumberLineFields({ start: "0", end: "1", step: "0.1" }))
      .toEqual({ start: 0, end: 1, step: 0.1 });
    expect(parseNumberLineFields({ start: "0", end: "5", step: "0.1" })).toBeNull();
    expect(parseNumberLineFields({ start: "0", end: "5", step: "0" })).toBeNull();
    expect(parseNumberLineFields({ start: "0", end: "5", step: "" })).toBeNull();
    expect(parseNumberLineFields({ start: "5", end: "0", step: "10" })).toBeNull();
    expect(parseNumberLineFields({ start: "0", end: "5", step: "Infinity" })).toBeNull();
    const sparse = updateTemplateParams(note(), 0, "number-line", { end: 5, step: 10 });
    expect(validatePublishRequest({ schemaVersion: 1, note: sparse }).ok).toBe(true);
  });

  it("keeps intermediate invalid combinations out of the note and commits once", () => {
    const original = useNoteStore.getState().note;
    const draft = useNumberLineDrafts.getState();
    draft.setField(0, "end", "5");
    expect(parseNumberLineFields(active()!.fields)).toBeNull();
    draft.setField(0, "step", "10");
    expect(parseNumberLineFields(active()!.fields)).toEqual({ start: 0, end: 5, step: 10 });
    expect(hasPending()).toBe(true);
    expect(useNoteStore.getState().note).toBe(original);
    expect(draft.apply(0)).toBe(true);
    expect(useNoteStore.getState().note?.diagrams?.[0]).toMatchObject({
      template: "number-line", params: { start: 0, end: 5, step: 10 },
    });
    expect(useNoteStore.getState().diagramUndo).toEqual([original]);
    expect(hasPending()).toBe(false);
    useNoteStore.getState().undoDiagram();
    expect(useNoteStore.getState().note).toEqual(original);
    useNoteStore.getState().redoDiagram();
    expect(useNoteStore.getState().note?.diagrams?.[0]).toMatchObject({
      params: { start: 0, end: 5, step: 10 },
    });
  });

  it("accepts equivalent decimal spellings without a note revision or undo entry", () => {
    const original = useNoteStore.getState().note;
    const store = useNumberLineDrafts.getState();
    for (const [field, spelling] of [
      ["start", "0.0"], ["end", "1.00"], ["step", "0.10"],
    ] as const) {
      store.setField(0, field, spelling);
      expect(hasPending()).toBe(true);
      expect(store.apply(0)).toBe(true);
      expect(useNoteStore.getState().note).toBe(original);
      expect(useNoteStore.getState().diagramUndo).toEqual([]);
      expect(hasPending()).toBe(false);
    }

    // The inspector deliberately displays a shortened float32 value.
    // Applying its equivalent spelling must not rewrite the saved precision.
    const float32Note = note();
    float32Note.diagrams = [{ afterSection: 0, template: "number-line",
      params: { start: 0, end: 1, step: Math.fround(0.1) } }];
    useNoteStore.getState().setResult(float32Note, null, "local");
    expect(numberLineFields({ start: 0, end: 1, step: Math.fround(0.1) }).step).toBe("0.1");
    store.setField(0, "step", "0.100");
    expect(hasPending()).toBe(true);
    expect(store.apply(0)).toBe(true);
    expect(useNoteStore.getState().note).toBe(float32Note);
    expect(useNoteStore.getState().diagramUndo).toEqual([]);
    expect(hasPending()).toBe(false);
  });

  it("blocks unresolved edits, including after an unrelated caption edit", () => {
    const original = useNoteStore.getState().note;
    const store = useNumberLineDrafts.getState();
    store.setField(0, "step", "0");
    expect(store.apply(0)).toBe(false);
    expect(hasPending()).toBe(true);
    expect(useNoteStore.getState().note).toBe(original);
    useNoteStore.getState().updateDiagram((current) => ({
      ...current, diagrams: current.diagrams!.map((block, i) =>
        i === 0 ? { ...block, caption: "Updated label" } : block),
    }));
    expect(hasPending()).toBe(true);
    const current = useNoteStore.getState();
    expect(unappliedNumberLineBlocks(current.note, current.noteSerial, useNumberLineDrafts.getState().drafts)).toHaveLength(1);
    store.discard(0);
    expect(hasPending()).toBe(false);
  });

  it("does not attach stale drafts to another document or replaced diagram", () => {
    const store = useNumberLineDrafts.getState();
    store.setField(0, "start", "0.5");
    expect(hasPending()).toBe(true);
    useNoteStore.getState().setResult(note(), null, "local");
    expect(hasPending()).toBe(false);
    expect(active()).toBeNull();
    store.setField(0, "start", "0.5");
    expect(hasPending()).toBe(true);
    useNoteStore.getState().updateDiagram((current) =>
      updateTemplateParams(current, 0, "number-line", { end: 3, step: 1 }));
    expect(hasPending()).toBe(false);
  });

  it("recognizes the painted unsaved badge only in the editor context", () => {
    const current = useNoteStore.getState();
    const block = current.note!.diagrams![0];
    const original = renderToStaticMarkup(createElement(DiagramBlockView, { block, seed: 1 }));
    const marked = renderToStaticMarkup(createElement(
      PendingDiagramContext.Provider, { value: [block] },
      createElement(DiagramBlockView, { block, seed: 1 }),
    ));
    expect(original).not.toContain('data-diagram-unapplied="true"');
    expect(marked).toContain('data-diagram-unapplied="true"');
    expect(marked).toContain("diagram-unapplied-badge");
  });

  it("normalizes float32 input display without changing the stored precision", () => {
    const original = { start: 0, end: 1, step: Math.fround(0.1) };
    expect(numberLineFields(original).step).toBe("0.1");
    expect(original.step).not.toBe(0.1);
  });
});
