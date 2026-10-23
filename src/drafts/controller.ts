import { create } from "zustand";
import type { NoteDocument } from "../../shared/document.ts";
import { useNoteStore } from "../state/store.ts";
import { DraftConflict, readDraft, writeDraft } from "./storage.ts";

type Status = "ready" | "saving" | "saved" | "restored" | "disabled" | "error" | "conflict";
export const useDraftStatus = create<{ status: Status }>(() => ({ status: "ready" }));
const status = (value: Status) => useDraftStatus.setState({ status: value });
let revision: string | null = null;
let enabled = true;
let suspended = false;
let applying = false;
let pending: NoteDocument | null = null;
let working: Promise<void> | null = null;

function document(): NoteDocument {
  const { input, note, settings, stickers, aiDoodle, source } = useNoteStore.getState();
  return { input, note, settings, stickers, aiDoodle, source };
}

function apply(value: NoteDocument) {
  applying = true;
  useNoteStore.setState({ ...value, meta: null, status: "idle", error: null, selectedStickerId: null,
    noteSerial: useNoteStore.getState().noteSerial + 1 });
  applying = false;
}

function failed(error: unknown) {
  suspended = true;
  status(error instanceof DraftConflict ? "conflict" : "error");
}

async function drain() {
  while (pending && enabled && !suspended) {
    const value = pending;
    pending = null;
    status("saving");
    try {
      const saved = await writeDraft(revision, value, true);
      revision = saved.revision;
      if (!pending) status("saved");
    } catch (error) { failed(error); }
  }
}

function save() {
  if (working || !enabled || suspended) return;
  working = drain().finally(() => { working = null; if (pending && !suspended && enabled) save(); });
}

/** Called once before React mounts, so recovery never races the sample note or editing. */
export async function startDrafts() {
  try {
    const saved = await readDraft();
    revision = saved?.revision ?? null;
    enabled = saved?.enabled ?? true;
    if (enabled && saved?.document) { apply(saved.document); status("restored"); }
    else status(enabled ? "ready" : "disabled");
  } catch (error) { failed(error); }
  useNoteStore.subscribe((next, previous) => {
    if (applying || !enabled) return;
    if (next.input === previous.input && next.note === previous.note && next.settings === previous.settings
      && next.stickers === previous.stickers && next.aiDoodle === previous.aiDoodle && next.source === previous.source) return;
    // Merely opening the editor or switching its untouched sample language is not user work.
    if (next.source === "sample" && next.noteSerial !== previous.noteSerial) return;
    pending = document();
    save();
  });
  window.addEventListener("beforeunload", (event) => {
    if (enabled && (pending || working || suspended)) { event.preventDefault(); event.returnValue = ""; }
  });
}

export async function retryDraft() {
  if (working) await working;
  suspended = false;
  pending = document();
  save();
}

/** Explicit recovery replaces local edits only after the UI confirms. */
export async function restoreLatestDraft() {
  const before = document();
  status("saving");
  suspended = true;
  if (working) await working;
  try {
    const saved = await readDraft();
    const current = document();
    if ((Object.keys(before) as Array<keyof NoteDocument>).some((key) => before[key] !== current[key])) {
      throw new DraftConflict("Edits changed while restoring");
    }
    revision = saved?.revision ?? null;
    enabled = saved?.enabled ?? true;
    pending = null;
    if (saved?.document) apply(saved.document);
    suspended = false;
    status(enabled ? (saved?.document ? "restored" : "ready") : "disabled");
  } catch (error) { failed(error); }
}

/** Forgetting is explicit and leaves the current editor available in memory. */
export async function forgetDraft() {
  status("saving");
  suspended = true;
  if (working) await working;
  try {
    const saved = await writeDraft(revision, null, false, true);
    revision = saved.revision;
    enabled = false;
    pending = null;
    suspended = false;
    status("disabled");
  } catch (error) { failed(error); }
}

export async function enableDraft() {
  enabled = true;
  await retryDraft();
}
