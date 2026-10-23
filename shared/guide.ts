import { NOTE_LIMITS } from "./note.ts";
import type { PublishRequest } from "./publishing.ts";

/** One source for the interactive guide and its readable, server-rendered HTML. */
export type GuideLocale = "zh" | "en";
export type GuideItem = { title: string; body: string };
export type GuideLink = { href: string; label: string; description: string };

export type GuideContent = {
  title: string;
  documentTitle: string;
  description: string;
  eyebrow: string;
  tocLabel: string;
  toc: Array<{ id: "users" | "agents" | "faq"; label: string }>;
  users: {
    title: string;
    description: string;
    steps: GuideItem[];
    notes: GuideItem[];
    action: { href: string; label: string };
  };
  agents: {
    title: string;
    description: string;
    access: GuideItem;
    steps: GuideItem[];
    fieldsTitle: string;
    fieldHeaders: [string, string, string];
    fields: Array<{ field: string; required: string; description: string }>;
    jsonTitle: string;
    jsonDescription: string;
    curlTitle: string;
    curlDescription: string;
    rulesTitle: string;
    rules: GuideItem[];
    statusTitle: string;
    statusHeaders: [string, string];
    statuses: Array<{ code: string; description: string }>;
    resourcesTitle: string;
    resources: GuideLink[];
  };
  faq: { title: string; items: GuideItem[] };
  copy: { label: string; success: string; failure: string };
};

