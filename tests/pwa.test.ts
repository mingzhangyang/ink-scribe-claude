import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { APP_CACHE_PREFIX, pruneRetiredCaches, retireCaches } from "../src/pwa/cleanup.ts";
import { cacheKey, classifyRequest, FONT_RETRY_PARAM, isCacheable } from "../src/pwa/routing.ts";

const ORIGIN = "https://ink.example";
const PRECACHED = new Set(["/", "/site.webmanifest", "/icon-192.png"]);

const classify = (path: string, init: { method?: string; mode?: string; origin?: string } = {}) =>
  classifyRequest({ method: init.method ?? "GET", mode: init.mode ?? "cors", url: `${init.origin ?? ORIGIN}${path}` }, ORIGIN, PRECACHED);

describe("service worker request routing", () => {
  it("serves page navigations network-first, including client-only routes", () => {
    for (const path of ["/", "/library", "/gallery/", "/n/abcdefghijklmnopqrstuv", "/unknown"]) {
      expect(classify(path, { mode: "navigate" })).toBe("page");
    }
  });

  it("never intercepts the API, dynamic documents, other origins or writes", () => {
    expect(classify("/api/structure", { method: "POST" })).toBe("bypass");
    expect(classify("/api/config")).toBe("bypass");
    expect(classify("/api/v1/notes", { mode: "navigate" })).toBe("bypass");
    for (const path of ["/llms.txt", "/robots.txt", "/sitemap.xml"]) expect(classify(path, { mode: "navigate" })).toBe("bypass");
    expect(classify("/assets/index-abc.js", { origin: "https://cdn.example" })).toBe("bypass");
    expect(classify("/og-image.jpg")).toBe("bypass");
  });

  it("keeps fonts and CMaps in the long-lived cache, build files in the versioned one", () => {
    expect(classify("/assets/lxgw-subset-6-BF1xtsWL.woff2")).toBe("static");
    expect(classify("/assets/kalam-400.woff2?ink-font-retry=1")).toBe("static");
    expect(classify("/pdfjs/cmaps/UniGB-UCS2-H.bcmap")).toBe("static");
    expect(classify("/assets/index-BZZaxi5t.js")).toBe("app");
    expect(classify("/assets/pdf.worker.min-CjEcRF4W.mjs")).toBe("app");
    expect(classify("/site.webmanifest")).toBe("app");
    expect(classify("/icon-192.png?v=2")).toBe("bypass");
  });

  it("caches only successful same-origin non-HTML responses", () => {
    const response = (status: number, type: ResponseType, contentType: string) => ({
      ok: status >= 200 && status < 300, status, type, headers: new Headers({ "Content-Type": contentType }),
    });
    expect(isCacheable(response(200, "basic", "font/woff2"))).toBe(true);
    expect(isCacheable(response(200, "basic", "text/javascript"))).toBe(true);
    expect(isCacheable(response(200, "basic", "text/html; charset=utf-8"))).toBe(false);
    expect(isCacheable(response(206, "basic", "font/woff2"))).toBe(false);
    expect(isCacheable(response(404, "basic", "text/plain"))).toBe(false);
    expect(isCacheable(response(200, "opaque", ""))).toBe(false);
  });
});

describe("service worker cache keys", () => {
  it("drops only the font retry parameter so retried fonts are found offline", () => {
    expect(cacheKey(`${ORIGIN}/assets/kalam-400.woff2?ink-font-retry=2`)).toBe(`${ORIGIN}/assets/kalam-400.woff2`);
    expect(cacheKey(`${ORIGIN}/pdfjs/cmaps/a.bcmap?v=1&ink-font-retry=1`)).toBe(`${ORIGIN}/pdfjs/cmaps/a.bcmap?v=1`);
    expect(cacheKey(`${ORIGIN}/assets/index-abc.js`)).toBe(`${ORIGIN}/assets/index-abc.js`);
  });

  it("matches the parameter the font retry code adds", () => {
    expect(readFileSync("src/export/fontEmbed.ts", "utf8")).toContain(`url.searchParams.set("${FONT_RETRY_PARAM}"`);
  });
});

