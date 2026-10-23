# Agent 发布、查看页与图库

任何具备 HTTP 调用能力、持有站点 API 密钥的 AI agent 或自动化程序，都可以把已经整理好的笔记发布到 InkScribe。`POST /api/v1/notes` **必须提供 `schemaVersion: 1` 和完整的 `note`**。服务验证数据并保存作品，返回查看链接 `/n/<id>`；发布和预检都不会调用 AI，也不会重新总结、截断或补写正文。

- 发布不需要传原文，`text` 字段会作为未知字段拒绝。agent 在自己的上下文中完成整理并检查事实，InkScribe 负责验证结构、排版与分享。
- 服务保存整理后的笔记结构、外观、贴纸和插图。笔记保存至通过 API 删除；发布者可把它载入编辑器继续修改，但发布记录没有独立的原文副本。主动保留在 `note` 中的原文摘录或个人信息仍会保存和展示。
- 写操作需要管理员发放的 API 密钥；不按 agent 品牌或模型限制，不提供匿名发布。
- 新笔记默认 `unlisted`（持有链接可见，页面带 `noindex`）。只有明确传入 `"visibility": "public"` 才会进入图库；`unlisted` 不是需要登录的私有文档。

## 一次性部署准备

```bash
npx wrangler d1 create ink-scribe               # 把返回的 database_id 填入 wrangler.jsonc
npm run db:migrate:remote                       # 应用全部迁移，包括 0003_publication_schema.sql
npm run deploy
npm run keys -- create --name "我的发布脚本" --remote   # 密钥只显示一次
```

- 查看链接使用 `PUBLIC_BASE_URL`（默认 `https://scribe.orangely.xyz`）；更换域名时同时修改它与 `wrangler.jsonc` 中的 `routes`。本地开发与 mock 构建中该值会被清空，链接指向本机。
- 本地开发：先运行 `npm run db:migrate`，再用 `npm run keys -- create --name 本地` 生成本地密钥。
- 发布接口返回网页链接，不返回服务端生成的 PNG。图库采用标题与摘要的文字卡片，链接预览使用统一站点分享图；用户打开查看页后可下载图片。

## 发布一条已整理的笔记

```bash
curl -X POST https://notes.example.com/api/v1/notes \
  -H "Authorization: Bearer $INKSCRIBE_API_KEY" \
  -H "Content-Type: application/json" \
  -H "Idempotency-Key: weekly-review-2026-43" \
  -d '{
        "schemaVersion": 1,
        "note": {
          "title": "本周进展与下周安排",
          "date": "2026年10月22日",
          "cues": [{ "keyword": "下一步", "note": "先修复排版，再试用" }],
          "sections": [
            { "heading": "已完成", "content": "本周完成了导出功能。", "highlights": ["导出功能"] },
            { "heading": "下周安排", "content": "- 修复移动端排版\n- 邀请同事试用", "highlights": ["移动端排版"] }
          ],
          "summary": "导出功能已完成；下周优先修复移动端排版，再收集试用反馈。",
          "doodleTheme": "book"
        },
        "template": "meeting-minutes",
        "visibility": "unlisted",
        "appearance": {
          "layout": "free-journal",
          "paper": "kraft",
          "ink": "brown",
          "zhFont": "long-cang",
          "overflow": "expand"
        }
      }'
```

成功返回 `201`，其中包含 `schemaVersion: 1`、`id`、`url`、`visibility`、保留的 `note`、补齐默认值后的 `settings` 与 `stickers`。缺省笔记日期使用发布时区的当天日期；其余正文不重写。`meta` 包含：

```json
{
  "requestId": "…",
  "processing": "agent",
  "validation": { "structure": "passed", "layout": "not_checked" }
}
```

`meta.processing: "agent"` 表示内容由调用方整理，发布过程没有调用模型。`layout: "not_checked"` 表示服务端已验证结构，但没有执行浏览器字体加载与几何排版；它不是已完成单页排版或生成图片的承诺。

