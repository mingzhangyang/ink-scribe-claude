import { createHash } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Env } from "../worker/env.ts";
import { resetMemoryRateLimit } from "../worker/rate-limit.ts";
import { handleApi } from "../worker/router.ts";
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
  it("structures text with Workers AI and returns a share link", async () => {
    const { response, body } = await call(
      request("POST", "/api/v1/notes", {
        body: { text: "需要整理的原文，内容足够长。", template: "reading-notes", appearance: { paper: "kraft", ink: "brown" } },
      }),
    );
    expect(response.status).toBe(201);
    expect(body!.id).toMatch(/^[A-Za-z0-9_-]{22}$/);
    expect(body!.url).toBe(`https://notes.example/n/${body!.id}`);
    expect(response.headers.get("Location")).toBe(body!.url);
    expect(body!.visibility).toBe("unlisted");
    expect(body!.template).toBe("reading-notes");
    expect(body!.note.title).toBe("整理后的标题");
    expect(body!.note.date).toBeTruthy();
    expect(body!.settings).toMatchObject({ paper: "kraft", ink: "brown", layout: "hybrid-cornell" });
    expect(body).not.toHaveProperty("image");
    expect(body!.meta.model).toBeDefined();
  });

  it("accepts a pre-structured note and sanitizes it", async () => {
    const { response, body } = await call(
      request("POST", "/api/v1/notes", {
        body: {
          note: { title: "<img src=x onerror=alert(1)>标题", sections: [{ content: "正文 <script>x</script>", highlights: ["正文"] }], summary: "" },
          stickers: [{ type: "tape", x: 99999, y: 10, variant: "mint" }, { type: "iframe", x: 1 }],
          style: "minimal",
        },
      }),
    );
    expect(response.status).toBe(201);
    expect(body!.note.title).toBe("标题");
    expect(body!.note.sections[0].content).toBe("正文 x");
    expect(body!.settings.layout).toBe("minimal");
    expect(body!.stickers).toHaveLength(1);
    expect(body!.stickers[0]).toMatchObject({ type: "tape", x: 880, variant: "mint" });
    expect(env.AI.run).not.toHaveBeenCalled();
  });

  it("validates the request strictly so agents notice mistakes", async () => {
    const cases: Array<[unknown, string]> = [
      [{}, "text"],
      [{ text: "abc", note: aiNote }, "text"],
      [{ text: "原文内容", appearance: { papr: "kraft" } }, "papr"],
      [{ text: "原文内容", appearance: { paper: "neon" } }, "appearance.paper"],
      [{ text: "原文内容", visibility: "secret" }, "visibility"],
      [{ note: { title: "" } }, "note"],
      [{ text: "原文内容", doodle: { elements: [] } }, "doodle"],
    ];
    for (const [body, hint] of cases) {
      const result = await call(request("POST", "/api/v1/notes", { body }));
      expect(result.response.status, JSON.stringify(body)).toBe(400);
      expect(result.body!.error.message).toContain(hint);
    }
  });

  it("replays idempotent requests and rejects reused keys with different bodies", async () => {
    const body = { note: aiNote };
    const first = await call(request("POST", "/api/v1/notes", { body, headers: { "Idempotency-Key": "daily-1" } }));
    const replay = await call(request("POST", "/api/v1/notes", { body, headers: { "Idempotency-Key": "daily-1" } }));
    expect(first.response.status).toBe(201);
    expect(replay.response.status).toBe(200);
    expect(replay.response.headers.get("Idempotent-Replayed")).toBe("true");
    expect(replay.body!.id).toBe(first.body!.id);
    const conflict = await call(request("POST", "/api/v1/notes", { body: { note: { ...aiNote, title: "别的" } }, headers: { "Idempotency-Key": "daily-1" } }));
    expect(conflict.response.status).toBe(409);
    expect(conflict.body!.error.code).toBe("IDEMPOTENCY_CONFLICT");
    // 同一个键在另一个密钥下互不影响
    const other = await call(request("POST", "/api/v1/notes", { body, key: OTHER_KEY, headers: { "Idempotency-Key": "daily-1" } }));
    expect(other.response.status).toBe(201);
    expect(other.body!.id).not.toBe(first.body!.id);
  });

  it("reserves concurrent requests before calling AI, then replays the committed result", async () => {
    let finish!: (value: { response: typeof aiNote }) => void;
    let started!: () => void;
    const entered = new Promise<void>((resolve) => { started = resolve; });
    env.AI.run = vi.fn(() => { started(); return new Promise((resolve) => { finish = resolve; }); }) as typeof env.AI.run;
    const options = { body: { text: "足够长的会议原文，用于测试并发发布。" }, headers: { "Idempotency-Key": "parallel" } };
    const first = call(request("POST", "/api/v1/notes", options));
    await entered;
    const duplicate = await call(request("POST", "/api/v1/notes", options));
    expect(duplicate.response.status).toBe(409);
    expect(duplicate.response.headers.get("Retry-After")).toBe("2");
    expect(env.AI.run).toHaveBeenCalledTimes(1);
    finish({ response: aiNote });
    const created = await first;
    const replay = await call(request("POST", "/api/v1/notes", options));
    expect(created.response.status).toBe(201);
    expect(replay.body!.id).toBe(created.body!.id);
    expect((await env.DB!.prepare("SELECT count(*) AS n FROM notes").first<{ n: number }>())!.n).toBe(1);
  });

  it("does not resurrect deleted notes on delayed retries", async () => {
    const options = { body: { note: aiNote }, headers: { "Idempotency-Key": "deleted" } };
    const created = await call(request("POST", "/api/v1/notes", options));
    await call(request("DELETE", `/api/v1/notes/${created.body!.id}`));
    const replay = await call(request("POST", "/api/v1/notes", options));
    expect(replay.response.status).toBe(410);
    expect((await env.DB!.prepare("SELECT count(*) AS n FROM notes").first<{ n: number }>())!.n).toBe(0);
  });

  it("rolls back failed commits and allows a same-key retry", async () => {
    await env.DB!.exec("CREATE TRIGGER fail_commit BEFORE UPDATE OF state ON idempotency_keys WHEN NEW.state = 'completed' BEGIN SELECT RAISE(ABORT, 'injected failure'); END;");
    const options = { body: { note: aiNote }, headers: { "Idempotency-Key": "retry" } };
    expect((await call(request("POST", "/api/v1/notes", options))).response.status).toBe(500);
    expect((await env.DB!.prepare("SELECT count(*) AS n FROM notes").first<{ n: number }>())!.n).toBe(0);
    await env.DB!.exec("DROP TRIGGER fail_commit;");
    expect((await call(request("POST", "/api/v1/notes", options))).response.status).toBe(201);
  });

});

