import { loadConfig } from "./config.ts";
import type { Env } from "./env.ts";
import { llmsTxt } from "./openapi.ts";
import { handleApi } from "./router.ts";
import { handleSharePage } from "./share-page.ts";

export default {
  async fetch(request, env, ctx): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname.startsWith("/api/")) {
      return handleApi(request, env, (promise) => ctx.waitUntil(promise));
    }
    if (url.pathname === "/llms.txt") {
      const origin = loadConfig(env).publicBaseUrl ?? url.origin;
      return new Response(llmsTxt(origin), {
        headers: { "Content-Type": "text/markdown; charset=utf-8", "Cache-Control": "public, max-age=300" },
      });
    }
    if (/^\/n\/[^/]+\/?$/.test(url.pathname) && (request.method === "GET" || request.method === "HEAD")) {
      return handleSharePage(request, env);
    }
    // 正常情况下静态资源由 Workers Assets 直接返回，只有未命中时才会走到这里
    if (env.ASSETS) return env.ASSETS.fetch(request);
    return new Response("Not Found", { status: 404 });
  },
} satisfies ExportedHandler<Env>;
