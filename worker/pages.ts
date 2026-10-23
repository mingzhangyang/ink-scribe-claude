import type { PublishedNote, PublishedNoteSummary } from "../shared/api.ts";
import { GUIDE_CONTENT, getGuideExamples, type GuideItem, type GuideLocale } from "../shared/guide.ts";
import { LEGAL_CONTENT, type LegalLocale, type LegalPageId } from "../shared/legal.ts";
import { TEMPLATE_LABELS, TEMPLATES, isOneOf } from "../shared/options.ts";
import { loadConfig } from "./config.ts";
import type { Env } from "./env.ts";
import { getNoteRow, isNoteId, listNotes, listPublicNoteDates, toPublished, toSummary } from "./store.ts";

/**
 * 服务端渲染的页面元信息（SEO / GEO）。
 *
 * 前端是 SPA，但搜索引擎、链接预览和 AI 爬虫大多不执行 JavaScript。首页、图库、说明页面和笔记查看页由 Worker
 * 返回 index.html，并注入标题、描述、canonical、Open Graph、JSON-LD，以及写在 #root 里的语义化正文；
 * 浏览器加载脚本后，React 会替换 #root 的内容。
 */

export const SITE_NAME = "墨语笔记";
const SITE_FULL_NAME = "墨语笔记 InkScribe";
const SITE_TAGLINE = "把文字变成一页手写笔记";
const SITE_DESCRIPTION =
  "墨语笔记（InkScribe）用 AI 把粘贴的文字整理成康奈尔结构的手写风格笔记：自动提炼标题、线索关键词、分节要点与总结，可选纸张、手写字体、墨水颜色与贴纸，一键导出高清 PNG/JPG 图片。在线使用，无需注册。";
const OG_IMAGE = { path: "/og-image.jpg", width: 1200, height: 630, alt: "墨语笔记 InkScribe：把文字变成一页手写笔记" };
const GALLERY_SIZE = 48;
const SITEMAP_LIMIT = 10_000;

export type PageMeta = {
  status: number;
  /** 完整的 <title> */
  title: string;
  description: string;
  /** 绝对地址；为空时不输出 canonical 与 og:url（例如 404 页） */
  canonical?: string;
  ogType: "website" | "article";
  ogTitle: string;
  lang: "zh-CN" | "en";
  robots?: string;
  vary?: string;
  article?: { publishedTime: string; modifiedTime: string; section?: string; tags: string[] };
  jsonLd: object[];
  /** 放进 #root 的 HTML */
  body: string;
};

// ---------- 转义 ----------

