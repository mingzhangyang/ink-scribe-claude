import { createHash } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Env } from "../worker/env.ts";
import { resetMemoryRateLimit } from "../worker/rate-limit.ts";
import { handleApi } from "../worker/router.ts";
import * as noteStore from "../worker/store.ts";
import { claimPublish, insertNote, releasePublish } from "../worker/store.ts";
import { DEFAULT_SETTINGS } from "../shared/settings.ts";
import { createTestD1 } from "./helpers/d1.ts";

const KEY = "isk_test_key_owner";
const OTHER_KEY = "isk_test_key_other";
const REVOKED_KEY = "isk_test_key_revoked";

const aiNote = {
  title: "整理后的标题",
  cues: [{ keyword: "要点", note: "说明" }],
  sections: [{ heading: "小节", content: "整理后的正文内容。", highlights: ["正文"] }],
  summary: "总结",
  doodlePrompt: "一本书",
  doodleTheme: "book" as const,
};

const publication = (overrides: Record<string, unknown> = {}) => ({ schemaVersion: 1, note: aiNote, ...overrides });

const sha = (value: string) => createHash("sha256").update(value).digest("hex");

let env: Env;

async function seedKeys(db: D1Database) {
  const insert = "INSERT INTO api_keys (id, name, key_hash, created_at, revoked_at) VALUES (?, ?, ?, ?, ?)";
  await db.prepare(insert).bind("key_owner", "owner", sha(KEY), 1, null).run();
  await db.prepare(insert).bind("key_other", "other", sha(OTHER_KEY), 1, null).run();
  await db.prepare(insert).bind("key_revoked", "revoked", sha(REVOKED_KEY), 1, 2).run();
}

function request(method: string, path: string, options: { body?: unknown; key?: string | null; headers?: Record<string, string> } = {}) {
  const headers: Record<string, string> = { "CF-Connecting-IP": "203.0.113.9", ...options.headers };
  if (options.key !== null) headers.Authorization = `Bearer ${options.key ?? KEY}`;
  if (options.body !== undefined) headers["Content-Type"] = "application/json";
  return new Request(`https://notes.example${path}`, {
    method,
    headers,
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  });
}

async function call(req: Request) {
  const response = await handleApi(req, env, () => {});
  const text = await response.text();
  return { response, body: text ? (JSON.parse(text) as Record<string, any>) : null };
}