export const GUIDE_CONTENT: Record<GuideLocale, GuideContent> = {
  zh: {
    title: "使用说明",
    documentTitle: "使用说明 · 墨语笔记 InkScribe",
    description: "从第一张手写笔记到自动发布：在网页里整理和导出，或让 AI agent 直接发布准备好的笔记。",
    eyebrow: "INKSCRIBE / GUIDE",
    tocLabel: "使用说明目录",
    toc: [{ id: "users", label: "网页使用" }, { id: "agents", label: "AI agent 接入" }, { id: "faq", label: "常见问题" }],
    users: {
      title: "在网页里，做一张自己的笔记",
      description: "无需注册。准备好一段文字，整理内容，再选出适合它的纸张与版式。",
      steps: [
        { title: "放入你的内容", body: "粘贴文章、读书摘抄、会议记录或零散想法，也可以上传 TXT、Markdown、HTML、DOCX、PDF 文件。文件先在浏览器中提取文字。" },
        { title: "整理成清晰的结构", body: "选择模板、输出语言与详略，点击“转化为手写笔记”。AI 会整理标题、关键词、分节要点与总结；“不使用 AI，按段落快速排版”则使用现有段落，不调用 AI。" },
        { title: "修改内容，调整外观", body: "在“内容”中校对正文和重点词，在“样式”中选择版式、纸张、手写字体与墨水。还可以添加贴纸，拖动、旋转或缩放它们。" },
        { title: "导出，发给你想分享的人", body: "在“导出”中选择 PNG 或 JPG 和 1x、2x、3x 倍率，下载图片；浏览器支持时也可复制到剪贴板。等待字体与排版就绪，长内容默认会展开为长图。" },
      ],
      notes: [
        { title: "草稿保存在这台设备上", body: "编辑器默认在当前浏览器自动保存原文、笔记和外观，刷新后可恢复。草稿栏可以删除草稿并关闭自动保存；它不会跨设备同步，也不等于已经发布。" },
        { title: "知道内容去了哪里", body: "文件解析和图片导出在本地完成。选择 AI 整理时，提取后的文字会发送到服务端用于本次模型调用。网页编辑器目前不提供在线发布；在线分享链接由 AI agent 或程序通过发布接口创建。" },
      ],
      action: { href: "/", label: "开始制作笔记" },
    },
    agents: {
      title: "让 AI agent 直接发布笔记",
      description: "任何能够调用 HTTP 的 agent 都可以接入，无需注册或密钥。先在自己的上下文中完成整理，再提交可绘图的结构；发布时无需原文，也不会再次调用 AI。",
      access: { title: "无需注册，直接发布", body: "发布接口不需要账户或密钥，直接发送 JSON 请求即可。作品只能以 unlisted 方式发布，按客户端 IP 限流，并有 24 小时发布次数上限。成功响应中的 manageToken 是删除这篇笔记的唯一凭据，请连同链接一起交给用户保存。/api/v1 接口面向服务端调用，不开放跨站浏览器 CORS。" },
      steps: [
        { title: "读取契约，准备 note", body: "先读取 OpenAPI 的完整字段与限制，自行校对事实。新建请求必须包含 schemaVersion: 1 和 note；不要传 text、language、detail、顶层 style 或顶层 doodle。" },
        { title: "先预检，再修正", body: "向 POST /api/v1/notes/validate 提交同一份 JSON。预检不会保存作品、占用幂等键或调用模型；收到 422 时，按 error.issues 中的 path、code、message 修正后重试。" },
        { title: "发布完整结构", body: "预检通过后，向 POST /api/v1/notes 提交相同 JSON，并带上本次发布专用的 Idempotency-Key。visibility 省略或设为 unlisted；public 会被拒绝。" },
        { title: "交付链接与删除凭据", body: "成功返回 201，把响应中的 url 和 manageToken 交给用户。url 打开查看页，浏览器中可下载图片；API 不直接生成 PNG。HTTP 成功表示结构已保存，实际页面仍需加载字体并完成排版。" },
      ],
      fieldsTitle: "请求由什么组成",
      fieldHeaders: ["字段", "要求", "用途"],
      fields: [
        { field: "schemaVersion", required: "必填", description: "数值 1。" },
        { field: "note", required: "必填", description: "包含 title、cues、sections、summary；每段包含 content 与 highlights。cues 和 highlights 可为空数组，summary 可为空字符串。" },
        { field: "appearance", required: "可选", description: "版式、字体、纸张、墨水及溢出策略；未提供的设置使用默认值。" },
        { field: "template / stickers", required: "可选", description: "内容分类标签与贴纸数组。插图主题或图元放在 note.doodleTheme / note.doodleSpec。" },
        { field: "visibility", required: "可选", description: "只能为 unlisted（默认）：不进入公开图库，持有链接的人可以查看。" },
        { field: "Idempotency-Key", required: "建议请求头", description: "每次逻辑发布使用一个新键；相同发布的网络重试保留原键和原请求体。" },
      ],
      jsonTitle: "完整 JSON 请求示例",
      jsonDescription: "这份示例可同时用于预检和发布。根据用户内容修改 note，外观与可见性按需设置。",
      curlTitle: "预检并发布：curl 示例",
      curlDescription: "先在环境中设置 INKSCRIBE_IDEMPOTENCY_KEY。新作品使用新的幂等键；重试同一作品时保留原键。下面的命令会先预检，只有预检成功才会发布，并打印包含 url 与 manageToken 的响应。",
      rulesTitle: "让结果保持完整",
      rules: [
        { title: "直接提交可排版的文字", body: `标题不超过 ${NOTE_LIMITS.title} 字，最多 ${NOTE_LIMITS.maxSections} 个段落、每段 ${NOTE_LIMITS.content} 字。使用已去除首尾空白的纯文本，重点短语必须出现在所属段落实际显示的文字中，不包含列表标记。重叠时前面的重点词优先，每个短语都须至少有一次不与前项重叠的匹配。完整约束以 OpenAPI 为准，无效或超限内容会被拒绝，不会静默截断。` },
        { title: "预检不等于排版完成", body: "validation.layout: not_checked 表示服务端没有测量字体与页面。appearance.overflow 默认 expand，固定页面放不下时展开为长图；设为 error 时仍溢出会阻止导出。需要固定尺寸效果时，打开查看页确认排版。" },
        { title: "重试保留同一份请求", body: "请求处理中可能返回 409 和 Retry-After；保留原键、原 JSON 字段顺序，从同一网络稍后重试。完成后返回原链接（200）和新的 manageToken，之前的 manageToken 随之失效；修改内容必须使用新键。作品被删除后，原请求重放返回 410，不会重新创建。" },
        { title: "链接即访问权限", body: "unlisted 不出现在图库中，也不被搜索引擎收录，但任何持有链接的人都能读取，并非登录后才能查看的私有文档。发布记录不另外保存原文副本；主动保留在 note 中的原文摘录仍会保存和展示。" },
        { title: "用 manageToken 删除", body: "向 DELETE /api/v1/notes/{id} 发送请求，并在 X-Manage-Token 头中带上 manageToken，成功返回 204。服务端只保存它的哈希，无法找回；遗失后请联系维护者处理。" },
      ],
      statusTitle: "常见响应与下一步",
      statusHeaders: ["状态", "如何处理"],
      statuses: [
        { code: "201 / 200", description: "201 表示创建成功；发布接口的 200 表示幂等重放。预检成功也返回 200，请查看 valid 与 validation。" },
        { code: "401 / 404", description: "删除时缺少 X-Manage-Token 返回 401；笔记不存在或 manageToken 不正确返回 404。" },
        { code: "422", description: "根据 error.issues 的字段路径修正请求，不要盲目重试同一份无效数据。" },
        { code: "409 / 410", description: "409 可能是原请求仍在处理，或同一幂等键被用于不同内容；410 表示原作品已删除。" },
        { code: "403", description: "本站暂未开放免密钥发布，请联系站点管理员。" },
        { code: "429", description: "每分钟请求过多，或 24 小时内的发布次数已达上限。遵循 Retry-After 等待；预检与发布共享每分钟额度。" },
        { code: "503", description: "存储暂不可用或尚未配置，请联系站点管理员。" },
      ],
      resourcesTitle: "给 agent 的机器可读入口",
      resources: [
        { href: "/api/v1/openapi.json", label: "OpenAPI 规范", description: "完整 JSON Schema、字段限制与接口定义。" },
        { href: "/llms.txt", label: "llms.txt", description: "精简的产品说明与 agent 发布流程。" },
      ],
    },
    faq: {
      title: "常见问题",
      items: [
        { title: "在哪里切换界面语言和主题？", body: "打开右上角“菜单”，在“界面偏好”中选择中文或 English，以及跟随系统、浅色或深色主题。选择会保存在当前浏览器，界面语言不会改写你正在编辑的笔记。" },
        { title: "不想使用 AI，也能做笔记吗？", body: "可以。选择“不使用 AI，按段落快速排版”，再在“内容”中修改文字，选择样式并导出。通过 API 发布已经整理好的 note 也不调用 AI。" },
        { title: "为什么下载按钮暂时不可用？", body: "字体可能还在加载，或者内容正在适配页面。字体失败时可以重试；固定页面仍放不下时，缩短内容或选择长图。应用会提示问题，并阻止导出不完整的图片。" },
        { title: "保存草稿后，别人能看到吗？", body: "本机草稿没有公开链接，仅存在当前浏览器。导出的图片由你自行分享；只有经 API 发布的作品才有在线查看链接。" },
        { title: "agent 发布的笔记怎么删除？", body: "agent 发布成功时会返回 manageToken。请它用这个凭据调用删除接口，或把凭据保存下来以后使用。凭据遗失时，可通过隐私政策中的联系方式请维护者处理。" },
        { title: "agent 必须提交原文吗？", body: "不需要。只提交 schemaVersion: 1 和完整 note，新建请求中的 text 会被拒绝。如果希望由服务整理原文，先调用独立的 /api/structure，再把整理结果提交发布。" },
      ],
    },
    copy: { label: "复制", success: "已复制", failure: "复制失败，请选中代码后手动复制。" },
  },
  en: {
    title: "How to use InkScribe",
    documentTitle: "User & agent guide · InkScribe",
    description: "From your first handwritten note to automated publishing: create and export in the editor, or let an AI agent publish a prepared note.",
    eyebrow: "INKSCRIBE / GUIDE",
    tocLabel: "Guide contents",
    toc: [{ id: "users", label: "Use the editor" }, { id: "agents", label: "Connect an AI agent" }, { id: "faq", label: "Common questions" }],
    users: {
      title: "Make a note in your browser",
      description: "No account required. Start with your text, organize its ideas, then choose the paper and layout that suit it.",
      steps: [
        { title: "Bring your content", body: "Paste an article, reading excerpt, meeting notes, or rough ideas. You can also upload TXT, Markdown, HTML, DOCX, or PDF files; text is extracted in your browser first." },
        { title: "Give it a clear structure", body: "Choose a template, output language, and detail level, then select “Turn into a handwritten note”. AI organizes the title, cues, sections, and summary. “Quick layout by paragraphs, without AI” uses your existing paragraphs." },
        { title: "Edit the words and appearance", body: "Use “Content” to check the text and highlights, and “Style” to choose a layout, paper, handwriting font, and ink. Add stickers, then drag, rotate, or resize them." },
        { title: "Export and share", body: "In “Export”, choose PNG or JPG and a 1x, 2x, or 3x scale, then download the image. Supported browsers can also copy it to the clipboard. Wait for fonts and layout to finish; long content expands into a long page by default." },
      ],
      notes: [
        { title: "Drafts stay on this device", body: "The editor saves your source text, note, and appearance in the current browser by default, so they can return after a refresh. The draft bar lets you delete the draft and turn off autosave. Drafts do not sync across devices and are not published notes." },
        { title: "Know where your content goes", body: "File parsing and image export happen locally. Choosing AI organization sends the extracted text to the server for that model request. The web editor does not publish online; AI agents and programs create online share links through the publishing API." },
      ],
      action: { href: "/", label: "Create a note" },
    },
    agents: {
      title: "Publish from an AI agent",
      description: "Any agent that can make HTTP requests can connect, with no account or key. Prepare the note in your own context, then submit its renderable structure. Publishing needs no source text and makes no AI call.",
      access: { title: "No sign-up: publish directly", body: "The publishing API needs no account or key. Just send the JSON request. Notes are published as unlisted, requests are rate-limited by client IP, and there is a 24-hour publishing limit. The manageToken in a successful response is the only credential for deleting that note, so give it to the user along with the link. The /api/v1 API is for server-side clients and does not enable cross-site browser CORS." },
      steps: [
        { title: "Read the contract and prepare note", body: "Read the OpenAPI document for all fields and limits, and check the content's accuracy yourself. New requests require schemaVersion: 1 and note. Do not send text, language, detail, top-level style, or top-level doodle." },
        { title: "Validate and correct", body: "Send the same JSON to POST /api/v1/notes/validate. Validation does not save a note, reserve an idempotency key, or call a model. On a 422 response, use the path, code, and message in error.issues to correct the data." },
        { title: "Publish the complete structure", body: "After validation succeeds, send the same JSON to POST /api/v1/notes with an Idempotency-Key for this publication. Omit visibility or set it to unlisted; public is rejected." },
        { title: "Deliver the link and deletion credential", body: "A successful creation returns 201. Give the response's url and manageToken to the user. The url opens a view page with image download; the API does not generate a PNG directly. HTTP success means the structure was saved, while the browser still needs to load fonts and fit the page." },
      ],
      fieldsTitle: "What goes in a request",
      fieldHeaders: ["Field", "Requirement", "Purpose"],
      fields: [
        { field: "schemaVersion", required: "Required", description: "The number 1." },
        { field: "note", required: "Required", description: "Contains title, cues, sections, and summary. Each section contains content and highlights. cues and highlights may be empty arrays; summary may be an empty string." },
        { field: "appearance", required: "Optional", description: "Layout, fonts, paper, ink, and overflow policy. Omitted settings use defaults." },
        { field: "template / stickers", required: "Optional", description: "A content category and sticker array. Put illustration themes or drawing primitives in note.doodleTheme / note.doodleSpec." },
        { field: "visibility", required: "Optional", description: "Must be unlisted (the default): the note stays out of the public gallery, and anyone with the link can view it." },
        { field: "Idempotency-Key", required: "Recommended header", description: "Use a new key for each logical publication. Reuse the original key and body when retrying that same publication." },
      ],
      jsonTitle: "Complete JSON request",
      jsonDescription: "Use this example for both validation and publishing. Replace note with the user's content and choose appearance and visibility as needed.",
      curlTitle: "Validate and publish with curl",
      curlDescription: "First set INKSCRIBE_IDEMPOTENCY_KEY in your environment. Use a new idempotency key for a new note, and keep it when retrying the same note. These commands validate first, publish only if validation succeeds, and print the response with url and manageToken.",
      rulesTitle: "Keep the result complete",
      rules: [
        { title: "Submit text ready for layout", body: `Titles allow ${NOTE_LIMITS.title} characters, with at most ${NOTE_LIMITS.maxSections} sections and ${NOTE_LIMITS.content} characters per section. Use trimmed plain text. Highlights must occur in the corresponding section's visible text without list markers. Earlier highlights take precedence on overlaps, so each phrase needs at least one non-overlapping occurrence. Read OpenAPI for every constraint. Invalid or excessive content is rejected, never silently truncated.` },
        { title: "Validation is not a layout measurement", body: "validation.layout: not_checked means the server has not measured fonts or page geometry. appearance.overflow defaults to expand, which changes an overflowing fixed page to a long page. error blocks image export if the fixed page still overflows. Open the view page when a specific page size matters." },
        { title: "Keep retries identical", body: "A request in progress may return 409 and Retry-After. Keep the original key and JSON field order, then retry later from the same network. Completed requests replay the original link with 200 and a new manageToken, which replaces the previous one. Changed content needs a new key. Replaying a deleted publication returns 410 and does not recreate it." },
        { title: "The link is the access", body: "unlisted stays out of the gallery and search engines, but anyone with the link can read it; it is not a private document behind a sign-in screen. Publishing does not store a separate source-text copy. Excerpts you include in note are still stored and displayed." },
        { title: "Delete with manageToken", body: "Send DELETE /api/v1/notes/{id} with the manageToken in the X-Manage-Token header. Success returns 204. The server stores only a hash and cannot recover the token; if it is lost, contact the maintainers." },
      ],
      statusTitle: "Common responses and next steps",
      statusHeaders: ["Status", "What to do"],
      statuses: [
        { code: "201 / 200", description: "201 means a note was created. Publishing returns 200 for an idempotent replay. Successful validation also returns 200; inspect valid and validation." },
        { code: "401 / 404", description: "Deleting without X-Manage-Token returns 401. A missing note or incorrect manageToken returns 404." },
        { code: "422", description: "Correct the fields identified in error.issues. Do not repeatedly resend the same invalid request." },
        { code: "409 / 410", description: "409 can mean the original request is still running or the key was reused for different content. 410 means the original publication was deleted." },
        { code: "403", description: "Publishing without a key is not available on this site. Contact the site administrator." },
        { code: "429", description: "Too many requests per minute, or the 24-hour publishing limit was reached. Respect Retry-After; validation and publishing share the per-minute limit." },
        { code: "503", description: "Storage is unavailable or has not been configured. Contact the site administrator." },
      ],
      resourcesTitle: "Machine-readable references",
      resources: [
        { href: "/api/v1/openapi.json", label: "OpenAPI specification", description: "The complete JSON Schema, field limits, and endpoint definitions." },
        { href: "/llms.txt", label: "llms.txt", description: "A compact product overview and the agent publishing workflow." },
      ],
    },
    faq: {
      title: "Common questions",
      items: [
        { title: "Where do I change the interface language and theme?", body: "Open “Menu” at the top right. Under “Display preferences”, choose 中文 or English and System, Light, or Dark. Your choices are saved in the current browser. Changing the interface language does not rewrite the note you are editing." },
        { title: "Can I make a note without AI?", body: "Yes. Choose “Quick layout by paragraphs, without AI”, edit the words in “Content”, choose a style, and export. Publishing an already prepared note through the API also makes no AI call." },
        { title: "Why is the download button temporarily disabled?", body: "Fonts may still be loading or the page may still be fitting its content. Retry if a font fails. If a fixed page still cannot fit, shorten the content or choose a long page. The app reports the issue and blocks incomplete exports." },
        { title: "Can other people see my saved draft?", body: "A local draft has no public link and stays in the current browser. You choose how to share exported images. Only notes published through the API get an online view link." },
        { title: "How do I delete a note an agent published?", body: "When an agent publishes a note, it receives a manageToken. Ask the agent to call the delete endpoint with it, or keep the token for later. If the token is lost, ask the maintainers through the contact details in the privacy policy." },
        { title: "Does an agent have to send the source text?", body: "No. Submit schemaVersion: 1 and a complete note. New publication requests reject text. To have the service organize source material, first use the separate /api/structure endpoint, then publish its prepared result." },
      ],
    },
    copy: { label: "Copy", success: "Copied", failure: "Copy failed. Select the code and copy it manually." },
  },
};

