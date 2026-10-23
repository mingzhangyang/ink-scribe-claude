import type { DoodleSpec } from "./doodle.ts";
import type { NoteStructure } from "./note.ts";
import type { Detail, Language, NoteStyle, Template } from "./options.ts";

export type StructureRequest = {
  text: string;
  template: Template;
  language: Language;
  style: NoteStyle;
  detail?: Detail;
};

export type ResponseMeta = {
  requestId: string;
  model: string;
  latencyMs: number;
  attempts: number;
  warnings: string[];
  /** true 表示结果来自本地启发式整理（AI_MOCK 开发模式），未调用 Workers AI。 */
  mock?: boolean;
  cached?: boolean;
};

export type StructureResponse = {
  note: NoteStructure;
  meta: ResponseMeta;
};

export type DoodleRequest = {
  concept: string;
};

export type DoodleResponse = {
  doodle: DoodleSpec;
  meta: ResponseMeta;
};

export type PublicConfig = {
  maxInputChars: number;
  doodleEnabled: boolean;
  mock: boolean;
};

export const ERROR_CODES = [
  "INVALID_REQUEST",
  "INVALID_JSON",
  "METHOD_NOT_ALLOWED",
  "UNSUPPORTED_MEDIA_TYPE",
  "PAYLOAD_TOO_LARGE",
  "TEXT_TOO_LONG",
  "FORBIDDEN_ORIGIN",
  "UNAUTHORIZED",
  "IDEMPOTENCY_CONFLICT",
  "STORAGE_UNAVAILABLE",
  "RATE_LIMITED",
  "FEATURE_DISABLED",
  "NOT_FOUND",
  "AI_TIMEOUT",
  "AI_RATE_LIMITED",
  "AI_UNAVAILABLE",
  "AI_OUTPUT_INVALID",
  "INTERNAL_ERROR",
] as const;
export type ErrorCode = (typeof ERROR_CODES)[number];

export type ApiErrorBody = {
  error: {
    code: ErrorCode;
    message: string;
    requestId?: string;
    retryAfterSeconds?: number;
  };
};

// ---------- 发布的笔记（/api/v1 与公开读取接口） ----------

export type NoteVisibility = "public" | "unlisted";

export type PublishedNoteSummary = {
  id: string;
  url: string;
  title: string;
  summary: string;
  language: "zh" | "en";
  template: string;
  layout: string;
  visibility: NoteVisibility;
  createdAt: string;
  updatedAt: string;
};

export type PublishedNote = PublishedNoteSummary & {
  note: import("./note.ts").NoteStructure;
  settings: import("./settings.ts").Settings;
  stickers: import("./stickers.ts").StickerItem[];
  doodle?: import("./doodle.ts").DoodleSpec;
};

export type NoteListResponse = {
  items: PublishedNoteSummary[];
  nextCursor: string | null;
};
