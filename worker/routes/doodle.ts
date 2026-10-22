import type { DoodleResponse } from "../../shared/api.ts";
import { DOODLE_JSON_SCHEMA, normalizeDoodleSpec, type DoodleSpec } from "../../shared/doodle.ts";
import { charLength, cleanText } from "../../shared/text.ts";
import { runJsonTask, type AiBinding } from "../ai.ts";
import { AppError, jsonResponse, readJsonBody } from "../http.ts";
import { buildDoodleMessages } from "../prompts.ts";
import type { RouteContext } from "../router.ts";

export const MAX_CONCEPT_CHARS = 80;

export function validateDoodleRequest(body: unknown): { concept: string } {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw new AppError(400, "INVALID_REQUEST", "请求体必须是 JSON 对象。");
  }
  const raw = (body as Record<string, unknown>).concept;
  if (typeof raw !== "string" || raw.trim() === "") {
    throw new AppError(400, "INVALID_REQUEST", "请提供插图主题 concept。");
  }
  if (charLength(raw) > MAX_CONCEPT_CHARS) {
    throw new AppError(413, "TEXT_TOO_LONG", `插图主题过长，请控制在 ${MAX_CONCEPT_CHARS} 字以内。`);
  }
  return { concept: cleanText(raw, MAX_CONCEPT_CHARS) };
}

/** 开发模式下的确定性插图：由概念文本的哈希决定花瓣数量与位置。 */
export function mockDoodle(concept: string): DoodleSpec {
  let hash = 0;
  for (const ch of concept) hash = (hash * 31 + ch.codePointAt(0)!) >>> 0;
  const petals = 5 + (hash % 4);
  const elements: DoodleSpec["elements"] = [
    { type: "circle", cx: 50, cy: 42, r: 14, fill: "yellow", stroke: "ink", width: 2 },
  ];
  for (let i = 0; i < petals; i++) {
    const angle = (i / petals) * Math.PI * 2;
    const x1 = 50 + Math.cos(angle) * 20;
    const y1 = 42 + Math.sin(angle) * 20;
    const x2 = 50 + Math.cos(angle) * 30;
    const y2 = 42 + Math.sin(angle) * 30;
    elements.push({ type: "line", x1: Math.round(x1), y1: Math.round(y1), x2: Math.round(x2), y2: Math.round(y2), stroke: "ink", width: 2 });
  }
  elements.push({
    type: "path",
    points: [
      [18, 86],
      [34, 80],
      [50, 86],
      [66, 80],
      [82, 86],
    ],
    closed: false,
    smooth: true,
    fill: "none",
    stroke: "accent",
    width: 2,
  });
  return { concept, elements };
}

async function cacheKeyFor(model: string, concept: string): Promise<Request> {
  const data = new TextEncoder().encode(`${model}\n${concept.toLowerCase()}`);
  const digest = await crypto.subtle.digest("SHA-256", data);
  const hex = [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
  // 缓存键只包含哈希，不包含概念原文
  return new Request(`https://doodle-cache.ink-scribe.internal/${hex}`);
}

function defaultCache(): Cache | undefined {
  return typeof caches !== "undefined" ? (caches as unknown as { default?: Cache }).default : undefined;
}

export async function handleDoodle(ctx: RouteContext): Promise<Response> {
  const { request, env, config, log } = ctx;
  if (!config.doodleEnabled) {
    throw new AppError(403, "FEATURE_DISABLED", "AI 插图功能未启用，请使用内置插图库。");
  }
  const body = await readJsonBody(request, Math.min(config.maxBodyBytes, 4_096));
  const { concept } = validateDoodleRequest(body);
  log.inputChars = charLength(concept);

  if (config.mock) {
    log.mock = true;
    const response: DoodleResponse = {
      doodle: mockDoodle(concept),
      meta: { requestId: ctx.requestId, model: "local-mock", latencyMs: Date.now() - ctx.startedAt, attempts: 0, warnings: [], mock: true },
    };
    return jsonResponse(response);
  }

  const model = config.doodle.model;
  log.model = model;
  const cache = config.doodleCacheTtlSeconds > 0 ? defaultCache() : undefined;
  const cacheKey = cache ? await cacheKeyFor(model, concept) : undefined;
  if (cache && cacheKey) {
    const hit = await cache.match(cacheKey);
    if (hit) {
      const cached = normalizeDoodleSpec(await hit.json());
      if (cached.ok) {
        log.cached = true;
        const response: DoodleResponse = {
          doodle: { ...cached.value, concept: cached.value.concept || concept },
          meta: { requestId: ctx.requestId, model, latencyMs: Date.now() - ctx.startedAt, attempts: 0, warnings: [], cached: true },
        };
        return jsonResponse(response);
      }
    }
  }

  const { system, user } = buildDoodleMessages(concept);
  const result = await runJsonTask(env.AI as unknown as AiBinding, config.doodle, {
    system,
    user,
    schemaName: "doodle_spec",
    schema: DOODLE_JSON_SCHEMA as unknown as Record<string, unknown>,
    normalize: normalizeDoodleSpec,
    invalidMessage: "无法生成有效的插图，请重试或使用内置插图。",
  });
  log.attempts = result.attempts;
  log.promptTokens = result.usage.promptTokens;
  log.completionTokens = result.usage.completionTokens;
  log.warnings = result.warnings.length;

  if (cache && cacheKey) {
    // 只缓存经过校验的图元，不缓存概念文本
    const stored = new Response(JSON.stringify({ ...result.value, concept: "" }), {
      headers: { "Content-Type": "application/json", "Cache-Control": `public, max-age=${config.doodleCacheTtlSeconds}` },
    });
    ctx.waitUntil(cache.put(cacheKey, stored));
  }

  const response: DoodleResponse = {
    doodle: { ...result.value, concept: result.value.concept || concept },
    meta: {
      requestId: ctx.requestId,
      model,
      latencyMs: Date.now() - ctx.startedAt,
      attempts: result.attempts,
      warnings: result.warnings,
    },
  };
  return jsonResponse(response);
}
