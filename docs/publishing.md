# 发布接口、查看页与图库

通过 API 密钥调用 `/api/v1/notes`，把文字整理成手写笔记并保存，返回可以直接发给用户的链接（`/n/<id>`）。设为公开（`public`）的笔记会出现在图库（`/gallery`）中。适合让 AI agent 或自动化脚本代为制作和发布笔记。

- 只有持有 API 密钥的请求可以写入；网页端不提供匿名发布，因此图库内容都来自你发放的密钥，无需审核。
- 只保存整理后的笔记结构、外观与贴纸，不保存原文；笔记永久保存，直到通过 API 删除。
- 新建笔记默认 `unlisted`（仅持有链接可见，页面带 `noindex`），传 `"visibility": "public"` 才会进入图库。

## 一次性部署准备

```bash
npx wrangler d1 create ink-scribe               # 把返回的 database_id 填入 wrangler.jsonc
npm run db:migrate:remote                       # 创建数据表
npm run deploy
npm run keys -- create --name "我的发布脚本" --remote   # 密钥只显示一次
```

- 不为每条笔记生成预览图：图库以标题与摘要的文字卡片展示，链接预览显示标题、摘要与统一的站点分享图；查看页可在浏览器中下载高清图片。
- 返回的链接使用 `PUBLIC_BASE_URL`（默认 `https://scribe.orangely.xyz`）；更换域名时同时修改它与 `wrangler.jsonc` 中的 `routes`。本地开发与 mock 构建中该值会被清空，链接指向本机。
- 本地开发：`npm run db:migrate` 创建本地表，`npm run keys -- create --name 本地` 生成本地密钥。

## 发布一条笔记

```bash
curl -X POST https://notes.example.com/api/v1/notes \
  -H "Authorization: Bearer $INKSCRIBE_API_KEY" \
  -H "Content-Type: application/json" \
  -H "Idempotency-Key: weekly-review-2026-43" \
  -d '{
        "text": "本周完成了导出功能……",
        "template": "meeting-minutes",
        "detail": "concise",
        "visibility": "public",
        "appearance": { "layout": "free-journal", "paper": "kraft", "ink": "brown", "zhFont": "long-cang" }
      }'
```

返回 `201`，主要字段：

```json
{
  "id": "aYsHAXVJORuZWD8zykcUdg",
  "url": "https://notes.example.com/n/aYsHAXVJORuZWD8zykcUdg",
  "visibility": "public",
  "note": { "title": "…", "sections": [] },
  "settings": { "layout": "free-journal", "paper": "kraft" },
  "meta": { "requestId": "…", "model": "@cf/qwen/qwen3-30b-a3b-fp8", "attempts": 1 }
}
```

| 字段 | 说明 |
| --- | --- |
| `text` / `note` | 二选一。`text` 由服务调用 Workers AI 整理（可配 `template`、`language`、`detail`）；`note` 是你已整理好的 `NoteStructure`（agent 自己总结时使用，不消耗 Workers AI 额度） |
| `appearance` | 版式、纸张、字体、墨水、字号等，全部可选；未知字段或无效取值返回 400，便于发现拼写错误。完整取值见 `/api/v1/openapi.json` |
| `style` | 等同于 `appearance.layout` |
| `stickers` | 可选贴纸，格式同前端 `StickerItem`，会被校验与钳制 |
| `visibility` | `unlisted`（默认）或 `public` |
| `Idempotency-Key` 头 | 相同的键与请求体重试时返回同一条笔记（`200` + `Idempotent-Replayed: true`）；同一个键用于不同内容返回 `409` |


## 其他接口

| 方法与路径 | 认证 | 说明 |
| --- | --- | --- |
| `GET /api/v1/notes?cursor=&limit=` | 密钥 | 列出当前密钥发布的笔记 |
| `GET /api/v1/notes/:id` | 密钥 | 查询（只能访问自己密钥发布的笔记） |
| `PATCH /api/v1/notes/:id` | 密钥 | 修改 `visibility` |
| `DELETE /api/v1/notes/:id` | 密钥 | 删除笔记，返回 `204` |
| `GET /api/notes/:id` | 公开 | 查看页使用的笔记数据（`public` 与 `unlisted` 均可通过 ID 读取） |
| `GET /api/gallery?cursor=&template=&language=` | 公开 | 图库中的公开笔记 |
| `GET /api/v1/openapi.json`、`GET /llms.txt` | 公开 | 给 agent 读的接口说明 |

## 给 AI agent 的说明

让 agent 读取 `https://<你的域名>/llms.txt` 即可了解用法；需要结构化定义时读取 `/api/v1/openapi.json`。建议在 agent 的系统提示中写明：

- 密钥放在环境变量（如 `INKSCRIBE_API_KEY`）中，不要回显；
- 默认使用 `unlisted`，只有用户明确要求公开时才用 `public`；
- 每次发布带上 `Idempotency-Key`（例如任务 ID），网络重试不会产生重复笔记；
- 把返回的 `url` 发给用户。链接发到聊天工具里会显示标题、摘要和站点分享图（服务端注入的 Open Graph 信息），页面 HTML 中也直接包含笔记全文，便于搜索引擎与 AI 读取（见 [seo.md](seo.md)）。

## 密钥管理

```bash
npm run keys -- list --remote
npm run keys -- revoke --id key_xxxxxxxxxxxx --remote
```

密钥只保存 SHA-256 哈希；吊销后立即失效（返回 401）。每个密钥默认每分钟 30 次请求（`API_RATE_LIMIT_PER_MINUTE`；配置了 Rate Limiting 绑定时以绑定的阈值为准）。

## 安全说明

- 笔记 ID 为 128 位随机数，无法枚举；`unlisted` 笔记只能通过链接访问，且不进入图库、不被搜索引擎收录。
- 入库前与读取时都会规范化笔记、外观与贴纸，查看页同样在前端再次校验，不会渲染任何 HTML 或脚本。
- 公开读取接口不缓存，删除或修改可见性立即生效。
