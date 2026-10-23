# API 与数据契约

所有接口由 Cloudflare Worker 提供，返回 `application/json; charset=utf-8`，并带 `Cache-Control: no-store`（`/api/config` 除外）和 `X-Request-Id` 响应头。类型定义见 [`shared/api.ts`](../shared/api.ts)、[`shared/note.ts`](../shared/note.ts)、[`shared/doodle.ts`](../shared/doodle.ts)。

> 发布接口（`/api/v1/notes`）、查看页数据（`/api/notes/:id`）与图库（`/api/gallery`）见 [publishing.md](publishing.md)，机器可读的定义见 `/api/v1/openapi.json`。

## `GET /api/config`

前端启动时读取的公开配置：

```json
{ "maxInputChars": 12000, "doodleEnabled": false, "mock": false }
```

## `POST /api/structure`

请求：

```json
{
  "text": "用户粘贴的原始文本",
  "template": "reading-notes",
  "language": "auto",
  "style": "hybrid-cornell",
  "detail": "standard"
}
```

| 字段 | 必填 | 取值 |
| --- | --- | --- |
| `text` | 是 | 非空字符串，不超过 `MAX_INPUT_CHARS` 个字符 |
| `template` | 否 | `general`（默认）· `reading-notes` · `meeting-minutes` · `lecture-summary` · `idea-fragments` |
| `language` | 否 | 输出语言：`auto`（默认，跟随原文）· `zh` · `en` |
| `style` | 否 | 版式：`hybrid-cornell`（默认）· `classic-cornell` · `free-journal` · `minimal`，影响线索的写法与段落密度 |
| `detail` | 否 | `concise` · `standard`（默认）· `detailed`，控制段落数量与总字数，避免溢出单页 |

处理流程：

1. 检查方法、`Content-Type`、`Origin`、限流，流式读取请求体并强制字节上限；
2. 校验枚举与长度，清理控制字符与 HTML 标签；
3. 组装提示词与 JSON Schema，按模型调用约定（见 `MODEL_PROFILES`）调用 Workers AI，带超时；
4. 宽松解析输出（去除思考块、代码块标记），规范化为 `NoteStructure`；不合规时把错误反馈给模型做有限次数的修复；
5. 返回统一格式。

成功响应：

```json
{
  "note": {
    "title": "深度工作：专注是稀缺的超能力",
    "date": "2024年3月1日",
    "cues": [{ "keyword": "注意力残留", "note": "切换任务的隐形成本" }],
    "sections": [
      { "heading": "两种工作", "content": "……", "highlights": ["难以复制"] }
    ],
    "summary": "……",
    "doodlePrompt": "一盏亮着的台灯照在摊开的书上",
    "doodleTheme": "lightbulb"
  },
  "meta": {
    "requestId": "8f0c…",
    "model": "@cf/qwen/qwen3-30b-a3b-fp8",
    "latencyMs": 3120,
    "attempts": 1,
    "warnings": []
  }
}
```

### `NoteStructure` 约束

| 字段 | 约束 |
| --- | --- |
| `title` | 必填，≤ 60 字 |
| `date` | 可选，≤ 40 字，仅当原文写明日期时由模型填写（前端在缺省时显示当天日期） |
| `cues` | ≤ 8 项；`keyword` ≤ 24 字，`note` ≤ 120 字 |
| `sections` | 1–6 项；`heading` 可选 ≤ 50 字；`content` ≤ 900 字，可含以 `- ` 或 `1.` 开头的列表行；`highlights` ≤ 5 个，每个 ≤ 60 字，且必须逐字（忽略大小写）出现在该段 `content` 中，否则被丢弃 |
| `summary` | ≤ 400 字，可为空字符串 |
| `doodlePrompt` | 可选，≤ 160 字 |
| `doodleTheme` | 可选，内置插图主题枚举（`lightbulb`、`book`、`coffee`、`rocket`、`brain` 等 20 个）；无效时根据 `doodlePrompt` 推断 |
| `doodleSpec` | 可选，见下文 `DoodleSpec`；无效时忽略 |

规范化只保留上述字段，未知字段一律丢弃；字符串去除控制字符、HTML 标签与 Markdown 强调符号，并按码点截断。

## `POST /api/doodle`（可选，默认关闭）

由 `DOODLE_API_ENABLED=true` 开启。请求 `{ "concept": "一盏亮着的台灯" }`（≤ 80 字），响应：

