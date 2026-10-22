import type { NoteVisibility, PublishedNote, PublishedNoteSummary } from "../shared/api.ts";
import { normalizeDoodleSpec, type DoodleSpec } from "../shared/doodle.ts";
import { normalizeNoteStructure, type NoteStructure } from "../shared/note.ts";
import { sanitizeSettings, type Settings } from "../shared/settings.ts";
import { normalizeStickers, type StickerItem } from "../shared/stickers.ts";

/** D1 数据访问层。所有读取到的 JSON 都会再次规范化，保证即使库中数据异常也不会把非法内容交给前端。 */

export type ApiKeyRecord = { id: string; name: string; revokedAt: number | null };

export type NoteRow = {
  id: string;
  api_key_id: string;
  visibility: NoteVisibility;
  title: string;
  summary: string;
  language: "zh" | "en";
  template: string;
  layout: string;
  note_json: string;
  settings_json: string;
  stickers_json: string;
  doodle_json: string | null;
  created_at: number;
  updated_at: number;
};

export type NewNote = {
  id: string;
  apiKeyId: string;
  visibility: NoteVisibility;
  language: "zh" | "en";
  template: string;
  note: NoteStructure;
  settings: Settings;
  stickers: StickerItem[];
  doodle?: DoodleSpec;
  now: number;
};

const SUMMARY_COLUMNS =
  "id, api_key_id, visibility, title, summary, language, template, layout, created_at, updated_at";