| 字段 | 必填 | 说明 |
| --- | --- | --- |
| `schemaVersion` | 是 | 当前只接受数值 `1` |
| `note` | 是 | 完整 `NoteStructure`：`title`、`cues`、`sections`、`summary`；每个段落包含 `content` 与 `highlights` |
| `template` | 否 | 整理类型标签，默认 `general`；不会触发生成 |
| `appearance` | 否 | 版式、纸张、字体、字号、溢出策略等；未传字段使用默认值 |
| `stickers` | 否 | 符合契约的贴纸数组；每项包含唯一 `id`、`type`、`x`、`y`、`rotation`、`scale`，完整取值见 OpenAPI |
| `visibility` | 否 | `unlisted`（默认）或 `public` |
| `Idempotency-Key` 头 | 建议 | 同一键、同一请求重试返回原作品；不同内容不能复用该键 |

插图选择使用 `note.doodleTheme`，受限图元使用 `note.doodleSpec`。不要发送 HTML、SVG 字符串、脚本、任意 CSS 或外部资源地址。`text`、`language`、`detail`、顶层 `style` 与顶层 `doodle` 不属于发布请求；版式通过 `appearance.layout` 指定。

## 严格校验与发布前预检

创建、预检和 OpenAPI 共享 [`shared/publishing.ts`](../shared/publishing.ts) 中的发布契约。缺少字段、未知字段、错误类型、超长正文、超量段落、无效外观或图元，以及不出现在所属正文中的重点词，都会返回 `422 VALIDATION_FAILED`，不会以删减后的结果发布。

`note` 中的文本应直接适合排版：不要带需要剥离的 HTML、Markdown 强调/代码标记、控制字符或首尾空白。`summary` 与线索的 `note` 必须提供，但允许空字符串；`title`、段落 `content`、线索 `keyword` 不得为空。

错误包含可供 agent 修正的字段路径与错误码，消息不回显用户正文。例如，重点词错误的 `issues[].path` 会定位到 `note.sections[0].highlights[0]`。每项包含 `path`、`code`、`message`；调用方应使用 `error.code: "VALIDATION_FAILED"` 与 `issues` 处理错误，不要匹配整句文案。

先向 `POST /api/v1/notes/validate` 提交与发布完全相同的 JSON 和认证头，可得到：

```json
{
  "valid": true,
  "schemaVersion": 1,
  "validation": { "structure": "passed", "layout": "not_checked" }
}
```

预检不创建笔记、不占用幂等键、不调用 AI、不回显笔记正文。它只检查数据契约，不进行事实核查、浏览器排版或图像生成。认证与限流仍正常执行。

## 页面适配与导出

查看页等待所需字体就绪后，按实际文字尺寸检测页面。`appearance.overflow` 决定固定尺寸容纳不了内容时的处理：

| 策略 | 行为 |
| --- | --- |
| `expand`（默认） | 先在可读范围内缩小字号与行距；仍无法容纳时，以原定文字样式展开为长图，完整保留正文、线索与总结 |
| `error` | 尝试适配固定尺寸；仍然溢出时明确提示并禁用图片导出，调用方应缩短内容或改用长图 |

字体尚未准备好或排版仍在计算时，导出保持不可用。预览与导出共用已经完成适配的页面；不会把被固定页高裁掉的内容导出为一张“成功”的图片。四种版式均适用，选择 `pageSize: "long"` 时直接采用长图。长图也会重新测量；如果文字仍越过纸张边界，导出继续禁用并提示调整内容或样式。

## 其他接口

| 方法与路径 | 认证 | 说明 |
| --- | --- | --- |
| `POST /api/v1/notes/validate` | 密钥 | 预检完整发布数据，不保存 |
| `GET /api/v1/notes?cursor=&limit=` | 密钥 | 列出当前密钥发布的笔记 |
| `GET /api/v1/notes/:id` | 密钥 | 查询当前密钥发布的作品，不包含独立原文字段 |
| `PATCH /api/v1/notes/:id` | 密钥 | 修改 `visibility` |
| `DELETE /api/v1/notes/:id` | 密钥 | 删除笔记，返回 `204` |
| `GET /api/notes/:id` | 公开 | 查看页使用的笔记数据；`public` 与 `unlisted` 均可按 ID 读取，不包含独立原文字段 |
| `GET /api/gallery?cursor=&template=&language=` | 公开 | 图库中的公开笔记 |
| `GET /api/v1/openapi.json`、`GET /llms.txt` | 公开 | 完整契约与 agent 使用说明 |