```json
{
  "doodle": {
    "concept": "台灯",
    "elements": [
      { "type": "circle", "cx": 50, "cy": 40, "r": 14, "fill": "yellow", "stroke": "ink", "width": 2 },
      { "type": "path", "points": [[30, 80], [50, 70], [70, 80]], "closed": false, "smooth": true, "fill": "none", "stroke": "ink", "width": 2 }
    ]
  },
  "meta": { "requestId": "…", "model": "…", "latencyMs": 1800, "attempts": 1, "warnings": [] }
}
```

### `DoodleSpec` 约束

- 画布为 100×100，所有坐标钳制到 0–100；
- 图元类型仅限 `line`、`arrow`（`x1,y1,x2,y2`）、`circle`（`cx,cy,r`，r 为 1–50）、`rect`（`x,y,w,h,rx`）、`path`（`points` 为 2–24 个 `[x,y]`，可选 `closed`、`smooth`）；
- 样式只能取调色板名称：`stroke ∈ {ink, accent, muted}`、`fill ∈ {none, yellow, green, orange, ink}`，`width` 为 0.5–4；
- 最多 24 个图元，任何其他字段（`href`、`style`、事件属性、任意 `d` 字符串等）都会被丢弃；
- 客户端渲染前会再次规范化，然后由受控生成器转为 `<path>`。

校验后的图元会以哈希键缓存（Cache API，`DOODLE_CACHE_TTL_SECONDS`），缓存内容不含概念原文。

## 错误响应

```json
{
  "error": {
    "code": "AI_OUTPUT_INVALID",
    "message": "无法生成有效的笔记结构，请重试。",
    "requestId": "8f0c…"
  }
}
```

| HTTP | `code` | 场景 |
| --- | --- | --- |
| 400 | `INVALID_REQUEST` | 缺少字段、枚举值无效、文本为空 |
| 400 | `INVALID_JSON` | 请求体不是合法 JSON |
| 401 | `UNAUTHORIZED` | 发布接口缺少 API 密钥，或密钥无效 / 已吊销（带 `WWW-Authenticate: Bearer`） |
| 403 | `FORBIDDEN_ORIGIN` | 浏览器跨站调用（`Origin` 不是本站且不在 `ALLOWED_ORIGINS` 中） |
| 403 | `FEATURE_DISABLED` | `/api/doodle` 未启用 |
| 404 | `NOT_FOUND` | 接口不存在 |
| 405 | `METHOD_NOT_ALLOWED` | 方法错误（带 `Allow` 头） |
| 413 | `PAYLOAD_TOO_LARGE` | 请求体超过 `MAX_BODY_BYTES` |
| 413 | `TEXT_TOO_LONG` | 文本超过 `MAX_INPUT_CHARS` |
| 409 | `IDEMPOTENCY_CONFLICT` | 同一个 `Idempotency-Key` 用于内容不同的发布请求 |
| 415 | `UNSUPPORTED_MEDIA_TYPE` | 不是 `application/json` |
| 429 | `RATE_LIMITED` | 触发本服务限流（带 `Retry-After`） |
| 429 | `AI_RATE_LIMITED` | Workers AI 额度或频率限制（带 `Retry-After`） |
| 502 | `AI_OUTPUT_INVALID` | 修复重试后仍无法得到合规结构 |
| 502/503 | `AI_UNAVAILABLE` | 模型不可用、容量不足或上游错误 |
| 503 | `STORAGE_UNAVAILABLE` | 未配置 D1 绑定 |
| 504 | `AI_TIMEOUT` | 模型调用超时 |
| 500 | `INTERNAL_ERROR` | 未预期的错误 |

`ALLOWED_ORIGINS` 中的来源可以从浏览器跨源调用 `/api/structure` 与 `/api/doodle`：Worker 响应 `OPTIONS` 预检（允许 `POST` 与 `Content-Type` 头），并在所有响应（包括错误）中带上 `Access-Control-Allow-Origin` 与 `Vary: Origin`。同源请求不带 CORS 头；发布接口 `/api/v1/*` 面向服务端调用，不提供 CORS。

前端额外使用 `NETWORK_ERROR`、`CLIENT_TIMEOUT`（120 秒）表示客户端侧错误，并在 AI 相关错误时提供“本地快速排版”兜底。
