import type { ApiErrorBody, DoodleResponse, PublicConfig, StructureRequest, StructureResponse } from "../shared/api.ts";
import type { RequestError } from "./state/store.ts";

const CLIENT_TIMEOUT_MS = 120_000;

export class ApiRequestError extends Error {
  readonly detail: RequestError;
  constructor(detail: RequestError) {
    super(detail.message);
    this.detail = detail;
  }
}

async function postJson<T>(path: string, body: unknown, signal?: AbortSignal): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort("timeout"), CLIENT_TIMEOUT_MS);
  signal?.addEventListener("abort", () => controller.abort(signal.reason), { once: true });
  let response: Response;
  try {
    response = await fetch(path, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
  } catch (error) {
    if (controller.signal.aborted && controller.signal.reason === "timeout") {
      throw new ApiRequestError({ code: "CLIENT_TIMEOUT", message: "等待时间过长，请稍后重试。" });
    }
    if (signal?.aborted) throw error;
    throw new ApiRequestError({ code: "NETWORK_ERROR", message: "网络连接失败，请检查网络后重试。" });
  } finally {
    clearTimeout(timer);
  }

  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    payload = undefined;
  }
  if (!response.ok) {
    const error = (payload as ApiErrorBody | undefined)?.error;
    throw new ApiRequestError(
      error?.code
        ? error
        : { code: "INTERNAL_ERROR", message: `服务暂时不可用（HTTP ${response.status}），请稍后重试。` },
    );
  }
  return payload as T;
}

export function structureText(request: StructureRequest, signal?: AbortSignal): Promise<StructureResponse> {
  return postJson<StructureResponse>("/api/structure", request, signal);
}

export function generateDoodle(concept: string, signal?: AbortSignal): Promise<DoodleResponse> {
  return postJson<DoodleResponse>("/api/doodle", { concept }, signal);
}

export async function fetchPublicConfig(): Promise<PublicConfig | null> {
  try {
    const response = await fetch("/api/config");
    if (!response.ok) return null;
    return (await response.json()) as PublicConfig;
  } catch {
    return null;
  }
}
