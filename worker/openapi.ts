import type { PublishedNoteSummary } from "../shared/api.ts";
import { DOODLE_THEMES } from "../shared/themes.ts";
import { ACCENTS, EN_FONTS, INKS, PAGE_SIZES, PAPERS, ZH_FONTS } from "../shared/appearance.ts";
import { DETAILS, LANGUAGES, STYLES, TEMPLATES } from "../shared/options.ts";

const ids = (list: readonly { id: string }[]) => list.map((item) => item.id);

const appearanceSchema = {
  type: "object",
  description: "外观设置，所有字段可选，未提供的使用默认值。未知字段或无效取值会返回 400。",
  additionalProperties: false,
  properties: {
    layout: { type: "string", enum: [...STYLES], default: "hybrid-cornell" },
    paper: { type: "string", enum: ids(PAPERS), default: "grid" },
    zhFont: { type: "string", enum: ids(ZH_FONTS), default: "lxgw" },
    enFont: { type: "string", enum: ids(EN_FONTS), default: "kalam" },
    ink: { type: "string", enum: ids(INKS), default: "blue" },
    accent: { type: "string", enum: ids(ACCENTS), default: "yellow" },
    pageSize: { type: "string", enum: ids(PAGE_SIZES), default: "a4", description: "long 为自适应高度的长图" },
    fontSize: { type: "number", minimum: 12, maximum: 28, default: 19 },
    lineHeight: { type: "number", minimum: 1.3, maximum: 2.4, default: 1.75 },
    letterSpacing: { type: "number", minimum: -0.02, maximum: 0.15, default: 0.02 },
    naturalness: { type: "number", minimum: 0, maximum: 1, default: 0.55, description: "手写抖动幅度" },
    doodleMode: { type: "string", enum: ["auto", "theme", "ai", "none"], default: "auto" },
    doodleTheme: { type: "string", enum: [...DOODLE_THEMES], description: "doodleMode 为 theme 时使用" },
    seed: { type: "integer", description: "笔迹随机种子，相同种子得到相同的手写抖动" },
  },
} as const;

const noteStructureSchema = {
  type: "object",
  required: ["title", "sections"],
  properties: {
    title: { type: "string", maxLength: 60 },
    date: { type: "string", maxLength: 40, description: "缺省时使用发布日期" },
    cues: { type: "array", maxItems: 8, items: { type: "object", required: ["keyword"], properties: { keyword: { type: "string" }, note: { type: "string" } } } },
    sections: {
      type: "array",
      minItems: 1,
      maxItems: 6,
      items: {
        type: "object",
        required: ["content"],
        properties: {
          heading: { type: "string" },
          content: { type: "string", description: "以“- ”或“1.”开头的行会渲染为列表" },
          highlights: { type: "array", items: { type: "string" }, description: "必须逐字出现在 content 中" },
        },
      },
    },
    summary: { type: "string" },
    doodleTheme: { type: "string", enum: [...DOODLE_THEMES] },
  },
} as const;

const summarySchema = {
  type: "object",
  properties: {
    id: { type: "string" },
    url: { type: "string", format: "uri", description: "给用户查看的链接" },
    title: { type: "string" },
    summary: { type: "string" },
    language: { type: "string", enum: ["zh", "en"] },
    template: { type: "string" },
    layout: { type: "string" },
    visibility: { type: "string", enum: ["public", "unlisted"] },
    createdAt: { type: "string", format: "date-time" },
    updatedAt: { type: "string", format: "date-time" },
  },
} as const;

const errorResponse = {
  description: "错误",
  content: {
    "application/json": {
      schema: {
        type: "object",
        properties: { error: { type: "object", properties: { code: { type: "string" }, message: { type: "string" }, requestId: { type: "string" } } } },
      },
    },
  },
} as const;

const noteIdParam = { name: "id", in: "path", required: true, schema: { type: "string", pattern: "^[A-Za-z0-9_-]{22}$" } } as const;

