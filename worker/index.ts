import { loadConfig } from "./config.ts";
import type { Env } from "./env.ts";
import { llmsTxt } from "./openapi.ts";
import { handleApi } from "./router.ts";
import { handlePage } from "./pages.ts";
import { listNotes, toSummary } from "./store.ts";

export default {
  async fetch(request, env, ctx): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname.startsWith("/api/")) {
      return handleApi(request, env, (promise) => ctx.waitUntil(promise));
    }
    if (url.pathname === "/llms.txt") {
      const origin = loadConfig(env).publicBaseUrl ?? url.origin;
      const recent = env.DB ? await listNotes(env.DB, { visibility: "public" }, null, 20).then((r) => r.rows).catch(() => []) : [];
      return new Response(llmsTxt(origin, recent.map((row) => toSummary(row, origin))), {
        // 列出了最近的公开笔记，删除后应立即消失
        headers: { "Content-Type": "text/markdown; charset=utf-8", "Cache-Control": "no-cache" },
      });
    }
    // 首页、图库、说明与政策页面、笔记查看页、robots.txt 与 sitemap.xml：服务端注入 SEO 元信息与正文
    const page = await handlePage(request, env);
    if (page) return page;
    // 正常情况下静态资源由 Workers Assets 直接返回，只有未命中时才会走到这里
    if (env.ASSETS) return env.ASSETS.fetch(request);
    return new Response("Not Found", { status: 404 });
  },
} satisfies ExportedHandler<Env>;