/** In-memory CacheStorage with just what the cleanup code uses. */
function fakeCacheStorage() {
  const stores = new Map<string, Map<string, Response>>();
  const cache = (entries: Map<string, Response>) => ({
    async match(key: RequestInfo | URL) {
      return entries.get(String(key))?.clone();
    },
    async put(key: RequestInfo | URL, response: Response) {
      entries.set(String(key), response);
    },
    async delete(key: RequestInfo | URL) {
      return entries.delete(String(key));
    },
  });
  const storage = {
    async keys() {
      return [...stores.keys()];
    },
    async open(name: string) {
      if (!stores.has(name)) stores.set(name, new Map());
      return cache(stores.get(name)!) as unknown as Cache;
    },
    async delete(name: string) {
      return stores.delete(name);
    },
  };
  return { storage, appCaches: () => [...stores.keys()].filter((name) => name.startsWith(APP_CACHE_PREFIX)).sort() };
}

describe("service worker cache cleanup", () => {
  const v = (version: string) => `${APP_CACHE_PREFIX}${version}`;

  it("keeps superseded caches until the pages open before the update close", async () => {
    const { storage, appCaches } = fakeCacheStorage();
    await storage.open(v("1"));
    await storage.open(v("2"));
    await retireCaches(storage, v("2"), ["tab-a"]);
    const open = new Set(["tab-a"]);
    const isAlive = async (id: string) => open.has(id);

    await pruneRetiredCaches(storage, v("2"), isAlive);
    expect(appCaches()).toEqual([v("1"), v("2")]);

    open.clear();
    await pruneRetiredCaches(storage, v("2"), isAlive);
    expect(appCaches()).toEqual([v("2")]);
  });

  it("never deletes the precache of an update that is still waiting", async () => {
    const { storage, appCaches } = fakeCacheStorage();
    await storage.open(v("0"));
    await storage.open(v("1"));
    await retireCaches(storage, v("1"), ["tab-a"]);
    // v2 installs and waits while v1 still controls the pages
    await storage.open(v("2"));
    // A navigation handled by v1 after the old tab closed
    await pruneRetiredCaches(storage, v("1"), async () => false);
    expect(appCaches()).toEqual([v("1"), v("2")]);
  });

  it("does nothing without a record and never deletes the running version", async () => {
    const { storage, appCaches } = fakeCacheStorage();
    await storage.open(v("1"));
    await storage.open(v("2"));
    await pruneRetiredCaches(storage, v("2"), async () => false);
    expect(appCaches()).toEqual([v("1"), v("2")]);

    // A rollback re-activates a version that an earlier record listed as superseded
    await retireCaches(storage, v("2"), []);
    await pruneRetiredCaches(storage, v("1"), async () => false);
    expect(appCaches()).toEqual([v("1"), v("2")]);
  });
});

describe("web app manifest", () => {
  const manifest = JSON.parse(readFileSync("public/site.webmanifest", "utf8"));

  it("declares what browsers need to offer installation", () => {
    expect(manifest).toMatchObject({ id: "/", start_url: "/", scope: "/", display: "standalone" });
    expect(manifest.name).toBeTruthy();
    expect(manifest.short_name).toBeTruthy();
    const sizes = manifest.icons.map((icon: { sizes: string }) => icon.sizes);
    expect(sizes).toEqual(expect.arrayContaining(["192x192", "512x512"]));
    expect(manifest.icons.some((icon: { purpose?: string }) => icon.purpose === "maskable")).toBe(true);
  });

  it("only links shortcuts and icons inside the app scope", () => {
    for (const shortcut of manifest.shortcuts) expect(shortcut.url).toMatch(/^\/[^/]/);
    for (const icon of manifest.icons) expect(readFileSync(`public${icon.src}`).length).toBeGreaterThan(0);
  });
});
