# 部署与运维

前端静态资源与 API 一起部署为**一个** Cloudflare Worker：Vite 构建 `dist/client`（静态资源），Cloudflare Vite 插件同时构建 Worker（`dist/ink_scribe`，含生成的 `wrangler.json`）。`/api/*` 请求先交给 Worker（`run_worker_first`），其余路径由 Workers Static Assets 直接返回，未命中时回退到 `index.html`（SPA）。

## 前置条件

- Node.js 22+，`npm install`
- Cloudflare 账号，已开通 Workers 与 Workers AI（Workers AI 按 Neurons 计费，免费额度有每日上限）
- 登录 Wrangler：`npx wrangler login`；CI 中使用 `CLOUDFLARE_API_TOKEN` 与 `CLOUDFLARE_ACCOUNT_ID` 环境变量（Token 需要 Workers Scripts 编辑与 Workers AI 权限）

## 发布

```bash
npm run typecheck && npm test
npm run deploy          # = vite build && wrangler deploy
```

`wrangler deploy` 会读取构建产物中重定向的配置（`.wrangler/deploy/config.json` → `dist/ink_scribe/wrangler.json`），一起上传 Worker 代码与静态资源（含约 500 个字体分片，后续部署只上传变化的文件）。

> 不要用 `--mode mock` 构建要部署的产物，否则 Worker 会带上 `AI_MOCK=true`，不再调用 Workers AI。

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

### 自定义域名

`routes` 中以 `custom_domain: true` 绑定 `ink-scribe.orangely.xyz`：`wrangler deploy` 会自动创建 DNS 记录并签发证书。前提是 `orangely.xyz` 托管在部署所用的 Cloudflare 账户中，且该子域名下没有已存在的 DNS 记录。`*.workers.dev` 地址仍然可用，但返回的分享链接统一使用 `PUBLIC_BASE_URL`。

### AI Gateway（可选）

在 Cloudflare 控制台创建 AI Gateway 后设置 `AI_GATEWAY_ID`，即可获得网关侧的请求统计、缓存与限流。Worker 调用时设置了 `collectLog: false`，网关不保存请求与响应正文。

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
- [ ] 创建 D1 并执行 `npm run db:migrate:remote`；确认 `https://ink-scribe.orangely.xyz` 可访问；用 `npm run keys -- create --remote` 发放密钥，按 [publishing.md](publishing.md) 发布一条测试笔记，确认链接可打开、出现在图库
- [ ] 根据预算决定是否开启 `DOODLE_API_ENABLED`、`METRICS` 与 AI Gateway
- [ ] 在 Chrome、Safari、Firefox 上各导出一次 PNG/JPG 并测试“复制到剪贴板”

## 故障排查

| 现象 | 可能原因 |
| --- | --- |
| `npm run dev` 报 `CLOUDFLARE_API_TOKEN` 相关错误 | AI binding 只能远程执行，需要先 `wrangler login`；离线开发请用 `npm run dev:mock` |
| 接口返回 `AI_UNAVAILABLE`（502） | 模型 ID 不存在或输入参数不被该模型接受：检查 `AI_MODEL`，或调整 `AI_API_STYLE` / `AI_RESPONSE_FORMAT` / `AI_EXTRA_PARAMS`；Workers Logs 中的 `upstreamCode` 是上游错误编号 |
| 频繁 `AI_OUTPUT_INVALID` | 该模型对 JSON Schema 遵循较差：换用 `json_object` 或更强的模型，参考评测结果 |
| `AI_RATE_LIMITED` | Workers AI 免费额度用尽或触发平台限流 |
| 导出图片中文字体缺失 | 字体分片下载失败或被浏览器扩展拦截；导出前会等待 `document.fonts` 加载完成 |
