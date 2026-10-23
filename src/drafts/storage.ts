import { readDocument, type NoteDocument } from "../../shared/document.ts";
import { openDatabase } from "../lib/idb.ts";
import { readLink, type LibraryLink } from "../library/storage.ts";

/** `library` names the library entry the draft was opened from or last saved to. */
export type DraftRecord = { version: 1; revision: string; enabled: boolean; document: NoteDocument | null; library: LibraryLink | null; savedAt: number };
export class DraftConflict extends Error {}
const DATABASE = "ink-scribe-drafts";
const STORE = "drafts";
const KEY = "current";

function open(): Promise<IDBDatabase> {
  return openDatabase(DATABASE, 1, (db) => { db.createObjectStore(STORE); });
}

function parse(value: unknown): DraftRecord | null {
  if (value === undefined) return null;
  const r = value as Partial<DraftRecord> | null;
  if (!r || r.version !== 1 || typeof r.revision !== "string" || typeof r.enabled !== "boolean" || typeof r.savedAt !== "number") throw new Error("Unsupported draft version");
  return { version: 1, revision: r.revision, enabled: r.enabled, savedAt: r.savedAt, document: r.document === null ? null : readDocument(r.document),
    library: readLink(r.library) };
}

export async function readDraft(): Promise<DraftRecord | null> {
  const db = await open();
  try {
    return await new Promise((resolve, reject) => {
      const request = db.transaction(STORE).objectStore(STORE).get(KEY);
      request.onsuccess = () => { try { resolve(parse(request.result)); } catch (error) { reject(error); } };
      request.onerror = () => reject(request.error);
    });
  } finally { db.close(); }
}

/** Read/compare/write happens in one IndexedDB transaction, including across tabs. */
export async function writeDraft(expected: string | null, document: NoteDocument | null, enabled: boolean, discard = false, library: LibraryLink | null = null): Promise<DraftRecord> {
  const db = await open();
  try {
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, "readwrite");
      const store = tx.objectStore(STORE);
      const get = store.get(KEY);
      const next: DraftRecord = { version: 1, revision: crypto.randomUUID(), enabled, document, library, savedAt: Date.now() };
      let failure: Error | null = null;
      get.onsuccess = () => {
        const matches = expected === null ? get.result === undefined : get.result?.revision === expected;
        if (!discard && !matches) {
          failure = new DraftConflict("Draft changed in another tab");
          tx.abort();
          return;
        }
        // A disabled tombstone fences old tabs; deleting the record could resurrect their stale content.
        try { store.put(next, KEY); }
        catch (error) { failure = error instanceof Error ? error : new Error("Draft write failed"); tx.abort(); }
      };
      tx.oncomplete = () => resolve(next);
      tx.onabort = () => reject(failure ?? tx.error ?? new Error("Draft transaction aborted"));
      tx.onerror = () => { failure ??= tx.error; };
    });
  } finally { db.close(); }
}
