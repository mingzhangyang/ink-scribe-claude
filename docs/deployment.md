# 部署与运维

前端静态资源与 API 一起部署为**一个** Cloudflare Worker：Vite 构建 `dist/client`（静态资源），Cloudflare Vite 插件同时构建 Worker（`dist/ink_scribe`，含生成的 `wrangler.json`）。`/api/*`、需要注入 SEO 信息的页面（`/`、`/gallery`、`/guide`、`/privacy`、`/terms`、`/n/*`）以及 `/llms.txt`、`/robots.txt`、`/sitemap.xml` 先交给 Worker（`run_worker_first`），其余路径由 Workers Static Assets 直接返回，未命中时回退到 `index.html`（SPA）。

## 前置条件

- Node.js 22+，`npm install`
- Cloudflare 账号，已开通 Workers 与 Workers AI（Workers AI 按 Neurons 计费，免费额度有每日上限）
- 登录 Wrangler：`npx wrangler login`；CI 中使用 `CLOUDFLARE_API_TOKEN` 与 `CLOUDFLARE_ACCOUNT_ID` 环境变量（Token 需要 Workers Scripts 编辑、Workers AI 与 D1 编辑权限）

## 发布

```bash
npm run typecheck && npm test
npm run db:migrate:remote  # 在 Worker 更新前应用 D1 迁移
npm run deploy          # = vite build && wrangler deploy
```

`wrangler deploy` 会读取构建产物中重定向的配置（`.wrangler/deploy/config.json` → `dist/ink_scribe/wrangler.json`），一起上传 Worker 代码与静态资源（含约 500 个字体分片，后续部署只上传变化的文件）。

> 不要用 `--mode mock` 构建要部署的产物，否则 Worker 会带上 `AI_MOCK=true`，不再调用 Workers AI。

### 发布契约升级

agent 发布必须提供 `schemaVersion: 1` 与完整 `note`，不接受原文 `text`。升级前同步修改原有调用方，具体请求见 [publishing.md](publishing.md)。`POST /api/v1/notes/validate` 可在不创建作品的情况下预检；发布与预检均不调用 Workers AI。

先应用 `0003_publication_schema.sql`，再部署新 Worker。若 Worker 先上线，已有作品仍按版本 `0` 读取，但发布会失败，直到迁移完成。迁移为已有作品记录版本 `0`，使历史链接继续可读；新作品保存为版本 `1`，按严格契约读取。不单独保存原文 `text`，但 `note` 中主动保留的摘录仍会作为笔记写入 D1；不需要新增绑定。并发与删除保护仍依赖此前的 `0002_publish_reservations.sql`，应按顺序应用全部迁移。

## 配置项

在 [`wrangler.jsonc`](../wrangler.jsonc) 的 `vars` 中修改（完整列表见 README）。常见调整：

```jsonc
"vars": {
  "AI_MODEL": "@cf/meta/llama-3.3-70b-instruct-fp8-fast",   // 切换模型
  "AI_RESPONSE_FORMAT": "",                                 // 留空则使用 MODEL_PROFILES 中的约定
  "AI_MAX_OUTPUT_TOKENS": "2048",
  "DOODLE_API_ENABLED": "true"                              // 开启 AI 插图
}
```

本服务没有必须的 Secret：AI 通过 binding 调用，不需要 API Key。

### 绑定

| 绑定 | 配置 | 作用 |
| --- | --- | --- |
| `AI` | `"ai": { "binding": "AI" }` | Workers AI，必需 |
| `ASSETS` | `assets.binding` | 静态资源（Worker 内兜底使用） |
| `RATE_LIMITER` | `ratelimits`（默认每 IP 每分钟 12 次） | 跨实例限流；`namespace_id` 是账户内唯一的正整数字符串，如与其他 Worker 冲突请修改。删除该绑定后退化为单实例内存限流（`RATE_LIMIT_PER_MINUTE`） |
| `DB` | `d1_databases` | 已发布的笔记与 API 密钥；部署前 `wrangler d1 create ink-scribe` 并填入 `database_id`，再执行 `npm run db:migrate:remote` |
| `METRICS` | `analytics_engine_datasets`（默认注释） | 可选：写入调用量、延迟、token 用量，用于成本监控 |

### Workers Builds（连接 GitHub 自动构建）

在 Cloudflare 控制台把仓库连接到 `ink-scribe` Worker 时：

- **Build command** 设为 `npm run build`。`wrangler.jsonc` 中的 `assets` 没有 `directory`，完整的部署配置由 `vite build` 生成到 `dist/ink_scribe/wrangler.json`；跳过构建直接运行 wrangler 会报 `The assets property … is missing the required directory property`。
- 生产分支的 **Deploy command** 设为 `npm run db:migrate:remote && npx wrangler deploy`。合并到生产分支会直接部署，先应用 D1 迁移，新 Worker 上线时表结构才已就绪；迁移失败时不会部署。构建使用的 API Token 需要 D1 编辑权限，wrangler 在非交互环境中自动确认迁移。迁移执行到新 Worker 上线之间旧 Worker 仍在运行，因此迁移要保持向后兼容（如只加带默认值的列）。
- 其他分支的部署命令保持默认 `npx wrangler preview`（Worker Previews）。
- 预览使用 `wrangler.jsonc` 中的 `previews` 块：变量与生产一致但 `PUBLIC_BASE_URL` 为空，限流使用独立的命名空间，**不绑定 D1**，因此预览不会读写生产的笔记与 API 密钥（图库为空，发布接口返回 503）。修改顶层 `vars` 时要同步修改 `previews.vars`。

### 自定义域名

