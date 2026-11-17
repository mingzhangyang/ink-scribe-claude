import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { NoteStructure } from "../shared/note.ts";
import { insertDiagram, setDiagramCaption } from "../src/diagrams/editor.ts";
import { useNoteStore } from "../src/state/store.ts";

function original(): NoteStructure {
  return {
    title: "Undoable diagrams", cues: [],
    sections: [{ heading: "Section", content: "Geometry", highlights: [] }],
    summary: "Done",
  };
}

describe("D3 history: bounded and document-scoped", () => {
  beforeEach(() => {
    useNoteStore.setState({ note: original(), diagramUndo: [], diagramRedo: [] });
  });
  afterEach(() => {
    useNoteStore.setState({ note: null, diagramUndo: [], diagramRedo: [] });
  });

  it("records one immutable snapshot for each committed diagram command and supports redo", () => {
    const store = useNoteStore.getState();
    const previous = original();
    store.updateDiagram((note) => insertDiagram(note, 0, "inclined-plane"));
    const inserted = useNoteStore.getState().note;
    expect(inserted?.diagrams).toHaveLength(1);
    expect(useNoteStore.getState().diagramUndo).toEqual([previous]);
    useNoteStore.getState().undoDiagram();
    expect(useNoteStore.getState().note).toEqual(previous);
    expect(useNoteStore.getState().diagramRedo).toHaveLength(1);
    useNoteStore.getState().redoDiagram();
    expect(useNoteStore.getState().note).toEqual(inserted);
  });

  it("does not store no-op geometry changes and invalidates redo on new edits", () => {
    useNoteStore.getState().updateDiagram((note) => note);
    expect(useNoteStore.getState().diagramUndo).toHaveLength(0);
    useNoteStore.getState().updateDiagram((note) => insertDiagram(note, 0, "number-line"));
    useNoteStore.getState().undoDiagram();
    expect(useNoteStore.getState().diagramRedo).toHaveLength(1);
    useNoteStore.getState().updateDiagram((note) => insertDiagram(note, 0, "right-triangle"));
    expect(useNoteStore.getState().diagramRedo).toHaveLength(0);
    expect(useNoteStore.getState().diagramUndo).toHaveLength(1);
  });

  it("bounds history and discards snapshots after changing a different content section", () => {
    useNoteStore.getState().updateDiagram((note) => insertDiagram(note, 0, "number-line"));
    for (let i = 0; i < 45; i++) {
      useNoteStore.getState().updateDiagram((note) => setDiagramCaption(note, 0, "Revision " + i));
    }
    expect(useNoteStore.getState().diagramUndo).toHaveLength(30);
    useNoteStore.getState().undoDiagram();
    expect(useNoteStore.getState().diagramRedo).toHaveLength(1);
    useNoteStore.getState().updateNote((note) => ({ ...note, title: "Another title" }));
    expect(useNoteStore.getState().diagramUndo).toHaveLength(0);
    expect(useNoteStore.getState().diagramRedo).toHaveLength(0);
  });

  it("clears history when a new note is generated or loaded", () => {
    useNoteStore.getState().updateDiagram((note) => insertDiagram(note, 0, "right-triangle"));
    expect(useNoteStore.getState().diagramUndo).toHaveLength(1);
    const replacement = { ...original(), title: "New note" };
    useNoteStore.getState().setResult(replacement, null, "local");
    expect(useNoteStore.getState().note).toEqual(replacement);
    expect(useNoteStore.getState().diagramUndo).toHaveLength(0);
    expect(useNoteStore.getState().diagramRedo).toHaveLength(0);
    useNoteStore.getState().undoDiagram();
    expect(useNoteStore.getState().note).toEqual(replacement);
  });
});
