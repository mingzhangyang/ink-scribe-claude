import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Env } from "../worker/env.ts";
import { handleApi } from "../worker/router.ts";
import { resetMemoryRateLimit } from "../worker/rate-limit.ts";

const SECRET_TEXT = "这是一段用户的私密原文，包含机密项目代号 AURORA。";

const goodNote = {
  title: "测试标题",
  cues: [{ keyword: "要点", note: "说明" }],
  sections: [{ heading: "小节", content: "私密原文中的内容整理。", highlights: ["内容整理"] }],
  summary: "总结",
  doodlePrompt: "一本书",
  doodleTheme: "book",
};

type RunFn = (model: string, inputs: Record<string, unknown>, options?: unknown) => Promise<unknown>;

function makeEnv(run: RunFn, overrides: Partial<Env> = {}): Env {
  return {
    AI: { run: vi.fn(run) } as unknown as Ai,
    AI_MODEL: "@cf/test/model",
    AI_RESPONSE_FORMAT: "json_schema",
    AI_TIMEOUT_MS: "5000",
    ...overrides,
  };
}

function post(path: string, body: unknown, headers: Record<string, string> = {}): Request {
  return new Request(`https://ink.example${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "CF-Connecting-IP": "203.0.113.7", ...headers },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

const noopWait = () => {};

async function call(request: Request, env: Env) {
  const response = await handleApi(request, env, noopWait);
  return { response, body: (await response.json()) as Record<string, any> };
}

let logs: string[];

beforeEach(() => {
  resetMemoryRateLimit();
  logs = [];
  for (const level of ["log", "warn", "error"] as const) {
    vi.spyOn(console, level).mockImplementation((...args: unknown[]) => {
      logs.push(args.map(String).join(" "));
    });
  }
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("POST /api/structure", () => {
  it("returns a validated note from Workers AI", async () => {
    const env = makeEnv(async () => ({ response: JSON.stringify(goodNote), usage: { prompt_tokens: 100, completion_tokens: 50 } }));
    const { response, body } = await call(post("/api/structure", { text: SECRET_TEXT, template: "reading-notes" }), env);
    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(body.note.title).toBe("测试标题");
    expect(body.meta).toMatchObject({ model: "@cf/test/model", attempts: 1 });

    const [model, inputs] = (env.AI.run as unknown as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(model).toBe("@cf/test/model");
    expect(inputs.response_format.type).toBe("json_schema");
    expect(inputs.messages[1].content).toContain(SECRET_TEXT);
  });

  it("passes the user's text to the model without stripping code or markup", async () => {
    const env = makeEnv(async () => ({ response: goodNote }));
    const text = "请比较 Promise<string> 和 Promise<number>，以及 **粗体** 与 __init__ 的写法。";
    expect((await call(post("/api/structure", { text }), env)).response.status).toBe(200);
    const [, inputs] = (env.AI.run as unknown as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(inputs.messages[1].content).toContain(text);
  });

  it("keeps indentation of the user's text", async () => {
    const env = makeEnv(async () => ({ response: goodNote }));
    const text = "def f(items):\n    for item in items:\n        if item:\n\t\t\treturn item\n    return None";
    expect((await call(post("/api/structure", { text }), env)).response.status).toBe(200);
    const [, inputs] = (env.AI.run as unknown as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(inputs.messages[1].content).toContain(text);
  });

  it("accepts object responses from JSON mode", async () => {
    const env = makeEnv(async () => ({ response: goodNote }));
    const { response } = await call(post("/api/structure", { text: SECRET_TEXT }), env);
    expect(response.status).toBe(200);
  });

  it("accepts chat-completions shaped output with think blocks and code fences", async () => {
    const content = "<think>hmm</think>\n```json\n" + JSON.stringify(goodNote) + "\n```";
    const env = makeEnv(async () => ({ choices: [{ message: { content } }] }));
    const { response } = await call(post("/api/structure", { text: SECRET_TEXT }), env);
    expect(response.status).toBe(200);
  });

  it("repairs invalid output once and then succeeds", async () => {
    let n = 0;
    const env = makeEnv(async () => (n++ === 0 ? { response: "not json at all" } : { response: JSON.stringify(goodNote) }));
    const { response, body } = await call(post("/api/structure", { text: SECRET_TEXT }), env);
    expect(response.status).toBe(200);
    expect(body.meta.attempts).toBe(2);
    const secondInputs = (env.AI.run as unknown as ReturnType<typeof vi.fn>).mock.calls[1][1];
    expect(secondInputs.messages).toHaveLength(4);
    expect(secondInputs.messages[3].content).toContain("无法通过校验");
  });

  it("resolves the source language for auto and repairs a note written in another language", async () => {
    const englishNote = { ...goodNote, title: "Spaced repetition", sections: [{ content: "Review notes at growing intervals.", highlights: ["growing intervals"] }], summary: "Spacing beats cramming." };
    let n = 0;
    const env = makeEnv(async () => ({ response: n++ === 0 ? goodNote : englishNote }));
    const text = "Spaced repetition beats cramming. Review notes at growing intervals to remember more.";
    const { response, body } = await call(post("/api/structure", { text, language: "auto" }), env);
    expect(response.status).toBe(200);
    expect(body.note.title).toBe("Spaced repetition");
    expect(body.meta.attempts).toBe(2);
    const calls = (env.AI.run as unknown as ReturnType<typeof vi.fn>).mock.calls;
    expect(calls[0][1].messages[0].content).toContain("Write every text field in English");
    expect(calls[0][1].messages[1].content).toMatch(/Output language: English\.$/);
    expect(calls[1][1].messages[3].content).toContain("every text field must be written in English");
  });

  it("keeps a note in the wrong language with a warning when the repair also misses", async () => {
    const env = makeEnv(async () => ({ response: goodNote }));
    const { response, body } = await call(post("/api/structure", { text: "Spaced repetition beats cramming.", language: "en" }), env);
    expect(response.status).toBe(200);
    expect(body.note.title).toBe("测试标题");
    expect(body.meta.warnings).toContain("Wrong output language: every text field must be written in English.");
    expect((env.AI.run as unknown as ReturnType<typeof vi.fn>).mock.calls).toHaveLength(2);
  });

  it("returns AI_OUTPUT_INVALID when output stays invalid", async () => {
    const env = makeEnv(async () => ({ response: JSON.stringify({ title: "" }) }));
    const { response, body } = await call(post("/api/structure", { text: SECRET_TEXT }), env);
    expect(response.status).toBe(502);
    expect(body.error.code).toBe("AI_OUTPUT_INVALID");
    expect(body.error.message).toBe("无法生成有效的笔记结构，请重试。");
    expect((env.AI.run as unknown as ReturnType<typeof vi.fn>).mock.calls).toHaveLength(2);
  });

  it("maps a model timeout to AI_TIMEOUT", async () => {
    const env = makeEnv(() => new Promise(() => {}), { AI_TIMEOUT_MS: "5000" });
    vi.useFakeTimers();
    const pending = call(post("/api/structure", { text: SECRET_TEXT }), env);
    await vi.advanceTimersByTimeAsync(5_100);
    const { response, body } = await pending;
    vi.useRealTimers();
    expect(response.status).toBe(504);
    expect(body.error.code).toBe("AI_TIMEOUT");
  });

  it("maps capacity and quota errors to stable codes", async () => {
    const capacity = makeEnv(async () => {
      throw new Error("InferenceUpstreamError: 3040: Capacity temporarily exceeded");
    });
    const first = await call(post("/api/structure", { text: SECRET_TEXT }), capacity);
    expect(first.response.status).toBe(503);
    expect(first.body.error.code).toBe("AI_UNAVAILABLE");
    expect(first.response.headers.get("Retry-After")).toBe("10");

    const quota = makeEnv(async () => {
      throw new Error("3036: you have used up your daily free allocation of 10,000 neurons");
    });
    const second = await call(post("/api/structure", { text: SECRET_TEXT }), quota);
    expect(second.response.status).toBe(429);
    expect(second.body.error.code).toBe("AI_RATE_LIMITED");
  });

  it("validates input", async () => {
    const env = makeEnv(async () => ({ response: goodNote }), { MAX_INPUT_CHARS: "200" });
    expect((await call(post("/api/structure", { text: "" }), env)).body.error.code).toBe("INVALID_REQUEST");
    expect((await call(post("/api/structure", { text: "abc", template: "poem" }), env)).body.error.code).toBe("INVALID_REQUEST");
    const tooLong = await call(post("/api/structure", { text: "长".repeat(201) }), env);
    expect(tooLong.response.status).toBe(413);
    expect(tooLong.body.error.code).toBe("TEXT_TOO_LONG");
    expect((await call(post("/api/structure", "{bad json"), env)).body.error.code).toBe("INVALID_JSON");
    const wrongType = await call(post("/api/structure", "text=1", { "Content-Type": "text/plain" }), env);
    expect(wrongType.response.status).toBe(415);
  });

  it("rejects oversized bodies even without Content-Length", async () => {
    // MAX_INPUT_CHARS=200 时请求体上限为 max(4096, 200×6+8192) = 9392 字节
    const env = makeEnv(async () => ({ response: goodNote }), { MAX_BODY_BYTES: "4096", MAX_INPUT_CHARS: "200" });
    const big = JSON.stringify({ text: "x".repeat(20_000) });
    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue(new TextEncoder().encode(big));
        controller.close();
      },
    });
    const request = new Request("https://ink.example/api/structure", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: stream,
      // @ts-expect-error Node 需要 duplex 才能发送流式请求体
      duplex: "half",
    });
    const { response, body } = await call(request, env);
    expect(response.status).toBe(413);
    expect(body.error.code).toBe("PAYLOAD_TOO_LARGE");
  });

  it("accepts in-limit text sent as \\u-escaped JSON", async () => {
    const env = makeEnv(async () => ({ response: goodNote }));
    const escaped = JSON.stringify({ text: "长".repeat(11_000) }).replace(/长/g, "\\u957f");
    expect(escaped.length).toBeGreaterThan(65_536);
    const { response } = await call(post("/api/structure", escaped), env);
    expect(response.status).toBe(200);
  });

  it("rejects cross-origin browser requests", async () => {
    const env = makeEnv(async () => ({ response: goodNote }));
    const { response, body } = await call(post("/api/structure", { text: SECRET_TEXT }, { Origin: "https://evil.example" }), env);
    expect(response.status).toBe(403);
    expect(body.error.code).toBe("FORBIDDEN_ORIGIN");
    const allowed = makeEnv(async () => ({ response: goodNote }), { ALLOWED_ORIGINS: "https://partner.example" });
    expect((await call(post("/api/structure", { text: SECRET_TEXT }, { Origin: "https://partner.example" }), allowed)).response.status).toBe(200);
    expect((await call(post("/api/structure", { text: SECRET_TEXT }, { Origin: "https://ink.example" }), env)).response.status).toBe(200);
  });

  it("answers CORS preflights and adds CORS headers only for allowed origins", async () => {
    const env = makeEnv(async () => ({ response: goodNote }), { ALLOWED_ORIGINS: "https://partner.example" });
    const preflight = (origin: string) =>
      handleApi(
        new Request("https://ink.example/api/structure", {
          method: "OPTIONS",
          headers: { Origin: origin, "Access-Control-Request-Method": "POST", "Access-Control-Request-Headers": "content-type" },
        }),
        env,
        noopWait,
      );
    const ok = await preflight("https://partner.example");
    expect(ok.status).toBe(204);
    expect(ok.headers.get("Access-Control-Allow-Origin")).toBe("https://partner.example");
    expect(ok.headers.get("Access-Control-Allow-Methods")).toBe("POST");
    expect(ok.headers.get("Access-Control-Allow-Headers")).toBe("Content-Type");
    const denied = await preflight("https://evil.example");
    expect(denied.status).toBe(403);
    expect(denied.headers.get("Access-Control-Allow-Origin")).toBeNull();

    const { response } = await call(post("/api/structure", { text: SECRET_TEXT }, { Origin: "https://partner.example" }), env);
    expect(response.headers.get("Access-Control-Allow-Origin")).toBe("https://partner.example");
    expect(response.headers.get("Vary")).toContain("Origin");
    // 错误响应同样带 CORS 头，浏览器才能读到错误信息
    const invalid = await call(post("/api/structure", { text: "" }, { Origin: "https://partner.example" }), env);
    expect(invalid.response.status).toBe(400);
    expect(invalid.response.headers.get("Access-Control-Allow-Origin")).toBe("https://partner.example");
    // 同源请求不需要 CORS 头
    const same = await call(post("/api/structure", { text: SECRET_TEXT }, { Origin: "https://ink.example" }), env);
    expect(same.response.headers.get("Access-Control-Allow-Origin")).toBeNull();
  });

  it("rate limits per client", async () => {
    const env = makeEnv(async () => ({ response: goodNote }), { RATE_LIMIT_PER_MINUTE: "2" });
    expect((await call(post("/api/structure", { text: SECRET_TEXT }), env)).response.status).toBe(200);
    expect((await call(post("/api/structure", { text: SECRET_TEXT }), env)).response.status).toBe(200);
    const limited = await call(post("/api/structure", { text: SECRET_TEXT }), env);
    expect(limited.response.status).toBe(429);
    expect(limited.body.error.code).toBe("RATE_LIMITED");
  });

  it("uses the Rate Limiting binding when configured", async () => {
    const limit = vi.fn(async () => ({ success: false }));
    const env = makeEnv(async () => ({ response: goodNote }), { RATE_LIMITER: { limit } as unknown as RateLimit });
    const { response } = await call(post("/api/structure", { text: SECRET_TEXT }), env);
    expect(response.status).toBe(429);
    expect(limit).toHaveBeenCalledWith({ key: "/api/structure:203.0.113.7" });
  });

  it("uses the local heuristic in mock mode without calling Workers AI", async () => {
    const env = makeEnv(async () => {
      throw new Error("should not be called");
    }, { AI_MOCK: "true" });
    const { response, body } = await call(post("/api/structure", { text: "第一段内容很重要。\n\n第二段内容也很重要。" }), env);
    expect(response.status).toBe(200);
    expect(body.meta.mock).toBe(true);
    expect(env.AI.run).not.toHaveBeenCalled();
  });

  it("never writes the user's text or model output to logs", async () => {
    const env = makeEnv(async () => ({ response: JSON.stringify(goodNote) }));
    await call(post("/api/structure", { text: SECRET_TEXT }), env);
    const failing = makeEnv(async () => {
      throw new Error(`upstream echoed input: ${SECRET_TEXT}`);
    });
    await call(post("/api/structure", { text: SECRET_TEXT }), failing);
    expect(logs.length).toBeGreaterThan(0);
    for (const line of logs) {
      expect(line).not.toContain("AURORA");
      expect(line).not.toContain("私密原文");
    }
  });
});

describe("POST /api/doodle", () => {
  const spec = {
    concept: "灯泡",
    elements: [
      { type: "circle", cx: 50, cy: 40, r: 20 },
      { type: "line", x1: 40, y1: 70, x2: 60, y2: 70 },
    ],
  };

  it("is disabled by default", async () => {
    const env = makeEnv(async () => ({ response: spec }));
    const { response, body } = await call(post("/api/doodle", { concept: "灯泡" }), env);
    expect(response.status).toBe(403);
    expect(body.error.code).toBe("FEATURE_DISABLED");
  });

  it("returns a sanitized doodle spec when enabled", async () => {
    const env = makeEnv(async () => ({ response: { ...spec, elements: [...spec.elements, { type: "image", href: "https://x" }] } }), {
      DOODLE_API_ENABLED: "true",
    });
    const { response, body } = await call(post("/api/doodle", { concept: "灯泡" }), env);
    expect(response.status).toBe(200);
    expect(body.doodle.elements).toHaveLength(2);
    expect(body.meta.warnings).toContain("丢弃了 1 个不合法的图元");
  });

  it("rejects concepts that are empty after cleaning without calling the model", async () => {
    const env = makeEnv(async () => ({ response: spec }), { DOODLE_API_ENABLED: "true" });
    for (const concept of ["<b></b>", "\u0001\u0002"]) {
      const { response, body } = await call(post("/api/doodle", { concept }), env);
      expect(response.status).toBe(400);
      expect(body.error.code).toBe("INVALID_REQUEST");
    }
    expect(env.AI.run).not.toHaveBeenCalled();
  });
});

describe("routing", () => {
  it("drains request bodies it rejects without reading", async () => {
    // 未读的请求体会让本地预览中复用的 keep-alive 连接出错（下一个请求 “fetch failed”）
    const env = makeEnv(async () => ({}));
    const request = post("/api/config", { unused: true });
    const { response } = await call(request, env);
    expect(response.status).toBe(405);
    expect(request.bodyUsed).toBe(true);
  });

  it("does not let a stalled upload hold back an early error response", async () => {
    const env = makeEnv(async () => ({}));
    // 只发一个字节、之后不再结束的上传
    const body = new ReadableStream<Uint8Array>({ start: (controller) => controller.enqueue(new Uint8Array([123])) });
    const request = new Request("https://ink.example/api/config", { method: "POST", body, duplex: "half" } as RequestInit);
    const started = Date.now();
    const response = await handleApi(request, env, noopWait);
    expect(response.status).toBe(405);
    expect(Date.now() - started).toBeLessThan(3_000);
  });

  it("serves public config", async () => {
    const env = makeEnv(async () => ({}), { DOODLE_API_ENABLED: "true", MAX_INPUT_CHARS: "5000" });
    const { response, body } = await call(new Request("https://ink.example/api/config"), env);
    expect(response.status).toBe(200);
    expect(body).toEqual({ maxInputChars: 5000, doodleEnabled: true, mock: false });
  });

  it("returns 404 and 405 with stable codes", async () => {
    const env = makeEnv(async () => ({}));
    const missing = await call(new Request("https://ink.example/api/nope"), env);
    expect(missing.response.status).toBe(404);
    expect(missing.body.error.code).toBe("NOT_FOUND");
    const wrong = await call(new Request("https://ink.example/api/structure"), env);
    expect(wrong.response.status).toBe(405);
    expect(wrong.response.headers.get("Allow")).toBe("POST");
    expect(wrong.body.error.code).toBe("METHOD_NOT_ALLOWED");
  });
});