/** 128 位随机数编码为 22 位 base64url，作为不可枚举的笔记 ID。 */
export function newNoteId(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function isNoteId(value: string): boolean {
  return /^[A-Za-z0-9_-]{22}$/.test(value);
}

export async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export async function findApiKey(db: D1Database, key: string): Promise<ApiKeyRecord | null> {
  const row = await db
    .prepare("SELECT id, name, revoked_at FROM api_keys WHERE key_hash = ?")
    .bind(await sha256Hex(key))
    .first<{ id: string; name: string; revoked_at: number | null }>();
  return row ? { id: row.id, name: row.name, revokedAt: row.revoked_at } : null;
}

export async function touchApiKey(db: D1Database, id: string, now: number): Promise<void> {
  await db.prepare("UPDATE api_keys SET last_used_at = ? WHERE id = ?").bind(now, id).run();
}

function noteSummaryText(note: NoteStructure): string {
  const text = note.summary || note.sections[0]?.content || "";
  const chars = Array.from(text.replace(/\s+/g, " ").trim());
  return chars.length > 140 ? `${chars.slice(0, 139).join("")}…` : chars.join("");
}

export async function insertNote(db: D1Database, input: NewNote): Promise<void> {
  await db
    .prepare(
      `INSERT INTO notes (id, api_key_id, visibility, title, summary, language, template, layout, note_json, settings_json,
        stickers_json, doodle_json, image_status, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      input.id,
      input.apiKeyId,
      input.visibility,
      input.note.title,
      noteSummaryText(input.note),
      input.language,
      input.template,
      input.settings.layout,
      JSON.stringify(input.note),
      JSON.stringify(input.settings),
      JSON.stringify(input.stickers),
      input.doodle ? JSON.stringify(input.doodle) : null,
      // 预览图功能已移除，保留列以兼容已有数据库，统一写入 disabled
      "disabled",
      input.now,
      input.now,
    )
    .run();
}

export async function getNoteRow(db: D1Database, id: string): Promise<NoteRow | null> {
  return db.prepare("SELECT * FROM notes WHERE id = ?").bind(id).first<NoteRow>();
}

export async function updateVisibility(db: D1Database, id: string, apiKeyId: string, visibility: NoteVisibility, now: number): Promise<boolean> {
  const result = await db
    .prepare("UPDATE notes SET visibility = ?, updated_at = ? WHERE id = ? AND api_key_id = ?")
    .bind(visibility, now, id, apiKeyId)
    .run();
  return (result.meta.changes ?? 0) > 0;
}

export async function deleteNote(db: D1Database, id: string, apiKeyId: string): Promise<NoteRow | null> {
  const row = await db.prepare("SELECT * FROM notes WHERE id = ? AND api_key_id = ?").bind(id, apiKeyId).first<NoteRow>();
  if (!row) return null;
  await db.batch([
    db.prepare("DELETE FROM notes WHERE id = ?").bind(id),
    db.prepare("DELETE FROM idempotency_keys WHERE note_id = ?").bind(id),
  ]);
  return row;
}

// ---------- 分页 ----------

export type Cursor = { createdAt: number; id: string };

export function encodeCursor(row: { created_at: number; id: string }): string {
  return btoa(`${row.created_at}:${row.id}`).replace(/=+$/, "");
}

export function decodeCursor(value: string | null): Cursor | null {
  if (!value) return null;
  try {
    const [created, id] = atob(value).split(":");
    const createdAt = Number(created);
    return Number.isSafeInteger(createdAt) && id && isNoteId(id) ? { createdAt, id } : null;
  } catch {
    return null;
  }
}

export async function listNotes(
  db: D1Database,
  filter: { visibility?: "public"; apiKeyId?: string; template?: string; language?: string },
  cursor: Cursor | null,
  limit: number,
): Promise<{ rows: NoteRow[]; nextCursor: string | null }> {
  const where: string[] = [];
  const params: unknown[] = [];
  if (filter.visibility) {
    where.push("visibility = ?");
    params.push(filter.visibility);
  }
  if (filter.apiKeyId) {
    where.push("api_key_id = ?");
    params.push(filter.apiKeyId);
  }
  if (filter.template) {
    where.push("template = ?");
    params.push(filter.template);
  }
  if (filter.language) {
    where.push("language = ?");
    params.push(filter.language);
  }
  if (cursor) {
    where.push("(created_at < ? OR (created_at = ? AND id < ?))");
    params.push(cursor.createdAt, cursor.createdAt, cursor.id);
  }
  const sql = `SELECT ${SUMMARY_COLUMNS} FROM notes ${where.length ? `WHERE ${where.join(" AND ")}` : ""}
    ORDER BY created_at DESC, id DESC LIMIT ?`;
  const { results } = await db.prepare(sql).bind(...params, limit + 1).all<NoteRow>();
  const rows = results.slice(0, limit);
  return { rows, nextCursor: results.length > limit ? encodeCursor(rows[rows.length - 1]) : null };
}

/** 站点地图用：最近的公开笔记 id 与更新时间。 */
export async function listPublicNoteDates(db: D1Database, limit: number): Promise<Array<{ id: string; updatedAt: string }>> {
  const { results } = await db
    .prepare("SELECT id, updated_at FROM notes WHERE visibility = 'public' ORDER BY created_at DESC, id DESC LIMIT ?")
    .bind(limit)
    .all<{ id: string; updated_at: number }>();
  return results.map((row) => ({ id: row.id, updatedAt: iso(row.updated_at) }));
}

// ---------- 幂等 ----------

export async function findIdempotent(db: D1Database, apiKeyId: string, key: string): Promise<{ noteId: string; requestHash: string } | null> {
  const row = await db
    .prepare("SELECT note_id, request_hash FROM idempotency_keys WHERE api_key_id = ? AND idempotency_key = ?")
    .bind(apiKeyId, key)
    .first<{ note_id: string; request_hash: string }>();
  return row ? { noteId: row.note_id, requestHash: row.request_hash } : null;
}

export async function saveIdempotent(db: D1Database, apiKeyId: string, key: string, requestHash: string, noteId: string, now: number): Promise<void> {
  await db
    .prepare("INSERT OR IGNORE INTO idempotency_keys (api_key_id, idempotency_key, request_hash, note_id, created_at) VALUES (?, ?, ?, ?, ?)")
    .bind(apiKeyId, key, requestHash, noteId, now)
    .run();
}

// ---------- 输出 ----------

function iso(ms: number): string {
  return new Date(ms).toISOString();
}

export function toSummary(row: NoteRow, origin: string): PublishedNoteSummary {
  return {
    id: row.id,
    url: `${origin}/n/${row.id}`,
    title: row.title,
    summary: row.summary,
    language: row.language,
    template: row.template,
    layout: row.layout,
    visibility: row.visibility,
    createdAt: iso(row.created_at),
    updatedAt: iso(row.updated_at),
  };
}

function parseJson(text: string | null): unknown {
  if (!text) return undefined;
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

export function toPublished(row: NoteRow, origin: string): PublishedNote | null {
  const note = normalizeNoteStructure(parseJson(row.note_json));
  if (!note.ok) return null;
  const doodle = normalizeDoodleSpec(parseJson(row.doodle_json));
  return {
    ...toSummary(row, origin),
    note: note.value,
    settings: sanitizeSettings(parseJson(row.settings_json)),
    stickers: normalizeStickers(parseJson(row.stickers_json)),
    ...(doodle.ok ? { doodle: doodle.value } : {}),
  };
}
