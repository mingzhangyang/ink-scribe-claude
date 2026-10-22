import { createHash } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Env, RenderJob } from "../worker/env.ts";
import { resetMemoryRateLimit } from "../worker/rate-limit.ts";
import { handleRenderBatch, type RenderBrowser } from "../worker/render.ts";
import { handleApi } from "../worker/router.ts";
import { createTestD1, createTestR2 } from "./helpers/d1.ts";

const KEY = "isk_test_key_owner";
const OTHER_KEY = "isk_test_key_other";
const REVOKED_KEY = "isk_test_key_revoked";

const aiNote = {
  title: "整理后的标题",
  cues: [{ keyword: "要点", note: "说明" }],
  sections: [{ heading: "小节", content: "整理后的正文内容。", highlights: ["正文"] }],
  summary: "总结",
  doodlePrompt: "一本书",
  doodleTheme: "book",
};

const sha = (value: string) => createHash("sha256").update(value).digest("hex");

let env: Env;
let r2: ReturnType<typeof createTestR2>;
let queued: RenderJob[];

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
  r2 = createTestR2();
  queued = [];
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
    expect(body!.image.status).toBe("disabled");
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

  it("does not render thumbnails unless explicitly enabled", async () => {
    env.IMAGES = r2 as unknown as R2Bucket;
    env.BROWSER = {} as Fetcher;
    env.RENDER_QUEUE = { send: vi.fn(async (job: RenderJob) => void queued.push(job)) } as unknown as Queue<RenderJob>;
    const { body } = await call(request("POST", "/api/v1/notes", { body: { note: aiNote } }));
    expect(body!.image.status).toBe("disabled");
    expect(queued).toHaveLength(0);
  });

  it("queues a thumbnail render when rendering is enabled and configured", async () => {
    env.THUMBNAILS_ENABLED = "true";
    env.IMAGES = r2 as unknown as R2Bucket;
    env.BROWSER = {} as Fetcher;
    env.RENDER_QUEUE = { send: vi.fn(async (job: RenderJob) => void queued.push(job)) } as unknown as Queue<RenderJob>;
    env.PUBLIC_BASE_URL = "https://ink.example.com/";
    const { body } = await call(request("POST", "/api/v1/notes", { body: { note: aiNote } }));
    expect(body!.image.status).toBe("pending");
    expect(body!.url).toBe(`https://ink.example.com/n/${body!.id}`);
    expect(queued).toEqual([{ id: body!.id, origin: "https://ink.example.com" }]);
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

    env.IMAGES = r2 as unknown as R2Bucket;
    await r2.put(`notes/${note.id}.png`, new Uint8Array([1]));
    await env.DB!.prepare("UPDATE notes SET image_key = ? WHERE id = ?").bind(`notes/${note.id}.png`, note.id).run();
    const deleted = await handleApi(request("DELETE", `/api/v1/notes/${note.id}`), env, (p) => void p);
    expect(deleted.status).toBe(204);
    await Promise.resolve();
    expect(r2.objects.size).toBe(0);
    expect((await call(request("GET", `/api/notes/${note.id}`, { key: null }))).response.status).toBe(404);
  });

  it("serves the preview image only when it is ready", async () => {
    const note = await create("public");
    env.IMAGES = r2 as unknown as R2Bucket;
    expect((await call(request("GET", `/api/notes/${note.id}/image.png`, { key: null }))).response.status).toBe(404);
    await r2.put(`notes/${note.id}.png`, new Uint8Array([137, 80, 78, 71]));
    await env.DB!.prepare("UPDATE notes SET image_status = 'ready', image_key = ?, image_width = 1680, image_height = 2376 WHERE id = ?")
      .bind(`notes/${note.id}.png`, note.id)
      .run();
    const response = await handleApi(request("GET", `/api/notes/${note.id}/image.png`, { key: null }), env, () => {});
    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toBe("image/png");
    const { body } = await call(request("GET", `/api/notes/${note.id}`, { key: null }));
    expect(body!.image).toMatchObject({ status: "ready", width: 1680, height: 2376 });
    expect(body!.image.url).toContain(`/api/notes/${note.id}/image.png`);
  });

  it("publishes an OpenAPI document pointing at the public origin", async () => {
    env.PUBLIC_BASE_URL = "https://ink.example.com";
    const { body } = await call(request("GET", "/api/v1/openapi.json", { key: null }));
    expect(body!.servers).toEqual([{ url: "https://ink.example.com" }]);
    expect(Object.keys(body!.paths)).toContain("/api/v1/notes");
  });
});

