import type { NoteListResponse, PublishedNote, PublishValidation, PublishValidationResponse } from "../../shared/api.ts";
import type { NoteStructure } from "../../shared/note.ts";
import { isOneOf, TEMPLATES } from "../../shared/options.ts";
import { PUBLISH_SCHEMA_VERSION, validatePublishRequest, type PublishRequest } from "../../shared/publishing.ts";
import { DEFAULT_SETTINGS, type Settings } from "../../shared/settings.ts";
import { detectLanguage } from "../../shared/text.ts";
import { AppError, jsonResponse, readJsonBody } from "../http.ts";
import { clientKey } from "../rate-limit.ts";
import type { RouteContext } from "../router.ts";
import {
  ANONYMOUS_OWNER,
  countAnonymousNotes,
  decodeCursor,
  deleteAnonymousNote,
  deleteNote,
  findPublishRequest,
  type ApiKeyRecord,
  claimPublish,
  releasePublish,
  type PublishClaim,
  type PublishRequest as PublishReservation,
  type NoteRow,
  getNoteRow,
  insertNote,
  listNotes,
  newNoteId,
  newSecretToken,
  sha256Hex,
  toPublished,
  toSummary,
  updateVisibility,
} from "../store.ts";

const VISIBILITIES = ["public", "unlisted"] as const;
const MAX_PAGE_SIZE = 50;
const DAY_MS = 86_400_000;
const MANAGE_TOKEN_HEADER = "X-Manage-Token";
/** A client-chosen manage token must be long enough to be unguessable. */
const MANAGE_TOKEN_PATTERN = /^[A-Za-z0-9._~-]{32,200}$/;

/**
 * Who publishes. Anonymous clients are known only by a hash of their IP, which scopes their daily quota and their
 * Idempotency-Keys, so one client's keys never collide with another's.
 */
type Publisher =
  | { kind: "key"; ownerId: string; scope: string }
  | { kind: "anonymous"; ownerId: typeof ANONYMOUS_OWNER; scope: string; clientHash: string };

async function publisherOf(ctx: RouteContext): Promise<Publisher> {
  if (ctx.apiKey) return { kind: "key", ownerId: ctx.apiKey.id, scope: ctx.apiKey.id };
  const clientHash = await sha256Hex(`anonymous-client:${clientKey(ctx.request)}`);
  return { kind: "anonymous", ownerId: ANONYMOUS_OWNER, scope: `${ANONYMOUS_OWNER}:${clientHash}`, clientHash };
}

function requireApiKey(ctx: RouteContext): ApiKeyRecord {
  if (!ctx.apiKey) throw new AppError(401, "UNAUTHORIZED", "该操作需要 API 密钥。");
  return ctx.apiKey;
}

function assertAnonymousEnabled(ctx: RouteContext): void {
  if (ctx.config.anonymousDailyLimit === 0 || ctx.config.anonymousDailyLimitPerClient === 0) {
    throw new AppError(403, "FEATURE_DISABLED", "本站未开放匿名发布。");
  }
}

/** Soft daily caps: concurrent requests from one client may exceed them by a few, bounded by the per-minute limit. */
async function assertAnonymousQuota(ctx: RouteContext, database: D1Database, clientHash: string): Promise<void> {
  const usage = await countAnonymousNotes(database, clientHash, Date.now() - DAY_MS);
  if (usage.client >= ctx.config.anonymousDailyLimitPerClient || usage.total >= ctx.config.anonymousDailyLimit) {
    throw new AppError(429, "RATE_LIMITED", "24 小时内的匿名发布次数已达上限，请稍后再试。", { retryAfterSeconds: 3600 });
  }
}

/**
 * The publisher may choose its own token, so it can still delete the note if the response is lost: a replay never
 * reveals or replaces the token, because a client sharing the same IP could otherwise take it over.
 */
async function manageTokenFor(ctx: RouteContext): Promise<{ token: string; hash: string }> {
  const supplied = ctx.request.headers.get(MANAGE_TOKEN_HEADER)?.trim();
  if (supplied !== undefined && !MANAGE_TOKEN_PATTERN.test(supplied)) {
    throw invalid(`${MANAGE_TOKEN_HEADER} 需为 32–200 个字母、数字或 . _ ~ - 字符；也可以省略，由服务端生成。`);
  }
  const token = supplied ?? `imt_${newSecretToken()}`;
  return { token, hash: await sha256Hex(token) };
}

