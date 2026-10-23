import { beforeEach, describe, expect, it, vi } from "vitest";
import { IDBFactory, IDBObjectStore } from "fake-indexeddb";
import { readDocument, type NoteDocument } from "../shared/document.ts";
import { DEFAULT_SETTINGS } from "../shared/settings.ts";
import { DraftConflict, readDraft, writeDraft } from "../src/drafts/storage.ts";

const document: NoteDocument = {
  input: { text: "原文\n完整保留", template: "general", language: "auto", detail: "standard" },
  note: { title: "", cues: [{ keyword: "", note: "未完成" }], sections: [{ heading: "", content: "", highlights: ["待补正文"], highlightInput: "待补正文； " }], summary: "" },
  settings: { ...DEFAULT_SETTINGS, seed: 1234 },
  stickers: [{ id: "sticker", type: "star", x: 17, y: 500, rotation: 31, scale: 1.2, flip: true }],
  aiDoodle: null, source: "local",
};

beforeEach(() => { vi.stubGlobal("indexedDB", new IDBFactory()); });

describe("local draft storage", () => {
  it("round-trips unfinished editing fields, input, appearance and sticker geometry including flips", async () => {
    const saved = await writeDraft(null, document, true);
    expect((await readDraft())?.document).toEqual(document);
    expect((await readDraft())?.revision).toBe(saved.revision);
  });

  it("allows only one of two tabs with the same revision to save", async () => {
    const saved = await writeDraft(null, document, true);
    const results = await Promise.allSettled([
      writeDraft(saved.revision, { ...document, input: { ...document.input, text: "A" } }, true),
      writeDraft(saved.revision, { ...document, input: { ...document.input, text: "B" } }, true),
    ]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    const failed = results.find((r) => r.status === "rejected");
    expect(failed?.status === "rejected" && failed.reason).toBeInstanceOf(DraftConflict);
  });

  it("does not allow an old tab to resurrect a deleted draft", async () => {
    const saved = await writeDraft(null, document, true);
    await writeDraft(saved.revision, null, false, true);
    await expect(writeDraft(saved.revision, document, true)).rejects.toBeInstanceOf(DraftConflict);
    expect(await readDraft()).toMatchObject({ document: null, enabled: false });
  });

  it("keeps the last committed draft when a transaction aborts", async () => {
    const saved = await writeDraft(null, document, true);
    const original = IDBObjectStore.prototype.put;
    const spy = vi.spyOn(IDBObjectStore.prototype, "put").mockImplementation(function (this: IDBObjectStore, ...args: Parameters<typeof original>) {
      const result = original.apply(this, args);
      this.transaction.abort();
      return result;
    });
    try { await expect(writeDraft(saved.revision, { ...document, note: null }, true)).rejects.toThrow(); }
    finally { spy.mockRestore(); }
    expect((await readDraft())?.document).toEqual(document);
  });

  it("rejects unavailable storage instead of reporting a successful save", async () => {
    vi.stubGlobal("indexedDB", { open: () => { throw new DOMException("Denied", "SecurityError"); } });
    await expect(writeDraft(null, document, true)).rejects.toThrow("Denied");
  });

  it.each([{ version: 99, revision: "future" }, { broken: true }])("preserves malformed records until explicit discard: %j", async (corrupt) => {
    const db = await new Promise<IDBDatabase>((resolve) => {
      const req = indexedDB.open("ink-scribe-drafts", 1);
      req.onupgradeneeded = () => req.result.createObjectStore("drafts");
      req.onsuccess = () => resolve(req.result);
    });
    await new Promise<void>((resolve) => {
      const tx = db.transaction("drafts", "readwrite");
      tx.objectStore("drafts").put(corrupt, "current");
      tx.oncomplete = () => resolve();
    });
    db.close();
    await expect(readDraft()).rejects.toThrow("Unsupported draft version");
    await expect(writeDraft(null, document, true)).rejects.toBeInstanceOf(DraftConflict);
    await writeDraft(null, null, false, true);
    expect(await readDraft()).toMatchObject({ enabled: false });
  });

  it("rejects malformed nested content and retains all stickers without publishing limits", () => {
    expect(() => readDocument({ ...document, note: { ...document.note, sections: [{}] } })).toThrow();
    const many = { ...document, stickers: Array.from({ length: 60 }, (_, i) => ({ ...document.stickers[0], id: `s${i}` })) };
    expect(readDocument(many).stickers).toHaveLength(60);
  });

  it("records the generation source only when it differs from the current source text", () => {
    expect(readDocument({ ...document, generatedFrom: "提交生成时的原文" }).generatedFrom).toBe("提交生成时的原文");
    expect(readDocument({ ...document, generatedFrom: document.input.text })).toEqual(document);
    expect(() => readDocument({ ...document, generatedFrom: 1 })).toThrow();
  });
});
