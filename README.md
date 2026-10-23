# 墨语笔记 · InkScribe

把粘贴的散乱文本或文章，通过 AI 重构为具有手写质感、主次分明的**单页手写笔记**：康奈尔结构 + 手账美学，支持中英文手写字体、多种纸张纹理、荧光笔重点、手绘插图与贴纸，并可导出高清图片或复制到剪贴板。

- **前端**：Vite + React + TypeScript，纯客户端排版、贴纸编辑与图片导出
- **服务端**：Cloudflare Worker（同时托管静态资源与 `/api/*`），不依赖 Node.js / Express 常驻服务
- **AI**：只通过 Cloudflare Workers AI binding 调用，模型 ID 与调用参数全部配置化

## 功能

| 模块 | 说明 |
| --- | --- |
| 输入 | 中英文文本，模板：通用整理 / 读书摘抄 / 会议纪要 / 课程总结 / 思想碎片；输出语言（跟随原文 / 中文 / English）；详略（精简 / 标准 / 详细） |
| 上传文件 | 支持 TXT / Markdown（自动识别 UTF-8、UTF-16、GBK 编码）、HTML（去除脚本与导航）、Word .docx、文字型 PDF；点击上传或拖入文本框。文件在浏览器本地解析，只有提取出的文字会用于整理；文字超出上限时可一键截取。扫描件 / 图片 PDF 与旧版 .doc 暂不支持，会给出明确提示 |
| AI 整理 | `POST /api/structure` 返回经过校验的 `NoteStructure`（标题、线索、段落、重点词、总结、插图建议） |
| 版式 | 混合康奈尔手账（默认）、经典康奈尔、自由手账、简约手札 |
| 纸张 | 方格纸、横线本、点阵纸、象牙白纸、纹理纸、牛皮纸、复古羊皮纸；页面 A4 / 3:4 / 1:1 / 长图 |
| 字体与墨水 | 5 款中文手写字体 + 4 款英文手写字体（均为 OFL），字号 / 行距 / 字距；碳素黑、钢笔蓝、复古棕、黛绿、波尔多红；三种荧光笔色 |
| 自然手写感 | 逐字基线浮动、墨色深浅、段落微旋转，幅度可调且可复现（同一笔记预览与导出一致）；“换一种笔迹” |
| 插图与贴纸 | 20 个内置手绘插图（受控 SVG 生成器绘制）；和纸胶带、便利贴、回形针、星星、咖啡渍；拖拽、缩放、旋转、删除、层级调整、键盘微调 |
| AI 插图（可选） | `POST /api/doodle` 只返回受限图元规格（线、箭头、圆、矩形、折线），经校验后由本地生成器绘制，默认关闭 |
| 内容微调 | 结构化编辑标题、日期、线索、段落、重点短语与总结 |
| 溢出处理 | 自动检测文字超出页面，一键缩小字号、切换为长图，或以“精简”档位重新生成 |
| 导出 | PNG / JPG，1x / 2x / 3x；复制 PNG 到剪贴板（不支持时提示并保留下载）；字体按 unicode-range 分片按需内嵌 |
| 发布与分享 | 用 API 密钥调用 `POST /api/v1/notes`（传原文或已整理的结构），返回查看链接 `/n/<id>`；链接带标题与摘要的 Open Graph 信息。详见 [docs/publishing.md](docs/publishing.md) |
| 图库 | `/gallery` 展示公开笔记，可按模板与语言筛选；可在编辑器中打开任意已发布笔记继续修改 |
| SEO 与 GEO | 首页、图库与笔记查看页由 Worker 注入标题、canonical、Open Graph、JSON-LD 和可读正文；提供 `robots.txt`、`sitemap.xml` 与 `llms.txt`；标志、图标与 OG 图由代码生成（`npm run brand`）。详见 [docs/seo.md](docs/seo.md) |
| 兜底 | AI 不可用时可一键“本地快速排版”（基于段落与关键词的抽取式整理，不调用模型） |
| 界面语言与主题 | 界面支持中文 / English（首次访问按浏览器语言选择），外观支持浅色 / 深色 / 跟随系统；右上角一键切换，偏好保存在本机。笔记画布上的标签始终跟随笔记本身的语言 |

## 快速开始

需要 Node.js 22+。

