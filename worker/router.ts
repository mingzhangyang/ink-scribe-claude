import type { PublicConfig } from "../shared/api.ts";
import { upstreamErrorCode } from "./ai.ts";
import { loadConfig, type AppConfig } from "./config.ts";
import type { Env } from "./env.ts";
import { AppError, assertAllowedOrigin, errorResponse, jsonResponse } from "./http.ts";
import { logEvent, logRequest, recordMetrics, type RequestLog } from "./log.ts";
import { enforceRateLimit } from "./rate-limit.ts";
import { handleDoodle } from "./routes/doodle.ts";
import { handleStructure } from "./routes/structure.ts";

export type RouteContext = {
  request: Request;
  env: Env;
  config: AppConfig;
  requestId: string;
  startedAt: number;
  log: Partial<RequestLog>;
  waitUntil: (promise: Promise<unknown>) => void;
};

type Route = {
  method: "GET" | "POST";
  /** 是否调用模型（需要来源校验与限流）。 */
  ai: boolean;
  handler: (ctx: RouteContext) => Promise<Response>;
};

const ROUTES: Record<string, Route> = {
  "/api/config": {
    method: "GET",
    ai: false,
    handler: async ({ config }) => {
      const body: PublicConfig = {
        maxInputChars: config.maxInputChars,
        doodleEnabled: config.doodleEnabled,
        mock: config.mock,
      };
      return jsonResponse(body, 200, { "Cache-Control": "public, max-age=60" });
    },
  },
  "/api/structure": { method: "POST", ai: true, handler: handleStructure },
  "/api/doodle": { method: "POST", ai: true, handler: handleDoodle },
};

function newRequestId(request: Request): string {
  const ray = request.headers.get("CF-Ray");
  return ray ? ray.split("-")[0] : crypto.randomUUID();
}

export async function handleApi(request: Request, env: Env, waitUntil: (promise: Promise<unknown>) => void): Promise<Response> {
  const startedAt = Date.now();
  const url = new URL(request.url);
  const requestId = newRequestId(request);
  const log: Partial<RequestLog> = {};
  const config = loadConfig(env);
  let response: Response;
  let errorCode: string | undefined;

  try {
    const route = ROUTES[url.pathname];
    if (!route) throw new AppError(404, "NOT_FOUND", "接口不存在。");
    if (request.method !== route.method) {
      const error = new AppError(405, "METHOD_NOT_ALLOWED", `该接口只支持 ${route.method} 请求。`);
      return finish(errorResponse(error, requestId, { Allow: route.method }), error.code);
    }
    if (route.ai) {
      assertAllowedOrigin(request, config.allowedOrigins);
      await enforceRateLimit(env, request, url.pathname, config.rateLimitPerMinute);
    }
    response = await route.handler({ request, env, config, requestId, startedAt, log, waitUntil });
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
    response = errorResponse(appError, requestId);
    errorCode = appError.code;
  }
  return finish(response, errorCode);

  function finish(res: Response, code?: string): Response {
    const entry: RequestLog = {
      ...log,
      requestId,
      route: url.pathname,
      status: res.status,
      code,
      latencyMs: Date.now() - startedAt,
    };
    logRequest(entry);
    recordMetrics(env, entry);
    res.headers.set("X-Request-Id", requestId);
    return res;
  }
}
