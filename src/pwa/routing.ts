/**
 * Service Worker 的请求分类（src/sw.ts 使用）。不依赖 DOM 或 Service Worker 全局对象，便于单元测试。
 */

export type RequestKind =
  /** 页面导航：网络优先，离线时返回缓存的应用外壳，由前端路由渲染对应页面 */
  | "page"
  /** 当前版本的构建产物与公共文件：缓存优先，随版本整体替换 */
  | "app"
  /** 字体分片与 PDF CMap：内容稳定，缓存优先，跨版本保留 */
  | "static"
  /** 不经过 Service Worker：API、跨域请求、非 GET 请求与 Worker 动态生成的文本 */
  | "bypass";

/** 离线时所有页面导航共用的应用外壳 */
export const SHELL_URL = "/";

/** 由 Worker 动态生成的文档，离线时不应该回退成应用外壳 */
const DYNAMIC_DOCUMENTS = new Set(["/llms.txt", "/robots.txt", "/sitemap.xml"]);

export type RequestLike = { method: string; mode: string; url: string };

export function classifyRequest(request: RequestLike, origin: string, precached: ReadonlySet<string>): RequestKind {
  if (request.method !== "GET") return "bypass";
  const url = new URL(request.url);
  if (url.origin !== origin) return "bypass";
  if (url.pathname.startsWith("/api/") || DYNAMIC_DOCUMENTS.has(url.pathname)) return "bypass";
  if (request.mode === "navigate") return "page";
  if (/^\/assets\/.+\.woff2$/.test(url.pathname) || url.pathname.startsWith("/pdfjs/cmaps/")) return "static";
  // 构建产物文件名带内容哈希；公共文件（图标、manifest 等）只在没有查询参数时使用预缓存
  if (url.pathname.startsWith("/assets/") || (precached.has(url.pathname) && !url.search)) return "app";
  return "bypass";
}

/** 字体加载失败后重试时加在 URL 上的参数（src/export/fontEmbed.ts），用于绕过浏览器缓存的失败结果 */
export const FONT_RETRY_PARAM = "ink-font-retry";

/** Service Worker 缓存的键：去掉字体重试参数，重试成功的字体与原 URL 共用同一条缓存。 */
export function cacheKey(url: string): string {
  const parsed = new URL(url);
  if (!parsed.searchParams.has(FONT_RETRY_PARAM)) return url;
  parsed.searchParams.delete(FONT_RETRY_PARAM);
  return parsed.href;
}

/** 只缓存同源的成功响应；静态资源未命中时可能回退成 index.html，不能当作脚本或字体缓存下来。 */
export function isCacheable(response: Pick<Response, "ok" | "status" | "type" | "headers">): boolean {
  if (!response.ok || response.status !== 200 || response.type !== "basic") return false;
  return !(response.headers.get("Content-Type") ?? "").startsWith("text/html");
}
