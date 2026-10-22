import type {
  ApiErrorBody,
  DoodleResponse,
  NoteListResponse,
  PublicConfig,
  PublishedNoteSummary,
  StructureRequest,
  StructureResponse,
} from "../shared/api.ts";
import { normalizeDoodleSpec, type DoodleSpec } from "../shared/doodle.ts";
import { normalizeNoteStructure, type NoteStructure } from "../shared/note.ts";
import { sanitizeSettings, type Settings } from "../shared/settings.ts";
import { normalizeStickers, type StickerItem } from "../shared/stickers.ts";
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

// ---------- 已发布的笔记与图库 ----------

export type ViewableNote = {
  summary: PublishedNoteSummary;
  note: NoteStructure;
  settings: Settings;
  stickers: StickerItem[];
  doodle: DoodleSpec | null;
};

async function getJson(path: string): Promise<unknown> {
  let response: Response;
  try {
    response = await fetch(path);
  } catch {
    throw new ApiRequestError({ code: "NETWORK_ERROR", message: "网络连接失败，请检查网络后重试。" });
  }
  const payload = (await response.json().catch(() => undefined)) as ApiErrorBody | undefined;
  if (!response.ok) {
    throw new ApiRequestError(payload?.error?.code ? payload.error : { code: "INTERNAL_ERROR", message: `服务暂时不可用（HTTP ${response.status}）。` });
  }
  return payload;
}

function safeSummary(raw: Record<string, unknown>): PublishedNoteSummary | null {
  const str = (value: unknown) => (typeof value === "string" ? value : "");
  if (typeof raw.id !== "string" || !/^[A-Za-z0-9_-]{22}$/.test(raw.id)) return null;
  const image = (raw.image ?? {}) as Record<string, unknown>;
  // 只接受本站的预览图路径，并转换为相对地址（与 CSP 的 img-src 'self' 一致）
  let imagePath = "";
  try {
    const parsed = new URL(str(image.url), location.origin);
    if (parsed.pathname === `/api/notes/${raw.id}/image.png`) imagePath = `${parsed.pathname}${parsed.search}`;
  } catch {
    imagePath = "";
  }
  return {
    id: raw.id,
    url: `/n/${raw.id}`,
    title: str(raw.title),
    summary: str(raw.summary),
    language: raw.language === "en" ? "en" : "zh",
    template: str(raw.template),
    layout: str(raw.layout),
    visibility: raw.visibility === "public" ? "public" : "unlisted",
    image: {
      status: image.status === "ready" || image.status === "pending" || image.status === "failed" ? image.status : "disabled",
      ...(imagePath ? { url: imagePath } : {}),
      ...(typeof image.width === "number" ? { width: image.width } : {}),
      ...(typeof image.height === "number" ? { height: image.height } : {}),
    },
    createdAt: str(raw.createdAt),
    updatedAt: str(raw.updatedAt),
  };
}

export async function fetchPublishedNote(id: string): Promise<ViewableNote> {
  const raw = (await getJson(`/api/notes/${encodeURIComponent(id)}`)) as Record<string, unknown> | undefined;
  const summary = raw ? safeSummary(raw) : null;
  const note = normalizeNoteStructure(raw?.note);
  if (!summary || !note.ok) throw new ApiRequestError({ code: "AI_OUTPUT_INVALID", message: "笔记数据无效。" });
  const doodle = normalizeDoodleSpec(raw?.doodle);
  return {
    summary,
    note: note.value,
    settings: sanitizeSettings(raw?.settings),
    stickers: normalizeStickers(raw?.stickers),
    doodle: doodle.ok ? doodle.value : null,
  };
}

export async function fetchGallery(params: { cursor?: string | null; template?: string; language?: string }): Promise<NoteListResponse> {
  const query = new URLSearchParams({ limit: "24" });
  if (params.cursor) query.set("cursor", params.cursor);
  if (params.template) query.set("template", params.template);
  if (params.language) query.set("language", params.language);
  const raw = (await getJson(`/api/gallery?${query}`)) as { items?: unknown[]; nextCursor?: unknown } | undefined;
  const items = (Array.isArray(raw?.items) ? raw.items : [])
    .map((item) => (item && typeof item === "object" ? safeSummary(item as Record<string, unknown>) : null))
    .filter((item): item is PublishedNoteSummary => item !== null);
  return { items, nextCursor: typeof raw?.nextCursor === "string" ? raw.nextCursor : null };
}