export function escapeHtml(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

/** JSON-LD 写在 <script> 里：转义 <、> 与 &，避免提前闭合标签。 */
export function jsonLdScript(data: object): string {
  const json = JSON.stringify(data).replace(/</g, "\\u003c").replace(/>/g, "\\u003e").replace(/&/g, "\\u0026");
  return `<script type="application/ld+json">${json}</script>`;
}

function truncate(text: string, max: number): string {
  const chars = Array.from(text.replace(/\s+/g, " ").trim());
  return chars.length <= max ? chars.join("") : `${chars.slice(0, max - 1).join("")}…`;
}

// ---------- <head> ----------

export function headTags(meta: PageMeta, origin: string): string {
  const image = `${origin}${OG_IMAGE.path}`;
  const tags: string[] = [];
  const add = (attr: "name" | "property", key: string, value: string) =>
    tags.push(`<meta ${attr}="${key}" content="${escapeHtml(value)}" />`);
  add("name", "description", meta.description);
  if (meta.robots) add("name", "robots", meta.robots);
  if (meta.canonical) tags.push(`<link rel="canonical" href="${escapeHtml(meta.canonical)}" />`);
  add("property", "og:type", meta.ogType);
  add("property", "og:site_name", SITE_FULL_NAME);
  add("property", "og:locale", meta.lang === "en" ? "en_US" : "zh_CN");
  add("property", "og:title", meta.ogTitle);
  add("property", "og:description", meta.description);
  if (meta.canonical) add("property", "og:url", meta.canonical);
  add("property", "og:image", image);
  add("property", "og:image:width", String(OG_IMAGE.width));
  add("property", "og:image:height", String(OG_IMAGE.height));
  add("property", "og:image:alt", OG_IMAGE.alt);
  if (meta.article) {
    add("property", "article:published_time", meta.article.publishedTime);
    add("property", "article:modified_time", meta.article.modifiedTime);
    if (meta.article.section) add("property", "article:section", meta.article.section);
    for (const tag of meta.article.tags) add("property", "article:tag", tag);
  }
  add("name", "twitter:card", "summary_large_image");
  add("name", "twitter:title", meta.ogTitle);
  add("name", "twitter:description", meta.description);
  add("name", "twitter:image", image);
  for (const data of meta.jsonLd) tags.push(jsonLdScript(data));
  return tags.join("\n    ");
}

// ---------- 结构化数据 ----------

function websiteLd(origin: string) {
  return {
    "@context": "https://schema.org",
    "@type": "WebSite",
    "@id": `${origin}/#website`,
    name: SITE_NAME,
    alternateName: "InkScribe",
    url: `${origin}/`,
    description: SITE_DESCRIPTION,
    inLanguage: "zh-CN",
  };
}

function publisherLd(origin: string) {
  return { "@type": "Organization", name: SITE_FULL_NAME, url: `${origin}/`, logo: { "@type": "ImageObject", url: `${origin}/icon-512.png` } };
}

function breadcrumbLd(items: Array<{ name: string; url: string }>) {
  return {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: items.map((item, i) => ({ "@type": "ListItem", position: i + 1, name: item.name, item: item.url })),
  };
}

// ---------- 首页 ----------

const FEATURES = [
  "AI 整理：把长文、会议记录、读书摘抄或课程内容整理成标题、线索关键词、分节要点和总结",
  "康奈尔笔记与手账两类版式，五种模板：通用整理、读书摘抄、会议纪要、课程总结、思想碎片",
  "多种手写字体、纸张（方格、横线、点阵、牛皮纸等）、墨水与高亮颜色，可调字号、行距与手写抖动",
  "贴纸与 AI 插图，可在页面上拖动、缩放和旋转",
  "导出 1x/2x/3x 的 PNG 或 JPG 图片，或直接复制到剪贴板",
  "支持上传 TXT、Markdown、HTML、DOCX、PDF 文件，文件在浏览器本地解析",
  "提供 REST API，AI agent 可以为用户生成笔记并返回分享链接",
];

const FAQ: Array<[string, string]> = [
  ["墨语笔记是什么？", "一个在线工具：粘贴文字或上传文件，AI 会把内容整理成康奈尔结构的笔记，并以手写风格排版成一页可以导出为图片的笔记。"],
  ["需要注册吗？", "不需要。打开网页即可使用编辑器；排版与导出图片都在浏览器中完成。"],
  ["我的原文会被保存吗？", "编辑器默认在本机保存原文和笔记草稿，可删除并关闭自动保存。上传文件在浏览器本地解析；选择 AI 整理会发送提取出的文字，应用日志只记录元数据。通过 API 发布时保存整理后的笔记，不另外保存原文副本；你主动保留在笔记中的原文摘录仍会保存和展示。具体说明见隐私政策。"],
  ["可以导出什么格式？", "PNG 或 JPG，分辨率可选 1x、2x、3x，也可以一键复制图片到剪贴板。"],
  ["AI agent 如何使用？", "通过 REST API（POST /api/v1/notes）提交整理好的笔记结构与 schemaVersion，无需注册或密钥，校验后返回分享链接，无需提交原文或再次调用 AI；可先用 /api/v1/notes/validate 预检，完整说明见 /llms.txt 与 /api/v1/openapi.json。"],
];

export function homePage(origin: string): PageMeta {
  const url = `${origin}/`;
  const body = `<main class="ssr">
  <h1>${SITE_FULL_NAME}</h1>
  <p class="ssr-lead">${escapeHtml(SITE_TAGLINE)}。${escapeHtml(SITE_DESCRIPTION)}</p>
  <h2>功能</h2>
  <ul>${FEATURES.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul>
  <h2>使用步骤</h2>
  <ol>
    <li>粘贴文本，或上传 TXT、Markdown、HTML、DOCX、PDF 文件</li>
    <li>选择模板、输出语言与详略，点击“整理成笔记”</li>
    <li>调整纸张、字体、墨水与贴纸，导出图片或复制到剪贴板</li>
  </ol>
  <h2>常见问题</h2>
  <dl>${FAQ.map(([q, a]) => `<dt>${escapeHtml(q)}</dt><dd>${escapeHtml(a)}</dd>`).join("")}</dl>
  <p><a href="/guide">使用说明</a> · <a href="/gallery">浏览公开笔记图库</a> · <a href="/llms.txt">给 AI agent 的说明</a></p>
  <p><a href="/privacy">隐私政策</a> · <a href="/terms">使用条款</a></p>
</main>`;
  return {
    status: 200,
    title: `${SITE_FULL_NAME} · ${SITE_TAGLINE}`,
    description: SITE_DESCRIPTION,
    canonical: url,
    ogType: "website",
    ogTitle: `${SITE_FULL_NAME}：${SITE_TAGLINE}`,
    lang: "zh-CN",
    jsonLd: [
      websiteLd(origin),
      {
        "@context": "https://schema.org",
        "@type": "WebApplication",
        "@id": `${origin}/#app`,
        name: SITE_NAME,
        alternateName: "InkScribe",
        url,
        description: SITE_DESCRIPTION,
        applicationCategory: "EducationalApplication",
        operatingSystem: "Any",
        browserRequirements: "Requires JavaScript",
        inLanguage: ["zh-CN", "en"],
        image: `${origin}${OG_IMAGE.path}`,
        featureList: FEATURES,
      },
      {
        "@context": "https://schema.org",
        "@type": "FAQPage",
        mainEntity: FAQ.map(([q, a]) => ({ "@type": "Question", name: q, acceptedAnswer: { "@type": "Answer", text: a } })),
      },
    ],
    body,
  };
}

// ---------- 使用说明 ----------

export function guidePage(origin: string, locale: GuideLocale = "zh"): PageMeta {
  const content = GUIDE_CONTENT[locale];
  const examples = getGuideExamples(origin, locale);
  const url = `${origin}/guide`;
  const lang = locale === "zh" ? "zh-CN" : "en";
  const steps = (items: GuideItem[]) => `<ol class="guide-steps">${items
    .map((item, index) => `<li><span class="guide-step-number" aria-hidden="true">${String(index + 1).padStart(2, "0")}</span><div><h3>${escapeHtml(item.title)}</h3><p>${escapeHtml(item.body)}</p></div></li>`)
    .join("")}</ol>`;
  const definitions = (items: GuideItem[], className: string) => `<dl class="${className}">${items
    .map((item) => `<div><dt>${escapeHtml(item.title)}</dt><dd>${escapeHtml(item.body)}</dd></div>`)
    .join("")}</dl>`;
  const tableHead = (headers: string[]) => `<thead><tr>${headers.map((label) => `<th scope="col">${escapeHtml(label)}</th>`).join("")}</tr></thead>`;
  const codeExample = (kind: "json" | "curl", title: string, description: string) => `<div class="guide-example">
    <div class="guide-example-heading"><h3>${escapeHtml(title)}</h3></div><p>${escapeHtml(description)}</p>
    <pre class="guide-code" data-guide-code="${kind}" tabindex="0" aria-label="${escapeHtml(title)}"><code>${escapeHtml(examples[kind])}</code></pre>
  </div>`;
  const { users, agents, faq } = content;
  return {
    status: 200,
    title: content.documentTitle,
    description: content.description,
    canonical: url,
    ogType: "website",
    ogTitle: content.title,
    lang,
    vary: "Accept-Language",
    jsonLd: [
      {
        "@context": "https://schema.org",
        "@type": "WebPage",
        name: content.title,
        url,
        description: content.description,
        inLanguage: lang,
        isPartOf: { "@id": `${origin}/#website` },
      },
      breadcrumbLd([{ name: SITE_NAME, url: `${origin}/` }, { name: content.title, url }]),
    ],
    body: `<main class="guide-page">
  <header class="guide-hero">
    <p class="guide-eyebrow">${escapeHtml(content.eyebrow)}</p>
    <h1>${escapeHtml(content.title)}</h1><p class="guide-lead">${escapeHtml(content.description)}</p>
    <nav class="guide-toc" aria-label="${escapeHtml(content.tocLabel)}">${content.toc.map((item) => `<a href="#${item.id}">${escapeHtml(item.label)}<span aria-hidden="true">↗</span></a>`).join("")}</nav>
  </header>
  <section class="guide-section" id="users" aria-labelledby="guide-users-title">
    <header class="guide-section-header"><span class="guide-section-number" aria-hidden="true">01</span><div><h2 id="guide-users-title">${escapeHtml(users.title)}</h2><p>${escapeHtml(users.description)}</p></div></header>
    ${steps(users.steps)}
    <div class="guide-notes">${users.notes.map((item) => `<div><h3>${escapeHtml(item.title)}</h3><p>${escapeHtml(item.body)}</p></div>`).join("")}</div>
    <a class="btn btn-primary guide-editor-link" href="${escapeHtml(users.action.href)}">${escapeHtml(users.action.label)}<span aria-hidden="true">→</span></a>
  </section>
  <section class="guide-section" id="agents" aria-labelledby="guide-agents-title">
    <header class="guide-section-header"><span class="guide-section-number" aria-hidden="true">02</span><div><h2 id="guide-agents-title">${escapeHtml(agents.title)}</h2><p>${escapeHtml(agents.description)}</p></div></header>
    <aside class="guide-callout"><h3>${escapeHtml(agents.access.title)}</h3><p>${escapeHtml(agents.access.body)}</p></aside>
    ${steps(agents.steps)}
    <h3 class="guide-subheading">${escapeHtml(agents.fieldsTitle)}</h3>
    <div class="guide-table-wrap" role="region" tabindex="0" aria-label="${escapeHtml(agents.fieldsTitle)}"><table class="guide-table">
      ${tableHead(agents.fieldHeaders)}
      <tbody>${agents.fields.map((item) => `<tr><th scope="row"><code>${escapeHtml(item.field)}</code></th><td>${escapeHtml(item.required)}</td><td>${escapeHtml(item.description)}</td></tr>`).join("")}</tbody>
    </table></div>
    ${codeExample("json", agents.jsonTitle, agents.jsonDescription)}
    ${codeExample("curl", agents.curlTitle, agents.curlDescription)}
    <h3 class="guide-subheading">${escapeHtml(agents.rulesTitle)}</h3>
    ${definitions(agents.rules, "guide-rules")}
    <h3 class="guide-subheading">${escapeHtml(agents.statusTitle)}</h3>
    <div class="guide-table-wrap" role="region" tabindex="0" aria-label="${escapeHtml(agents.statusTitle)}"><table class="guide-table guide-status-table">
      ${tableHead(agents.statusHeaders)}
      <tbody>${agents.statuses.map((item) => `<tr><th scope="row"><code>${escapeHtml(item.code)}</code></th><td>${escapeHtml(item.description)}</td></tr>`).join("")}</tbody>
    </table></div>
    <h3 class="guide-subheading">${escapeHtml(agents.resourcesTitle)}</h3>
    <div class="guide-resources">${agents.resources.map((item) => `<a href="${escapeHtml(item.href)}"><strong>${escapeHtml(item.label)}<span aria-hidden="true">↗</span></strong><span>${escapeHtml(item.description)}</span><code>${escapeHtml(item.href)}</code></a>`).join("")}</div>
  </section>
  <section class="guide-section" id="faq" aria-labelledby="guide-faq-title">
    <header class="guide-section-header"><span class="guide-section-number" aria-hidden="true">03</span><h2 id="guide-faq-title">${escapeHtml(faq.title)}</h2></header>
    ${definitions(faq.items, "guide-faq")}
  </section>
</main>`,
  };
}

// ---------- 隐私政策与使用条款 ----------

export function legalPage(origin: string, page: LegalPageId, locale: LegalLocale = "zh"): PageMeta {
  const content = LEGAL_CONTENT[locale][page];
  const url = `${origin}/${page}`;
  const lang = locale === "zh" ? "zh-CN" : "en";
  const links = (items: Array<{ href: string; label: string }>, arrow = "↗") => items
    .map((item) => `<a href="${escapeHtml(item.href)}">${escapeHtml(item.label)}<span aria-hidden="true"> ${arrow}</span></a>`)
    .join("");
  return {
    status: 200,
    title: content.documentTitle,
    description: content.description,
    canonical: url,
    ogType: "website",
    ogTitle: content.title,
    lang,
    vary: "Accept-Language",
    jsonLd: [
      {
        "@context": "https://schema.org",
        "@type": "WebPage",
        name: content.title,
        url,
        description: content.description,
        dateModified: content.updatedDate,
        inLanguage: lang,
        isPartOf: { "@id": `${origin}/#website` },
      },
      breadcrumbLd([{ name: SITE_NAME, url: `${origin}/` }, { name: content.title, url }]),
    ],
    body: `<main class="legal-page" data-legal-page="${page}">
  <header class="legal-hero">
    <p class="legal-updated">${escapeHtml(content.updatedLabel)} <time datetime="${escapeHtml(content.updatedDate)}">${escapeHtml(content.updatedDate)}</time></p>
    <h1>${escapeHtml(content.title)}</h1>
    <p class="legal-lead">${escapeHtml(content.description)}</p>
  </header>
  <nav class="legal-toc" aria-label="${escapeHtml(content.tocLabel)}">
    <h2>${escapeHtml(content.tocLabel)}</h2>
    <ol>${content.sections.map((section) => `<li><a href="#${escapeHtml(section.id)}">${escapeHtml(section.title)}</a></li>`).join("")}</ol>
  </nav>
  <div class="legal-body">
  ${content.sections.map((section, index) => `<section class="legal-section" id="${escapeHtml(section.id)}" aria-labelledby="legal-${page}-${escapeHtml(section.id)}">
    <h2 id="legal-${page}-${escapeHtml(section.id)}"><span class="legal-section-number" aria-hidden="true">${String(index + 1).padStart(2, "0")}</span>${escapeHtml(section.title)}</h2>
    ${section.paragraphs.map((paragraph) => `<p>${escapeHtml(paragraph)}</p>`).join("")}
    ${section.items?.length ? `<ul>${section.items.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul>` : ""}
    ${section.links?.length ? `<div class="legal-links">${links(section.links)}</div>` : ""}
  </section>`).join("\n  ")}
  </div>
  <nav class="legal-related" aria-label="${escapeHtml(content.relatedTitle)}">
    <h2>${escapeHtml(content.relatedTitle)}</h2><div>${links(content.relatedLinks, "→")}</div>
  </nav>
</main>`,
  };
}

// ---------- 图库 ----------

function templateLabel(template: string): string | undefined {
  return isOneOf(TEMPLATES, template) ? TEMPLATE_LABELS[template] : undefined;
}

export function galleryPage(origin: string, notes: PublishedNoteSummary[]): PageMeta {
  const url = `${origin}/gallery`;
  const description = "墨语笔记图库：浏览公开的手写风格笔记，包括读书摘抄、会议纪要、课程总结与思想碎片。";
  const items = notes
    .map((note) => {
      const meta = [templateLabel(note.template), note.createdAt.slice(0, 10)].filter(Boolean).join(" · ");
      return `<li><a href="/n/${note.id}">${escapeHtml(note.title)}</a><p>${escapeHtml(note.summary)}</p><small>${escapeHtml(meta)}</small></li>`;
    })
    .join("");
  return {
    status: 200,
    title: `图库 · ${SITE_FULL_NAME}`,
    description,
    canonical: url,
    ogType: "website",
    ogTitle: `${SITE_NAME}图库`,
    lang: "zh-CN",
    jsonLd: [
      {
        "@context": "https://schema.org",
        "@type": "CollectionPage",
        name: `${SITE_NAME}图库`,
        url,
        description,
        isPartOf: { "@id": `${origin}/#website` },
        mainEntity: {
          "@type": "ItemList",
          itemListElement: notes.map((note, i) => ({ "@type": "ListItem", position: i + 1, url: note.url, name: note.title })),
        },
      },
      breadcrumbLd([
        { name: SITE_NAME, url: `${origin}/` },
        { name: "图库", url },
      ]),
    ],
    body: `<main class="ssr">
  <h1>图库</h1>
  <p class="ssr-lead">${escapeHtml(description)}</p>
  ${items ? `<ul class="ssr-list">${items}</ul>` : "<p>还没有公开的笔记。</p>"}
  <p><a href="/">用墨语笔记整理你自己的文字</a></p>
</main>`,
  };
}

// ---------- 笔记 ----------

/** 把笔记正文转成语义化 HTML：以“- ”或“1.”开头的行合并为列表，其余为段落。 */
export function contentToHtml(content: string): string {
  const blocks: Array<{ tag: "p" | "ul" | "ol"; items: string[] }> = [];
  for (const raw of content.split("\n")) {
    const line = raw.trim();
    if (!line) {
      blocks.push({ tag: "p", items: [] });
      continue;
    }
    const bullet = line.match(/^[-*•·]\s+(.*)$/);
    const numbered = line.match(/^\d{1,2}(?:\.(?!\d)|[、)）])\s*(.+)$/);
    const tag = bullet ? "ul" : numbered ? "ol" : "p";
    const text = escapeHtml(bullet?.[1] ?? numbered?.[1] ?? line);
    const last = blocks[blocks.length - 1];
    if (tag !== "p" && last?.tag === tag) last.items.push(text);
    else blocks.push({ tag, items: [text] });
  }
  return blocks
    .filter((block) => block.items.length > 0)
    .map((block) =>
      block.tag === "p" ? `<p>${block.items[0]}</p>` : `<${block.tag}>${block.items.map((item) => `<li>${item}</li>`).join("")}</${block.tag}>`,
    )
    .join("");
}

