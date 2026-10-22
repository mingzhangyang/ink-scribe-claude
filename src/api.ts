import type { ApiErrorBody, DoodleResponse, PublicConfig, StructureRequest, StructureResponse } from "../shared/api.ts";
import { normalizeDoodleSpec } from "../shared/doodle.ts";
import { normalizeNoteStructure } from "../shared/note.ts";
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

/**
 * 前端不直接信任接口返回值：与 Worker 使用同一套规范化逻辑再校验一次，
 * 防止前后端版本不一致或异常响应导致页面渲染失败。
 */
export async function structureText(request: StructureRequest, signal?: AbortSignal): Promise<StructureResponse> {
  const response = await postJson<Partial<StructureResponse> | undefined>("/api/structure", request, signal);
  const checked = normalizeNoteStructure(response?.note);
  if (!checked.ok || !response?.meta) {
    throw new ApiRequestError({ code: "AI_OUTPUT_INVALID", message: "服务返回的笔记结构无效，请重试。", requestId: response?.meta?.requestId });
  }
  return { note: checked.value, meta: response.meta };
}

export async function generateDoodle(concept: string, signal?: AbortSignal): Promise<DoodleResponse> {
  const response = await postJson<Partial<DoodleResponse> | undefined>("/api/doodle", { concept }, signal);
  const checked = normalizeDoodleSpec(response?.doodle);
  if (!checked.ok || !response?.meta) {
    throw new ApiRequestError({ code: "AI_OUTPUT_INVALID", message: "服务返回的插图无效，请重试。", requestId: response?.meta?.requestId });
  }
  return { doodle: checked.value, meta: response.meta };
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
