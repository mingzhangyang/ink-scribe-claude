import type { Env } from "./env.ts";

/**
 * 结构化日志与用量指标。约定：任何日志字段都不得包含用户原文或模型输出正文，
 * 只记录长度、耗时、token 数、错误码等元数据。
 */
export type RequestLog = {
  requestId: string;
  route: string;
  status: number;
  code?: string;
  model?: string;
  latencyMs: number;
  attempts?: number;
  inputChars?: number;
  promptTokens?: number;
  completionTokens?: number;
  template?: string;
  style?: string;
  mock?: boolean;
  cached?: boolean;
  warnings?: number;
  /** agent 路由上未带 API 密钥的调用。 */
  anonymous?: boolean;
};

export function logRequest(entry: RequestLog): void {
  const line = JSON.stringify({ event: "api.request", ...entry });
  if (entry.status >= 500) console.error(line);
  else if (entry.status >= 400) console.warn(line);
  else console.log(line);
}

export function logEvent(event: string, fields: Record<string, string | number | boolean | undefined>): void {
  console.log(JSON.stringify({ event, ...fields }));
}

/** 写入 Workers Analytics Engine（可选绑定），用于统计调用量、失败率、延迟与 token 成本。 */
export function recordMetrics(env: Env, entry: RequestLog): void {
  if (!env.METRICS) return;
  try {
    env.METRICS.writeDataPoint({
      indexes: [entry.route],
      blobs: [entry.route, entry.model ?? "", String(entry.status), entry.code ?? "", entry.template ?? ""],
      doubles: [
        entry.latencyMs,
        entry.promptTokens ?? 0,
        entry.completionTokens ?? 0,
        entry.attempts ?? 0,
        entry.inputChars ?? 0,
      ],
    });
  } catch {
    // 指标写入失败不影响主流程
  }
}