export function notePage(origin: string, published: PublishedNote): PageMeta {
  const { note } = published;
  const url = published.url;
  const lang = published.language === "en" ? "en" : "zh-CN";
  const section = templateLabel(published.template);
  const tags = note.cues.map((cue) => cue.keyword).filter(Boolean);
  const description = truncate(published.summary || note.summary || note.sections[0]?.content || note.title, 160);
  const isPublic = published.visibility === "public";
  const meta = [note.date, section].filter(Boolean).map((part) => escapeHtml(part!)).join(" · ");
  const cues = note.cues.length
    ? `<aside><h2>线索</h2><dl>${note.cues.map((cue) => `<dt>${escapeHtml(cue.keyword)}</dt>${cue.note ? `<dd>${escapeHtml(cue.note)}</dd>` : ""}`).join("")}</dl></aside>`
    : "";
  const sections = note.sections
    .map((s) => `<section>${s.heading ? `<h2>${escapeHtml(s.heading)}</h2>` : ""}${contentToHtml(s.content)}</section>`)
    .join("");
  const summary = note.summary ? `<section><h2>总结</h2><p>${escapeHtml(note.summary)}</p></section>` : "";
  const body = `<main class="ssr">
  <article lang="${lang}">
    <h1>${escapeHtml(note.title)}</h1>
    <p class="ssr-meta"><time datetime="${published.createdAt}">${meta || published.createdAt.slice(0, 10)}</time></p>
    ${cues}${sections}${summary}
  </article>
  <p class="ssr-meta">由 <a href="/">${SITE_FULL_NAME}</a> 整理为手写笔记${isPublic ? ` · <a href="/gallery">更多公开笔记</a>` : ""}</p>
</main>`;
  const articleLd = {
    "@context": "https://schema.org",
    "@type": "Article",
    "@id": `${url}#note`,
    headline: truncate(note.title, 110),
    description,
    url,
    mainEntityOfPage: url,
    datePublished: published.createdAt,
    dateModified: published.updatedAt,
    inLanguage: lang,
    image: `${origin}${OG_IMAGE.path}`,
    ...(section ? { articleSection: section } : {}),
    ...(tags.length ? { keywords: tags.join(", ") } : {}),
    isAccessibleForFree: true,
    isPartOf: { "@id": `${origin}/#website` },
    publisher: publisherLd(origin),
  };
  return {
    status: 200,
    title: `${note.title} · ${SITE_NAME}`,
    description,
    canonical: url,
    ogType: "article",
    ogTitle: note.title,
    lang,
    // 仅持有链接可见的笔记不允许搜索引擎收录
    robots: isPublic ? undefined : "noindex, nofollow",
    article: { publishedTime: published.createdAt, modifiedTime: published.updatedAt, section, tags },
    jsonLd: isPublic
      ? [
          articleLd,
          breadcrumbLd([
            { name: SITE_NAME, url: `${origin}/` },
            { name: "图库", url: `${origin}/gallery` },
            { name: truncate(note.title, 60), url },
          ]),
        ]
      : [articleLd],
    body,
  };
}