beforeEach(async () => {
  resetMemoryRateLimit();
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
  const db = createTestD1();
  await seedKeys(db);
  env = {
    AI: { run: vi.fn(async () => ({ response: aiNote })) } as unknown as Ai,
    DB: db,
    AI_TIMEOUT_MS: "5000",
  };
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("API key authentication", () => {
  it("rejects missing, unknown and revoked keys", async () => {
    for (const key of [null, "isk_unknown", REVOKED_KEY]) {
      const { response, body } = await call(request("GET", "/api/v1/notes", { key }));
      expect(response.status).toBe(401);
      expect(body!.error.code).toBe("UNAUTHORIZED");
      expect(response.headers.get("WWW-Authenticate")).toBe("Bearer");
    }
  });

  it("reports missing storage clearly", async () => {
    env.DB = undefined;
    const { response, body } = await call(request("GET", "/api/v1/notes"));
    expect(response.status).toBe(503);
    expect(body!.error.code).toBe("STORAGE_UNAVAILABLE");
  });
});

describe("POST /api/v1/notes", () => {
  it("publishes prepared content without original text or any model call", async () => {
    const { response, body } = await call(request("POST", "/api/v1/notes", {
      body: publication({ template: "reading-notes", appearance: { paper: "kraft", ink: "brown" } }),
    }));
    expect(response.status).toBe(201);
    expect(body!.id).toMatch(/^[A-Za-z0-9_-]{22}$/);
    expect(body!.url).toBe(`https://notes.example/n/${body!.id}`);
    expect(response.headers.get("Location")).toBe(body!.url);
    expect(body!.schemaVersion).toBe(1);
    expect(body!.visibility).toBe("unlisted");
    expect(body!.template).toBe("reading-notes");
    expect(body!.note).toEqual({ ...aiNote, date: expect.any(String) });
    expect(body!.settings).toMatchObject({ paper: "kraft", ink: "brown", layout: "hybrid-cornell", overflow: "expand" });
    expect(body!.meta).toMatchObject({ processing: "agent", validation: { structure: "passed", layout: "not_checked" } });
    expect(body).not.toHaveProperty("image");
    expect(body).not.toHaveProperty("text");
    expect(body!.meta).not.toHaveProperty("model");
    expect(env.AI.run).not.toHaveBeenCalled();
  });

  it("preserves valid text, highlight casing and drawings through storage and public reads", async () => {
    const note = { ...aiNote, title: "Exact Note", date: "2026-10-23", doodleTheme: undefined,
      sections: [{ content: "Keep JavaScript and <Type> intact.", highlights: ["javascript"] }],
      doodleSpec: { concept: "circle", elements: [
        { type: "circle", cx: 50, cy: 50, r: 10, stroke: "ink", fill: "none", width: 2 },
      ] },
    };
    const stickers = [{ id: "star-1", type: "star", x: 700, y: 90, rotation: 12.3, scale: 0.75, variant: "gold" }];
    const { response, body } = await call(request("POST", "/api/v1/notes", {
      body: publication({ note, stickers, appearance: { seed: 42, overflow: "error" } }),
    }));
    expect(response.status).toBe(201);
    const expectedNote = JSON.parse(JSON.stringify(note));
    expect(body!.note).toEqual(expectedNote);
    expect(body!.stickers).toEqual(stickers);
    expect(body!.settings).toMatchObject({ seed: 42, overflow: "error" });
    const read = await call(request("GET", `/api/notes/${body!.id}`, { key: null }));
    expect(read.body!.note).toEqual(expectedNote);
    expect(read.body!.stickers).toEqual(stickers);
    expect(read.body).not.toHaveProperty("text");
    const stored = await env.DB!.prepare("SELECT note_json, schema_version FROM notes WHERE id = ?")
      .bind(body!.id).first<{ note_json: string; schema_version: number }>();
    expect(JSON.parse(stored!.note_json)).toEqual(expectedNote);
    expect(stored!.schema_version).toBe(1);
    expect(env.AI.run).not.toHaveBeenCalled();
  });

  it("rejects missing, unknown and lossy fields with actionable paths and no writes", async () => {
    const cases: Array<[unknown, string]> = [
      [{}, "schemaVersion"],
      [{ schemaVersion: 1 }, "note"],
      [{ note: aiNote }, "schemaVersion"],
      [publication({ text: "private source" }), "text"],
      [publication({ appearance: { papr: "kraft" } }), "appearance.papr"],
      [publication({ appearance: { paper: "neon" } }), "appearance.paper"],
      [publication({ appearance: { fontSize: 100 } }), "appearance.fontSize"],
      [publication({ visibility: "secret" }), "visibility"],
      [publication({ note: { ...aiNote, title: "<b>title</b>" } }), "note.title"],
      [publication({ note: { ...aiNote, sections: [{ content: "a".repeat(901), highlights: [] }] } }), "note.sections[0].content"],
      [publication({ note: { ...aiNote, sections: [{ content: "正文", highlights: ["missing"] }] } }), "note.sections[0].highlights[0]"],
      [publication({ doodle: { elements: [] } }), "doodle"],
    ];
    for (const [body, path] of cases) {
      const result = await call(request("POST", "/api/v1/notes", { body }));
      expect(result.response.status, JSON.stringify(body)).toBe(422);
      expect(result.body!.error.code).toBe("VALIDATION_FAILED");
      expect(result.body!.error.issues).toEqual(expect.arrayContaining([expect.objectContaining({ path })]));
      expect(JSON.stringify(result.body)).not.toContain("private source");
    }
    expect((await env.DB!.prepare("SELECT count(*) AS n FROM notes").first<{ n: number }>())!.n).toBe(0);
    expect(env.AI.run).not.toHaveBeenCalled();
  });

  it("rejects malformed UTF-8 instead of replacing submitted characters", async () => {
    const bytes = new TextEncoder().encode(JSON.stringify(publication({ note: { ...aiNote, title: "marker" } })));
    const marker = new TextEncoder().encode("marker");
    const position = bytes.findIndex((_, index) => marker.every((byte, offset) => bytes[index + offset] === byte));
    bytes[position] = 0xff;
    const { response, body } = await call(new Request("https://notes.example/api/v1/notes", {
      method: "POST", headers: { Authorization: `Bearer ${KEY}`, "Content-Type": "application/json" }, body: bytes,
    }));
    expect(response.status).toBe(400);
    expect(body!.error.code).toBe("INVALID_JSON");
    expect((await env.DB!.prepare("SELECT count(*) AS n FROM notes").first<{ n: number }>())!.n).toBe(0);
    expect(env.AI.run).not.toHaveBeenCalled();
  });

  it("does not persist rejected original text in notes, reservations or logs", async () => {
    const source = "private source marker that must never be echoed";
    const { response, body } = await call(request("POST", "/api/v1/notes", {
      body: publication({ text: source }), headers: { "Idempotency-Key": "reject-source" },
    }));
    expect(response.status).toBe(422);
    expect(JSON.stringify(body)).not.toContain(source);
    expect((await env.DB!.prepare("SELECT count(*) AS n FROM notes").first<{ n: number }>())!.n).toBe(0);
    // Validation precedes the reservation, so a rejected request does not bind its key.
    expect(await env.DB!.prepare("SELECT * FROM idempotency_keys WHERE idempotency_key = 'reject-source'").first()).toBeNull();
    expect(JSON.stringify(vi.mocked(console.log).mock.calls)).not.toContain(source);
    expect(JSON.stringify(vi.mocked(console.error).mock.calls)).not.toContain(source);
  });

  it("replays idempotent requests and rejects reused keys with different bodies", async () => {
    const body = publication();
    const first = await call(request("POST", "/api/v1/notes", { body, headers: { "Idempotency-Key": "daily-1" } }));
    const replay = await call(request("POST", "/api/v1/notes", { body, headers: { "Idempotency-Key": "daily-1" } }));
    expect(first.response.status).toBe(201);
    expect(replay.response.status).toBe(200);
    expect(replay.response.headers.get("Idempotent-Replayed")).toBe("true");
    expect(replay.body!.id).toBe(first.body!.id);
    const conflict = await call(request("POST", "/api/v1/notes", { body: publication({ note: { ...aiNote, title: "别的" } }), headers: { "Idempotency-Key": "daily-1" } }));
    expect(conflict.response.status).toBe(409);
    expect(conflict.body!.error.code).toBe("IDEMPOTENCY_CONFLICT");
    // 同一个键在另一个密钥下互不影响
    const other = await call(request("POST", "/api/v1/notes", { body, key: OTHER_KEY, headers: { "Idempotency-Key": "daily-1" } }));
    expect(other.response.status).toBe(201);
    expect(other.body!.id).not.toBe(first.body!.id);
  });

  it("reserves concurrent agent requests before writing and replays one committed result", async () => {
    let finish!: () => void;
    let started!: () => void;
    const entered = new Promise<void>((resolve) => { started = resolve; });
    const pending = new Promise<void>((resolve) => { finish = resolve; });
    const originalInsert = noteStore.insertNote;
    vi.spyOn(noteStore, "insertNote").mockImplementationOnce(async (...args) => {
      started();
      await pending;
      return originalInsert(...args);
    });
    const options = { body: publication(), headers: { "Idempotency-Key": "parallel" } };
    const first = call(request("POST", "/api/v1/notes", options));
    await entered;
    const duplicate = await call(request("POST", "/api/v1/notes", options));
    expect(duplicate.response.status).toBe(409);
    expect(duplicate.response.headers.get("Retry-After")).toBe("2");
    expect(env.AI.run).not.toHaveBeenCalled();
    finish();
    const created = await first;
    const replay = await call(request("POST", "/api/v1/notes", options));
    expect(created.response.status).toBe(201);
    expect(replay.body!.id).toBe(created.body!.id);
    expect(replay.body!.note).toEqual(created.body!.note);
    expect(replay.body!.settings).toEqual(created.body!.settings);
    expect((await env.DB!.prepare("SELECT count(*) AS n FROM notes").first<{ n: number }>())!.n).toBe(1);
  });

  it("does not resurrect deleted notes on delayed retries", async () => {
    const options = { body: publication(), headers: { "Idempotency-Key": "deleted" } };
    const created = await call(request("POST", "/api/v1/notes", options));
    await call(request("DELETE", `/api/v1/notes/${created.body!.id}`));
    const replay = await call(request("POST", "/api/v1/notes", options));
    expect(replay.response.status).toBe(410);
    expect((await env.DB!.prepare("SELECT count(*) AS n FROM notes").first<{ n: number }>())!.n).toBe(0);
  });

  it("uses one replay snapshot when deletion races the read", async () => {
    const options = { body: publication(), headers: { "Idempotency-Key": "delete-race" } };
    const created = await call(request("POST", "/api/v1/notes", options));
    const original = noteStore.getNoteRow;
    const spy = vi.spyOn(noteStore, "getNoteRow").mockImplementation(async (db, id) => {
      const row = await original(db, id);
      await db.prepare("DELETE FROM notes WHERE id = ?").bind(id).run();
      return row;
    });
    const replay = await call(request("POST", "/api/v1/notes", options));
    expect(spy).toHaveBeenCalledTimes(1);
    expect(replay.response.status).toBe(200);
    expect(replay.body!.id).toBe(created.body!.id);
    spy.mockRestore();
    expect((await call(request("POST", "/api/v1/notes", options))).response.status).toBe(410);
  });

  it("rolls back failed commits and allows a same-key retry", async () => {
    await env.DB!.exec("CREATE TRIGGER fail_commit BEFORE UPDATE OF state ON idempotency_keys WHEN NEW.state = 'completed' BEGIN SELECT RAISE(ABORT, 'injected failure'); END;");
    const options = { body: publication(), headers: { "Idempotency-Key": "retry" } };
    expect((await call(request("POST", "/api/v1/notes", options))).response.status).toBe(500);
    expect((await env.DB!.prepare("SELECT count(*) AS n FROM notes").first<{ n: number }>())!.n).toBe(0);
    await env.DB!.exec("DROP TRIGGER fail_commit;");
    expect((await call(request("POST", "/api/v1/notes", options))).response.status).toBe(201);
  });

});

describe("POST /api/v1/notes/validate", () => {
  it("shares strict validation without creating notes, reservations or invoking AI", async () => {
    const { response, body } = await call(request("POST", "/api/v1/notes/validate", {
      body: publication(), headers: { "Idempotency-Key": "preflight" },
    }));
    expect(response.status).toBe(200);
    expect(body).toEqual({ valid: true, schemaVersion: 1, validation: { structure: "passed", layout: "not_checked" } });
    expect((await env.DB!.prepare("SELECT count(*) AS n FROM notes").first<{ n: number }>())!.n).toBe(0);
    expect((await env.DB!.prepare("SELECT count(*) AS n FROM idempotency_keys").first<{ n: number }>())!.n).toBe(0);
    const invalid = publication({ note: { ...aiNote, sections: [] } });
    const preflight = await call(request("POST", "/api/v1/notes/validate", { body: invalid }));
    const publish = await call(request("POST", "/api/v1/notes", { body: invalid }));
    expect(preflight.response.status).toBe(422);
    expect(preflight.body!.error.issues).toEqual(publish.body!.error.issues);
    expect(env.AI.run).not.toHaveBeenCalled();
  });

  it("rejects invalid keys and applies the publisher's rate limit", async () => {
    expect((await call(request("POST", "/api/v1/notes/validate", { key: "isk_unknown", body: publication() }))).response.status).toBe(401);
    env.API_RATE_LIMIT_PER_MINUTE = "1";
    expect((await call(request("POST", "/api/v1/notes/validate", { body: publication() }))).response.status).toBe(200);
    expect((await call(request("POST", "/api/v1/notes", { body: publication() }))).response.status).toBe(429);
  });

  it.each([null, [], 42])("returns the same field errors for a non-object JSON body: %j", async (body) => {
    const preflight = await call(request("POST", "/api/v1/notes/validate", { body }));
    const publish = await call(request("POST", "/api/v1/notes", { body }));
    expect(preflight.response.status).toBe(422);
    expect(publish.response.status).toBe(422);
    expect(publish.body!.error.code).toBe("VALIDATION_FAILED");
    expect(publish.body!.error.issues).toEqual([{ path: "$", code: "INVALID_TYPE", message: "Expected an object." }]);
    expect(preflight.body!.error.issues).toEqual(publish.body!.error.issues);
  });
});

describe("reading, gallery and management", () => {
  async function create(visibility: "public" | "unlisted", key = KEY, title = "标题") {
    const { body } = await call(request("POST", "/api/v1/notes", { key, body: publication({ note: { ...aiNote, title }, visibility }) }));
    return body!;
  }

  it("keeps legacy illustrations readable and completed requests replayable", async () => {
    const legacyRequest = { text: "previous source" };
    const reservation = await claimPublish(env.DB!, "key_owner", "legacy-request", sha(JSON.stringify(legacyRequest)), Date.now());
    if (!("claim" in reservation)) throw new Error("Expected a legacy reservation");
    const id = reservation.claim.noteId;
    const doodle = { concept: "legacy circle", elements: [
      { type: "circle" as const, cx: 50, cy: 50, r: 10, stroke: "ink" as const, fill: "none" as const, width: 2 },
    ] };
    await insertNote(env.DB!, {
      id, schemaVersion: 0, apiKeyId: "key_owner", visibility: "unlisted", language: "zh", template: "general",
      note: aiNote, settings: { ...DEFAULT_SETTINGS, doodleMode: "ai" }, stickers: [], doodle, now: Date.now(),
    }, reservation.claim);
    const { response, body } = await call(request("GET", `/api/notes/${id}`, { key: null }));
    expect(response.status).toBe(200);
    expect(body!.schemaVersion).toBe(0);
    expect(body!.settings.doodleMode).toBe("ai");
    expect(body!.doodle).toEqual(doodle);
    expect(body!.note).toEqual(aiNote);
    const replay = await call(request("POST", "/api/v1/notes", {
      body: legacyRequest, headers: { "Idempotency-Key": "legacy-request" },
    }));
    expect(replay.response.status).toBe(200);
    expect(replay.body!.id).toBe(id);
    expect(replay.body!.schemaVersion).toBe(0);
    expect(replay.body!.meta.replayed).toBe(true);
    expect(replay.body!.meta).not.toHaveProperty("processing");
    expect(replay.body!.meta).not.toHaveProperty("validation");
    expect(replay.body).not.toHaveProperty("text");
    expect(env.AI.run).not.toHaveBeenCalled();
  });

  it("serves version 1 snapshots that fail a stricter contract normalized, without rewriting storage", async () => {
    const note = await create("unlisted");
    const corruptNote = { ...note.note, sections: [{ content: "x".repeat(901), highlights: [] }] };
    await env.DB!.prepare("UPDATE notes SET note_json = ? WHERE id = ?")
      .bind(JSON.stringify(corruptNote), note.id).run();
    const read = await call(request("GET", `/api/notes/${note.id}`, { key: null }));
    expect(read.response.status).toBe(200);
    expect(read.body!.schemaVersion).toBe(0);
    expect(read.body!.note.sections[0].content).toBe(`${"x".repeat(899)}…`);
    const stored = await env.DB!.prepare("SELECT note_json FROM notes WHERE id = ?")
      .bind(note.id).first<{ note_json: string }>();
    expect(JSON.parse(stored!.note_json)).toEqual(corruptNote);
    // The log names the note and the failing field, never its content.
    const logged = vi.mocked(console.log).mock.calls.map(([line]) => String(line)).find((line) => line.includes("note.snapshot_fallback"));
    expect(JSON.parse(logged!)).toMatchObject({ noteId: note.id, path: "note.sections[0].content", code: "TOO_LONG" });
    expect(logged).not.toContain("xxxx");

    await env.DB!.prepare("UPDATE notes SET note_json = ?, settings_json = ? WHERE id = ?")
      .bind(JSON.stringify(note.note), JSON.stringify({ ...note.settings, doodleMode: "ai" }), note.id).run();
    const legacySettings = await call(request("GET", `/api/v1/notes/${note.id}`));
    expect(legacySettings.response.status).toBe(200);
    expect(legacySettings.body!.schemaVersion).toBe(0);
    expect(legacySettings.body!.settings.doodleMode).toBe("ai");

    await env.DB!.prepare("UPDATE notes SET note_json = ? WHERE id = ?").bind("{}", note.id).run();
    const unreadable = await call(request("GET", `/api/notes/${note.id}`, { key: null }));
    expect(unreadable.response.status).toBe(500);
    expect(unreadable.body!.error.code).toBe("INTERNAL_ERROR");
  });

  // Stored exactly as version 1 publishing wrote it. Keep it frozen: a contract change that stops reading it
  // losslessly needs a migration or a deliberate decision to serve it normalized.
  const FROZEN_V1 = {
    note: '{"title":"间隔重复","date":"2026年10月23日","cues":[{"keyword":"遗忘曲线","note":"不复习就会快速遗忘"}],"sections":[{"heading":"方法","content":"按间隔复习卡片。\\n- 先难后易\\n1. 记录结果","highlights":["间隔","记录结果"]}],"summary":"间隔复习比集中复习更有效。","doodleTheme":"book"}',
    settings: '{"layout":"classic-cornell","paper":"grid","zhFont":"lxgw","enFont":"kalam","fontSize":21,"lineHeight":1.8,"letterSpacing":0.02,"ink":"blue","accent":"yellow","naturalness":0.4,"pageSize":"a4","overflow":"error","doodleMode":"theme","doodleTheme":"book","seed":123456}',
    stickers: '[{"id":"tape-1","type":"tape","x":120,"y":-12,"rotation":-4.5,"scale":1.2,"variant":"mint"}]',
  };

  async function insertSnapshot(id: string, schemaVersion?: 0 | 1) {
    const version = schemaVersion === undefined ? ["", ""] : [", schema_version", `, ${schemaVersion}`];
    await env.DB!.prepare(`INSERT INTO notes (id, api_key_id, visibility, title, summary, language, template, layout,
      note_json, settings_json, stickers_json, doodle_json, image_status, created_at, updated_at${version[0]})
      VALUES (?, 'key_owner', 'unlisted', '间隔重复', '间隔复习比集中复习更有效。', 'zh', 'general', 'classic-cornell',
      ?, ?, ?, NULL, 'disabled', 1, 1${version[1]})`)
      .bind(id, FROZEN_V1.note, FROZEN_V1.settings, FROZEN_V1.stickers).run();
  }

  it("reads a frozen version 1 snapshot losslessly, giving settings added later their defaults", async () => {
    const id = noteStore.newNoteId();
    await insertSnapshot(id, 1);
    const read = await call(request("GET", `/api/notes/${id}`, { key: null }));
    expect(read.response.status).toBe(200);
    expect(read.body!.schemaVersion).toBe(1);
    expect(read.body!.note).toEqual(JSON.parse(FROZEN_V1.note));
    expect(read.body!.settings).toEqual(JSON.parse(FROZEN_V1.settings));
    expect(read.body!.stickers).toEqual(JSON.parse(FROZEN_V1.stickers));

    // Written before `overflow` existed: still lossless, and the new setting takes its default.
    const { overflow: _, ...earlier } = JSON.parse(FROZEN_V1.settings);
    await env.DB!.prepare("UPDATE notes SET settings_json = ? WHERE id = ?").bind(JSON.stringify(earlier), id).run();
    const older = await call(request("GET", `/api/notes/${id}`, { key: null }));
    expect(older.body!.schemaVersion).toBe(1);
    expect(older.body!.settings).toEqual({ ...earlier, overflow: DEFAULT_SETTINGS.overflow });
  });

  it("keeps existing notes readable when the Worker is deployed before migration 0003", async () => {
    await env.DB!.prepare("ALTER TABLE notes DROP COLUMN schema_version").run();
    const id = noteStore.newNoteId();
    await insertSnapshot(id);
    const read = await call(request("GET", `/api/notes/${id}`, { key: null }));
    expect(read.response.status).toBe(200);
    expect(read.body!.schemaVersion).toBe(0);
    expect(read.body!.note.title).toBe("间隔重复");
  });

  it("serves public and unlisted notes by id but lists only public ones in the gallery", async () => {
    const pub = await create("public", KEY, "公开");
    const hidden = await create("unlisted", KEY, "隐藏");
    for (const note of [pub, hidden]) {
      const { response, body } = await call(request("GET", `/api/notes/${note.id}`, { key: null }));
      expect(response.status).toBe(200);
      expect(body!.note.title).toBe(note.note.title);
      expect(body).not.toHaveProperty("api_key_id");
    }
    const { body } = await call(request("GET", "/api/gallery", { key: null }));
    expect(body!.items.map((i: { title: string }) => i.title)).toEqual(["公开"]);
    const missing = await call(request("GET", "/api/notes/AAAAAAAAAAAAAAAAAAAAAA", { key: null }));
    expect(missing.response.status).toBe(404);
  });

  it("paginates the gallery with a cursor and filters by template", async () => {
    for (let i = 0; i < 5; i++) await create("public", KEY, `第${i}篇`);
    const first = await call(request("GET", "/api/gallery?limit=2", { key: null }));
    expect(first.body!.items).toHaveLength(2);
    const second = await call(request("GET", `/api/gallery?limit=2&cursor=${first.body!.nextCursor}`, { key: null }));
    const third = await call(request("GET", `/api/gallery?limit=2&cursor=${second.body!.nextCursor}`, { key: null }));
    const ids = [...first.body!.items, ...second.body!.items, ...third.body!.items].map((i: { id: string }) => i.id);
    expect(new Set(ids).size).toBe(5);
    expect(third.body!.nextCursor).toBeNull();
    const filtered = await call(request("GET", "/api/gallery?template=meeting-minutes", { key: null }));
    expect(filtered.body!.items).toHaveLength(0);
    const bad = await call(request("GET", "/api/gallery?template=poem", { key: null }));
    expect(bad.response.status).toBe(400);
  });

  it("lets only the owning key read, update and delete through /api/v1", async () => {
    const note = await create("unlisted");
    expect((await call(request("GET", `/api/v1/notes/${note.id}`, { key: OTHER_KEY }))).response.status).toBe(404);
    expect((await call(request("PATCH", `/api/v1/notes/${note.id}`, { key: OTHER_KEY, body: { visibility: "public" } }))).response.status).toBe(404);
    expect((await call(request("DELETE", `/api/v1/notes/${note.id}`, { key: OTHER_KEY }))).response.status).toBe(404);

    const patched = await call(request("PATCH", `/api/v1/notes/${note.id}`, { body: { visibility: "public" } }));
    expect(patched.body!.visibility).toBe("public");
    const list = await call(request("GET", "/api/v1/notes"));
    expect(list.body!.items.map((i: { id: string }) => i.id)).toEqual([note.id]);
    const otherList = await call(request("GET", "/api/v1/notes", { key: OTHER_KEY }));
    expect(otherList.body!.items).toHaveLength(0);

    const deleted = await handleApi(request("DELETE", `/api/v1/notes/${note.id}`), env, () => {});
    expect(deleted.status).toBe(204);
    expect((await call(request("GET", `/api/notes/${note.id}`, { key: null }))).response.status).toBe(404);
  });

  it("builds share links from PUBLIC_BASE_URL when configured", async () => {
    env.PUBLIC_BASE_URL = "https://ink.example.com/";
    const { body } = await call(request("POST", "/api/v1/notes", { body: publication() }));
    expect(body!.url).toBe(`https://ink.example.com/n/${body!.id}`);
  });

  it("publishes an OpenAPI document pointing at the public origin", async () => {
    env.PUBLIC_BASE_URL = "https://ink.example.com";
    const { body } = await call(request("GET", "/api/v1/openapi.json", { key: null }));
    expect(body!.servers).toEqual([{ url: "https://ink.example.com" }]);
    expect(Object.keys(body!.paths)).toContain("/api/v1/notes");
    expect(Object.keys(body!.paths)).toContain("/api/v1/notes/validate");
    const schema = body!.components.schemas.PublishRequest;
    expect(schema.required).toEqual(["schemaVersion", "note"]);
    expect(schema.properties).not.toHaveProperty("text");
    expect(schema.properties.visibility.enum).toEqual(["unlisted"]);
    expect(schema.properties.note.properties.sections.items.properties.content.maxLength).toBe(900);
    const versions = body!.components.schemas.PublishedNote.allOf[1].oneOf;
    expect(versions.map((version: any) => version.properties.schemaVersion.const)).toEqual([1, 0]);
    expect(versions[0].properties.settings.$ref).toBe("#/components/schemas/Settings");
    expect(versions[1].properties.settings.$ref).toBe("#/components/schemas/LegacySettings");
    expect(body!.components.schemas.Settings.properties.doodleMode.enum).not.toContain("ai");
    expect(body!.components.schemas.LegacySettings.properties.doodleMode.enum).toContain("ai");
  });
});


describe("anonymous publishing", () => {
  const anonymous = (method: string, path: string, options: { body?: unknown; ip?: string; headers?: Record<string, string> } = {}) =>
    request(method, path, { key: null, body: options.body, headers: { "CF-Connecting-IP": options.ip ?? "198.51.100.7", ...options.headers } });
  const count = async (sql: string) => (await env.DB!.prepare(sql).first<{ n: number }>())!.n;

  it("publishes an unlisted note without a key and returns a manage token", async () => {
    const preflight = await call(anonymous("POST", "/api/v1/notes/validate", { body: publication() }));
    expect(preflight.response.status).toBe(200);
    const { response, body } = await call(anonymous("POST", "/api/v1/notes", { body: publication() }));
    expect(response.status).toBe(201);
    expect(body!.visibility).toBe("unlisted");
    expect(body!.manageToken).toMatch(/^imt_[A-Za-z0-9_-]{43}$/);
    expect(body!.meta).toMatchObject({ processing: "agent" });
    expect(env.AI.run).not.toHaveBeenCalled();

    const stored = await env.DB!.prepare("SELECT api_key_id, client_hash, manage_token_hash FROM notes WHERE id = ?")
      .bind(body!.id).first<{ api_key_id: string; client_hash: string; manage_token_hash: string }>();
    expect(stored!.api_key_id).toBe("anonymous");
    expect(stored!.client_hash).toMatch(/^[0-9a-f]{64}$/);
    expect(stored!.client_hash).not.toContain("198.51.100.7");
    expect(stored!.manage_token_hash).toBe(sha(body!.manageToken));

    const read = await call(request("GET", `/api/notes/${body!.id}`, { key: null }));
    expect(read.response.status).toBe(200);
    expect(read.body).not.toHaveProperty("manageToken");
    expect((await call(request("GET", "/api/gallery", { key: null }))).body!.items).toHaveLength(0);
  });

  it("keeps anonymous notes out of the gallery", async () => {
    for (const path of ["/api/v1/notes/validate", "/api/v1/notes"]) {
      const { response, body } = await call(anonymous("POST", path, { body: publication({ visibility: "public" }) }));
      expect(response.status).toBe(422);
      expect(body!.error.issues).toEqual([expect.objectContaining({ path: "visibility", code: "ANONYMOUS_UNLISTED_ONLY" })]);
    }
    expect(await count("SELECT count(*) AS n FROM notes")).toBe(0);
    expect(await count("SELECT count(*) AS n FROM idempotency_keys")).toBe(0);
  });

  it("requires a key to list, read through /api/v1 or change visibility", async () => {
    const { body } = await call(anonymous("POST", "/api/v1/notes", { body: publication() }));
    for (const [method, path, payload] of [
      ["GET", "/api/v1/notes", undefined],
      ["GET", `/api/v1/notes/${body!.id}`, undefined],
      ["PATCH", `/api/v1/notes/${body!.id}`, { visibility: "public" }],
    ] as const) {
      const result = await call(anonymous(method, path, { body: payload }));
      expect(result.response.status).toBe(401);
      expect(result.body!.error.code).toBe("UNAUTHORIZED");
    }
    expect((await call(request("GET", `/api/v1/notes/${body!.id}`))).response.status).toBe(404);
    expect((await call(request("GET", "/api/v1/notes"))).body!.items).toHaveLength(0);
  });

  it("deletes only with the manage token and does not recreate deleted notes", async () => {
    const created = await call(anonymous("POST", "/api/v1/notes", { body: publication(), headers: { "Idempotency-Key": "anon-1" } }));
    const path = `/api/v1/notes/${created.body!.id}`;
    expect((await call(anonymous("DELETE", path))).response.status).toBe(401);
    expect((await call(anonymous("DELETE", path, { headers: { "X-Manage-Token": "imt_wrong" } }))).response.status).toBe(404);
    expect((await call(request("DELETE", path))).response.status).toBe(404);
    const deleted = await handleApi(anonymous("DELETE", path, { ip: "192.0.2.1", headers: { "X-Manage-Token": created.body!.manageToken } }), env, () => {});
    expect(deleted.status).toBe(204);
    expect((await call(request("GET", `/api/notes/${created.body!.id}`, { key: null }))).response.status).toBe(404);
    const replay = await call(anonymous("POST", "/api/v1/notes", { body: publication(), headers: { "Idempotency-Key": "anon-1" } }));
    expect(replay.response.status).toBe(410);
  });

  it("scopes idempotency keys to the client and never reveals or replaces the manage token on replay", async () => {
    const headers = { "Idempotency-Key": "shared-key" };
    const first = await call(anonymous("POST", "/api/v1/notes", { body: publication(), headers }));
    // Anyone behind the same IP who knows the key and body gets the same note, but no deletion credential.
    const replay = await call(anonymous("POST", "/api/v1/notes", { body: publication(), headers }));
    expect(replay.response.status).toBe(200);
    expect(replay.response.headers.get("Idempotent-Replayed")).toBe("true");
    expect(replay.body!.id).toBe(first.body!.id);
    expect(replay.body).not.toHaveProperty("manageToken");

    const elsewhere = await call(anonymous("POST", "/api/v1/notes", { body: publication(), headers, ip: "192.0.2.50" }));
    expect(elsewhere.response.status).toBe(201);
    expect(elsewhere.body!.id).not.toBe(first.body!.id);

    const path = `/api/v1/notes/${first.body!.id}`;
    expect((await call(anonymous("DELETE", path, { headers: { "X-Manage-Token": first.body!.manageToken } }))).response.status).toBe(204);
  });

  it("accepts a client-chosen manage token so a lost response can still be deleted", async () => {
    const token = "my-own-secret-token-0123456789abcdef";
    const headers = { "Idempotency-Key": "own-token", "X-Manage-Token": token };
    const first = await call(anonymous("POST", "/api/v1/notes", { body: publication(), headers }));
    expect(first.response.status).toBe(201);
    expect(first.body!.manageToken).toBe(token);
    const replay = await call(anonymous("POST", "/api/v1/notes", { body: publication(), headers }));
    expect(replay.body!.id).toBe(first.body!.id);
    expect((await call(anonymous("DELETE", `/api/v1/notes/${first.body!.id}`, { headers: { "X-Manage-Token": token } }))).response.status).toBe(204);

    const weak = await call(anonymous("POST", "/api/v1/notes", { body: publication(), headers: { "X-Manage-Token": "short" } }));
    expect(weak.response.status).toBe(400);
    expect(await count("SELECT count(*) AS n FROM notes")).toBe(0);
  });

  it("leaves no reservation behind for rejected requests", async () => {
    env.ANON_PUBLISH_DAILY_LIMIT_PER_CLIENT = "1";
    const invalid = publication({ note: { ...aiNote, sections: [] } });
    expect((await call(anonymous("POST", "/api/v1/notes", { body: invalid, headers: { "Idempotency-Key": "bad" } }))).response.status).toBe(422);
    expect((await call(anonymous("POST", "/api/v1/notes", { body: publication({ visibility: "public" }), headers: { "Idempotency-Key": "public" } }))).response.status).toBe(422);
    expect((await call(anonymous("POST", "/api/v1/notes", { body: publication(), headers: { "Idempotency-Key": "first" } }))).response.status).toBe(201);
    expect((await call(anonymous("POST", "/api/v1/notes", { body: publication(), headers: { "Idempotency-Key": "over" } }))).response.status).toBe(429);
    const keys = await env.DB!.prepare("SELECT idempotency_key FROM idempotency_keys").all<{ idempotency_key: string }>();
    expect(keys.results.map((row) => row.idempotency_key)).toEqual(["first"]);
    // A completed request still replays after the quota is spent.
    expect((await call(anonymous("POST", "/api/v1/notes", { body: publication(), headers: { "Idempotency-Key": "first" } }))).response.status).toBe(200);
  });

  it("enforces daily quotas per client and for the whole site", async () => {
    env.ANON_PUBLISH_DAILY_LIMIT_PER_CLIENT = "2";
    env.ANON_PUBLISH_DAILY_LIMIT = "3";
    for (let i = 0; i < 2; i++) expect((await call(anonymous("POST", "/api/v1/notes", { body: publication() }))).response.status).toBe(201);
    const limited = await call(anonymous("POST", "/api/v1/notes", { body: publication() }));
    expect(limited.response.status).toBe(429);
    expect(limited.response.headers.get("Retry-After")).toBe("3600");
    expect((await call(anonymous("POST", "/api/v1/notes", { body: publication(), ip: "192.0.2.2" }))).response.status).toBe(201);
    expect((await call(anonymous("POST", "/api/v1/notes", { body: publication(), ip: "192.0.2.3" }))).response.status).toBe(429);
    // Key publishing is outside the anonymous quota, and notes older than a day no longer count.
    expect((await call(request("POST", "/api/v1/notes", { body: publication() }))).response.status).toBe(201);
    await env.DB!.prepare("UPDATE notes SET created_at = ? WHERE api_key_id = 'anonymous'").bind(Date.now() - 86_400_001).run();
    expect((await call(anonymous("POST", "/api/v1/notes", { body: publication() }))).response.status).toBe(201);
  });

  it("can be turned off", async () => {
    env.ANON_PUBLISH_DAILY_LIMIT = "0";
    for (const path of ["/api/v1/notes/validate", "/api/v1/notes"]) {
      const { response, body } = await call(anonymous("POST", path, { body: publication() }));
      expect(response.status).toBe(403);
      expect(body!.error.code).toBe("FEATURE_DISABLED");
    }
    expect((await call(request("POST", "/api/v1/notes", { body: publication() }))).response.status).toBe(201);
  });

  it("rate-limits anonymous calls by client IP", async () => {
    env.API_RATE_LIMIT_PER_MINUTE = "1";
    expect((await call(anonymous("POST", "/api/v1/notes/validate", { body: publication() }))).response.status).toBe(200);
    expect((await call(anonymous("POST", "/api/v1/notes/validate", { body: publication() }))).response.status).toBe(429);
    expect((await call(anonymous("POST", "/api/v1/notes/validate", { body: publication(), ip: "192.0.2.9" }))).response.status).toBe(200);
  });

  it("keeps key publishing working when the Worker is deployed before migration 0004", async () => {
    await env.DB!.prepare("ALTER TABLE notes DROP COLUMN client_hash").run();
    await env.DB!.prepare("ALTER TABLE notes DROP COLUMN manage_token_hash").run();
    const { response, body } = await call(request("POST", "/api/v1/notes", { body: publication() }));
    expect(response.status).toBe(201);
    expect((await call(request("DELETE", `/api/v1/notes/${body!.id}`))).response.status).toBe(204);
  });
});


describe("publish lease fencing", () => {
  it("recovers expired leases without allowing the old Worker to commit or release its successor", async () => {
    const first = await claimPublish(env.DB!, "key_owner", "lease", "hash", 0);
    const next = await claimPublish(env.DB!, "key_owner", "lease", "hash", 120_001);
    if (!("claim" in first) || !("claim" in next)) throw new Error("Expected both reservations");
    await releasePublish(env.DB!, first.claim);
    const input = { id: first.claim.noteId, schemaVersion: 1 as const, apiKeyId: "key_owner", visibility: "unlisted" as const,
      language: "zh" as const, template: "general", note: aiNote, settings: DEFAULT_SETTINGS, stickers: [], now: 120_002 };
    expect(await insertNote(env.DB!, input, first.claim)).toBe(false);
    expect(await insertNote(env.DB!, { ...input, id: next.claim.noteId }, next.claim)).toBe(true);
    const rows = await env.DB!.prepare("SELECT id FROM notes").all<{ id: string }>();
    expect(rows.results.map((r) => r.id)).toEqual([next.claim.noteId]);
  });

  it("keeps different payloads conflicting even after lease expiry", async () => {
    await claimPublish(env.DB!, "key_owner", "lease", "original", 0);
    const next = await claimPublish(env.DB!, "key_owner", "lease", "changed", 120_001);
    expect("existing" in next && next.existing.request_hash).toBe("original");
  });
});
