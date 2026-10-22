import type { Env } from "./env.ts";

/**
 * 模型调用方式。
 * - messages：Workers AI 文本生成 / Chat Completions 风格（{ messages, max_tokens, response_format }）
 * - responses：OpenAI Responses 风格（{ instructions, input, max_output_tokens, text.format }）
 */
export type ApiStyle = "messages" | "responses";

/**
 * 结构化输出方式。
 * - json_schema：Workers AI 原生 JSON 模式，response_format.json_schema 直接放 Schema
 * - openai_json_schema：OpenAI 兼容格式，response_format.json_schema = { name, schema, strict }
 * - json_object：只要求输出 JSON 对象，不携带 Schema
 * - none：不使用 JSON 模式，仅依赖提示词 + 服务端解析校验
 */
export type ResponseFormatMode = "json_schema" | "openai_json_schema" | "json_object" | "none";

export type ModelProfile = {
  apiStyle: ApiStyle;
  responseFormat: ResponseFormatMode;
  extraParams: Record<string, unknown>;
  /** 追加到用户消息末尾的控制指令，例如 Qwen3 的 /no_think 软开关。 */
  promptSuffix?: string;
};

/**
 * 已知模型的调用约定，依据 @cloudflare/workers-types 中的模型输入类型整理。
 * 这是配置数据而非业务逻辑：新增或替换模型时只需在此登记或通过环境变量覆盖。
 * 未登记的模型使用 DEFAULT_PROFILE。
 */
export const MODEL_PROFILES: Record<string, Partial<ModelProfile>> = {
  "@cf/qwen/qwen3-30b-a3b-fp8": {
    responseFormat: "json_schema",
    // Qwen3 默认开启思考模式，会显著增加延迟与输出 token；结构化整理任务不需要。
    // 该模型的输入类型未声明 chat_template_kwargs，因此使用聊天模板自带的 /no_think 软开关。
    promptSuffix: "/no_think",
  },
  "@cf/meta/llama-3.3-70b-instruct-fp8-fast": { responseFormat: "json_schema" },
  "@cf/meta/llama-4-scout-17b-16e-instruct": { responseFormat: "json_schema" },
  "@cf/mistralai/mistral-small-3.1-24b-instruct": { responseFormat: "json_object" },
  "@cf/google/gemma-3-12b-it": { responseFormat: "json_object" },
  "@cf/qwen/qwen3.8-27b": {
    responseFormat: "openai_json_schema",
    extraParams: { chat_template_kwargs: { enable_thinking: false } },
  },
  "@cf/zai-org/glm-4.7-flash": { responseFormat: "openai_json_schema" },
  "@cf/zai-org/glm-5.3-flash": { responseFormat: "openai_json_schema", extraParams: { reasoning_effort: "low" } },
  "@cf/deepseek-ai/deepseek-v4-flash-0731": { responseFormat: "openai_json_schema" },
  "@cf/openai/gpt-oss-20b": { apiStyle: "responses", responseFormat: "openai_json_schema", extraParams: { reasoning: { effort: "low" } } },
  "@cf/openai/gpt-oss-120b": { apiStyle: "responses", responseFormat: "openai_json_schema", extraParams: { reasoning: { effort: "low" } } },
};

const DEFAULT_PROFILE: ModelProfile = {
  apiStyle: "messages",
  responseFormat: "json_schema",
  extraParams: {},
};

export const DEFAULT_MODEL = "@cf/qwen/qwen3-30b-a3b-fp8";

export type AiTaskConfig = {
  model: string;
  profile: ModelProfile;
  temperature: number;
  maxOutputTokens: number;
  timeoutMs: number;
  maxRetries: number;
  gatewayId?: string;
};

export type AppConfig = {
  mock: boolean;
  structure: AiTaskConfig;
  doodle: AiTaskConfig;
  maxInputChars: number;
  maxBodyBytes: number;
  rateLimitPerMinute: number;
  doodleEnabled: boolean;
  doodleCacheTtlSeconds: number;
  allowedOrigins: string[];
};

function int(value: string | undefined, fallback: number, min: number, max: number): number {
  const n = value === undefined || value.trim() === "" ? NaN : Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, Math.round(n)));
}

function float(value: string | undefined, fallback: number, min: number, max: number): number {
  const n = value === undefined || value.trim() === "" ? NaN : Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

function bool(value: string | undefined, fallback: boolean): boolean {
  if (value === undefined || value.trim() === "") return fallback;
  return ["1", "true", "yes", "on"].includes(value.trim().toLowerCase());
}

function parseExtraParams(value: string | undefined): Record<string, unknown> | undefined {
  if (!value || !value.trim()) return undefined;
  try {
    const parsed = JSON.parse(value) as unknown;
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) return parsed as Record<string, unknown>;
  } catch {
    // 配置错误时忽略并记录告警，避免整个服务不可用
  }
  console.warn(JSON.stringify({ event: "config.invalid_extra_params" }));
  return undefined;
}

export function resolveProfile(model: string, env: Env): ModelProfile {
  const known = MODEL_PROFILES[model] ?? {};
  const style = env.AI_API_STYLE?.trim();
  const format = env.AI_RESPONSE_FORMAT?.trim();
  const extra = parseExtraParams(env.AI_EXTRA_PARAMS);
  return {
    apiStyle: style === "messages" || style === "responses" ? style : (known.apiStyle ?? DEFAULT_PROFILE.apiStyle),
    responseFormat:
      format === "json_schema" || format === "openai_json_schema" || format === "json_object" || format === "none"
        ? format
        : (known.responseFormat ?? DEFAULT_PROFILE.responseFormat),
    extraParams: extra ?? known.extraParams ?? DEFAULT_PROFILE.extraParams,
    promptSuffix: known.promptSuffix,
  };
}

export function loadConfig(env: Env): AppConfig {
  const model = env.AI_MODEL?.trim() || DEFAULT_MODEL;
  const doodleModel = env.AI_DOODLE_MODEL?.trim() || model;
  const base = {
    temperature: float(env.AI_TEMPERATURE, 0.3, 0, 1.5),
    maxOutputTokens: int(env.AI_MAX_OUTPUT_TOKENS, 2048, 256, 8192),
    timeoutMs: int(env.AI_TIMEOUT_MS, 45_000, 5_000, 120_000),
    maxRetries: int(env.AI_MAX_RETRIES, 1, 0, 3),
    gatewayId: env.AI_GATEWAY_ID?.trim() || undefined,
  };
  return {
    mock: bool(env.AI_MOCK, false),
    structure: { ...base, model, profile: resolveProfile(model, env) },
    doodle: { ...base, model: doodleModel, profile: resolveProfile(doodleModel, env), maxOutputTokens: Math.min(base.maxOutputTokens, 1200) },
    maxInputChars: int(env.MAX_INPUT_CHARS, 12_000, 200, 60_000),
    maxBodyBytes: int(env.MAX_BODY_BYTES, 65_536, 4_096, 1_048_576),
    rateLimitPerMinute: int(env.RATE_LIMIT_PER_MINUTE, 12, 1, 1_000),
    doodleEnabled: bool(env.DOODLE_API_ENABLED, false),
    doodleCacheTtlSeconds: int(env.DOODLE_CACHE_TTL_SECONDS, 86_400, 0, 2_592_000),
    allowedOrigins: (env.ALLOWED_ORIGINS ?? "")
      .split(",")
      .map((o) => o.trim())
      .filter(Boolean),
  };
}