export function noteNotFoundPage(): PageMeta {
  const heading = "这条笔记不存在或已被删除";
  return {
    status: 404,
    title: `${heading} · ${SITE_NAME}`,
    description: heading,
    ogType: "website",
    ogTitle: heading,
    lang: "zh-CN",
    robots: "noindex",
    jsonLd: [],
    body: `<main class="ssr"><h1>${heading}</h1><p><a href="/">回到编辑器</a> · <a href="/gallery">去图库看看</a></p></main>`,
  };
}

// ---------- robots.txt 与 sitemap.xml ----------

export function robotsTxt(origin: string): string {
  return `# ${SITE_FULL_NAME}
# 给 AI agent 的说明：${origin}/llms.txt

User-agent: *
Allow: /
Allow: /api/v1/openapi.json
Disallow: /api/

Sitemap: ${origin}/sitemap.xml
`;
}

export function sitemapXml(origin: string, notes: Array<{ id: string; updatedAt: string }>): string {
  const latest = notes.reduce<string | undefined>((max, note) => (!max || note.updatedAt > max ? note.updatedAt : max), undefined);
  const entry = (loc: string, lastmod?: string) => `  <url><loc>${escapeHtml(loc)}</loc>${lastmod ? `<lastmod>${lastmod}</lastmod>` : ""}</url>`;
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
    entry(`${origin}/`),
    entry(`${origin}/gallery`, latest),
    entry(`${origin}/guide`),
    entry(`${origin}/privacy`),
    entry(`${origin}/terms`),
    ...notes.map((note) => entry(`${origin}/n/${note.id}`, note.updatedAt)),
    "</urlset>",
    "",
  ].join("\n");
}

