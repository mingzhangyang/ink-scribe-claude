import { FAILURE_CODES, type CreationEvent } from "../../shared/creation-events.ts";
import type { NoteStructure } from "../../shared/note.ts";
import { SAMPLE_TEXTS } from "../samples.ts";
import { usePreferences } from "../state/preferences.ts";
import { useNoteStore } from "../state/store.ts";

const FIRST_KEY = "ink-scribe:creation-started";
export const SUCCESS_KEY = "ink-scribe:creation-success";
type Context = Omit<CreationEvent, "eventId" | "name" | "durationMs" | "code" | "requestId">;
type Creation = { context: Context; attempted: boolean };
let inputCreation: Creation | null = null;
let rendered: { context: Context; serial: number; ready: boolean; failures: Set<string> } | null = null;
let inputMethod: "text" | "file" = "text";
let pendingFileInput = false;
let queue: CreationEvent[] = [];
let timer: ReturnType<typeof setTimeout> | undefined;
let initialized = false;
let sessionSuccess = false;

export function hasCreatedSuccessfully(): boolean {
  if (sessionSuccess) return true;
  try { return localStorage.getItem(SUCCESS_KEY) === "1"; } catch { return false; }
}
function markSuccess() {
  // Persistence is optional: a successful action must dismiss this session’s guide.
  sessionSuccess = true;
  try { localStorage.setItem(SUCCESS_KEY, "1"); } catch { /* Storage may be disabled. */ }
  try { if (typeof window !== "undefined") window.dispatchEvent(new Event("creation-success")); } catch { /* Notifications are best effort too. */ }
}
function firstCreation(): boolean {
  try {
    const first = localStorage.getItem(FIRST_KEY) !== "1";
    localStorage.setItem(FIRST_KEY, "1");
    return first;
  } catch { return false; } // Unknown, never claim every visit is a first visit.
}

/** Best effort, bounded, no persistent queue or background retry loop. */
export function flushCreationEvents(): void {
  clearTimeout(timer);
  timer = undefined;
  if (!queue.length) return;
  const body = JSON.stringify(queue.splice(0, 20));
  try {
    void fetch("/api/creation-events", {
      method: "POST", headers: { "Content-Type": "application/json" }, body,
      keepalive: true, credentials: "same-origin", signal: AbortSignal.timeout(5_000),
    }).catch(() => undefined);
  } catch { /* Statistics must never block the editor. */ }
}
function emit(context: Context | null, name: CreationEvent["name"], durationMs = 0, code = "NONE", requestId = "") {
  if (!context) return;
  try {
    if (typeof navigator === "undefined" || navigator.doNotTrack === "1") return;
    const event: CreationEvent = {
      ...context, eventId: crypto.randomUUID(), name,
      durationMs: Math.min(600_000, Math.max(0, Math.round(durationMs))),
      code: FAILURE_CODES.includes(code as CreationEvent["code"]) ? code as CreationEvent["code"] : "INTERNAL_ERROR",
      requestId: /^(?:[a-f0-9]{16,32}|[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12})$/i.test(requestId) ? requestId : "",
    };
    queue.push(event);
    if (queue.length >= 20) flushCreationEvents();
    else timer ??= setTimeout(flushCreationEvents, 5_000);
  } catch { /* Includes restricted browser APIs. */ }
}
function ensureInput(): Creation | null {
  if (!initialized) return null;
  if (inputCreation) return inputCreation;
  const { input } = useNoteStore.getState();
  if (!input.text.trim()) return null;
  try {
    const sample = SAMPLE_TEXTS.some((s) => s.text === input.text);
    const id = crypto.randomUUID();
    inputCreation = { attempted: false, context: {
      version: 1, creationId: id, attemptId: id,
      source: sample ? "sample" : "own", inputMethod: sample ? "sample" : inputMethod,
      first: !sample && firstCreation(), locale: usePreferences.getState().locale,
      language: input.language, template: input.template,
      length: input.text.length < 500 ? "short" : input.text.length < 3000 ? "medium" : "long",
      mode: "none", device: typeof window !== "undefined" && window.innerWidth < 768 ? "narrow" : "wide",
    } };
    emit(inputCreation.context, "creation_started");
    return inputCreation;
  } catch { return null; }
}
export function markFileInput(): void { inputMethod = "file"; inputCreation = null; pendingFileInput = true; }
export function markTextInput(): void { inputMethod = "text"; pendingFileInput = false; }

