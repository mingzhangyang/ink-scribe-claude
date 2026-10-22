import type { Env } from "./env.ts";
import { AppError } from "./http.ts";

/**
 * 优先使用 Workers Rate Limiting 绑定（跨实例、按 key 计数）。
 * 没有配置绑定时退化为单个 isolate 内的固定窗口计数，只能提供有限保护。
 */
const WINDOW_MS = 60_000;
const MAX_TRACKED_KEYS = 5_000;
const memoryBuckets = new Map<string, { windowStart: number; count: number }>();

function memoryLimit(key: string, limit: number, now: number): boolean {
  const bucket = memoryBuckets.get(key);
  if (!bucket || now - bucket.windowStart >= WINDOW_MS) {
    if (memoryBuckets.size >= MAX_TRACKED_KEYS) {
      for (const [k, b] of memoryBuckets) {
        if (now - b.windowStart >= WINDOW_MS) memoryBuckets.delete(k);
      }
      if (memoryBuckets.size >= MAX_TRACKED_KEYS) memoryBuckets.clear();
    }
    memoryBuckets.set(key, { windowStart: now, count: 1 });
    return true;
  }
  bucket.count++;
  return bucket.count <= limit;
}

export function clientKey(request: Request): string {
  return request.headers.get("CF-Connecting-IP") ?? request.headers.get("X-Forwarded-For")?.split(",")[0]?.trim() ?? "anonymous";
}

export async function enforceRateLimit(env: Env, request: Request, route: string, limitPerMinute: number): Promise<void> {
  const key = `${route}:${clientKey(request)}`;
  let allowed: boolean;
  if (env.RATE_LIMITER) {
    try {
      allowed = (await env.RATE_LIMITER.limit({ key })).success;
    } catch {
      allowed = memoryLimit(key, limitPerMinute, Date.now());
    }
  } else {
    allowed = memoryLimit(key, limitPerMinute, Date.now());
  }
  if (!allowed) {
    throw new AppError(429, "RATE_LIMITED", "请求过于频繁，请稍后再试。", { retryAfterSeconds: 60 });
  }
}

/** 仅供测试使用。 */
export function resetMemoryRateLimit(): void {
  memoryBuckets.clear();
}
