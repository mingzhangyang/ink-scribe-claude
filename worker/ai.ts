import type { NormalizeResult } from "../shared/doodle.ts";
import { truncate } from "../shared/text.ts";
import type { AiTaskConfig } from "./config.ts";
import { AppError } from "./http.ts";
import { buildRepairMessage } from "./prompts.ts";

/** Workers AI binding 的最小接口，便于在测试中替换。 */
export interface AiBinding {
  run(model: string, inputs: Record<string, unknown>, options?: AiOptions): Promise<unknown>;
}

type ChatMessage = { role: "system" | "user" | "assistant"; content: string };

export type Usage = { promptTokens: number; completionTokens: number };

export type JsonTaskResult<T> = {
  value: T;
  warnings: string[];
  attempts: number;
  usage: Usage;
};

export type JsonTask<T> = {
  system: string;
  user: string;
  schemaName: string;
  schema: Record<string, unknown>;
  normalize: (raw: unknown) => NormalizeResult<T>;
  /** 多次尝试仍无法得到合法结构时返回给用户的提示。 */
  invalidMessage: string;
};

const MAX_REPAIR_ECHO_CHARS = 6_000;

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function toNumber(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

export function buildModelInputs(
  task: AiTaskConfig,
  messages: ChatMessage[],
  schemaName: string,
  schema: Record<string, unknown>,
): Record<string, unknown> {
  const { profile } = task;
  const withSuffix = messages.map((m, i) =>
    profile.promptSuffix && i === messages.length - 1 && m.role === "user"
      ? { ...m, content: `${m.content}\n${profile.promptSuffix}` }
      : m,
  );

  if (profile.apiStyle === "responses") {
    const [system, ...rest] = withSuffix;
    const inputs: Record<string, unknown> = {
      instructions: system.content,
      input: rest.map((m) => ({ role: m.role, content: m.content })),
      max_output_tokens: task.maxOutputTokens,
      temperature: task.temperature,
    };
    if (profile.responseFormat === "json_schema" || profile.responseFormat === "openai_json_schema") {
      inputs.text = { format: { type: "json_schema", name: schemaName, schema, strict: false } };
    } else if (profile.responseFormat === "json_object") {
      inputs.text = { format: { type: "json_object" } };
    }
    return { ...inputs, ...profile.extraParams };
  }

  const inputs: Record<string, unknown> = {
    messages: withSuffix,
    max_tokens: task.maxOutputTokens,
    temperature: task.temperature,
  };
  switch (profile.responseFormat) {
    case "json_schema":
      inputs.response_format = { type: "json_schema", json_schema: schema };
      break;
    case "openai_json_schema":
      inputs.response_format = { type: "json_schema", json_schema: { name: schemaName, schema, strict: false } };
      break;
    case "json_object":
      inputs.response_format = { type: "json_object" };
      break;
    case "none":
      break;
  }
  return { ...inputs, ...profile.extraParams };
}

/**
 * 兼容多种 Workers AI 输出形态：
 * - 传统文本生成：{ response: string | object, usage }
 * - Chat Completions：{ choices: [{ message: { content } }], usage }
 * - Responses：{ output: [{ type: "message", content: [{ type: "output_text", text }] }], usage }
 * - 直接返回字符串
 */
export function extractModelOutput(output: unknown): { text?: string; object?: unknown; usage: Usage } {
  const usage: Usage = { promptTokens: 0, completionTokens: 0 };
  if (typeof output === "string") return { text: output, usage };
  if (!isRecord(output)) return { usage };

  if (isRecord(output.usage)) {
    usage.promptTokens = toNumber(output.usage.prompt_tokens) || toNumber(output.usage.input_tokens);
    usage.completionTokens = toNumber(output.usage.completion_tokens) || toNumber(output.usage.output_tokens);
  }

  if ("response" in output) {
    const response = output.response;
    if (typeof response === "string") return { text: response, usage };
    if (isRecord(response)) return { object: response, usage };
  }

  if (Array.isArray(output.choices) && output.choices.length > 0) {
    const choice = output.choices[0] as Record<string, unknown>;
    const message = isRecord(choice?.message) ? choice.message : undefined;
    const content = message?.content ?? choice?.text;
    if (typeof content === "string") return { text: content, usage };
    if (Array.isArray(content)) {
      const text = content
        .map((part) => (isRecord(part) && typeof part.text === "string" ? part.text : ""))
        .join("");
      return { text, usage };
    }
  }

  if (Array.isArray(output.output)) {
    const parts: string[] = [];
    for (const item of output.output) {
      if (!isRecord(item) || item.type !== "message" || !Array.isArray(item.content)) continue;
      for (const part of item.content) {
        if (isRecord(part) && typeof part.text === "string") parts.push(part.text);
      }
    }
    if (parts.length > 0) return { text: parts.join(""), usage };
  }

  if (typeof output.output_text === "string") return { text: output.output_text, usage };
  return { usage };
}

/** 宽松解析模型返回的 JSON：去掉思考块与代码块标记，必要时截取第一个完整对象。 */
export function parseJsonLoose(text: string): unknown {
  let cleaned = text
    .replace(/<think>[\s\S]*?<\/think>/gi, "")
    .replace(/^[\s\S]*?<\/think>/i, "")
    .trim();
  const fence = cleaned.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) cleaned = fence[1].trim();
  try {
    return JSON.parse(cleaned);
  } catch {
    const start = cleaned.indexOf("{");
    const end = cleaned.lastIndexOf("}");
    if (start >= 0 && end > start) return JSON.parse(cleaned.slice(start, end + 1));
    throw new SyntaxError("No JSON object found");
  }
}

