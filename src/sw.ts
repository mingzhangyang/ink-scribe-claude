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
      const names = await caches.keys();
      await Promise.all(names.filter((name) => name.startsWith(APP_CACHE_PREFIX) && name !== APP_CACHE).map((name) => caches.delete(name)));
      // 首次安装后立即接管已打开的页面，无需刷新即可离线使用
      await self.clients.claim();
    })(),
  );
});

// 新版本安装后等待页面确认（“刷新”按钮）再接管，避免正在编辑的页面中途换版本
self.addEventListener("message", (event) => {
  if (event.data?.type === "SKIP_WAITING") void self.skipWaiting();
});

self.addEventListener("fetch", (event) => {
  const kind = classifyRequest(event.request, self.location.origin, precached);
  if (kind === "bypass") return;
  if (kind === "page") event.respondWith(networkFirstPage(event.request));
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
  const cached = await cache.match(event.request, { ignoreVary: true });
  if (cached) return cached;
  const response = await fetch(event.request);
  if (isCacheable(response)) event.waitUntil(cache.put(event.request, response.clone()).catch(() => {}));
  return response;
}