```bash
npm install

# 无需 Cloudflare 账号：Worker 使用本地启发式整理器和示例插图（AI_MOCK）
npm run dev:mock

# 连接真实 Workers AI（需要先 `npx wrangler login`，AI binding 始终在远端执行并计费）
npm run dev
```

打开终端输出的地址（默认 <http://localhost:5173>）。

| 命令 | 作用 |
| --- | --- |
| `npm run dev` / `npm run dev:mock` | 本地开发（Vite + Cloudflare Vite 插件，在 workerd 中运行 Worker） |
| `npm run build` | 构建前端静态资源（`dist/client`）与 Worker（`dist/ink_scribe`） |
| `npm run preview` | 构建后在本地 workerd 中预览生产产物 |
| `npm run deploy` | 构建并通过 `wrangler deploy` 发布 |
| `npm run typecheck` | TypeScript 项目引用全量类型检查 |
| `npm test` | Vitest 单元测试（契约校验、Worker API、AI 输出解析、排版工具等） |
| `npm run test:e2e` | 浏览器验收测试：以 mock 模式构建并在本地 workerd 预览，用 Playwright 对照验收标准逐条断言（71 项，覆盖文件上传、生成、样式、贴纸、导出、剪贴板、注入防护、错误提示、发布与查看、图库、界面语言与主题、移动端）。会覆盖 `dist/`，部署前请重新 `npm run build`；首次运行需 `npx playwright install chromium`，或用 `PLAYWRIGHT_CHROMIUM_PATH` 指定本机 Chromium |
| `npm run db:migrate` / `npm run db:migrate:remote` | 应用 D1 迁移（本地 / 线上） |
| `npm run keys -- create --name … [--remote]` | 发放 API 密钥（另有 `list`、`revoke`），见 [docs/publishing.md](docs/publishing.md) |
| `npm run eval:models` | 对候选 Workers AI 模型做质量 / 延迟 / 成本评测，见 [docs/model-evaluation.md](docs/model-evaluation.md) |

> ⚠️ 不要用 `vite build --mode mock` 构建要部署的产物：mock 模式会把 `AI_MOCK=true` 写入生成的 Worker 配置。

## 架构

```text
Browser ── 输入 / 画布 / 样式 / 贴纸 / 导出（客户端完成排版与图片渲染）
   │ HTTPS JSON（同源）
   ▼
Cloudflare Worker ── 静态资源 + SPA 回退；/api/structure、/api/doodle、/api/config；
   │                   发布接口 /api/v1/notes、图库 /api/gallery；
   │                   首页、图库与查看页 /n/:id 注入 SEO 信息与正文，robots.txt、sitemap.xml、llms.txt
   └── D1：已发布的笔记与 API 密钥（哈希）
   │  校验 · 来源检查 · 限流 · 超时 · 修复重试 · 只记录元数据的日志与指标
   ▼ AI binding
Cloudflare Workers AI ── 配置化模型 ID，JSON 模式结构化输出
```

```text
shared/      前后端共享：NoteStructure / DoodleSpec 契约与规范化、选项枚举、本地整理器
worker/      Worker：路由、配置与模型调用约定、提示词、AI 调用（超时/重试/修复）、限流、日志、
             发布接口与存储（D1）、页面 SEO 信息与站点地图
migrations/  D1 数据库迁移
src/         React 前端：状态（zustand）、版式、手写渲染、贴纸、导出、字体
scripts/     模型评测脚本与评测集、API 密钥管理、品牌资源生成（scripts/brand）
tests/       Vitest 单元测试
e2e/         Playwright 浏览器验收测试
docs/        API、部署、模型评测、字体与导出说明
```

## 配置

所有配置都在 [`wrangler.jsonc`](wrangler.jsonc) 的 `vars` 中（字符串），修改模型无需改代码：

