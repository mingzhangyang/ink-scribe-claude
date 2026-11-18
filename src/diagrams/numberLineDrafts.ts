import { create } from "zustand";
import { validDiagramBlocks, type DiagramBlock } from "../../shared/diagram.ts";
import type { NoteStructure } from "../../shared/note.ts";
import { updateTemplateParams } from "./editor.ts";
import { useNoteStore } from "../state/store.ts";

export type NumberLineParams = Extract<DiagramBlock, { template: "number-line" }>["params"];
export type NumberLineField = keyof NumberLineParams;
export type NumberLineFields = Record<NumberLineField, string>;

export type PendingNumberLine = {
  /** A params reference survives caption edits but not template replacement or undo. */
  sourceParams: NumberLineParams;
  section: number;
  noteSerial: number;
  fields: NumberLineFields;
};
export type PendingNumberLines = Record<number, PendingNumberLine>;

function formatNumber(value: number): string {
  const rounded = Number(value.toPrecision(8));
  return Number.isFinite(rounded) && rounded !== value && Math.fround(rounded) === value
    ? String(rounded) : String(value);
}

export function numberLineFields(params: NumberLineParams): NumberLineFields {
  return {
    start: formatNumber(params.start),
    end: formatNumber(params.end),
    step: formatNumber(params.step),
  };
}

/** Exactly the same domain validation used by drafts and the publishing API. */
export function parseNumberLineFields(fields: NumberLineFields): NumberLineParams | null {
  if (Object.values(fields).some((raw) => !raw.trim())) return null;
  const params: NumberLineParams = {
    start: Number(fields.start),
    end: Number(fields.end),
    step: Number(fields.step),
  };
  return validDiagramBlocks([{ afterSection: 0, template: "number-line", params }], 1)
    ? params : null;
}

/** Identity check prevents a stale draft from leaking onto a replaced or reordered diagram. */
export function activeNumberLineDraft(
  note: NoteStructure | null, noteSerial: number, index: number, drafts: PendingNumberLines,
): PendingNumberLine | null {
  const pending = drafts[index];
  const block = note?.diagrams?.[index];
  return pending && block?.template === "number-line"
    && pending.noteSerial === noteSerial
    && pending.section === block.afterSection
    && pending.sourceParams === block.params ? pending : null;
}

export function unappliedNumberLineBlocks(
  note: NoteStructure | null, noteSerial: number, drafts: PendingNumberLines,
): DiagramBlock[] {
  return Object.keys(drafts).flatMap((key) => {
    const index = Number(key);
    const pending = activeNumberLineDraft(note, noteSerial, index, drafts);
    return pending && note?.diagrams?.[index] ? [note.diagrams[index]] : [];
  });
}

export function hasUnappliedNumberLines(
  note: NoteStructure | null, noteSerial: number, drafts: PendingNumberLines,
): boolean {
  return Object.keys(drafts).some((key) =>
    activeNumberLineDraft(note, noteSerial, Number(key), drafts) !== null);
}

function withoutIndex(drafts: PendingNumberLines, index: number): PendingNumberLines {
  const next = { ...drafts };
  delete next[index];
  return next;
}

type NumberLineDraftState = {
  drafts: PendingNumberLines;
  setField: (index: number, key: NumberLineField, value: string) => void;
  discard: (index: number) => void;
  apply: (index: number) => boolean;
};

/** Ephemeral and non-persisted: only a validated Apply writes to NoteStructure. */
export const useNumberLineDrafts = create<NumberLineDraftState>((set, get) => ({
  drafts: {},
  setField: (index, key, value) => {
    const { note, noteSerial } = useNoteStore.getState();
    const block = note?.diagrams?.[index];
    if (block?.template !== "number-line") return;
    set((state) => {
      const existing = activeNumberLineDraft(note, noteSerial, index, state.drafts);
      const initial = numberLineFields(block.params);
      const fields = { ...(existing?.fields ?? initial), [key]: value };
      const unchanged = (Object.keys(initial) as NumberLineField[])
        .every((field) => fields[field] === initial[field]);
      if (unchanged) return { drafts: withoutIndex(state.drafts, index) };
      return { drafts: { ...state.drafts, [index]: {
        sourceParams: block.params, section: block.afterSection, noteSerial, fields,
      } } };
    });
  },
  discard: (index) => set((state) => ({ drafts: withoutIndex(state.drafts, index) })),
  apply: (index) => {
    const { note, noteSerial } = useNoteStore.getState();
    const pending = activeNumberLineDraft(note, noteSerial, index, get().drafts);
    if (!note || !pending) return false;
    const params = parseNumberLineFields(pending.fields);
    if (!params) return false;
    // The same value may be typed differently (0 vs 0.0), or be displayed in
    // its shorter float32 representation. Neither is a new document edit.
    const initial = numberLineFields(pending.sourceParams);
    const equivalent = (Object.keys(params) as NumberLineField[]).every((field) =>
      params[field] === pending.sourceParams[field] || params[field] === Number(initial[field]));
    if (equivalent) {
      set((state) => ({ drafts: withoutIndex(state.drafts, index) }));
      return true;
    }
    // This validation happens over all three numbers, in one undoable transaction.
    const updated = updateTemplateParams(note, index, "number-line", params);
    if (updated === note) return false;
    useNoteStore.getState().updateDiagram((current) => current === note ? updated : current);
    if (useNoteStore.getState().note !== updated) return false;
    set((state) => ({ drafts: withoutIndex(state.drafts, index) }));
    return true;
  },
}));
