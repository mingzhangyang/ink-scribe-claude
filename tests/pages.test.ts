import { describe, expect, it } from "vitest";
import type { PublishedNote } from "../shared/api.ts";
import type { Env } from "../worker/env.ts";
import { llmsTxt } from "../worker/openapi.ts";
import {
  contentToHtml,
  galleryPage,
  handlePage,
  headTags,
  homePage,
  jsonLdScript,
  notePage,
  noteNotFoundPage,
  robotsTxt,
  sitemapXml,
} from "../worker/pages.ts";
import { createTestD1 } from "./helpers/d1.ts";

const ORIGIN = "https://ink.example";

function published(overrides: Partial<PublishedNote> = {}): PublishedNote {
  return {
    id: "AAAAAAAAAAAAAAAAAAAAAA",
    url: `${ORIGIN}/n/AAAAAAAAAAAAAAAAAAAAAA`,
    title: "番茄工作法",
    summary: "用 25 分钟专注 + 5 分钟休息的节奏工作。",
    language: "zh",
    template: "reading-notes",
    layout: "hybrid-cornell",
    visibility: "public",
    createdAt: "2026-10-20T08:00:00.000Z",
    updatedAt: "2026-10-21T08:00:00.000Z",
    note: {
      title: "番茄工作法",
      date: "2026-10-20",
      cues: [{ keyword: "专注", note: "一次只做一件事" }],
      sections: [{ heading: "步骤", content: "- 设定 25 分钟\n- 专注工作\n\n休息 5 分钟。", highlights: [] }],
      summary: "短时专注，规律休息。",
    },
    settings: {} as PublishedNote["settings"],
    stickers: [],
    ...overrides,
  };
}

describe("head tags", () => {
  it("emits canonical, absolute Open Graph image and JSON-LD for the home page", () => {
    const head = headTags(homePage(ORIGIN), ORIGIN);
    expect(head).toContain(`<link rel="canonical" href="${ORIGIN}/" />`);
    expect(head).toContain(`<meta property="og:image" content="${ORIGIN}/og-image.jpg" />`);
    expect(head).toContain('<meta name="twitter:card" content="summary_large_image" />');
    expect(head).toContain('"@type":"WebApplication"');
    expect(head).toContain('"@type":"FAQPage"');
    expect(head).not.toContain("robots");
  });

  it("escapes markup in titles and keeps JSON-LD from closing the script tag", () => {
    const note = published({ title: '"><script>alert(1)</script>', note: { ...published().note, title: "</script><img src=x>" } });
    const meta = notePage(ORIGIN, note);
    const head = headTags(meta, ORIGIN);
    expect(head).not.toMatch(/<script>alert|<\/script><img/);
    expect(head.match(/<\/script>/g)).toHaveLength(meta.jsonLd.length);
    expect(meta.body).toContain("&lt;/script&gt;&lt;img src=x&gt;");
    expect(jsonLdScript({ a: "</script>&" })).toBe('<script type="application/ld+json">{"a":"\\u003c/script\\u003e\\u0026"}</script>');
  });
});

describe("note page", () => {
  it("renders the full note as semantic HTML with Article structured data", () => {
    const meta = notePage(ORIGIN, published());
    expect(meta.title).toBe("番茄工作法 · 墨语笔记");
    expect(meta.canonical).toBe(`${ORIGIN}/n/AAAAAAAAAAAAAAAAAAAAAA`);
    expect(meta.robots).toBeUndefined();
    expect(meta.body).toContain("<h1>番茄工作法</h1>");
    expect(meta.body).toContain("<dt>专注</dt><dd>一次只做一件事</dd>");
    expect(meta.body).toContain("<ul><li>设定 25 分钟</li><li>专注工作</li></ul><p>休息 5 分钟。</p>");
    expect(meta.body).toContain("<h2>总结</h2><p>短时专注，规律休息。</p>");
    const article = meta.jsonLd[0] as Record<string, unknown>;
    expect(article).toMatchObject({ "@type": "Article", headline: "番茄工作法", datePublished: "2026-10-20T08:00:00.000Z", articleSection: "读书摘抄", keywords: "专注" });
    expect(meta.jsonLd.some((item) => (item as { "@type": string })["@type"] === "BreadcrumbList")).toBe(true);
  });

  it("marks unlisted notes noindex and leaves them out of the breadcrumb trail", () => {
    const meta = notePage(ORIGIN, published({ visibility: "unlisted" }));
    expect(meta.robots).toBe("noindex, nofollow");
    expect(meta.jsonLd).toHaveLength(1);
    expect(meta.body).not.toContain('href="/gallery"');
  });

  it("uses the English locale for English notes", () => {
    const meta = notePage(ORIGIN, published({ language: "en" }));
    expect(meta.lang).toBe("en");
    expect(headTags(meta, ORIGIN)).toContain('<meta property="og:locale" content="en_US" />');
  });

  it("serves a noindex 404 page for missing notes", () => {
    const meta = noteNotFoundPage();
    expect(meta.status).toBe(404);
    expect(meta.robots).toBe("noindex");
    expect(meta.canonical).toBeUndefined();
  });
});

