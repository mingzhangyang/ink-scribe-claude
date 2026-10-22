import type { Env } from "./env.ts";
import { loadConfig } from "./config.ts";
import { getNoteRow, isNoteId, toSummary } from "./store.ts";

function escapeAttr(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/**
 * /n/:id 查看页：返回前端 index.html，并在服务端注入标题与 Open Graph 元信息，
 * 让 agent 发到聊天工具里的链接能显示标题与摘要。页面内容仍由前端渲染。
 */
export async function handleSharePage(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  const id = url.pathname.split("/")[2] ?? "";
  // 不转发浏览器的条件请求头（If-None-Match 等）：否则静态资源会返回没有内容的 304，
  // 而这里需要完整的 index.html 来注入元信息
  const shell = env.ASSETS ? await env.ASSETS.fetch(new Request(new URL("/", url), { headers: { Accept: "text/html" } })) : null;
  if (!shell || !shell.ok) return new Response("Not Found", { status: 404 });

  const row = isNoteId(id) && env.DB ? await getNoteRow(env.DB, id).catch(() => null) : null;
  const headers = new Headers(shell.headers);
  headers.set("Cache-Control", "no-cache");
  // 页面内容按笔记改写过，原有的校验头不再准确
  for (const name of ["Content-Length", "ETag", "Last-Modified"]) headers.delete(name);
  if (!row) return new Response(shell.body, { status: 404, headers });

  const config = loadConfig(env);
  const summary = toSummary(row, config.publicBaseUrl ?? url.origin);
  const title = `${summary.title} · 墨语笔记`;
  const meta: Array<[string, string, string]> = [
    ["name", "description", summary.summary],
    ["property", "og:type", "article"],
    ["property", "og:site_name", "墨语笔记 InkScribe"],
    ["property", "og:title", summary.title],
    ["property", "og:description", summary.summary],
    ["property", "og:url", summary.url],
    ["name", "twitter:card", "summary"],
    ["name", "twitter:title", summary.title],
    ["name", "twitter:description", summary.summary],
  ];
  // 仅持有链接可见的笔记不允许搜索引擎收录
  if (summary.visibility === "unlisted") meta.push(["name", "robots", "noindex, nofollow"]);

  const tags = meta.map(([attr, key, value]) => `<meta ${attr}="${key}" content="${escapeAttr(value)}" />`).join("\n    ");
  const rewritten = new HTMLRewriter()
    .on("title", { element: (el) => void el.setInnerContent(title) })
    .on('meta[name="description"]', { element: (el) => void el.remove() })
    .on("head", { element: (el) => void el.append(`\n    ${tags}\n`, { html: true }) })
    .transform(new Response(shell.body, { status: 200, headers }));
  return rewritten;
}