/**
 * 将 Workers AI 抛出的错误映射为稳定的错误码。只根据错误码数字和关键字判断，
 * 不把上游错误原文透传给客户端或写入日志（其中可能夹带输入片段）。
 */
export function classifyAiError(error: unknown): AppError {
  if (error instanceof AppError) return error;
  const name = error instanceof Error ? error.name : "";
  const message = error instanceof Error ? error.message : String(error);
  if (name === "AbortError" || /timed? ?out|timeout/i.test(message)) {
    return new AppError(504, "AI_TIMEOUT", "AI 处理超时，请缩短文本或稍后重试。", { cause: error });
  }
  if (/\b3036\b|\b4006\b|daily free|neurons|rate limit|too many requests|\b429\b/i.test(message)) {
    return new AppError(429, "AI_RATE_LIMITED", "AI 服务调用额度已达上限，请稍后再试。", { retryAfterSeconds: 60, cause: error });
  }
  if (/\b3040\b|capacity|overloaded|temporarily unavailable|\b503\b/i.test(message)) {
    return new AppError(503, "AI_UNAVAILABLE", "AI 服务繁忙，请稍后重试。", { retryAfterSeconds: 10, cause: error });
  }
  return new AppError(502, "AI_UNAVAILABLE", "AI 服务暂时不可用，请稍后重试。", { cause: error });
}

/**
 * 从上游错误中提取可安全记录的错误编号（例如 “InferenceUpstreamError: 3040: …” 中的 3040）。
 * 只匹配消息开头或 “Error:” 之后紧跟冒号的 4 位编号，避免把错误信息里回显的原文数字写进日志。
 */
export function upstreamErrorCode(error: unknown): string | undefined {
  const cause = error instanceof AppError ? error.cause : error;
  const message = cause instanceof Error ? cause.message : typeof cause === "string" ? cause : "";
  return message.match(/(?:^|Error:\s*)(\d{4}):/)?.[1];
}

async function callModel(ai: AiBinding, task: AiTaskConfig, inputs: Record<string, unknown>, timeoutMs: number): Promise<unknown> {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      controller.abort();
      reject(new AppError(504, "AI_TIMEOUT", "AI 处理超时，请缩短文本或稍后重试。"));
    }, timeoutMs);
  });
  const options: AiOptions = { signal: controller.signal };
  // 通过 AI Gateway 时关闭请求/响应正文日志，避免在网关侧持久化用户原文
  if (task.gatewayId) options.gateway = { id: task.gatewayId, collectLog: false };
  try {
    return await Promise.race([ai.run(task.model, inputs, options), timeout]);
  } catch (error) {
    throw classifyAiError(error);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

/**
 * 调用模型并得到通过校验的结构化结果。
 * 输出无法解析或不符合契约时，把错误反馈给模型做有限次数的修复；
 * 上游暂时性错误也会在时间预算内重试一次。
 */
export async function runJsonTask<T>(ai: AiBinding, task: AiTaskConfig, job: JsonTask<T>): Promise<JsonTaskResult<T>> {
  const started = Date.now();
  const usage: Usage = { promptTokens: 0, completionTokens: 0 };
  const baseMessages: ChatMessage[] = [
    { role: "system", content: job.system },
    { role: "user", content: job.user },
  ];
  let messages = baseMessages;
  let attempts = 0;
  let lastUpstreamError: AppError | undefined;

  while (attempts <= task.maxRetries) {
    // 只有在时间预算的前一半内才发起重试，保证整体延迟有上限
    if (attempts > 0 && Date.now() - started > task.timeoutMs / 2) break;
    attempts++;

    let output: unknown;
    try {
      output = await callModel(ai, task, buildModelInputs(task, messages, job.schemaName, job.schema), task.timeoutMs);
    } catch (error) {
      const appError = classifyAiError(error);
      if (appError.code === "AI_UNAVAILABLE" && appError.status === 503) {
        lastUpstreamError = appError;
        continue;
      }
      throw appError;
    }
    lastUpstreamError = undefined;

    const extracted = extractModelOutput(output);
    usage.promptTokens += extracted.usage.promptTokens;
    usage.completionTokens += extracted.usage.completionTokens;

    let parsed: unknown;
    let errors: string[];
    try {
      parsed = extracted.object ?? parseJsonLoose(extracted.text ?? "");
      const result = job.normalize(parsed);
      if (result.ok) {
        const warnings = attempts > 1 ? [...result.warnings, "模型输出经过一次修复"] : result.warnings;
        return { value: result.value, warnings, attempts, usage };
      }
      errors = result.errors;
    } catch {
      errors = ["输出不是合法的 JSON 对象"];
    }

    const previous = extracted.text ?? (parsed !== undefined ? JSON.stringify(parsed) : "");
    messages = [
      ...baseMessages,
      { role: "assistant", content: truncate(previous, MAX_REPAIR_ECHO_CHARS) || "（空输出）" },
      { role: "user", content: buildRepairMessage(errors) },
    ];
  }

  if (lastUpstreamError) throw lastUpstreamError;
  throw new AppError(502, "AI_OUTPUT_INVALID", job.invalidMessage);
}
