/// <reference lib="webworker" />
import { classifyRequest, isCacheable, SHELL_URL } from "./pwa/routing.ts";

/**
 * 墨语笔记的 Service Worker：让应用可以安装到桌面或主屏幕，并在离线时打开编辑器、笔记库与已用过的字体。
 * 由 vite.config.ts 中的 serviceWorker 插件打包为 /sw.js，并把 __PWA_MANIFEST__ 替换成本次构建的版本号与预缓存清单。
 * AI 整理、图库与发布接口始终走网络。
 */

declare const self: ServiceWorkerGlobalScope;
declare const __PWA_MANIFEST__: { version: string; precache: string[] };

const MANIFEST = __PWA_MANIFEST__;
const APP_CACHE_PREFIX = "ink-scribe-app-";
const APP_CACHE = `${APP_CACHE_PREFIX}${MANIFEST.version}`;
const STATIC_CACHE = "ink-scribe-static-v1";
/** 记录更新前已打开的页面，它们关闭之前保留旧版本缓存 */
const META_CACHE = "ink-scribe-meta";
const LEGACY_CLIENTS_KEY = "/__ink-scribe/legacy-clients";
const precached = new Set(MANIFEST.precache);

self.addEventListener("install", (event) => {
  // 绕过 HTTP 缓存，确保外壳与本次部署的脚本一致
  event.waitUntil(
    caches.open(APP_CACHE).then((cache) => cache.addAll(MANIFEST.precache.map((url) => new Request(url, { cache: "reload" })))),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      // 此刻受控的页面运行的是旧版本脚本（点击“刷新”的页面随后会重新加载）。接管后它们仍可能按需加载旧版本的分片，
      // 所以等这些页面都关闭后再删除旧缓存。仍未关闭的更早版本页面也受旧 Service Worker 控制，会一并记录
      const legacy = (await self.clients.matchAll({ type: "window" })).map((client) => client.id);
      const meta = await caches.open(META_CACHE);
      await meta.put(LEGACY_CLIENTS_KEY, new Response(JSON.stringify(legacy), { headers: { "Content-Type": "application/json" } }));
      await pruneOldCaches();
      // 首次安装后立即接管已打开的页面，无需刷新即可离线使用
      await self.clients.claim();
    })(),
  );
});

/** 更新前打开的页面都关闭后，删除旧版本的缓存。 */
async function pruneOldCaches(): Promise<void> {
  const meta = await caches.open(META_CACHE);
  const ids: string[] = await (await meta.match(LEGACY_CLIENTS_KEY))?.json().catch(() => []) ?? [];
  const alive = await Promise.all(ids.map((id) => self.clients.get(id)));
  if (alive.some(Boolean)) return;
  const names = await caches.keys();
  await Promise.all(names.filter((name) => name.startsWith(APP_CACHE_PREFIX) && name !== APP_CACHE).map((name) => caches.delete(name)));
  await meta.delete(LEGACY_CLIENTS_KEY);
}

// 新版本安装后等待页面确认（“刷新”按钮）再接管，避免正在编辑的页面中途换版本
self.addEventListener("message", (event) => {
  if (event.data?.type === "SKIP_WAITING") void self.skipWaiting();
});

self.addEventListener("fetch", (event) => {
  const kind = classifyRequest(event.request, self.location.origin, precached);
  if (kind === "bypass") return;
  if (kind === "page") {
    event.respondWith(networkFirstPage(event.request));
    // 每次打开或刷新页面时顺带检查旧页面是否都已关闭
    event.waitUntil(pruneOldCaches().catch(() => {}));
  }
  else event.respondWith(cacheFirst(event, kind === "app" ? APP_CACHE : STATIC_CACHE));
});

async function networkFirstPage(request: Request): Promise<Response> {
  try {
    return await fetch(request);
  } catch (error) {
    // 服务端注入的 SEO 正文会在脚本加载后被替换，所以任何页面都可以用首页外壳渲染
    const shell = await caches.match(SHELL_URL, { cacheName: APP_CACHE, ignoreVary: true });
    if (shell) return shell;
    throw error;
  }
}

async function cacheFirst(event: FetchEvent, cacheName: string): Promise<Response> {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(event.request, { ignoreVary: true })
    // 更新前打开的页面需要旧版本的分片：构建产物文件名带内容哈希，可以从任何版本的缓存中取用
    ?? (new URL(event.request.url).pathname.startsWith("/assets/") ? await caches.match(event.request, { ignoreVary: true }) : undefined);
  if (cached) return cached;
  const response = await fetch(event.request);
  if (isCacheable(response)) event.waitUntil(cache.put(event.request, response.clone()).catch(() => {}));
  return response;
}
