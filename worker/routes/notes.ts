import type { NoteListResponse, NoteVisibility, PublishedNote } from "../../shared/api.ts";
import { normalizeDoodleSpec, type DoodleSpec } from "../../shared/doodle.ts";
import { normalizeNoteStructure, type NoteStructure } from "../../shared/note.ts";
import { isOneOf, STYLES, TEMPLATES, type Template } from "../../shared/options.ts";
import { DEFAULT_SETTINGS, sanitizeSettings, type Settings } from "../../shared/settings.ts";
import { normalizeStickers } from "../../shared/stickers.ts";
import { detectLanguage } from "../../shared/text.ts";
import { AppError, jsonResponse, readJsonBody } from "../http.ts";
import type { RouteContext } from "../router.ts";
import {
  decodeCursor,
  deleteNote,
  findIdempotent,
  getNoteRow,
  insertNote,
  listNotes,
  newNoteId,
  saveIdempotent,
  sha256Hex,
  toPublished,
  toSummary,
  updateVisibility,
} from "../store.ts";
import { generateNoteFromText, validateStructureRequest } from "./structure.ts";

const VISIBILITIES = ["public", "unlisted"] as const;
const MAX_PAGE_SIZE = 50;

function db(ctx: RouteContext): D1Database {
  if (!ctx.env.DB) throw new AppError(503, "STORAGE_UNAVAILABLE", "存储未配置，暂时无法读取或发布笔记。");
  return ctx.env.DB;
}

function invalid(message: string): AppError {
  return new AppError(400, "INVALID_REQUEST", message);
}

/**
 * 校验 API 传入的外观设置。与本地设置的宽松回退不同，这里对未知字段和无效取值直接报错，
 * 让调用方（通常是 AI agent）能立即发现拼写错误。数值超出范围时钳制到合法区间。
 */
export function validateAppearance(input: unknown, fallbackLayout?: string): Settings {
  if (input !== undefined && (input === null || typeof input !== "object" || Array.isArray(input))) {
    throw invalid("appearance 必须是对象。");
  }
  const raw = { ...((input as Record<string, unknown> | undefined) ?? {}) };
  if (raw.layout === undefined && fallbackLayout) raw.layout = fallbackLayout;
  const known = Object.keys(DEFAULT_SETTINGS);
  const unknown = Object.keys(raw).filter((key) => !known.includes(key));
  if (unknown.length > 0) throw invalid(`appearance 包含未知字段：${unknown.join(", ")}。可用字段：${known.join(", ")}。`);
  const settings = sanitizeSettings({ ...DEFAULT_SETTINGS, seed: Math.floor(Math.random() * 100_000), ...raw });
  for (const [key, value] of Object.entries(raw)) {
    const sanitized = settings[key as keyof Settings];
    if (typeof sanitized === "string" && sanitized !== value) {
      throw invalid(`appearance.${key} 的取值 ${JSON.stringify(value)} 无效。`);
    }
    if (typeof sanitized === "number" && typeof value !== "number") {
      throw invalid(`appearance.${key} 必须是数字。`);
    }
  }
  return settings;
}

/** 原文没有日期时，以发布时间（按配置的时区）作为笔记日期。 */
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

async function published(ctx: RouteContext, id: string, apiKeyId?: string): Promise<PublishedNote> {
  const row = ownedRowOr404(await getNoteRow(db(ctx), id));
  if (apiKeyId && row.api_key_id !== apiKeyId) throw new AppError(404, "NOT_FOUND", "笔记不存在。");
  const note = toPublished(row, ctx.origin);
  if (!note) throw new AppError(500, "INTERNAL_ERROR", "笔记数据已损坏。");
  return note;
}

// ---------- POST /api/v1/notes ----------

export async function handleCreateNote(ctx: RouteContext): Promise<Response> {
  const database = db(ctx);
  const apiKey = ctx.apiKey!;
  const raw = await readJsonBody(ctx.request, ctx.config.maxBodyBytes);
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw invalid("请求体必须是 JSON 对象。");
  const body = raw as Record<string, unknown>;

  const idempotencyKey = ctx.request.headers.get("Idempotency-Key")?.trim();
  if (idempotencyKey !== undefined && !/^[\w.:-]{1,100}$/.test(idempotencyKey)) {
    throw invalid("Idempotency-Key 只能包含字母、数字和 _ . : -，长度不超过 100。");
  }
  const requestHash = await sha256Hex(JSON.stringify(body));
  if (idempotencyKey) {
    const existing = await findIdempotent(database, apiKey.id, idempotencyKey);
    if (existing) {
      if (existing.requestHash !== requestHash) {
        throw new AppError(409, "IDEMPOTENCY_CONFLICT", "该 Idempotency-Key 已用于内容不同的请求。");
      }
      const note = await published(ctx, existing.noteId, apiKey.id).catch(() => null);
      if (note) return jsonResponse({ ...note, meta: { requestId: ctx.requestId, replayed: true } }, 200, { "Idempotent-Replayed": "true" });
    }
  }

  const hasText = body.text !== undefined;
  const hasNote = body.note !== undefined;
  if (hasText === hasNote) throw invalid("请提供 text（原文，由服务整理）或 note（已整理好的 NoteStructure）其中之一。");

  const visibility = body.visibility ?? "unlisted";
  if (!isOneOf(VISIBILITIES, visibility)) throw invalid("visibility 只能是 public 或 unlisted。");
  if (body.style !== undefined && !isOneOf(STYLES, body.style)) throw invalid(`style 取值无效，可选值：${STYLES.join(", ")}。`);
  const settings = validateAppearance(body.appearance, body.style as string | undefined);
  const stickers = normalizeStickers(body.stickers);

  let doodle: DoodleSpec | undefined;
  if (body.doodle !== undefined) {
    const result = normalizeDoodleSpec(body.doodle);
    if (!result.ok) throw invalid(`doodle 无效：${result.errors.join("；")}`);
    doodle = result.value;
  }

  let note: NoteStructure;
  let template: Template;
  let meta: Record<string, unknown> = {};
  if (hasText) {
    const input = validateStructureRequest({ ...body, style: settings.layout }, ctx.config.maxInputChars);
    const generated = await generateNoteFromText(ctx, input);
    note = generated.note;
    template = input.template;
    meta = { model: generated.model, attempts: generated.attempts, warnings: generated.warnings };
  } else {
    const result = normalizeNoteStructure(body.note);
    if (!result.ok) throw invalid(`note 不符合 NoteStructure：${result.errors.join("；")}`);
    note = result.value;
    template = isOneOf(TEMPLATES, body.template) ? body.template : "general";
    meta = { warnings: result.warnings };
  }

  const language = noteLanguage(note);
  note = withDate(note, language, ctx.config.defaultTimezone);
  const id = newNoteId();
  const now = Date.now();
  await insertNote(database, {
    id,
    apiKeyId: apiKey.id,
    visibility: visibility as NoteVisibility,
    language,
    template,
    note,
    settings,
    stickers,
    doodle,
    now,
  });
  if (idempotencyKey) await saveIdempotent(database, apiKey.id, idempotencyKey, requestHash, id, now);
  ctx.log.template = template;
  const result = await published(ctx, id);
  return jsonResponse({ ...result, meta: { requestId: ctx.requestId, ...meta } }, 201, { Location: result.url });
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