| 变量 | 默认值 | 说明 |
| --- | --- | --- |
| `AI_MODEL` | `@cf/qwen/qwen3-30b-a3b-fp8` | 结构化整理使用的模型（暂定默认，需按评测结果确认） |
| `AI_DOODLE_MODEL` | 同 `AI_MODEL` | AI 插图使用的模型 |
| `AI_API_STYLE` | 按模型 | `messages`（Chat 风格）或 `responses`（OpenAI Responses 风格） |
| `AI_RESPONSE_FORMAT` | 按模型 | `json_schema` / `openai_json_schema` / `json_object` / `none` |
| `AI_EXTRA_PARAMS` | 按模型 | 合并进模型输入的 JSON，例如 `{"reasoning_effort":"low"}` |
| `AI_TEMPERATURE` | `0.3` | 采样温度 |
| `AI_MAX_OUTPUT_TOKENS` | `2048` | 输出 token 上限（插图接口最多 1200） |
| `AI_TIMEOUT_MS` | `45000` | 单次模型调用超时 |
| `AI_MAX_RETRIES` | `1` | 输出不合规或上游繁忙时的修复/重试次数（仅在前一半时间预算内重试） |
| `AI_GATEWAY_ID` | 空 | 可选，经 AI Gateway 调用（默认关闭网关正文日志） |
| `MAX_INPUT_CHARS` | `12000` | 原文最大字数 |
| `MAX_BODY_BYTES` | `81920` | 请求体字节上限（流式读取时强制执行）；实际取值不低于 `MAX_INPUT_CHARS × 6 + 8KB`，保证转义为 `\uXXXX` 的中文 JSON 也能完整发送 |
| `RATE_LIMIT_PER_MINUTE` | `12` | 未配置 Rate Limiting 绑定时的单实例内存限流阈值 |
| `DOODLE_API_ENABLED` | `false` | 是否启用 `/api/doodle` |
| `DOODLE_CACHE_TTL_SECONDS` | `86400` | AI 插图缓存时长（只缓存校验后的图元，缓存键为哈希） |
| `ALLOWED_ORIGINS` | 空 | 额外允许跨源调用 AI 接口的来源，逗号分隔 |
| `PUBLIC_BASE_URL` | `https://scribe.orangely.xyz` | 分享链接使用的站点地址；为空时使用请求的域名。本地开发与 mock 构建中自动清空 |
| `DEFAULT_TIMEZONE` | `Asia/Shanghai` | 发布时自动补全笔记日期使用的时区 |
| `API_RATE_LIMIT_PER_MINUTE` | `30` | 未配置 Rate Limiting 绑定时，每个 API 密钥每分钟的请求上限 |

“按模型”的默认值来自 [`worker/config.ts`](worker/config.ts) 中的 `MODEL_PROFILES`，覆盖了 Qwen、Llama、Mistral、Gemma、GLM、DeepSeek、gpt-oss 等候选模型的调用约定。

## 安全与隐私

- 浏览器从不直接调用模型，也不接触任何凭据。
- 原文只用于本次请求：服务端不持久化，日志与 Analytics Engine 指标只记录长度、耗时、token 数、错误码等元数据（有单元测试保证日志不含原文）。
- 模型输出经过严格规范化：只保留契约字段、清理 HTML/控制字符、限制长度与数量，重点词必须逐字出现在正文中。
- 插图只接受受限图元规格；SVG 由本地生成器以 React 元素渲染，不使用 `innerHTML`，不允许脚本、事件处理器、外部资源或 URL。
- AI 接口检查 `Origin`，拒绝其他站点借用浏览器调用；按客户端 IP 限流；静态资源带 CSP 等安全响应头（[`public/_headers`](public/_headers)）。
- 上传的文件只在浏览器内解析（PDF 使用按需加载的 pdf.js，CMap 文件同源提供），文件本身不会发送到服务器。
- 发布接口只接受 API 密钥（只存哈希、可吊销）；笔记 ID 为 128 位随机数，`unlisted` 笔记不进入图库并带 `noindex`；入库与读取时都会再次规范化。
- 本机只保存外观偏好（localStorage），不保存原文与笔记。

## 文档

- [API 与数据契约](docs/api.md)
- [发布接口、查看页与图库](docs/publishing.md)
- [部署与运维](docs/deployment.md)
- [品牌资源、SEO 与 GEO](docs/seo.md)
- [Workers AI 模型选择与评测](docs/model-evaluation.md)
- [字体、导出与浏览器兼容](docs/fonts-and-export.md)

## 许可证说明

手写字体均使用 SIL Open Font License 1.1（霞鹜文楷屏幕阅读版、龙藏体、马善政楷书、站酷快乐体、志莽行书、Kalam、Caveat、Patrick Hand、Indie Flower），随静态资源一起分发，详见 [docs/fonts-and-export.md](docs/fonts-and-export.md)。