// ---------- 请求处理 ----------

function siteOrigin(env: Env, url: URL): string {
  return loadConfig(env).publicBaseUrl ?? url.origin;
}

function requestLocale(request: Request): "zh" | "en" {
  const preferredLanguage = request.headers.get("Accept-Language")?.split(",")[0]?.trim().toLowerCase();
  return !preferredLanguage || preferredLanguage.startsWith("zh") ? "zh" : "en";
}

async function renderShell(env: Env, url: URL, meta: PageMeta): Promise<Response> {
  // 不转发浏览器的条件请求头（If-None-Match 等）：否则静态资源会返回没有内容的 304，
  // 而这里需要完整的 index.html 来注入元信息
  const shell = env.ASSETS ? await env.ASSETS.fetch(new Request(new URL("/", url), { headers: { Accept: "text/html" } })) : null;
  if (!shell || !shell.ok) return new Response("Not Found", { status: 404 });
  const headers = new Headers(shell.headers);
  headers.set("Cache-Control", "no-cache");
  if (meta.vary) headers.append("Vary", meta.vary);
  // 页面内容按请求改写过，原有的校验头不再准确
  for (const name of ["Content-Length", "ETag", "Last-Modified"]) headers.delete(name);

  const tags = headTags(meta, siteOrigin(env, url));
  const remove = { element: (el: Element) => void el.remove() };
  return new HTMLRewriter()
    .on("html", { element: (el) => void el.setAttribute("lang", meta.lang) })
    .on("title", { element: (el) => void el.setInnerContent(meta.title) })
    // 去掉 index.html 中的默认描述与 Open Graph 信息，换成本页的
    .on('meta[name="description"]', remove)
    .on('meta[property^="og:"]', remove)
    .on('meta[name^="twitter:"]', remove)
    .on('link[rel="canonical"]', remove)
    .on("head", { element: (el) => void el.append(`\n    ${tags}\n  `, { html: true }) })
    .on("#root", { element: (el) => void el.setInnerContent(meta.body, { html: true }) })
    .transform(new Response(shell.body, { status: meta.status, headers }));
}