describe("thumbnail queue consumer", () => {
  function batchOf(jobs: Array<RenderJob & { attempts?: number }>) {
    const messages = jobs.map((job) => ({
      body: { id: job.id, origin: job.origin },
      attempts: job.attempts ?? 1,
      ack: vi.fn(),
      retry: vi.fn(),
    }));
    return { messages, ackAll: vi.fn(), retryAll: vi.fn() } as unknown as MessageBatch<RenderJob> & { messages: typeof messages };
  }

  function fakeBrowser(screenshot: () => Promise<Uint8Array>) {
    const visited: string[] = [];
    const browser: RenderBrowser = {
      async newPage() {
        return {
          async setViewport() {},
          async goto(url: string) {
            visited.push(url);
          },
          async waitForSelector() {},
          async $() {
            return { boundingBox: async () => ({ width: 840, height: 1188 }), screenshot };
          },
          async close() {},
        };
      },
      close: vi.fn(async () => {}),
    };
    return { browser, visited };
  }

  async function pendingNote(): Promise<string> {
    env.THUMBNAILS_ENABLED = "true";
    env.IMAGES = r2 as unknown as R2Bucket;
    env.BROWSER = {} as Fetcher;
    env.RENDER_QUEUE = { send: vi.fn(async () => {}) } as unknown as Queue<RenderJob>;
    const { body } = await call(request("POST", "/api/v1/notes", { body: { note: aiNote } }));
    return body!.id;
  }

  it("screenshots the render page, stores the PNG and marks the image ready", async () => {
    const id = await pendingNote();
    const { browser, visited } = fakeBrowser(async () => new Uint8Array([137, 80, 78, 71]));
    const batch = batchOf([{ id, origin: "https://ink.example.com" }]);
    await handleRenderBatch(batch, env, async () => browser);
    expect(visited).toEqual([`https://ink.example.com/n/${id}?render=1`]);
    expect(r2.objects.has(`notes/${id}.png`)).toBe(true);
    expect(batch.messages[0].ack).toHaveBeenCalled();
    expect(browser.close).toHaveBeenCalled();
    const { body } = await call(request("GET", `/api/notes/${id}`, { key: null }));
    expect(body!.image).toMatchObject({ status: "ready", width: 1680, height: 2376 });
  });

  it("retries failures and marks the image failed after the last attempt", async () => {
    const id = await pendingNote();
    const { browser } = fakeBrowser(async () => {
      throw new Error("timeout");
    });
    const early = batchOf([{ id, origin: "https://x.example", attempts: 1 }]);
    await handleRenderBatch(early, env, async () => browser);
    expect(early.messages[0].retry).toHaveBeenCalled();
    const last = batchOf([{ id, origin: "https://x.example", attempts: 3 }]);
    await handleRenderBatch(last, env, async () => browser);
    expect(last.messages[0].ack).toHaveBeenCalled();
    const { body } = await call(request("GET", `/api/notes/${id}`, { key: null }));
    expect(body!.image.status).toBe("failed");
  });

  it("acks jobs for deleted notes and retries the whole batch when the browser cannot start", async () => {
    await pendingNote();
    const { browser } = fakeBrowser(async () => new Uint8Array([1]));
    const gone = batchOf([{ id: "AAAAAAAAAAAAAAAAAAAAAA", origin: "https://x.example" }]);
    await handleRenderBatch(gone, env, async () => browser);
    expect(gone.messages[0].ack).toHaveBeenCalled();

    const blocked = batchOf([{ id: "AAAAAAAAAAAAAAAAAAAAAA", origin: "https://x.example" }]);
    await handleRenderBatch(blocked, env, async () => {
      throw new Error("no browser sessions available");
    });
    expect(blocked.retryAll).toHaveBeenCalled();
  });
});
