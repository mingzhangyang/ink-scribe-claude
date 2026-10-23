import { create } from "zustand";
import { readDocument, type NoteDocument } from "../../shared/document.ts";
import { currentDocument, useNoteStore } from "../state/store.ts";
import { deleteEntry, getEntry, LibraryConflict, saveEntry, type LibraryEntry, type LibraryLink } from "./storage.ts";

type Status = "idle" | "saving" | "saved" | "error" | "conflict" | "deleted";
/**
 * `baseline` is the linked entry's content at `baseline.revision`, used to show unsaved changes;
 * `source` is the text its note was generated from, which tells a regenerated note apart from one made from other text.
 */
type Baseline = { revision: string; text: string; source: string } | null;
export const useLibraryStatus = create<{ status: Status; baseline: Baseline }>(() => ({ status: "idle", baseline: null }));
const set = (patch: Partial<{ status: Status; baseline: Baseline }>) => useLibraryStatus.setState(patch);
let persistRequested = false;
/** The save in progress. A note generated from other source text clears it, so that save no longer links the editor. */
let saving: { source: string } | null = null;
type SampleParts = Pick<NoteDocument, "input" | "note" | "settings" | "stickers" | "aiDoodle">;
/** The sample exactly as the editor loaded it; any change to these parts counts as the user's work. */
let sample: SampleParts | null = null;

useNoteStore.subscribe((next, previous) => {
  // Another document or link (restored draft, shared note) invalidates the previous save result, including one
  // still in flight: that save ignores its outcome, so leaving "saving" here would block every later save.
  if (next.libraryLink !== previous.libraryLink || next.documentSerial !== previous.documentSerial) set({ status: "idle" });
  if (next.noteSerial !== previous.noteSerial) {
    // Only a freshly generated sample counts; a restored draft may hold edits made on top of one. A sample replaced
    // by another (UI language switch) keeps edited settings, so it stays pristine only if the previous one was.
    const { input, note, settings, stickers, aiDoodle } = next;
    const fresh = next.source === "sample" && next.documentSerial === previous.documentSerial
      && !input.text.trim() && stickers.length === 0 && !aiDoodle && (!previous.note || isUntouchedSample(previous));
    sample = fresh ? { input, note, settings, stickers, aiDoodle } : null;
    // A note generated from other source text is a new note: saving it must add an entry, not replace the linked
    // one or the one being saved. Regenerating the same text (another template, condensing) still updates it.
    if (next.documentSerial === previous.documentSerial && (next.source === "ai" || next.source === "local")) {
      const from = next.generatedFrom;
      if (saving && saving.source !== from) {
        saving = null;
        set({ status: "idle" });
      }
      // Without the linked revision's baseline (a restored draft whose entry changed or is gone), the note being
      // replaced is still the one linked to it, so its source decides.
      const link = next.libraryLink;
      const { baseline } = useLibraryStatus.getState();
      const linkedSource = baseline?.revision === link?.revision ? baseline?.source : previous.generatedFrom;
      if (link && linkedSource !== from) {
        useNoteStore.getState().setLibraryLink(null);
        set({ status: "idle", baseline: null });
      }
    }
  }
});

function baselineOf(revision: string, document: NoteDocument): Baseline {
  return { revision, text: serialize(document), source: document.generatedFrom ?? document.input.text };
}

function isUntouchedSample(state: SampleParts & Pick<NoteDocument, "source">): boolean {
  return state.source === "sample" && !!sample && (Object.keys(sample) as Array<keyof SampleParts>).every((key) => sample![key] === state[key]);
}

/** Normalized so that a document and its stored copy compare equal. */
export function serialize(document: NoteDocument): string {
  try { return JSON.stringify(readDocument(document)); } catch { return ""; }
}

/** Whether the editor differs from its linked entry; unknown baselines count as changed. */
export function isModified(document: NoteDocument, link: LibraryLink, baseline: Baseline): boolean {
  return baseline?.revision !== link.revision || serialize(document) !== baseline.text;
}

