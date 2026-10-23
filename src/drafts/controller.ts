import { create } from "zustand";
import type { NoteDocument } from "../../shared/document.ts";
import { currentDocument as document, useNoteStore } from "../state/store.ts";
import type { LibraryLink } from "../library/storage.ts";
import { DraftConflict, readDraft, writeDraft } from "./storage.ts";

type Status = "ready" | "saving" | "saved" | "restored" | "disabled" | "error" | "conflict";
export const useDraftStatus = create<{ status: Status }>(() => ({ status: "ready" }));
const status = (value: Status) => useDraftStatus.setState({ status: value });
let revision: string | null = null;
let enabled = true;
let suspended = false;
let applying = false;
let hasWork = false;
type Snapshot = { document: NoteDocument; library: LibraryLink | null };
let pending: Snapshot | null = null;
let working: Promise<void> | null = null;

function snapshot(): Snapshot {
  return { document: document(), library: useNoteStore.getState().libraryLink };
}

function apply(value: NoteDocument, library: LibraryLink | null) {
  applying = true;
  useNoteStore.getState().loadDocument(value, library);
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
      const saved = await writeDraft(revision, value.document, true, false, value.library);
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
    hasWork = !!saved?.document;
    if (enabled && saved?.document) { apply(saved.document, saved.library); status("restored"); }
    else status(enabled ? "ready" : "disabled");
  } catch (error) { failed(error); }
  useNoteStore.subscribe((next, previous) => {
    if (applying || !enabled) return;
    if (next.input === previous.input && next.note === previous.note && next.settings === previous.settings
      && next.stickers === previous.stickers && next.aiDoodle === previous.aiDoodle && next.source === previous.source
      && next.libraryLink === previous.libraryLink) return;
    // Skip sample initialization only before user work exists. Later replacements must match the saved canvas.
    if (!hasWork && next.source === "sample" && next.noteSerial !== previous.noteSerial) return;
    hasWork = true;
    pending = snapshot();
    save();
  });
  window.addEventListener("beforeunload", (event) => {
    if (enabled && (pending || working || suspended)) { event.preventDefault(); event.returnValue = ""; }
  });
}

export async function retryDraft() {
  if (working) await working;
  suspended = false;
  hasWork = true;
  pending = snapshot();
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
    hasWork = !!saved?.document;
    if (saved?.document) apply(saved.document, saved.library);
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
    hasWork = false;
    pending = null;
    suspended = false;
    status("disabled");
  } catch (error) { failed(error); }
}

export async function enableDraft() {
  enabled = true;
  await retryDraft();
}
