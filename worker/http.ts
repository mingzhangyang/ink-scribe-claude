import type { ApiErrorBody, ErrorCode } from "../shared/api.ts";

export class AppError extends Error {
  readonly status: number;
  readonly code: ErrorCode;
  readonly retryAfterSeconds?: number;

  constructor(status: number, code: ErrorCode, message: string, options: { retryAfterSeconds?: number; cause?: unknown } = {}) {
    super(message, { cause: options.cause });
    this.status = status;
    this.code = code;
    this.retryAfterSeconds = options.retryAfterSeconds;
  }
}

const BASE_HEADERS: Record<string, string> = {
  "Content-Type": "application/json; charset=utf-8",
  "Cache-Control": "no-store",
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "no-referrer",
};

export function jsonResponse(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...BASE_HEADERS, ...headers } });
}

export function errorResponse(error: AppError, requestId: string, extraHeaders: Record<string, string> = {}): Response {
  const body: ApiErrorBody = {
    error: {
      code: error.code,
      message: error.message,
      requestId,
      ...(error.retryAfterSeconds ? { retryAfterSeconds: error.retryAfterSeconds } : {}),
    },
  };
  const headers: Record<string, string> = { ...extraHeaders };
  if (error.retryAfterSeconds) headers["Retry-After"] = String(error.retryAfterSeconds);
  return jsonResponse(body, error.status, headers);
}

/** 只接受 JSON 请求体，并在读取过程中强制执行字节上限（不信任 Content-Length）。 */
/** 丢弃请求体的时间上限：客户端迟迟不发完时不能拖住已经确定的错误响应。 */
const DISCARD_BODY_TIMEOUT_MS = 1_000;

/**
 * 在未读取请求体就返回（鉴权失败、限流、方法不允许等）时丢弃请求体。
 * 留着没读的请求体会让本地预览（Vite 插件经 keep-alive 连接转发给 workerd）的下一个请求
 * 偶发 “fetch failed”。最多读取 maxBytes、最多等待 timeoutMs，超出时直接取消（不等待取消完成）。
 */
export async function discardUnreadBody(request: Request, maxBytes: number, timeoutMs = DISCARD_BODY_TIMEOUT_MS): Promise<void> {
  if (!request.body || request.bodyUsed) return;
  const reader = request.body.getReader();
  const drain = async () => {
    let total = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) return;
      total += value.byteLength;
      if (total > maxBytes) break;
    }
    void reader.cancel().catch(() => undefined);
  };
  let timer: ReturnType<typeof setTimeout> | null = null;
  const deadline = new Promise<void>((resolve) => {
    timer = setTimeout(() => {
      void reader.cancel().catch(() => undefined);
      resolve();
    }, timeoutMs);
  });
  try {
    // 客户端中途断开时 read() 会抛错：没有需要处理的内容
    await Promise.race([drain().catch(() => undefined), deadline]);
  } finally {
    clearTimeout(timer);
  }
}

export async function readJsonBody(request: Request, maxBytes: number): Promise<unknown> {
  const contentType = request.headers.get("Content-Type") ?? "";
  if (!/^application\/json\b/i.test(contentType.trim())) {
    throw new AppError(415, "UNSUPPORTED_MEDIA_TYPE", "请求必须使用 application/json。");
  }
  const declared = Number(request.headers.get("Content-Length"));
  if (Number.isFinite(declared) && declared > maxBytes) {
    throw new AppError(413, "PAYLOAD_TOO_LARGE", "请求体过大，请缩短文本后重试。");
  }
  if (!request.body) throw new AppError(400, "INVALID_JSON", "请求体为空。");

  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel();
      throw new AppError(413, "PAYLOAD_TOO_LARGE", "请求体过大，请缩短文本后重试。");
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  try {
    return JSON.parse(new TextDecoder().decode(bytes)) as unknown;
  } catch {
    throw new AppError(400, "INVALID_JSON", "请求体不是合法的 JSON。");
  }
}

/**
 * 浏览器跨站请求会携带 Origin。仅允许同源或显式配置的来源调用 AI 接口，
 * 防止其他网站借用户浏览器消耗本服务的模型额度。没有 Origin 的请求（如 curl）不受影响，
 * 由限流兜底。
 */
export function assertAllowedOrigin(request: Request, allowedOrigins: string[]): void {
  const origin = request.headers.get("Origin");
  if (!origin) return;
  const self = new URL(request.url).origin;
  if (origin === self || allowedOrigins.includes(origin)) return;
  throw new AppError(403, "FORBIDDEN_ORIGIN", "不允许从该来源调用接口。");
}
