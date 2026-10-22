import type { Env } from "./env.ts";
import { handleApi } from "./router.ts";

export default {
  async fetch(request, env, ctx): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname.startsWith("/api/")) {
      return handleApi(request, env, (promise) => ctx.waitUntil(promise));
    }
    // 正常情况下静态资源由 Workers Assets 直接返回，只有未命中时才会走到这里
    if (env.ASSETS) return env.ASSETS.fetch(request);
    return new Response("Not Found", { status: 404 });
  },
} satisfies ExportedHandler<Env>;