/** Start after draft hydration. Restoring a document is not a new creation. */
export function startCreationTracking(): void {
  if (initialized) return;
  initialized = true;
  useNoteStore.subscribe((next, previous) => {
    if (next.documentSerial !== previous.documentSerial) {
      inputCreation = null; rendered = null; inputMethod = "text"; pendingFileInput = false;
      return;
    }
    // A completed import is a new journey even if its extracted text is unchanged.
    if (pendingFileInput || next.input.text !== previous.input.text) {
      pendingFileInput = false;
      const sample = SAMPLE_TEXTS.some((s) => s.text === next.input.text);
      if (!next.input.text.trim() || inputCreation?.attempted || (inputCreation && sample !== (inputCreation.context.source === "sample"))) inputCreation = null;
      ensureInput();
    }
    if (rendered && next.noteSerial !== rendered.serial) rendered = null;
  });
  if (typeof window !== "undefined") {
    window.addEventListener("pagehide", flushCreationEvents);
    document.addEventListener("visibilitychange", () => { if (document.visibilityState === "hidden") flushCreationEvents(); });
  }
}

export function beginGeneration(mode: "ai" | "local") {
  const creation = ensureInput();
  const { input } = useNoteStore.getState();
  let context: Context | null = null;
  try {
    if (creation) {
      creation.attempted = true;
      context = { ...creation.context, attemptId: crypto.randomUUID(), mode,
        template: input.template, language: input.language, locale: usePreferences.getState().locale,
        length: input.text.length < 500 ? "short" : input.text.length < 3000 ? "medium" : "long" };
    }
  } catch { /* Optional telemetry. */ }
  const started = Date.now();
  let settled = false;
  emit(context, "generation_started");
  return {
    complete(requestId = "") {
      if (settled) return;
      settled = true;
      emit(context, "generation_completed", Date.now() - started, "NONE", requestId);
      if (context) rendered = { context, serial: useNoteStore.getState().noteSerial, ready: false, failures: new Set() };
    },
    fail(code: string, requestId = "") {
      if (settled) return;
      settled = true;
      emit(context, "generation_failed", Date.now() - started, code, requestId);
    },
    cancel() {
      if (settled) return;
      settled = true;
      emit(context, "generation_cancelled", Date.now() - started);
    },
  };
}

export function recordLayout(note: NoteStructure, status: string): void {
  if (!rendered || useNoteStore.getState().note !== note || rendered.serial !== useNoteStore.getState().noteSerial) return;
  if (status === "ready" && !rendered.ready) {
    rendered.ready = true;
    emit(rendered.context, "note_ready");
  } else if ((status === "font-error" || status === "overflow") && !rendered.failures.has(status)) {
    rendered.failures.add(status);
    emit(rendered.context, "layout_failed", 0, status === "font-error" ? "FONT_ERROR" : "OVERFLOW");
  }
}

/** Capture before awaiting: an old operation must never be attributed to a newly opened note. */
export function captureCreationOutcome() {
  const state = useNoteStore.getState();
  const context = rendered?.serial === state.noteSerial ? rendered.context : null;
  // Restored own work can complete onboarding without inventing a new analytics journey.
  const own = context ? context.source === "own" : (state.source === "ai" || state.source === "local")
    && !!state.generatedFrom.trim() && !SAMPLE_TEXTS.some((sample) => sample.text === state.generatedFrom);
  const started = Date.now();
  let settled = false;
  return (name: CreationEvent["name"], code = "NONE") => {
    if (settled) return;
    settled = true;
    emit(context, name, Date.now() - started, code);
    if (own && ["library_save_completed", "export_completed", "share_completed"].includes(name)) markSuccess();
  };
}
