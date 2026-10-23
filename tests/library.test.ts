import { beforeEach, describe, expect, it, vi } from "vitest";
import { IDBFactory } from "fake-indexeddb";
import type { NoteDocument } from "../shared/document.ts";
import { DEFAULT_SETTINGS } from "../shared/settings.ts";
import { readDraft, writeDraft } from "../src/drafts/storage.ts";
import { backupOf, deleteEntry, getEntry, importBackup, LibraryConflict, listEntries, saveEntry, searchTextOf, titleOf } from "../src/library/storage.ts";

const document: NoteDocument = {
  input: { text: "第一行原文\n第二行", template: "reading-notes", language: "auto", detail: "standard" },
  note: { title: "读书笔记", cues: [{ keyword: "要点", note: "提示" }], sections: [{ content: "正文", highlights: ["正文"] }], summary: "总结" },
  settings: { ...DEFAULT_SETTINGS, seed: 7 },
  stickers: [{ id: "s1", type: "star", x: 10, y: 20, rotation: 5, scale: 1 }],
  aiDoodle: null, source: "local",
};
const edited = (title: string): NoteDocument => ({ ...document, note: { ...document.note!, title } });

beforeEach(() => {
  vi.resetModules();
  vi.stubGlobal("indexedDB", new IDBFactory());
  vi.stubGlobal("window", { addEventListener: vi.fn() });
  vi.stubGlobal("localStorage", { getItem: () => null, setItem: () => {}, removeItem: () => {} });
});

describe("library storage", () => {
  it("stores several notes and lists them newest first", async () => {
    const a = await saveEntry(null, edited("A"));
    await new Promise((r) => setTimeout(r, 2));
    const b = await saveEntry(null, edited("B"));
    const { entries, unreadable } = await listEntries();
    expect(entries.map((e) => e.title)).toEqual(["B", "A"]);
    expect(unreadable).toBe(0);
    expect((await getEntry(a.id))?.document).toEqual(edited("A"));
    expect(b.id).not.toBe(a.id);
  });

  it("updates an entry only from its current revision", async () => {
    const first = await saveEntry(null, document);
    const second = await saveEntry(first, edited("新版本"));
    expect(second).toMatchObject({ id: first.id, createdAt: first.createdAt });
    await expect(saveEntry(first, edited("过期标签页"))).rejects.toBeInstanceOf(LibraryConflict);
    expect((await getEntry(first.id))?.title).toBe("新版本");
    const forced = await saveEntry(first, edited("覆盖"), true);
    expect((await getEntry(first.id))?.revision).toBe(forced.revision);
  });

  it("never recreates a deleted entry from a stale link, even when forced", async () => {
    const entry = await saveEntry(null, document);
    await deleteEntry(entry.id);
    const failure = await saveEntry(entry, document, true).catch((error) => error);
    expect(failure).toBeInstanceOf(LibraryConflict);
    expect(failure.deleted).toBe(true);
    expect(await getEntry(entry.id)).toBeNull();
  });

  it("keeps unreadable records instead of dropping them", async () => {
    await saveEntry(null, document);
    const db = await new Promise<IDBDatabase>((resolve) => { const r = indexedDB.open("ink-scribe-library", 1); r.onsuccess = () => resolve(r.result); });
    await new Promise<void>((resolve) => {
      const tx = db.transaction("notes", "readwrite");
      tx.objectStore("notes").put({ id: "future", version: 2, updatedAt: 1 });
      tx.oncomplete = () => resolve();
    });
    db.close();
    const { entries, unreadable } = await listEntries();
    expect(entries).toHaveLength(1);
    expect(unreadable).toBe(1);
  });

  it("derives titles from the note, falling back to the first line of text", () => {
    expect(titleOf(document)).toBe("读书笔记");
    expect(titleOf({ ...document, note: { ...document.note!, title: " " }, input: { ...document.input, text: "\n  开头  \n" } })).toBe("开头");
  });

  it("searches the full note, not only the truncated preview", () => {
    const long = { ...document, note: { ...document.note!, summary: `${"长".repeat(200)}尾部词`, sections: [{ heading: "小标题词", content: "章节里的词", highlights: [] }] } };
    expect(searchTextOf(long)).toContain("尾部词");
    expect(searchTextOf(long)).toContain("章节里的词");
    expect(searchTextOf(long)).toContain("小标题词");
    expect(searchTextOf(document)).toContain("提示");
  });

  it("restores backups without overwriting different local content", async () => {
    const entry = await saveEntry(null, document);
    const backup = backupOf((await listEntries()).entries);
    expect(await importBackup(backup)).toEqual({ added: 0, skipped: 1 });
    await saveEntry(entry, edited("本机修改"));
    expect(await importBackup(backup)).toEqual({ added: 1, skipped: 0 });
    const titles = (await listEntries()).entries.map((e) => e.title).sort();
    expect(titles).toEqual(["本机修改", "读书笔记"]);
    await expect(importBackup("{\"format\":\"other\"}")).rejects.toThrow("Invalid library backup");
    await expect(importBackup(backup.replace("\"读书笔记\"", "42"))).rejects.toThrow();
  });
});