## 给 AI agent 的工作流程

1. 读取 `https://<你的域名>/llms.txt` 与 `/api/v1/openapi.json`。按照契约整理原文，生成完整 `note`，自主检查事实与重点词。
2. 把密钥放在环境变量（例如 `INKSCRIBE_API_KEY`）中，不要回显。默认使用 `unlisted`，只有用户明确要求公开时使用 `public`。
3. 使用 `/api/v1/notes/validate` 预检。若收到 `422`，根据字段路径修正数据，再次预检。
4. 向 `/api/v1/notes` 发送同一份完整数据，并为这次逻辑发布设置唯一 `Idempotency-Key`。网络重试保留原键和请求体；修改内容后使用新键。
5. 把成功响应的 `url` 交给用户。它是查看页链接；需要验证固定尺寸效果时打开页面检查实际排版。服务端不返回 PNG 下载地址。

需要 InkScribe 代为整理原文时，使用单独的 `/api/structure` 生成接口，再把返回结构放入 `note`，连同 `schemaVersion: 1` 提交发布。生成接口保留自身来源检查与限流规则；有发布密钥并不会绕过这些规则。agent 也可以完全使用自己的模型；发布时不再次传输原文。

## 密钥与公开内容

```bash
npm run keys -- list --remote
npm run keys -- revoke --id key_xxxxxxxxxxxx --remote
```

密钥只保存 SHA-256 哈希；吊销后立即返回 `401`。有 Rate Limiting 绑定时以绑定阈值为准：当前 `wrangler.jsonc` 为每个密钥每分钟 12 次，预检与其他 `/api/v1` 操作共享该额度。没有绑定时使用 `API_RATE_LIMIT_PER_MINUTE`，默认每分钟 30 次。`/api/v1/*` 面向服务端调用，不开放浏览器 CORS。

笔记 ID 使用 128 位随机数。`unlisted` 不列入图库或站点地图，并通过 `noindex` 请求搜索引擎不要收录，但持有链接者可以读取内容。查看页、SEO 正文和公开 JSON 包含发布的笔记，不包含独立原文副本；你保留在笔记中的摘录仍会展示。删除或修改可见性后应用的公开读取不使用旧缓存，但无法收回第三方已下载或缓存的副本。

## 并发、重试与删除语义

发布前在 D1 原子占用 `(api_key_id, Idempotency-Key)`，笔记与完成状态在同一个事务中提交。相同键、相同 JSON 请求体的并发请求返回 `409 IDEMPOTENCY_CONFLICT` 与 `Retry-After: 2`；保留原键稍后重试，完成后返回原笔记（`200` 与 `Idempotent-Replayed: true`）。

同一键用于不同请求体始终返回 `409`。结构、契约版本和外观均参与请求哈希。请求体按 JSON 序列化内容比较，重试时应保留字段顺序。

已知失败释放占用，Worker 意外终止后可在 120 秒租约到期时接管。旧 Worker 不能提交或释放新请求，数据库写入失败不会留下半完成的笔记。已完成键永久保留；删除作品后重放返回 `410 NOT_FOUND`，不会复活笔记。确实要创建新作品时使用新键。

## 从原发布接口升级

接口路径继续使用 `/api/v1/notes`，创建请求统一升级为 `schemaVersion: 1` 与 `note` 两项必填。原先仅传 `note` 的调用方应补充版本号并遵守完整契约；仅传 `text` 的调用方应先完成整理，再提交结构。服务不会自动猜测或代为生成缺少的数据，附带 `text` 的新建请求也会返回 `422`。升级前已经完成的幂等请求仍按原键和原请求体重放历史作品，不重新生成或套用新建契约。

部署前执行全部 D1 迁移：`0002_publish_reservations.sql` 提供发布占用与删除后重放保护，`0003_publication_schema.sql` 记录作品契约版本。已有作品标为 `schemaVersion: 0` 并继续可查看，新作品为 `1`；`0` 不是可提交的新发布版本。升级没有新增云服务绑定，也不会把原文加入存储。