function db(ctx: RouteContext): D1Database {
  if (!ctx.env.DB) throw new AppError(503, "STORAGE_UNAVAILABLE", "存储未配置，暂时无法读取或发布笔记。");
  return ctx.env.DB;
}

function invalid(message: string): AppError {
  return new AppError(400, "INVALID_REQUEST", message);
}

// This checks the portable document contract; geometry is measured by the shared browser renderer.
const VALIDATION: PublishValidation = { structure: "passed", layout: "not_checked" };

function validatePublication(raw: unknown, publisher: Publisher): PublishRequest {
  const result = validatePublishRequest(raw);
  const issues = result.ok ? [] : result.issues;
  if (publisher.kind === "anonymous" && result.ok && result.value.visibility === "public") {
    issues.push({ path: "visibility", code: "ANONYMOUS_UNLISTED_ONLY", message: "Notes published without an API key must be unlisted." });
  }
  if (!result.ok || issues.length) {
    throw new AppError(422, "VALIDATION_FAILED", "发布数据不符合契约，请根据 issues 修正后重新提交。", { issues });
  }
  return result.value;
}

function publicationMeta(requestId: string) {
  return { requestId, processing: "agent" as const, validation: VALIDATION };
}

export async function handleValidateNote(ctx: RouteContext): Promise<Response> {
  const publisher = await publisherOf(ctx);
  if (publisher.kind === "anonymous") assertAnonymousEnabled(ctx);
  validatePublication(await readJsonBody(ctx.request, ctx.config.maxBodyBytes), publisher);
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

function ownedBy(row: NoteRow, owner: Publisher): boolean {
  return row.api_key_id === owner.ownerId && (owner.kind === "key" || row.client_hash === owner.clientHash);
}

function publishRow(ctx: RouteContext, row: NoteRow, owner?: Publisher): PublishedNote {
  if (owner && !ownedBy(row, owner)) throw new AppError(404, "NOT_FOUND", "笔记不存在。");
  const note = toPublished(row, ctx.origin);
  if (!note) throw new AppError(500, "INTERNAL_ERROR", "笔记数据已损坏。");
  return note;
}

async function published(ctx: RouteContext, id: string, owner?: Publisher): Promise<PublishedNote> {
  return publishRow(ctx, ownedRowOr404(await getNoteRow(db(ctx), id)), owner);
}

// ---------- POST /api/v1/notes ----------

export async function handleCreateNote(ctx: RouteContext): Promise<Response> {
  const database = db(ctx);
  const publisher = await publisherOf(ctx);
  if (publisher.kind === "anonymous") assertAnonymousEnabled(ctx);
  const body = await readJsonBody(ctx.request, ctx.config.maxBodyBytes);

  const idempotencyKey = ctx.request.headers.get("Idempotency-Key")?.trim();
  if (idempotencyKey !== undefined && !/^[\w.:-]{1,100}$/.test(idempotencyKey)) {
    throw invalid("Idempotency-Key 只能包含字母、数字和 _ . : -，长度不超过 100。");
  }
  const manage = publisher.kind === "anonymous" ? await manageTokenFor(ctx) : undefined;
  const requestHash = await sha256Hex(JSON.stringify(body));
  // Replays are answered before admission: a completed request replays under the contract it was published with,
  // and a new request is validated and checked against quotas before it may leave a reservation behind.
  if (idempotencyKey) {
    const existing = await findPublishRequest(database, publisher.scope, idempotencyKey);
    const takeover = existing?.state === "pending" && existing.request_hash === requestHash && existing.lease_until <= Date.now();
    if (existing && !takeover) return replay(ctx, publisher, existing, requestHash);
  }
  const input = validatePublication(body, publisher);
  if (publisher.kind === "anonymous") await assertAnonymousQuota(ctx, database, publisher.clientHash);
  let claim: PublishClaim | undefined;
  if (idempotencyKey) {
    const reservation = await claimPublish(database, publisher.scope, idempotencyKey, requestHash, Date.now());
    if ("existing" in reservation) return replay(ctx, publisher, reservation.existing, requestHash);
    claim = reservation.claim;
  }
  try {
    return await createNote(ctx, publisher, input, manage, claim);
  } catch (error) {
    // An ambiguous commit may already be completed; the conditional release leaves it intact.
    // If storage is unavailable, lease expiry still permits recovery.
    if (claim) await releasePublish(database, claim).catch(() => undefined);
    throw error;
  }
}

async function replay(ctx: RouteContext, publisher: Publisher, existing: PublishReservation, requestHash: string): Promise<Response> {
  if (existing.request_hash !== requestHash) {
    throw new AppError(409, "IDEMPOTENCY_CONFLICT", "该 Idempotency-Key 已用于内容不同的请求。");
  }
  if (existing.state === "pending") {
    throw new AppError(409, "IDEMPOTENCY_CONFLICT", "该请求正在处理中，请使用相同的键稍后重试。", { retryAfterSeconds: 2 });
  }
  const row = await getNoteRow(db(ctx), existing.note_id);
  if (!row) {
    throw new AppError(410, "NOT_FOUND", "该请求对应的笔记已删除，不能重放。新建笔记请使用新的 Idempotency-Key。");
  }
  const note = publishRow(ctx, row, publisher);
  return jsonResponse({ ...note, meta: {
    ...(note.schemaVersion === 1 ? publicationMeta(ctx.requestId) : { requestId: ctx.requestId }),
    replayed: true,
  } }, 200, { "Idempotent-Replayed": "true" });
}

async function createNote(
  ctx: RouteContext,
  publisher: Publisher,
  input: PublishRequest,
  manage?: { token: string; hash: string },
  claim?: PublishClaim,
): Promise<Response> {
  const database = db(ctx);
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
    apiKeyId: publisher.ownerId,
    visibility,
    language,
    template,
    note,
    settings,
    stickers: input.stickers ?? [],
    ...(publisher.kind === "anonymous" && manage ? { anonymous: { clientHash: publisher.clientHash, manageTokenHash: manage.hash } } : {}),
    now,
  }, claim);
  if (!committed) throw new AppError(409, "IDEMPOTENCY_CONFLICT", "请求已由另一次重试接管，请使用相同的键重试。", { retryAfterSeconds: 2 });
  ctx.log.template = template;
  const result = await published(ctx, id);
  return jsonResponse({ ...result, ...(manage ? { manageToken: manage.token } : {}), meta: publicationMeta(ctx.requestId) }, 201, { Location: result.url });
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
    { apiKeyId: requireApiKey(ctx).id },
    decodeCursor(url.searchParams.get("cursor")),
    pageSize(url),
  );
  const body: NoteListResponse = { items: rows.map((row) => toSummary(row, ctx.origin)), nextCursor };
  return jsonResponse(body);
}