describe("contentToHtml", () => {
  it("groups bullet and numbered lines into lists", () => {
    expect(contentToHtml("第一段\n1. 甲\n2. 乙\n- 丙\n结尾")).toBe("<p>第一段</p><ol><li>甲</li><li>乙</li></ol><ul><li>丙</li></ul><p>结尾</p>");
    expect(contentToHtml("a<b")).toBe("<p>a&lt;b</p>");
  });
});

describe("gallery page", () => {
  it("lists public notes as links with an ItemList", () => {
    const note = published();
    const meta = galleryPage(ORIGIN, [note]);
    expect(meta.canonical).toBe(`${ORIGIN}/gallery`);
    expect(meta.body).toContain('<a href="/n/AAAAAAAAAAAAAAAAAAAAAA">番茄工作法</a>');
    expect(JSON.stringify(meta.jsonLd[0])).toContain(`"url":"${ORIGIN}/n/AAAAAAAAAAAAAAAAAAAAAA"`);
    expect(galleryPage(ORIGIN, []).body).toContain("还没有公开的笔记");
  });
});

describe("robots.txt, sitemap.xml and llms.txt", () => {
  it("points crawlers at the sitemap and keeps them out of the API", () => {
    const robots = robotsTxt(ORIGIN);
    expect(robots).toContain(`Sitemap: ${ORIGIN}/sitemap.xml`);
    expect(robots).toContain("Disallow: /api/");
    expect(robots).toContain("Allow: /api/v1/openapi.json");
  });

  it("lists the home page, gallery and public notes in the sitemap", () => {
    const xml = sitemapXml(ORIGIN, [{ id: "AAAAAAAAAAAAAAAAAAAAAA", updatedAt: "2026-10-21T08:00:00.000Z" }]);
    expect(xml).toContain(`<url><loc>${ORIGIN}/</loc></url>`);
    expect(xml).toContain(`<url><loc>${ORIGIN}/gallery</loc><lastmod>2026-10-21T08:00:00.000Z</lastmod></url>`);
    expect(xml).toContain(`<url><loc>${ORIGIN}/n/AAAAAAAAAAAAAAAAAAAAAA</loc><lastmod>2026-10-21T08:00:00.000Z</lastmod></url>`);
  });

  it("serves robots.txt and a sitemap with only public notes from the Worker", async () => {
    const db = createTestD1();
    await db.prepare("INSERT INTO api_keys (id, name, key_hash, created_at) VALUES ('k', 'k', 'h', 1)").run();
    const insert = `INSERT INTO notes (id, api_key_id, visibility, title, summary, language, template, layout, note_json, settings_json, stickers_json, image_status, created_at, updated_at)
      VALUES (?, 'k', ?, 't', 's', 'zh', 'general', 'hybrid-cornell', '{}', '{}', '[]', 'disabled', ?, ?)`;
    await db.prepare(insert).bind("PPPPPPPPPPPPPPPPPPPPPP", "public", 1000, 2000).run();
    await db.prepare(insert).bind("UUUUUUUUUUUUUUUUUUUUUU", "unlisted", 1000, 2000).run();
    const env: Env = { AI: {} as Ai, DB: db, PUBLIC_BASE_URL: "https://ink-scribe.example" };

    const robots = await handlePage(new Request("http://localhost/robots.txt"), env);
    expect(await robots!.text()).toContain("Sitemap: https://ink-scribe.example/sitemap.xml");

    const sitemap = await handlePage(new Request("http://localhost/sitemap.xml"), env);
    expect(sitemap!.headers.get("Content-Type")).toContain("application/xml");
    const xml = await sitemap!.text();
    expect(xml).toContain("https://ink-scribe.example/n/PPPPPPPPPPPPPPPPPPPPPP");
    expect(xml).not.toContain("UUUUUUUUUUUUUUUUUUUUUU");

    expect(await handlePage(new Request("http://localhost/assets/app.js"), env)).toBeNull();
    expect(await handlePage(new Request("http://localhost/robots.txt", { method: "POST" }), env)).toBeNull();
  });

  it("describes the product and recent public notes in llms.txt", () => {
    const text = llmsTxt(ORIGIN, [published({ title: "[链接] 标题" })]);
    expect(text).toContain("## 页面");
    expect(text).toContain(`- [链接 标题](${ORIGIN}/n/AAAAAAAAAAAAAAAAAAAAAA)：`);
    expect(llmsTxt(ORIGIN)).not.toContain("最近的公开笔记");
  });
});
