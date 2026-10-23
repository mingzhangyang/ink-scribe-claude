import type { PublicConfig } from "../shared/api.ts";
import { upstreamErrorCode } from "./ai.ts";
import { loadConfig, type AppConfig } from "./config.ts";
import type { Env } from "./env.ts";
import { AppError, assertAllowedOrigin, discardUnreadBody, errorResponse, jsonResponse } from "./http.ts";
import { logEvent, logRequest, recordMetrics, type RequestLog } from "./log.ts";
import { OPENAPI_SPEC } from "./openapi.ts";
import { enforceRateLimit } from "./rate-limit.ts";
import { handleDoodle } from "./routes/doodle.ts";
import {
  handleCreateNote,
  handleDeleteNote,
  handleGallery,
  handleGetNoteV1,
  handleListNotes,
  handlePatchNote,
  handlePublicNote,
} from "./routes/notes.ts";
import { handleStructure } from "./routes/structure.ts";
import { findApiKey, touchApiKey, type ApiKeyRecord } from "./store.ts";

export type RouteContext = {
  request: Request;
  env: Env;
  config: AppConfig;
  requestId: string;
  startedAt: number;
  log: Partial<RequestLog>;
  waitUntil: (promise: Promise<unknown>) => void;
  /** 路径参数，例如 /api/notes/:id 中的 id。 */
  params: Record<string, string>;
  /** 生成分享链接使用的站点地址（PUBLIC_BASE_URL 或请求来源）。 */
  origin: string;
  /** 通过 Bearer 认证的 API 密钥（仅 access 为 "key" 的路由）。 */
  apiKey?: ApiKeyRecord;
};

type Method = "GET" | "POST" | "PATCH" | "DELETE";

type Route = {
  /** 用于日志与指标的模板路径（不含实际 ID）。 */
  name: string;
  pattern: RegExp;
  /** public：公开读取；ai：网页调用模型（来源校验 + 按 IP 限流）；key：需要 API 密钥（按密钥限流）。 */
  access: "public" | "ai" | "key";
  methods: Partial<Record<Method, (ctx: RouteContext) => Promise<Response>>>;
};

const ID = "(?<id>[A-Za-z0-9_-]{22})";

const ROUTES: Route[] = [
  {
    name: "/api/config",
    pattern: /^\/api\/config$/,
    access: "public",
    methods: {
      GET: async ({ config }) => {
        const body: PublicConfig = {
          maxInputChars: config.maxInputChars,
          doodleEnabled: config.doodleEnabled,
          mock: config.mock,
        };
        return jsonResponse(body, 200, { "Cache-Control": "public, max-age=60" });
      },
    },
  },
  { name: "/api/structure", pattern: /^\/api\/structure$/, access: "ai", methods: { POST: handleStructure } },
  { name: "/api/doodle", pattern: /^\/api\/doodle$/, access: "ai", methods: { POST: handleDoodle } },
  { name: "/api/gallery", pattern: /^\/api\/gallery$/, access: "public", methods: { GET: handleGallery } },
  { name: "/api/notes/:id", pattern: new RegExp(`^/api/notes/${ID}$`), access: "public", methods: { GET: handlePublicNote } },
  {
    name: "/api/v1/openapi.json",
    pattern: /^\/api\/v1\/openapi\.json$/,
    access: "public",
    methods: {
      GET: async ({ origin }) =>
        jsonResponse({ ...OPENAPI_SPEC, servers: [{ url: origin }] }, 200, { "Cache-Control": "public, max-age=300" }),
    },
  },
  { name: "/api/v1/notes", pattern: /^\/api\/v1\/notes$/, access: "key", methods: { POST: handleCreateNote, GET: handleListNotes } },
  {
    name: "/api/v1/notes/:id",
    pattern: new RegExp(`^/api/v1/notes/${ID}$`),
    access: "key",
    methods: { GET: handleGetNoteV1, PATCH: handlePatchNote, DELETE: handleDeleteNote },
  },
];

function newRequestId(request: Request): string {
  const ray = request.headers.get("CF-Ray");
  return ray ? ray.split("-")[0] : crypto.randomUUID();
}

async function authenticate(env: Env, request: Request): Promise<ApiKeyRecord> {
  const header = request.headers.get("Authorization") ?? "";
  const match = header.match(/^Bearer\s+(\S+)$/i);
  if (!match) throw new AppError(401, "UNAUTHORIZED", "缺少 API 密钥，请在 Authorization 头中使用 Bearer 方式提供。");
  if (!env.DB) throw new AppError(503, "STORAGE_UNAVAILABLE", "存储未配置，暂时无法使用发布接口。");
  const key = await findApiKey(env.DB, match[1]);
  if (!key || key.revokedAt) throw new AppError(401, "UNAUTHORIZED", "API 密钥无效或已吊销。");
  return key;
}