describe("library in the editor", () => {
  async function boot() {
    const drafts = await import("../src/drafts/controller.ts");
    const library = await import("../src/library/controller.ts");
    const { useNoteStore: store } = await import("../src/state/store.ts");
    await drafts.startDrafts();
    return { ...drafts, ...library, store };
  }

  it("links the editor to its entry, tracks changes and keeps the link across reloads", async () => {
    let c = await boot();
    c.store.getState().loadDocument(document, null);
    expect(c.hasUnsavedWork()).toBe(true);
    await c.saveToLibrary();
    const link = c.store.getState().libraryLink!;
    expect(c.useLibraryStatus.getState().status).toBe("saved");
    expect(c.hasUnsavedWork()).toBe(false);
    c.store.getState().setInput({ text: "继续编辑" });
    expect(c.hasUnsavedWork()).toBe(true);
    await c.saveToLibrary();
    expect(c.store.getState().libraryLink).toMatchObject({ id: link.id });
    expect((await listEntries()).entries).toHaveLength(1);
    await vi.waitFor(async () => expect((await readDraft())?.library).toEqual(c.store.getState().libraryLink));

    vi.resetModules();
    c = await boot();
    expect(c.store.getState().libraryLink).toEqual((await readDraft())?.library);
    await c.checkLibraryLink();
    expect(c.hasUnsavedWork()).toBe(false);
  });

  it("saves copies as separate entries and opens entries into the editor", async () => {
    const c = await boot();
    c.store.getState().loadDocument(document, null);
    await c.saveToLibrary();
    const original = c.store.getState().libraryLink!;
    c.store.getState().setInput({ text: "副本" });
    await c.saveToLibrary({ asNew: true });
    expect(c.store.getState().libraryLink?.id).not.toBe(original.id);
    const entry = (await getEntry(original.id))!;
    c.openEntry(entry);
    expect(c.store.getState()).toMatchObject({ input: document.input, libraryLink: original });
  });

  it("reports edits from another tab and deletions instead of overwriting them", async () => {
    const c = await boot();
    c.store.getState().loadDocument(document, null);
    await c.saveToLibrary();
    const link = c.store.getState().libraryLink!;
    await saveEntry(link, edited("另一个标签页"));
    c.store.getState().setInput({ text: "本标签页" });
    await c.saveToLibrary();
    expect(c.useLibraryStatus.getState().status).toBe("conflict");
    expect((await getEntry(link.id))?.title).toBe("另一个标签页");
    await c.saveToLibrary({ force: true });
    expect((await getEntry(link.id))?.document.input.text).toBe("本标签页");

    await c.removeEntry(link.id);
    expect(c.store.getState().libraryLink).toBeNull();
  });

  it("detects a deleted entry after reload", async () => {
    const entry = await saveEntry(null, document);
    await writeDraft(null, document, true, false, { id: entry.id, revision: entry.revision });
    await deleteEntry(entry.id);
    const c = await boot();
    await c.checkLibraryLink();
    expect(c.useLibraryStatus.getState().status).toBe("deleted");
    await c.saveToLibrary({ asNew: true });
    expect(c.store.getState().libraryLink?.id).not.toBe(entry.id);
  });

  it("treats edits to the startup sample as unsaved work", async () => {
    const c = await boot();
    c.store.getState().setResult(document.note!, null, "sample");
    expect(c.hasUnsavedWork()).toBe(false);
    c.store.getState().updateNote((n) => ({ ...n, title: "改过的示例" }));
    expect(c.hasUnsavedWork()).toBe(true);
    c.store.getState().setResult(document.note!, null, "sample");
    c.store.getState().setSettings({ paper: "kraft" });
    expect(c.hasUnsavedWork()).toBe(true);
  });

  it("keeps edited sample settings unsaved when the sample switches language", async () => {
    const c = await boot();
    c.store.getState().setResult(document.note!, null, "sample");
    c.store.getState().setSettings({ paper: "kraft" });
    c.store.getState().setResult(edited("English sample").note!, null, "sample");
    expect(c.hasUnsavedWork()).toBe(true);
  });

  it("treats the editor copy of an entry deleted elsewhere as unsaved work", async () => {
    const c = await boot();
    c.store.getState().loadDocument(document, null);
    await c.saveToLibrary();
    expect(c.hasUnsavedWork()).toBe(false);
    await deleteEntry(c.store.getState().libraryLink!.id);
    await c.checkLibraryLink(true);
    expect(c.hasUnsavedWork()).toBe(true);
  });

  it("rechecks a known link when asked, catching changes missed while unmounted", async () => {
    const c = await boot();
    c.store.getState().loadDocument(document, null);
    await c.saveToLibrary();
    await deleteEntry(c.store.getState().libraryLink!.id);
    await c.checkLibraryLink();
    expect(c.useLibraryStatus.getState().status).toBe("saved");
    await c.checkLibraryLink(true);
    expect(c.useLibraryStatus.getState().status).toBe("deleted");
  });

  it("clears a stale deleted status once the entry is restored from a backup", async () => {
    const c = await boot();
    c.store.getState().loadDocument(document, null);
    await c.saveToLibrary();
    const link = c.store.getState().libraryLink!;
    const backup = backupOf([(await getEntry(link.id))!]);
    await deleteEntry(link.id);
    await c.checkLibraryLink(true);
    expect(c.useLibraryStatus.getState().status).toBe("deleted");
    await importBackup(backup);
    await c.checkLibraryLink(true);
    expect(c.useLibraryStatus.getState().status).toBe("idle");
    c.store.getState().setInput({ text: "恢复后继续编辑" });
    await c.saveToLibrary();
    expect(c.store.getState().libraryLink?.id).toBe(link.id);
    expect((await listEntries()).entries).toHaveLength(1);
  });

  it("ignores a failed link check once another document is opened", async () => {
    const c = await boot();
    const other = await saveEntry(null, edited("B"));
    c.store.getState().loadDocument(document, null);
    await c.saveToLibrary();
    const working = indexedDB;
    vi.stubGlobal("indexedDB", { open: () => { throw new Error("unavailable"); } });
    const pending = c.checkLibraryLink(true);
    c.openEntry(other);
    await pending;
    vi.stubGlobal("indexedDB", working);
    expect(c.useLibraryStatus.getState().status).toBe("idle");
  });

  it("autosaves an opened sample-derived entry and its link when no draft exists yet", async () => {
    const entry = await saveEntry(null, { ...document, source: "sample" });
    const c = await boot();
    c.openEntry(entry);
    await vi.waitFor(async () => expect((await readDraft())?.library).toEqual({ id: entry.id, revision: entry.revision }));
    expect((await readDraft())?.document?.note?.title).toBe(document.note!.title);
  });

  it("ignores the outcome of a save once another document is opened", async () => {
    const c = await boot();
    const other = await saveEntry(null, edited("B"));
    c.store.getState().loadDocument(document, null);
    await c.saveToLibrary();
    const stale = c.store.getState().libraryLink!;
    await saveEntry(stale, edited("另一个标签页"));
    c.store.getState().setInput({ text: "A 的修改" });
    const pending = c.saveToLibrary();
    c.openEntry(other);
    await pending;
    expect(c.useLibraryStatus.getState().status).toBe("idle");
    expect(c.store.getState().libraryLink).toEqual({ id: other.id, revision: other.revision });
    expect(c.hasUnsavedWork()).toBe(false);
  });

  it("can save a replacement document while an unlinked save is still in flight", async () => {
    const c = await boot();
    c.store.getState().loadDocument(document, null);
    const pending = c.saveToLibrary();
    c.store.getState().loadDocument(edited("替换的文档"), null);
    expect(c.useLibraryStatus.getState().status).toBe("idle");
    await pending;
    expect(c.store.getState().libraryLink).toBeNull();
    await c.saveToLibrary();
    expect(c.useLibraryStatus.getState().status).toBe("saved");
    expect((await getEntry(c.store.getState().libraryLink!.id))?.title).toBe("替换的文档");
  });
});