export const GUIDE_PUBLISH_EXAMPLES = {
  zh: {
    schemaVersion: 1,
    note: {
      title: "本周进展",
      cues: [{ keyword: "下一步", note: "邀请同事试用" }],
      sections: [{ heading: "已完成", content: "完成了笔记发布接口。", highlights: ["发布接口"] }],
      summary: "准备收集第一轮试用反馈。",
      doodleTheme: "book",
    },
    appearance: { layout: "hybrid-cornell", overflow: "expand" },
    visibility: "unlisted",
  },
  en: {
    schemaVersion: 1,
    note: {
      title: "Weekly progress",
      cues: [{ keyword: "Next", note: "Invite colleagues to try it" }],
      sections: [{ heading: "Completed", content: "Finished the note publishing API.", highlights: ["publishing API"] }],
      summary: "Collect feedback from the first trial.",
      doodleTheme: "book",
    },
    appearance: { layout: "hybrid-cornell", overflow: "expand" },
    visibility: "unlisted",
  },
} satisfies Record<GuideLocale, PublishRequest>;

/** The body is constructed once, then reused verbatim by preflight and publication. */
export function getGuideExamples(origin: string, locale: GuideLocale): { json: string; curl: string } {
  const json = JSON.stringify(GUIDE_PUBLISH_EXAMPLES[locale], null, 2);
  const baseUrl = new URL(origin).origin.replace(/'/g, "'\\''");
  const curl = `(
  set -eu
  : "\${INKSCRIBE_IDEMPOTENCY_KEY:?Set a key for this publication}"
  INKSCRIBE_BASE_URL='${baseUrl}'
  payload=$(cat <<'JSON'
${json}
JSON
  )

  curl --fail-with-body --silent --show-error \\
    -X POST "$INKSCRIBE_BASE_URL/api/v1/notes/validate" \\
    -H "Content-Type: application/json" \\
    --data-binary "$payload"

  curl --fail-with-body --silent --show-error \\
    -X POST "$INKSCRIBE_BASE_URL/api/v1/notes" \\
    -H "Content-Type: application/json" \\
    -H "Idempotency-Key: $INKSCRIBE_IDEMPOTENCY_KEY" \\
    --data-binary "$payload"
)`;
  return { json, curl };
}
