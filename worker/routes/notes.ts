import type { NoteListResponse, PublishedNote, PublishValidation, PublishValidationResponse } from "../../shared/api.ts";
import type { NoteStructure } from "../../shared/note.ts";
import { isOneOf, TEMPLATES } from "../../shared/options.ts";
import { PUBLISH_SCHEMA_VERSION, validatePublishRequest, type PublishRequest } from "../../shared/publishing.ts";
import { DEFAULT_SETTINGS, type Settings } from "../../shared/settings.ts";
import { detectLanguage } from "../../shared/text.ts";
import { AppError, jsonResponse, readJsonBody } from "../http.ts";
import type { RouteContext } from "../router.ts";
import {
  decodeCursor,
  deleteNote,
  claimPublish,
  releasePublish,
  type PublishClaim,
  type NoteRow,
  getNoteRow,
  insertNote,
  listNotes,
  newNoteId,
  sha256Hex,
  toPublished,
  toSummary,
  updateVisibility,
} from "../store.ts";

const VISIBILITIES = ["public", "unlisted"] as const;
const MAX_PAGE_SIZE = 50;

function db(ctx: RouteContext): D1Database {
  if (!ctx.env.DB) throw new AppError(503, "STORAGE_UNAVAILABLE", "存储未配置，暂时无法读取或发布笔记。");
  return ctx.env.DB;
}

function invalid(message: string): AppError {
  return new AppError(400, "INVALID_REQUEST", message);
}

// This checks the portable document contract; geometry is measured by the shared browser renderer.
const VALIDATION: PublishValidation = { structure: "passed", layout: "not_checked" };

function validatePublication(raw: unknown): PublishRequest {
  const result = validatePublishRequest(raw);
  if (!result.ok) {
    throw new AppError(422, "VALIDATION_FAILED", "发布数据不符合契约，请根据 issues 修正后重新提交。", { issues: result.issues });
  }
  return result.value;
}

function publicationMeta(requestId: string) {
  return { requestId, processing: "agent" as const, validation: VALIDATION };
}

export async function handleValidateNote(ctx: RouteContext): Promise<Response> {
  validatePublication(await readJsonBody(ctx.request, ctx.config.maxBodyBytes));
  const result: PublishValidationResponse = { valid: true, schemaVersion: PUBLISH_SCHEMA_VERSION, validation: VALIDATION };
  return jsonResponse(result);
}

/** 笔记没有日期时，以发布时间（按配置的时区）作为笔记日期。 */
function withDate(note: NoteStructure, language: "zh" | "en", timeZone: string): NoteStructure {
  if (note.date) return note;
  const now = new Date();
  let date: string;
  try {
    date =
      language === "zh"
        ? new Intl.DateTimeFormat("zh-CN", { timeZone, year: "numeric", month: "long", day: "numeric" }).format(now)
        : new Intl.DateTimeFormat("en-US", { timeZone, year: "numeric", month: "short", day: "numeric" }).format(now);
  } catch {
    date = now.toISOString().slice(0, 10);
  }
  return { ...note, date };
}

function noteLanguage(note: NoteStructure): "zh" | "en" {
  return detectLanguage([note.title, note.summary, ...note.sections.map((s) => s.content)].join("\n"));
}

function ownedRowOr404<T>(row: T | null): T {
  if (!row) throw new AppError(404, "NOT_FOUND", "笔记不存在。");
  return row;
}

function publishRow(ctx: RouteContext, row: NoteRow, apiKeyId?: string): PublishedNote {
  if (apiKeyId && row.api_key_id !== apiKeyId) throw new AppError(404, "NOT_FOUND", "笔记不存在。");
  const note = toPublished(row, ctx.origin);
  if (!note) throw new AppError(500, "INTERNAL_ERROR", "笔记数据已损坏。");
  return note;
}

async function published(ctx: RouteContext, id: string, apiKeyId?: string): Promise<PublishedNote> {
  return publishRow(ctx, ownedRowOr404(await getNoteRow(db(ctx), id)), apiKeyId);
}

// ---------- POST /api/v1/notes ----------

export async function handleCreateNote(ctx: RouteContext): Promise<Response> {
  const database = db(ctx);
  const apiKey = ctx.apiKey!;
  const body = await readJsonBody(ctx.request, ctx.config.maxBodyBytes);

  const idempotencyKey = ctx.request.headers.get("Idempotency-Key")?.trim();
  if (idempotencyKey !== undefined && !/^[\w.:-]{1,100}$/.test(idempotencyKey)) {
    throw invalid("Idempotency-Key 只能包含字母、数字和 _ . : -，长度不超过 100。");
  }
  const requestHash = await sha256Hex(JSON.stringify(body));
  let claim: PublishClaim | undefined;
  if (idempotencyKey) {
    const reservation = await claimPublish(database, apiKey.id, idempotencyKey, requestHash, Date.now());
    if ("existing" in reservation) {
      const existing = reservation.existing;
      if (existing.request_hash !== requestHash) {
        throw new AppError(409, "IDEMPOTENCY_CONFLICT", "该 Idempotency-Key 已用于内容不同的请求。");
      }
      if (existing.state === "pending") {
        throw new AppError(409, "IDEMPOTENCY_CONFLICT", "该请求正在处理中，请使用相同的键稍后重试。", { retryAfterSeconds: 2 });
      }
      const row = await getNoteRow(database, existing.note_id);
      if (!row) {
        throw new AppError(410, "NOT_FOUND", "该请求对应的笔记已删除，不能重放。新建笔记请使用新的 Idempotency-Key。");
      }
      const note = publishRow(ctx, row, apiKey.id);
      return jsonResponse({ ...note, meta: {
        ...(note.schemaVersion === 1 ? publicationMeta(ctx.requestId) : { requestId: ctx.requestId }),
        replayed: true,
      } }, 200, { "Idempotent-Replayed": "true" });
    }
    claim = reservation.claim;
  }
  try {
    return await createNote(ctx, body, claim);
  } catch (error) {
    // An ambiguous commit may already be completed; the conditional release leaves it intact.
    // If storage is unavailable, lease expiry still permits recovery.
    if (claim) await releasePublish(database, claim).catch(() => undefined);
    throw error;
  }
}