`routes` 中以 `custom_domain: true` 绑定 `scribe.orangely.xyz`（主域名）与 `ink-scribe.orangely.xyz`：`wrangler deploy` 会自动创建 DNS 记录并签发证书。前提是 `orangely.xyz` 托管在部署所用的 Cloudflare 账户中，且这两个子域名下没有已存在的 DNS 记录。两个域名提供同样的内容，界面与 API 都可以直接使用（同源请求按请求的域名判断）；`*.workers.dev` 地址也仍然可用。返回的分享链接、canonical 与站点地图统一使用 `PUBLIC_BASE_URL`，因此搜索引擎只收录主域名，不会把两个域名当作重复内容。主域名原为 `ink-scribe.orangely.xyz`，之前分发的该域名分享链接继续可用。

### AI Gateway（可选）

在 Cloudflare 控制台创建 AI Gateway 后设置 `AI_GATEWAY_ID`，即可获得网关侧的请求统计、缓存与限流。Worker 调用时设置 `collectLog: false`，请求关闭网关正文日志；可选缓存与平台数据保留仍取决于实际配置及平台规则。

## 日志与成本监控

- `observability.enabled = true`：Workers Logs 收集结构化日志。每个请求一条 `api.request`，字段只有 `requestId`、路由、状态码、错误码、模型、耗时、尝试次数、原文字数、token 数等元数据；5xx 另有 `api.error_detail`（只含错误名与上游错误编号）。**不记录原文与模型输出**，`tests/worker.test.ts` 中有对应测试。
- 开启 `METRICS` 后，可用 Analytics Engine SQL API 统计成本：

```sql
SELECT
  blob2 AS model,
  SUM(_sample_interval) AS requests,
  SUM(_sample_interval * IF(blob3 = '200', 1, 0)) AS ok,
  AVG(double1) AS avg_latency_ms,
  SUM(_sample_interval * double2) AS prompt_tokens,
  SUM(_sample_interval * double3) AS completion_tokens
FROM ink_scribe_ai_usage
WHERE timestamp > NOW() - INTERVAL '1' DAY AND blob1 = '/api/structure'
GROUP BY model
```

字段含义：`blob1` 路由、`blob2` 模型、`blob3` 状态码、`blob4` 错误码、`blob5` 模板；`double1` 延迟、`double2` 输入 token、`double3` 输出 token、`double4` 尝试次数、`double5` 原文字数。将 token 数乘以定价页的单价即可估算费用。

## 安全响应头

[`public/_headers`](../public/_headers) 为所有静态资源设置 CSP（只允许同源脚本、样式、字体与 `data:`/`blob:` 图片）、`X-Content-Type-Options`、`Referrer-Policy`、`Permissions-Policy`，并为带哈希的 `/assets/*` 设置长期缓存。API 响应在 Worker 中单独设置 `no-store` 与 `nosniff`。

## 上线前检查清单

- [ ] 在目标账户的 Workers AI 模型目录中确认 `AI_MODEL` 可用，并按 [model-evaluation.md](model-evaluation.md) 跑一次评测、确认定价
- [ ] `npm run deploy` 后访问站点，用示例文本生成一次，检查 `X-Request-Id` 与 Workers Logs 中的 `api.request` 记录
- [ ] 确认 `ratelimits.namespace_id` 不与账户内其他 Worker 冲突，必要时调整阈值
- [ ] 若前端会被其他域名嵌入或调用，配置 `ALLOWED_ORIGINS`
- [ ] 创建 D1 并执行 `npm run db:migrate:remote`；确认 `https://scribe.orangely.xyz` 与 `https://ink-scribe.orangely.xyz` 都可访问；用 `npm run keys -- create --remote` 发放密钥，按 [publishing.md](publishing.md) 发布一条测试笔记，确认链接可打开、出现在图库
- [ ] 根据预算决定是否开启 `DOODLE_API_ENABLED`、`METRICS` 与 AI Gateway
- [ ] 在 Chrome、Safari、Firefox 上各导出一次 PNG/JPG 并测试“复制到剪贴板”
- [ ] 在 Google Search Console、Bing Webmaster Tools 提交 `sitemap.xml`，检查结构化数据与链接预览，见 [seo.md](seo.md)

## 故障排查

| 现象 | 可能原因 |
| --- | --- |
| `npm run dev` 报 `CLOUDFLARE_API_TOKEN` 相关错误 | AI binding 只能远程执行，需要先 `wrangler login`；离线开发请用 `npm run dev:mock` |
| 接口返回 `AI_UNAVAILABLE`（502） | 模型 ID 不存在或输入参数不被该模型接受：检查 `AI_MODEL`，或调整 `AI_API_STYLE` / `AI_RESPONSE_FORMAT` / `AI_EXTRA_PARAMS`；Workers Logs 中的 `upstreamCode` 是上游错误编号 |
| 频繁 `AI_OUTPUT_INVALID` | 该模型对 JSON Schema 遵循较差：换用 `json_object` 或更强的模型，参考评测结果 |
| `AI_RATE_LIMITED` | Workers AI 免费额度用尽或触发平台限流 |
| 发布或预检返回 `422 VALIDATION_FAILED` | 检查 `error.issues` 的字段路径；必须提供 `schemaVersion: 1` 与完整 `note`，移除原文 `text`，不能依赖服务补齐或截断正文 |
| 发布成功但固定尺寸无法导出 | 数据契约通过不代表页面能容纳全文；等待字体完成后检查排版提示，缩短内容、选择长图或使用默认 `appearance.overflow: "expand"` |
| 导出图片中文字体缺失 | 字体分片下载失败或被浏览器扩展拦截；导出前会等待 `document.fonts` 加载完成 |