export async function handleApi(request: Request, env: Env, waitUntil: (promise: Promise<unknown>) => void): Promise<Response> {
  const startedAt = Date.now();
  const url = new URL(request.url);
  const requestId = newRequestId(request);
  const log: Partial<RequestLog> = {};
  const config = loadConfig(env);
  const origin = config.publicBaseUrl ?? url.origin;
  let response: Response;
  let errorCode: string | undefined;
  let routeName = url.pathname;
  // ALLOWED_ORIGINS 中的跨源来源调用 AI 接口时，响应（含错误）需要带上 CORS 头
  let corsOrigin: string | null = null;

  try {
    const route = ROUTES.find((r) => r.pattern.test(url.pathname));
    if (!route) throw new AppError(404, "NOT_FOUND", "接口不存在。");
    routeName = route.name;
    const params = (url.pathname.match(route.pattern)?.groups ?? {}) as Record<string, string>;
    if (route.access === "ai") {
      const requestOrigin = request.headers.get("Origin");
      if (requestOrigin && requestOrigin !== url.origin && config.allowedOrigins.includes(requestOrigin)) corsOrigin = requestOrigin;
      if (request.method === "OPTIONS") {
        // CORS 预检：只对允许的来源返回 CORS 头，其他跨站来源返回 403
        assertAllowedOrigin(request, config.allowedOrigins);
        const allow = Object.keys(route.methods).join(", ");
        const headers: Record<string, string> = { Allow: allow };
        if (corsOrigin) {
          headers["Access-Control-Allow-Methods"] = allow;
          headers["Access-Control-Allow-Headers"] = "Content-Type";
          headers["Access-Control-Max-Age"] = "86400";
        }
        return finish(new Response(null, { status: 204, headers }));
      }
    }
    const method = request.method === "HEAD" ? "GET" : (request.method as Method);
    const handler = route.methods[method];
    if (!handler) {
      const allow = Object.keys(route.methods).join(", ");
      const error = new AppError(405, "METHOD_NOT_ALLOWED", `该接口只支持 ${allow} 请求。`);
      return finish(errorResponse(error, requestId, { Allow: allow }), error.code);
    }
    let apiKey: ApiKeyRecord | undefined;
    if (route.access === "ai") {
      assertAllowedOrigin(request, config.allowedOrigins);
      await enforceRateLimit(env, request, url.pathname, config.rateLimitPerMinute);
    } else if (route.access === "key") {
      apiKey = await authenticate(env, request);
      await enforceRateLimit(env, request, "/api/v1", config.apiRateLimitPerMinute, apiKey.id);
      waitUntil(touchApiKey(env.DB!, apiKey.id, startedAt).catch(() => undefined));
    }
    response = await handler({ request, env, config, requestId, startedAt, log, waitUntil, params, origin, apiKey });
  } catch (error) {
    const appError = error instanceof AppError ? error : new AppError(500, "INTERNAL_ERROR", "服务器内部错误，请稍后重试。", { cause: error });
    if (appError.status >= 500) {
      logEvent("api.error_detail", {
        requestId,
        code: appError.code,
        upstreamCode: upstreamErrorCode(appError),
        errorName: appError.cause instanceof Error ? appError.cause.name : undefined,
      });
    }
    response = errorResponse(appError, requestId, appError.status === 401 ? { "WWW-Authenticate": "Bearer" } : {});
    errorCode = appError.code;
  }
  return finish(response, errorCode);

  async function finish(res: Response, code?: string): Promise<Response> {
    // 鉴权失败、限流等提前返回时请求体还没读，先丢弃（见 discardUnreadBody）
    await discardUnreadBody(request, config.maxBodyBytes);
    const entry: RequestLog = {
      ...log,
      requestId,
      route: routeName,
      status: res.status,
      code,
      latencyMs: Date.now() - startedAt,
    };
    logRequest(entry);
    recordMetrics(env, entry);
    res.headers.set("X-Request-Id", requestId);
    if (corsOrigin) {
      res.headers.set("Access-Control-Allow-Origin", corsOrigin);
      res.headers.set("Access-Control-Expose-Headers", "X-Request-Id");
      res.headers.append("Vary", "Origin");
    }
    return res;
  }
}
