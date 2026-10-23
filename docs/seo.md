# 品牌资源、SEO 与 GEO

## 品牌资源

标志、favicon、PWA 图标与 OG 分享图都由代码生成，源文件在 [`scripts/brand/`](../scripts/brand)：

- `marks.mjs`：用 SVG 描述的标志。深墨蓝底上一页微微倾斜的笔记纸（左侧康奈尔线索栏、荧光笔高亮、手写波浪线），右下角一支金色笔尖。`detail: "small"` 是线条更粗、元素更少的简化版，用于 16–48px 的 favicon。
- `generate.mjs`：在 Chromium 的 canvas 中把标志栅格化为各尺寸图标，并用项目自带的手写字体（霞鹜文楷、Kalam）绘制 1200×630 的 OG 图。

修改设计后执行 `npm run brand`（需要 Playwright 的 Chromium；本机已有 Chromium 时可设置 `PLAYWRIGHT_CHROMIUM_PATH`），生成结果提交到仓库：

| 文件 | 用途 |
| --- | --- |
| `public/logo.svg` | 页面顶栏中的标志 |
| `public/favicon.svg`、`public/favicon.ico` | 浏览器标签页图标（ICO 内含 16/32/48px） |
| `public/apple-touch-icon.png` | iOS 主屏幕图标（180px，直角，由系统加圆角） |
| `public/icon-192.png`、`public/icon-512.png`、`public/icon-maskable-512.png` | Web App Manifest 图标（含 Android 自适应图标） |
| `public/og-image.jpg` | 链接预览图（1200×630） |
| `public/site.webmanifest` | Web App Manifest（手写） |

## 服务端注入的页面信息

前端是 SPA，但搜索引擎、聊天工具的链接预览和多数 AI 爬虫不执行 JavaScript。首页 `/`、图库 `/gallery`、使用说明 `/guide`、隐私政策 `/privacy`、使用条款 `/terms` 和笔记查看页 `/n/:id` 因此先经过 Worker（[`worker/pages.ts`](../worker/pages.ts)）：它取出 `index.html`，用 HTMLRewriter 注入本页的信息后返回。

| 内容 | 首页 | 图库 | 笔记查看页 |
| --- | --- | --- | --- |
| `<title>`、description、canonical | ✓ | ✓ | ✓（404 时不输出 canonical） |
| Open Graph / Twitter Card（大图） | ✓ | ✓ | ✓，另有 `article:*` 时间、分类与标签 |
| JSON-LD | `WebSite`、`WebApplication`、`FAQPage` | `CollectionPage` + `ItemList`、`BreadcrumbList` | `Article`，公开笔记另有 `BreadcrumbList` |
| `#root` 中的正文 | 产品介绍、功能、使用步骤、常见问题 | 最近 48 条公开笔记的标题、摘要与链接 | 笔记全文：标题、线索、分节（列表保留为 `<ul>`/`<ol>`）、总结 |
| `<html lang>` | `zh-CN` | `zh-CN` | 按笔记语言（`zh-CN` / `en`） |
| robots | 允许收录 | 允许收录 | `unlisted` 笔记为 `noindex, nofollow`；不存在的笔记返回 404 与 `noindex` |

使用说明 `/guide` 与 `/guide/` 都返回完整的网页教程、agent 发布流程、JSON / curl 示例与常见问题，canonical 统一为 `/guide`，结构化数据为 `WebPage` 与 `BreadcrumbList`。Worker 与 React 共用 [`shared/guide.ts`](../shared/guide.ts) 的双语文案和请求示例，示例使用实际发布校验器测试。初始 HTML 按 `Accept-Language` 的首选语言选择中文或英文（缺省为中文），返回 `Vary: Accept-Language`；交互页面继续使用浏览器中保存的语言偏好。`/guide#users`、`/guide#agents` 和 `/guide#faq` 可直接定位对应章节。

隐私政策 `/privacy` 与使用条款 `/terms` 使用相同的语言规则，也支持尾斜杠和章节锚点。正文、更新日期与相关链接由 [`shared/legal.ts`](../shared/legal.ts) 供 Worker 和 React 共用；完整初始 HTML 包含所有章节，`WebPage` 中提供 `dateModified`。菜单底部、首页 HTML、`llms.txt` 与站点地图都提供政策入口。

浏览器加载脚本后，React 会替换 `#root` 中的正文，所以用户看到的仍是应用本身；正文只是给不执行脚本的访问者看的同一份内容，不是隐藏文本。所有用户内容都经过 HTML 转义，JSON-LD 中的 `<`、`>`、`&` 也会转义，避免提前闭合 `<script>`。

`og:url`、canonical 与站点地图中的地址都使用 `PUBLIC_BASE_URL`（默认 `https://scribe.orangely.xyz`），为空时使用请求的域名。

## 爬虫入口

- `/robots.txt`：允许所有爬虫（包括 AI 爬虫）访问页面，禁止抓取 `/api/`（OpenAPI 规范除外），并指向站点地图。
- `/sitemap.xml`：首页、图库、使用说明、隐私政策、使用条款和最多 10000 条公开笔记（带 `lastmod`）。`unlisted` 笔记不会出现。
- `/llms.txt`：给大模型与 AI agent 的站点说明，包括产品介绍、主要页面、完整结构的预检/发布流程和最近 20 条公开笔记；`index.html` 中以 `<link rel="alternate" type="text/markdown">` 指向它。发布只提交契约版本与已整理的笔记，并明确区分数据验证与浏览器排版。
- `/api/v1/openapi.json`：机器可读的 API 规范，与发布验证器共享字段、长度、枚举及图元契约。发布不接收独立原文 `text` 字段，也不另外保存或公开原文副本；主动放进 `note` 的原文摘录仍会作为笔记内容出现在公开 JSON、笔记 HTML 等响应中。

## 上线后

1. 在 [Google Search Console](https://search.google.com/search-console) 与 [Bing Webmaster Tools](https://www.bing.com/webmasters)（Copilot 与多家 AI 搜索使用必应索引）验证 `scribe.orangely.xyz` 并提交 `https://scribe.orangely.xyz/sitemap.xml`；面向中文用户时，可同样提交到[百度搜索资源平台](https://ziyuan.baidu.com/)。
2. 用 [Rich Results Test](https://search.google.com/test/rich-results) 或 [Schema Markup Validator](https://validator.schema.org/) 检查首页与一条公开笔记的结构化数据。
3. 把一条笔记链接发到常用的聊天工具里，确认预览显示标题、摘要与 OG 图；预览有缓存时可用各平台的调试工具刷新。
4. 如果在 Cloudflare 控制台开启了 “AI Crawl Control / 阻止 AI 爬虫”，GEO 相关的内容将无法被 AI 搜索抓取，请按需要调整。