export const OPENAPI_SPEC = {
  openapi: "3.1.0",
  info: {
    title: "墨语笔记 InkScribe API",
    version: "1.0.0",
    description:
      "把文字整理为手写风格的笔记页面，返回可直接分享给用户的链接。写操作需要 API 密钥（Authorization: Bearer <key>）。",
  },
  components: {
    securitySchemes: { bearer: { type: "http", scheme: "bearer" } },
    schemas: { Appearance: appearanceSchema, NoteStructure: noteStructureSchema, NoteSummary: summarySchema },
  },
  paths: {
    "/api/v1/notes": {
      post: {
        operationId: "createNote",
        summary: "创建手写笔记并返回分享链接",
        security: [{ bearer: [] }],
        parameters: [
          { name: "Idempotency-Key", in: "header", required: false, schema: { type: "string", maxLength: 100 }, description: "相同的键与请求体重试时返回同一条笔记" },
        ],
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                description: "text 与 note 二选一。",
                properties: {
                  text: { type: "string", description: "原文，由服务调用 Workers AI 整理（最多 12000 字）" },
                  note: { $ref: "#/components/schemas/NoteStructure" },
                  template: { type: "string", enum: [...TEMPLATES], default: "general" },
                  language: { type: "string", enum: [...LANGUAGES], default: "auto", description: "输出语言，仅对 text 生效" },
                  detail: { type: "string", enum: [...DETAILS], default: "standard", description: "详略，仅对 text 生效" },
                  style: { type: "string", enum: [...STYLES], description: "版式，等同于 appearance.layout" },
                  appearance: { $ref: "#/components/schemas/Appearance" },
                  visibility: { type: "string", enum: ["public", "unlisted"], default: "unlisted", description: "public 会出现在图库中" },
                  stickers: { type: "array", description: "可选贴纸，格式同前端 StickerItem", items: { type: "object" } },
                },
              },
            },
          },
        },
        responses: {
          "201": { description: "已创建", content: { "application/json": { schema: { $ref: "#/components/schemas/NoteSummary" } } } },
          "200": { description: "幂等重放，返回之前创建的笔记" },
          "400": errorResponse,
          "401": errorResponse,
          "409": errorResponse,
          "413": errorResponse,
          "429": errorResponse,
          "502": errorResponse,
          "504": errorResponse,
        },
      },
      get: {
        operationId: "listNotes",
        summary: "列出当前密钥创建的笔记",
        security: [{ bearer: [] }],
        parameters: [
          { name: "cursor", in: "query", schema: { type: "string" } },
          { name: "limit", in: "query", schema: { type: "integer", minimum: 1, maximum: 50, default: 20 } },
        ],
        responses: { "200": { description: "笔记列表与下一页游标" }, "401": errorResponse },
      },
    },
    "/api/v1/notes/{id}": {
      parameters: [noteIdParam],
      get: { operationId: "getNote", summary: "查询笔记", security: [{ bearer: [] }], responses: { "200": { description: "笔记" }, "404": errorResponse } },
      patch: {
        operationId: "updateNote",
        summary: "修改可见性",
        security: [{ bearer: [] }],
        requestBody: {
          required: true,
          content: { "application/json": { schema: { type: "object", required: ["visibility"], properties: { visibility: { type: "string", enum: ["public", "unlisted"] } } } } },
        },
        responses: { "200": { description: "已更新" }, "404": errorResponse },
      },
      delete: { operationId: "deleteNote", summary: "删除笔记", security: [{ bearer: [] }], responses: { "204": { description: "已删除" }, "404": errorResponse } },
    },
    "/api/notes/{id}": {
      parameters: [noteIdParam],
      get: { operationId: "getPublicNote", summary: "公开读取笔记（无需密钥）", responses: { "200": { description: "笔记" }, "404": errorResponse } },
    },
    "/api/gallery": {
      get: {
        operationId: "listGallery",
        summary: "图库中的公开笔记",
        parameters: [
          { name: "cursor", in: "query", schema: { type: "string" } },
          { name: "limit", in: "query", schema: { type: "integer", minimum: 1, maximum: 50, default: 20 } },
          { name: "template", in: "query", schema: { type: "string", enum: [...TEMPLATES] } },
          { name: "language", in: "query", schema: { type: "string", enum: ["zh", "en"] } },
        ],
        responses: { "200": { description: "笔记列表与下一页游标" } },
      },
    },
  },
} as const;

export function llmsTxt(origin: string, recent: PublishedNoteSummary[] = []): string {
  const notes = recent.length
    ? `\n## 最近的公开笔记\n\n${recent.map((note) => `- [${note.title.replace(/[[\]]/g, "")}](${note.url})：${note.summary.replace(/\s+/g, " ")}`).join("\n")}\n`
    : "";
  return `# 墨语笔记 InkScribe

> 把文字整理为手写风格的单页笔记（康奈尔结构 + 手账排版），返回可以直接发给用户查看的链接。

墨语笔记是一个在线工具（${origin}）：用户粘贴文字或上传 TXT、Markdown、HTML、DOCX、PDF 文件，Workers AI 把内容整理为标题、线索关键词、分节要点与总结，再以手写字体排版在纸张上，可添加贴纸与插图，并导出 1x/2x/3x 的 PNG/JPG 图片。无需注册；原文不会被保存，服务端日志只记录元数据。

## 页面

- [编辑器](${origin}/)：粘贴文字、整理、排版与导出
- [图库](${origin}/gallery)：公开的笔记
- 笔记查看页：\`${origin}/n/<id>\`，HTML 中包含笔记全文（标题、线索、分节与总结）

## 给 AI agent 的用法

- 认证：\`Authorization: Bearer <API 密钥>\`（由站点管理员发放）。
- 创建笔记：\`POST ${origin}/api/v1/notes\`，JSON 请求体提供 \`text\`（原文，服务端用 Workers AI 整理）或 \`note\`（你已整理好的结构）二选一。
- 返回的 \`url\` 即笔记查看页，直接发给用户。
- \`visibility\` 默认 \`unlisted\`（仅持有链接可见）；只有用户明确要求公开时才使用 \`public\`，公开笔记会出现在 ${origin}/gallery。
- 重试时带上相同的 \`Idempotency-Key\` 头，避免重复创建。

示例：

\`\`\`bash
curl -X POST ${origin}/api/v1/notes \\
  -H "Authorization: Bearer $INKSCRIBE_API_KEY" \\
  -H "Content-Type: application/json" \\
  -H "Idempotency-Key: weekly-review-2026-10-22" \\
  -d '{"text": "……原文……", "template": "meeting-minutes", "appearance": {"paper": "kraft", "ink": "brown"}}'
\`\`\`

模板：${TEMPLATES.join(", ")}；版式：${STYLES.join(", ")}；纸张：${ids(PAPERS).join(", ")}；墨水：${ids(INKS).join(", ")}。

## 文档

- [OpenAPI 规范](${origin}/api/v1/openapi.json)
- [图库](${origin}/gallery)
- [站点地图](${origin}/sitemap.xml)
${notes}`;
}