describe("reading, gallery and management", () => {
  async function create(visibility: "public" | "unlisted", key = KEY, title = "标题") {
    const { body } = await call(request("POST", "/api/v1/notes", { key, body: { note: { ...aiNote, title }, visibility } }));
    return body!;
  }

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
    const { body } = await call(request("POST", "/api/v1/notes", { body: { note: aiNote } }));
    expect(body!.url).toBe(`https://ink.example.com/n/${body!.id}`);
  });

  it("publishes an OpenAPI document pointing at the public origin", async () => {
    env.PUBLIC_BASE_URL = "https://ink.example.com";
    const { body } = await call(request("GET", "/api/v1/openapi.json", { key: null }));
    expect(body!.servers).toEqual([{ url: "https://ink.example.com" }]);
    expect(Object.keys(body!.paths)).toContain("/api/v1/notes");
  });
});


describe("publish lease fencing", () => {
  it("recovers expired leases without allowing the old Worker to commit or release its successor", async () => {
    const first = await claimPublish(env.DB!, "key_owner", "lease", "hash", 0);
    const next = await claimPublish(env.DB!, "key_owner", "lease", "hash", 120_001);
    if (!("claim" in first) || !("claim" in next)) throw new Error("Expected both reservations");
    await releasePublish(env.DB!, first.claim);
    const input = { id: first.claim.noteId, apiKeyId: "key_owner", visibility: "unlisted" as const,
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
