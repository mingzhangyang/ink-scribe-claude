import { readDocument, type NoteDocument } from "../../shared/document.ts";
import { openDatabase, result } from "../lib/idb.ts";

/** One saved note in the user's local library. `revision` changes on every write. */
export type LibraryEntry = { version: 1; id: string; revision: string; title: string; createdAt: number; updatedAt: number; document: NoteDocument };
export type LibraryLink = { id: string; revision: string };
/** The entry changed or was deleted elsewhere since this tab last saw it. */
export class LibraryConflict extends Error {
  constructor(readonly deleted: boolean) { super(deleted ? "Library entry was deleted" : "Library entry changed elsewhere"); }
}

const DATABASE = "ink-scribe-library";
const STORE = "notes";
const CHANNEL = "ink-scribe-library";
const TITLE_LENGTH = 80;

function open(): Promise<IDBDatabase> {
  return openDatabase(DATABASE, 1, (db) => {
    db.createObjectStore(STORE, { keyPath: "id" }).createIndex("updatedAt", "updatedAt");
  });
}

async function using<T>(run: (db: IDBDatabase) => Promise<T>): Promise<T> {
  const db = await open();
  try { return await run(db); } finally { db.close(); }
}

/** Other tabs refresh their library view after a committed change. */
function announce() {
  if (typeof BroadcastChannel === "undefined") return;
  const channel = new BroadcastChannel(CHANNEL);
  channel.postMessage("changed");
  channel.close();
}

export function onLibraryChange(listener: () => void): () => void {
  if (typeof BroadcastChannel === "undefined") return () => {};
  const channel = new BroadcastChannel(CHANNEL);
  channel.onmessage = () => listener();
  return () => channel.close();
}

export function readLink(value: unknown): LibraryLink | null {
  const v = value as Partial<LibraryLink> | null | undefined;
  return v && typeof v.id === "string" && typeof v.revision === "string" ? { id: v.id, revision: v.revision } : null;
}

export function titleOf(document: NoteDocument): string {
  const title = document.note?.title.trim() || document.input.text.split("\n").map((line) => line.trim()).find(Boolean) || "";
  return title.slice(0, TITLE_LENGTH);
}

export function parseEntry(value: unknown): LibraryEntry {
  const r = value as Partial<LibraryEntry> | null;
  if (!r || r.version !== 1 || typeof r.id !== "string" || !r.id || typeof r.revision !== "string" || typeof r.title !== "string"
    || typeof r.createdAt !== "number" || typeof r.updatedAt !== "number") throw new Error("Unsupported library entry");
  return { version: 1, id: r.id, revision: r.revision, title: r.title, createdAt: r.createdAt, updatedAt: r.updatedAt, document: readDocument(r.document) };
}

/** Newest first. Unreadable records are counted but left untouched, so a newer app version can still read them. */
export async function listEntries(): Promise<{ entries: LibraryEntry[]; unreadable: number }> {
  const values = await using((db) => result(db.transaction(STORE).objectStore(STORE).index("updatedAt").getAll()));
  const entries: LibraryEntry[] = [];
  let unreadable = 0;
  for (const value of values.reverse()) {
    try { entries.push(parseEntry(value)); } catch { unreadable++; }
  }
  return { entries, unreadable };
}

export async function getEntry(id: string): Promise<LibraryEntry | null> {
  const value = await using((db) => result(db.transaction(STORE).objectStore(STORE).get(id)));
  return value === undefined ? null : parseEntry(value);
}

/**
 * Creates an entry when `link` is null; otherwise updates it only if it still has the expected revision,
 * so an edit from a stale tab never silently overwrites newer work or resurrects a deleted entry.
 * `force` overwrites the current revision but still refuses to recreate a deleted entry.
 */
export async function saveEntry(link: LibraryLink | null, value: NoteDocument, force = false): Promise<LibraryEntry> {
  // Refuse content that could not be read back, rather than storing an entry the library would hide.
  const document = readDocument(value);
  const saved = await using((db) => new Promise<LibraryEntry>((resolve, reject) => {
    const tx = db.transaction(STORE, "readwrite");
    const store = tx.objectStore(STORE);
    const now = Date.now();
    let failure: Error | null = null;
    let next: LibraryEntry;
    const write = (createdAt: number, id: string) => {
      next = { version: 1, id, revision: crypto.randomUUID(), title: titleOf(document), createdAt, updatedAt: now, document };
      try { store.put(next); }
      catch (error) { failure = error instanceof Error ? error : new Error("Library write failed"); tx.abort(); }
    };
    if (!link) write(now, crypto.randomUUID());
    else {
      const get = store.get(link.id);
      get.onsuccess = () => {
        const current = get.result as Partial<LibraryEntry> | undefined;
        if (!current || (!force && current.revision !== link.revision)) {
          failure = new LibraryConflict(!current);
          tx.abort();
          return;
        }
        write(typeof current.createdAt === "number" ? current.createdAt : now, link.id);
      };
    }
    tx.oncomplete = () => resolve(next);
    tx.onabort = () => reject(failure ?? tx.error ?? new Error("Library transaction aborted"));
    tx.onerror = () => { failure ??= tx.error; };
  }));
  announce();
  return saved;
}

export async function deleteEntry(id: string): Promise<void> {
  await using((db) => new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE, "readwrite");
    tx.objectStore(STORE).delete(id);
    tx.oncomplete = () => resolve();
    tx.onabort = () => reject(tx.error ?? new Error("Library transaction aborted"));
  }));
  announce();
}

// ---------- Backup ----------

const BACKUP_FORMAT = "ink-scribe-library";

export function backupOf(entries: LibraryEntry[]): string {
  return JSON.stringify({ format: BACKUP_FORMAT, version: 1, exportedAt: new Date().toISOString(), entries }, null, 2);
}

/**
 * Imports entries from a backup in one transaction. Entries already present at the same revision are skipped;
 * an id that holds different content is imported as a new copy, so restoring a backup never overwrites local work.
 */
export async function importBackup(text: string): Promise<{ added: number; skipped: number }> {
  let data: unknown;
  try { data = JSON.parse(text); } catch { throw new Error("Invalid library backup"); }
  const backup = data as { format?: unknown; version?: unknown; entries?: unknown };
  if (!backup || backup.format !== BACKUP_FORMAT || backup.version !== 1 || !Array.isArray(backup.entries)) throw new Error("Invalid library backup");
  const seen = new Set<string>();
  const entries = backup.entries.map(parseEntry).filter((entry) => !seen.has(entry.id) && !!seen.add(entry.id));
  const counts = await using((db) => new Promise<{ added: number; skipped: number }>((resolve, reject) => {
    const tx = db.transaction(STORE, "readwrite");
    const store = tx.objectStore(STORE);
    const counts = { added: 0, skipped: 0 };
    for (const entry of entries) {
      const get = store.get(entry.id);
      get.onsuccess = () => {
        const current = get.result as Partial<LibraryEntry> | undefined;
        if (current?.revision === entry.revision) { counts.skipped++; return; }
        store.put(current ? { ...entry, id: crypto.randomUUID() } : entry);
        counts.added++;
      };
    }
    tx.oncomplete = () => resolve(counts);
    tx.onabort = () => reject(tx.error ?? new Error("Library transaction aborted"));
  }));
  if (counts.added) announce();
  return counts;
}
