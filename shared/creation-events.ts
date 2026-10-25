import { ERROR_CODES } from "./api.ts";
import { TEMPLATES, LANGUAGES } from "./options.ts";

export const CREATION_EVENTS = ["creation_started", "generation_started", "generation_completed", "generation_failed", "generation_cancelled", "note_ready", "layout_failed", "library_save_completed", "library_save_failed", "export_completed", "export_failed", "share_completed", "share_cancelled", "share_failed", "share_retry_required"] as const;
export const FAILURE_CODES = [...ERROR_CODES, "NETWORK_ERROR", "CLIENT_TIMEOUT", "FONT_ERROR", "OVERFLOW", "STORAGE_ERROR", "CONFLICT", "EXPORT_ERROR", "SHARE_ERROR", "NONE"] as const;
export type CreationEvent = {
  version: 1;
  eventId: string;
  creationId: string;
  attemptId: string;
  name: typeof CREATION_EVENTS[number];
  source: "own" | "sample";
  inputMethod: "text" | "file" | "sample";
  first: boolean;
  locale: "zh" | "en";
  language: typeof LANGUAGES[number];
  template: typeof TEMPLATES[number];
  length: "short" | "medium" | "long";
  mode: "ai" | "local" | "none";
  device: "narrow" | "wide";
  durationMs: number;
  code: typeof FAILURE_CODES[number];
  requestId: string;
};
const KEYS = ["version", "eventId", "creationId", "attemptId", "name", "source", "inputMethod", "first", "locale", "language", "template", "length", "mode", "device", "durationMs", "code", "requestId"];
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const has = (values: readonly string[], value: unknown) => typeof value === "string" && values.includes(value);
/** Reject unknown fields rather than accidentally storing content supplied by a caller. */
export function parseCreationEvents(body: unknown): CreationEvent[] | null {
  if (!Array.isArray(body) || body.length < 1 || body.length > 20) return null;
  for (const raw of body) {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
    const e = raw as Record<string, unknown>;
    if (Object.keys(e).length !== KEYS.length || Object.keys(e).some((k) => !KEYS.includes(k))) return null;
    if (e.version !== 1 || ![e.eventId, e.creationId, e.attemptId].every((id) => typeof id === "string" && uuid.test(id))) return null;
    if (!has(CREATION_EVENTS, e.name) || !has(FAILURE_CODES, e.code) || !has(TEMPLATES, e.template) || !has(LANGUAGES, e.language)) return null;
    if (!has(["own", "sample"], e.source) || !has(["text", "file", "sample"], e.inputMethod) || typeof e.first !== "boolean") return null;
    if (!has(["zh", "en"], e.locale) || !has(["short", "medium", "long"], e.length) || !has(["ai", "local", "none"], e.mode) || !has(["narrow", "wide"], e.device)) return null;
    if (!Number.isInteger(e.durationMs) || (e.durationMs as number) < 0 || (e.durationMs as number) > 600_000) return null;
    if (typeof e.requestId !== "string" || (e.requestId !== "" && !uuid.test(e.requestId) && !/^[a-f0-9]{16,32}$/i.test(e.requestId))) return null;
  }
  return body as CreationEvent[];
}
