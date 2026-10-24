import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { classifyRequest, isCacheable } from "../src/pwa/routing.ts";

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