/** Whether replacing the editor would lose work that is not in the library. */
export function hasUnsavedWork(): boolean {
  const state = useNoteStore.getState();
  if (state.libraryLink) return isModified(currentDocument(), state.libraryLink, useLibraryStatus.getState().baseline);
  // Typed text counts before any note is generated: a restored draft may hold only that.
  return (!!state.note || !!state.input.text.trim()) && !isUntouchedSample(state);
}

/**
 * After a reload the link comes back with the draft; confirm it still matches the library.
 * `recheck` also verifies a known baseline, after another tab reported a change.
 */
export async function checkLibraryLink(recheck = false) {
  const link = useNoteStore.getState().libraryLink;
  const { baseline, status } = useLibraryStatus.getState();
  if (!link || status === "saving" || (!recheck && baseline?.revision === link.revision)) return;
  // Another document was opened or a save started meanwhile: neither result nor failure describes the editor now.
  const stale = () => useNoteStore.getState().libraryLink !== link || useLibraryStatus.getState().status === "saving";
  try {
    const entry = await getEntry(link.id);
    if (stale()) return;
    // The editor's copy is all that is left of a deleted entry: dropping the baseline makes it unsaved work.
    if (!entry) set({ status: "deleted", baseline: null });
    else if (entry.revision !== link.revision) set({ status: "conflict" });
    else {
      // The expected revision is there again (e.g. restored from a backup), so earlier failures no longer apply.
      const current = useLibraryStatus.getState();
      if (current.status === "deleted" || current.status === "conflict" || current.status === "error") set({ status: "idle" });
      if (current.baseline?.revision !== link.revision) set({ baseline: baselineOf(entry.revision, entry.document) });
    }
  } catch { if (!stale()) set({ status: "error" }); }
}

/** Saves the editor to its linked entry, or to a new entry when unlinked or `asNew`. */
export async function saveToLibrary({ asNew = false, force = false } = {}) {
  const state = useNoteStore.getState();
  if (!state.note || useLibraryStatus.getState().status === "saving") return;
  const document = currentDocument();
  const link = asNew ? null : state.libraryLink;
  set({ status: "saving" });
  if (!persistRequested) {
    persistRequested = true;
    // Best effort: asks the browser not to evict the library under storage pressure.
    void navigator.storage?.persist?.().catch(() => {});
  }
  // Another document was opened or restored, or a note was generated from other text meanwhile: the result, success
  // or failure, no longer describes the editor, and the status now belongs to that note. Regenerating the same text
  // keeps the save current.
  const job = { source: state.generatedFrom };
  saving = job;
  const replaced = () => {
    const now = useNoteStore.getState();
    return saving !== job || now.documentSerial !== state.documentSerial || now.libraryLink !== state.libraryLink;
  };
  try {
    const entry = await saveEntry(link, document, force);
    if (replaced()) return;
    useNoteStore.getState().setLibraryLink({ id: entry.id, revision: entry.revision });
    set({ status: "saved", baseline: baselineOf(entry.revision, document) });
  } catch (error) {
    if (replaced()) return;
    if (error instanceof LibraryConflict && error.deleted) set({ status: "deleted", baseline: null });
    else set({ status: error instanceof LibraryConflict ? "conflict" : "error" });
  } finally {
    if (saving === job) saving = null;
  }
}

export function openEntry(entry: LibraryEntry) {
  useNoteStore.getState().loadDocument(entry.document, { id: entry.id, revision: entry.revision });
  set({ status: "idle", baseline: baselineOf(entry.revision, entry.document) });
}

export async function removeEntry(entry: LibraryLink) {
  await deleteEntry(entry);
  if (useNoteStore.getState().libraryLink?.id === entry.id) {
    useNoteStore.getState().setLibraryLink(null);
    set({ status: "idle", baseline: null });
  }
}
