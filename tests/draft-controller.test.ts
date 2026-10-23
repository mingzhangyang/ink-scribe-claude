import { beforeEach, describe, expect, it, vi } from "vitest";
import { IDBFactory } from "fake-indexeddb";
import { DEFAULT_SETTINGS } from "../shared/settings.ts";
import type { NoteDocument } from "../shared/document.ts";
import { readDraft, writeDraft } from "../src/drafts/storage.ts";

const savedDocument: NoteDocument = {
  input: { text: "恢复的原文", template: "general", language: "auto", detail: "standard" },
  note: { title: "编辑结果", cues: [], sections: [{ content: "正文", highlights: [] }], summary: "" },
  settings: { ...DEFAULT_SETTINGS, seed: 42 }, stickers: [], aiDoodle: null, source: "local",
};

beforeEach(() => {
  vi.resetModules();
  vi.stubGlobal("indexedDB", new IDBFactory());
  vi.stubGlobal("window", { addEventListener: vi.fn() });
  vi.stubGlobal("localStorage", { getItem: () => null, setItem: () => {}, removeItem: () => {} });
});

async function boot() {
  const controller = await import("../src/drafts/controller.ts");
  const { useNoteStore: store } = await import("../src/state/store.ts");
  await controller.startDrafts();
  return { ...controller, store };
}

async function saved(controller: Awaited<ReturnType<typeof boot>>) {
  await vi.waitFor(() => expect(controller.useDraftStatus.getState().status).toBe("saved"));
}

describe("draft lifecycle", () => {
  it("restores before editing and saves subsequent changes without transient request state", async () => {
    await writeDraft(null, savedDocument, true);
    const c = await boot();
    expect(c.store.getState()).toMatchObject({ ...savedDocument, status: "idle", meta: null, selectedStickerId: null });
    expect(c.useDraftStatus.getState().status).toBe("restored");
    c.store.getState().setInput({ text: "新的原文" });
    c.store.getState().startLoading();
    await saved(c);
    expect((await readDraft())?.document?.input.text).toBe("新的原文");
    expect((await readDraft())?.document).not.toHaveProperty("status");
  });

  it("keeps the latest rapid edit when a save is in flight", async () => {
    const c = await boot();
    for (let i = 0; i < 20; i++) c.store.getState().setInput({ text: `edit ${i}` });
    await saved(c);
    expect((await readDraft())?.document?.input.text).toBe("edit 19");
  });

  it("shows conflicts without replacing local edits, then explicitly restores the latest draft", async () => {
    const record = await writeDraft(null, savedDocument, true);
    const c = await boot();
    await writeDraft(record.revision, { ...savedDocument, input: { ...savedDocument.input, text: "另一个标签页" } }, true);
    c.store.getState().setInput({ text: "我的编辑" });
    await vi.waitFor(() => expect(c.useDraftStatus.getState().status).toBe("conflict"));
    expect(c.store.getState().input.text).toBe("我的编辑");
    await c.restoreLatestDraft();
    expect(c.store.getState().input.text).toBe("另一个标签页");
  });

  it("does not recreate a forgotten draft when editing continues, and can opt back in", async () => {
    const c = await boot();
    c.store.getState().setInput({ text: "保存在内存" });
    await saved(c);
    await c.forgetDraft();
    c.store.getState().setInput({ text: "不留存" });
    expect(c.useDraftStatus.getState().status).toBe("disabled");
    expect((await readDraft())?.document).toBeNull();
    await c.enableDraft();
    await saved(c);
    expect((await readDraft())?.document?.input.text).toBe("不留存");
  });

  it("retains edits when storage fails and recovers after retry", async () => {
    const c = await boot();
    const factory = indexedDB;
    vi.stubGlobal("indexedDB", { open: () => { throw new Error("Storage denied"); } });
    c.store.getState().setInput({ text: "必须保留" });
    await vi.waitFor(() => expect(c.useDraftStatus.getState().status).toBe("error"));
    expect(c.store.getState().input.text).toBe("必须保留");
    vi.stubGlobal("indexedDB", factory);
    await c.retryDraft();
    await saved(c);
    expect((await readDraft())?.document?.input.text).toBe("必须保留");
  });
});