/** 需要服务端注入元信息的 HTML 页面；不匹配时返回 null。 */
export async function handlePage(request: Request, env: Env): Promise<Response | null> {
  if (request.method !== "GET" && request.method !== "HEAD") return null;
  const url = new URL(request.url);
  const origin = siteOrigin(env, url);

  if (url.pathname === "/") return renderShell(env, url, homePage(origin));

  if (/^\/guide\/?$/.test(url.pathname)) {
    return renderShell(env, url, guidePage(origin, requestLocale(request)));
  }

  const legal = url.pathname.match(/^\/(privacy|terms)\/?$/);
  if (legal) {
    return renderShell(env, url, legalPage(origin, legal[1] as LegalPageId, requestLocale(request)));
  }

  if (/^\/gallery\/?$/.test(url.pathname)) {
    const rows = env.DB ? await listNotes(env.DB, { visibility: "public" }, null, GALLERY_SIZE).then((r) => r.rows).catch(() => []) : [];
    return renderShell(env, url, galleryPage(origin, rows.map((row) => toSummary(row, origin))));
  }

  const match = url.pathname.match(/^\/n\/([^/]+)\/?$/);
  if (match) {
    const id = match[1];
    const row = isNoteId(id) && env.DB ? await getNoteRow(env.DB, id).catch(() => null) : null;
    const published = row ? toPublished(row, origin) : null;
    return renderShell(env, url, published ? notePage(origin, published) : noteNotFoundPage());
  }

  if (url.pathname === "/robots.txt") {
    return new Response(robotsTxt(origin), { headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "public, max-age=3600" } });
  }

  if (url.pathname === "/sitemap.xml") {
    const notes = env.DB ? await listPublicNoteDates(env.DB, SITEMAP_LIMIT).catch(() => []) : [];
    return new Response(sitemapXml(origin, notes), {
      headers: { "Content-Type": "application/xml; charset=utf-8", "Cache-Control": "public, max-age=3600" },
    });
  }

  return null;
}