// ---------- GET / PATCH / DELETE /api/v1/notes/:id ----------

export async function handleGetNoteV1(ctx: RouteContext): Promise<Response> {
  requireApiKey(ctx);
  return jsonResponse(await published(ctx, ctx.params.id, await publisherOf(ctx)));
}

export async function handlePatchNote(ctx: RouteContext): Promise<Response> {
  const apiKey = requireApiKey(ctx);
  const raw = await readJsonBody(ctx.request, 4_096);
  const visibility = (raw as Record<string, unknown> | null)?.visibility;
  if (!isOneOf(VISIBILITIES, visibility)) throw invalid("目前只支持修改 visibility（public 或 unlisted）。");
  const changed = await updateVisibility(db(ctx), ctx.params.id, apiKey.id, visibility, Date.now());
  if (!changed) throw new AppError(404, "NOT_FOUND", "笔记不存在。");
  return jsonResponse(await published(ctx, ctx.params.id, await publisherOf(ctx)));
}

export async function handleDeleteNote(ctx: RouteContext): Promise<Response> {
  if (ctx.apiKey) {
    const row = await deleteNote(db(ctx), ctx.params.id, ctx.apiKey.id);
    if (!row) throw new AppError(404, "NOT_FOUND", "笔记不存在。");
    return new Response(null, { status: 204 });
  }
  const token = ctx.request.headers.get(MANAGE_TOKEN_HEADER)?.trim();
  if (!token) throw new AppError(401, "UNAUTHORIZED", `删除笔记需要在 ${MANAGE_TOKEN_HEADER} 头中提供发布时返回的 manageToken。`);
  if (!(await deleteAnonymousNote(db(ctx), ctx.params.id, await sha256Hex(token)))) {
    throw new AppError(404, "NOT_FOUND", "笔记不存在，或 manageToken 不正确。");
  }
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
