/// <reference lib="webworker" />
import { APP_CACHE_PREFIX, pruneRetiredCaches, retireCaches } from "./pwa/cleanup.ts";
import { cacheKey, classifyRequest, isCacheable, SHELL_URL } from "./pwa/routing.ts";

/**
 * 墨语笔记的 Service Worker：让应用可以安装到桌面或主屏幕，并在离线时打开编辑器、笔记库与已用过的字体。
 * 由 vite.config.ts 中的 serviceWorker 插件打包为 /sw.js，并把 __PWA_MANIFEST__ 替换成本次构建的版本号与预缓存清单。
 * AI 整理、图库与发布接口始终走网络。
 */

declare const self: ServiceWorkerGlobalScope;
declare const __PWA_MANIFEST__: { version: string; precache: string[] };

const MANIFEST = __PWA_MANIFEST__;
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
      // 此刻受控的页面运行的是旧版本脚本（点击“刷新”的页面随后会重新加载），仍未关闭的更早版本页面也在其中
      const legacy = (await self.clients.matchAll({ type: "window" })).map((client) => client.id);
      await retireCaches(caches, APP_CACHE, legacy);
      await pruneOldCaches();
      // 首次安装后立即接管已打开的页面，无需刷新即可离线使用
      await self.clients.claim();
    })(),
  );
});

/** 更新前打开的页面都关闭后，删除旧版本的缓存。 */
function pruneOldCaches(): Promise<void> {
  return pruneRetiredCaches(caches, APP_CACHE, async (id) => Boolean(await self.clients.get(id)));
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
  // 字体重试时 URL 带有重试参数；缓存时去掉它，离线重新打开页面请求原 URL 也能命中
  const key = cacheKey(event.request.url);
  const cached = await cache.match(key, { ignoreVary: true })
    // 更新前打开的页面需要旧版本的分片：构建产物文件名带内容哈希，可以从任何版本的缓存中取用
    ?? (new URL(key).pathname.startsWith("/assets/") ? await caches.match(key, { ignoreVary: true }) : undefined);
  if (cached) return cached;
  // 请求仍使用原 URL，重试参数照常绕过浏览器中失败的字体缓存
  const response = await fetch(event.request);
  if (isCacheable(response)) event.waitUntil(cache.put(key, response.clone()).catch(() => {}));
  return response;
}
