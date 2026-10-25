import { beforeAll, beforeEach, afterAll, expect, it, vi } from "vitest";
import type { CreationEvent } from "../shared/creation-events.ts";
let tracking: typeof import("../src/analytics/creation.ts");
let store: typeof import("../src/state/store.ts").useNoteStore;
let sample: typeof import("../src/samples.ts");
const memory = new Map<string, string>();
let sent: CreationEvent[];
beforeAll(async () => {
  vi.stubGlobal("localStorage", { getItem: (key: string) => memory.get(key) ?? null, setItem: (key: string, value: string) => memory.set(key, value), removeItem: (key: string) => memory.delete(key) });
  vi.stubGlobal("navigator", { doNotTrack: "0" });
  store = (await import("../src/state/store.ts")).useNoteStore;
  sample = await import("../src/samples.ts");
  tracking = await import("../src/analytics/creation.ts");
  tracking.startCreationTracking();
});
beforeEach(() => {
  tracking.flushCreationEvents();
  memory.clear();
  sent = [];
  vi.stubGlobal("fetch", vi.fn((_url, options) => { sent.push(...JSON.parse(options.body)); return Promise.resolve(new Response(null, { status: 204 })); }));
  store.setState((s) => ({ documentSerial: s.documentSerial + 1, input: { ...s.input, text: "" }, note: null }));
});
afterAll(() => { tracking.flushCreationEvents(); vi.unstubAllGlobals(); });

function generate(text = "A private document with facts.") {
  store.getState().setInput({ text });
  const job = tracking.beginGeneration("local");
  store.getState().setResult(sample.SAMPLE_NOTE_EN, null, "local");
  job.complete();
  return job;
}
it("groups retries, starts a new creation for changed content, and emits ready only once", () => {
  store.getState().setInput({ text: "secret input" });
  store.getState().setInput({ text: "secret input expanded" });
  const first = tracking.beginGeneration("ai");
  first.fail("AI_TIMEOUT"); first.cancel();
  const retry = tracking.beginGeneration("ai");
  store.getState().setResult(sample.SAMPLE_NOTE_EN, null, "ai");
  retry.complete();
  tracking.recordLayout(sample.SAMPLE_NOTE_EN, "pending");
  tracking.recordLayout(sample.SAMPLE_NOTE_EN, "font-error");
  tracking.recordLayout(sample.SAMPLE_NOTE_EN, "font-error");
  tracking.recordLayout(sample.SAMPLE_NOTE_EN, "ready");
  tracking.recordLayout(sample.SAMPLE_NOTE_EN, "ready");
  store.getState().setInput({ text: "a different document" });
  tracking.flushCreationEvents();
  expect(sent.filter((e) => e.name === "creation_started")).toHaveLength(2);
  const starts = sent.filter((e) => e.name === "generation_started");
  expect(starts[0].creationId).toBe(starts[1].creationId);
  expect(starts[0].attemptId).not.toBe(starts[1].attemptId);
  expect(sent.filter((e) => e.name === "note_ready")).toHaveLength(1);
  expect(sent.filter((e) => e.name === "layout_failed")).toHaveLength(1);
  expect(sent.some((e) => e.name === "generation_cancelled")).toBe(false);
  expect(JSON.stringify(sent)).not.toContain("secret");
});
it("captures the original creation for asynchronous save/export, excluding restored documents", () => {
  generate();
  const saved = tracking.captureCreationOutcome();
  generate("second private text");
  saved("library_save_completed"); saved("library_save_completed");
  store.setState((s) => ({ documentSerial: s.documentSerial + 1 }));
  tracking.captureCreationOutcome()("export_completed");
  tracking.flushCreationEvents();
  const complete = sent.filter((e) => e.name === "library_save_completed");
  expect(complete).toHaveLength(1);
  expect(complete[0].creationId).toBe(sent[0].creationId);
  expect(sent.filter((e) => e.name === "export_completed")).toHaveLength(0);
  expect(tracking.hasCreatedSuccessfully()).toBe(true);
});
it("sample success does not dismiss first-own-work guidance", () => {
  generate(sample.SAMPLE_TEXTS[0].text);
  tracking.captureCreationOutcome()("export_completed");
  tracking.flushCreationEvents();
  expect(sent.every((e) => e.source === "sample" && !e.first)).toBe(true);
  expect(tracking.hasCreatedSuccessfully()).toBe(false);
});
it("failed statistics delivery and disabled storage do not throw into creation", () => {
  vi.stubGlobal("fetch", vi.fn(() => Promise.reject(new Error("offline"))));
  expect(() => { generate(); tracking.captureCreationOutcome()("export_failed", "EXPORT_ERROR"); tracking.flushCreationEvents(); }).not.toThrow();
  expect(tracking.hasCreatedSuccessfully()).toBe(false);
});
it("restored own work can finish guidance without inventing a new funnel", () => {
  store.setState((s) => ({ documentSerial: s.documentSerial + 1, source: "local", generatedFrom: "restored private source", note: sample.SAMPLE_NOTE_EN }));
  tracking.captureCreationOutcome()("library_save_completed");
  tracking.flushCreationEvents();
  expect(sent).toHaveLength(0);
  expect(tracking.hasCreatedSuccessfully()).toBe(true);
});
it("honors Do Not Track while still completing local guidance", () => {
  vi.stubGlobal("navigator", { doNotTrack: "1" });
  generate();
  tracking.captureCreationOutcome()("export_completed");
  tracking.flushCreationEvents();
  expect(sent).toHaveLength(0);
  expect(tracking.hasCreatedSuccessfully()).toBe(true);
  vi.stubGlobal("navigator", { doNotTrack: "0" });
});
