/** Worker 绑定与环境变量。所有变量在 wrangler.jsonc 的 vars 中声明，均为字符串。 */
export interface Env {
  AI: Ai;
  ASSETS?: Fetcher;
  RATE_LIMITER?: RateLimit;
  METRICS?: AnalyticsEngineDataset;

  AI_MODEL?: string;
  AI_DOODLE_MODEL?: string;
  AI_API_STYLE?: string;
  AI_RESPONSE_FORMAT?: string;
  AI_EXTRA_PARAMS?: string;
  AI_TEMPERATURE?: string;
  AI_MAX_OUTPUT_TOKENS?: string;
  AI_TIMEOUT_MS?: string;
  AI_MAX_RETRIES?: string;
  AI_GATEWAY_ID?: string;
  AI_MOCK?: string;

  MAX_INPUT_CHARS?: string;
  MAX_BODY_BYTES?: string;
  RATE_LIMIT_PER_MINUTE?: string;
  DOODLE_API_ENABLED?: string;
  DOODLE_CACHE_TTL_SECONDS?: string;
  ALLOWED_ORIGINS?: string;
}