async function createNote(ctx: RouteContext, body: unknown, claim?: PublishClaim): Promise<Response> {
  const database = db(ctx);
  const apiKey = ctx.apiKey!;
  const input = validatePublication(body);
  const settings: Settings = {
    ...DEFAULT_SETTINGS,
    seed: crypto.getRandomValues(new Uint32Array(1))[0],
    ...input.appearance,
  };
  const visibility = input.visibility ?? "unlisted";
  const template = input.template ?? "general";
  // Publishing consumes an already prepared document and never calls a model.
  let note = input.note;

  const language = noteLanguage(note);
  note = withDate(note, language, ctx.config.defaultTimezone);
  const id = claim?.noteId ?? newNoteId();
  const now = Date.now();
  const committed = await insertNote(database, {
    id,
    schemaVersion: PUBLISH_SCHEMA_VERSION,
    apiKeyId: apiKey.id,
    visibility,
    language,
    template,
    note,
    settings,
    stickers: input.stickers ?? [],
    now,
  }, claim);
  if (!committed) throw new AppError(409, "IDEMPOTENCY_CONFLICT", "请求已由另一次重试接管，请使用相同的键重试。", { retryAfterSeconds: 2 });
  ctx.log.template = template;
  const result = await published(ctx, id);
  return jsonResponse({ ...result, meta: publicationMeta(ctx.requestId) }, 201, { Location: result.url });
}

// ---------- GET /api/v1/notes ----------

function pageSize(url: URL): number {
  const limit = Number(url.searchParams.get("limit") ?? 20);
  return Number.isFinite(limit) ? Math.min(MAX_PAGE_SIZE, Math.max(1, Math.floor(limit))) : 20;
}

export async function handleListNotes(ctx: RouteContext): Promise<Response> {
  const url = new URL(ctx.request.url);
  const { rows, nextCursor } = await listNotes(
    db(ctx),
    { apiKeyId: ctx.apiKey!.id },
    decodeCursor(url.searchParams.get("cursor")),
    pageSize(url),
  );
  const body: NoteListResponse = { items: rows.map((row) => toSummary(row, ctx.origin)), nextCursor };
  return jsonResponse(body);
}

// ---------- GET / PATCH / DELETE /api/v1/notes/:id ----------

export async function handleGetNoteV1(ctx: RouteContext): Promise<Response> {
  return jsonResponse(await published(ctx, ctx.params.id, ctx.apiKey!.id));
}

export async function handlePatchNote(ctx: RouteContext): Promise<Response> {
  const raw = await readJsonBody(ctx.request, 4_096);
  const visibility = (raw as Record<string, unknown> | null)?.visibility;
  if (!isOneOf(VISIBILITIES, visibility)) throw invalid("目前只支持修改 visibility（public 或 unlisted）。");
  const changed = await updateVisibility(db(ctx), ctx.params.id, ctx.apiKey!.id, visibility, Date.now());
  if (!changed) throw new AppError(404, "NOT_FOUND", "笔记不存在。");
  return jsonResponse(await published(ctx, ctx.params.id, ctx.apiKey!.id));
}

export async function handleDeleteNote(ctx: RouteContext): Promise<Response> {
  const row = await deleteNote(db(ctx), ctx.params.id, ctx.apiKey!.id);
  if (!row) throw new AppError(404, "NOT_FOUND", "笔记不存在。");
  return new Response(null, { status: 204 });
}

// ---------- 公开读取 ----------

export async function handlePublicNote(ctx: RouteContext): Promise<Response> {
  const note = await published(ctx, ctx.params.id);
  // 不缓存：删除或修改可见性后应立即生效
  return jsonResponse(note, 200, { "Cache-Control": "no-cache" });
}

export async function handleGallery(ctx: RouteContext): Promise<Response> {
  const url = new URL(ctx.request.url);
  const template = url.searchParams.get("template") ?? undefined;
  const language = url.searchParams.get("language") ?? undefined;
  if (template !== undefined && !isOneOf(TEMPLATES, template)) throw invalid("template 取值无效。");
  if (language !== undefined && language !== "zh" && language !== "en") throw invalid("language 只能是 zh 或 en。");
  const { rows, nextCursor } = await listNotes(
    db(ctx),
    { visibility: "public", template, language },
    decodeCursor(url.searchParams.get("cursor")),
    pageSize(url),
  );
  const body: NoteListResponse = { items: rows.map((row) => toSummary(row, ctx.origin)), nextCursor };
  return jsonResponse(body, 200, { "Cache-Control": "no-cache" });
}
