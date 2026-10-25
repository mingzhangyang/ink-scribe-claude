/** Policy text is shared by the interactive pages and readable Worker HTML. */
import { CONTACT_EMAIL, DISCORD_INVITE } from "./contact.ts";

export type LegalLocale = "zh" | "en";
export type LegalPageId = "privacy" | "terms";
export type LegalLink = { href: string; label: string };
export type LegalSection = {
  id: string;
  title: string;
  paragraphs: string[];
  items?: string[];
  links?: LegalLink[];
};
export type LegalContent = {
  title: string;
  documentTitle: string;
  description: string;
  updatedLabel: string;
  updatedDate: string;
  tocLabel: string;
  sections: LegalSection[];
  relatedTitle: string;
  relatedLinks: LegalLink[];
};

const PROJECT_ISSUES = "https://github.com/mingzhangyang/ink-scribe-claude/issues";
const CONTACT_MAILTO = `mailto:${CONTACT_EMAIL}`;
const CLOUDFLARE_PRIVACY = "https://www.cloudflare.com/privacypolicy/";
const WORKERS_AI_DATA_USAGE = "https://developers.cloudflare.com/workers-ai/platform/data-usage/";
const GITHUB_PRIVACY = "https://docs.github.com/en/site-policy/privacy-policies/github-general-privacy-statement";

export const LEGAL_CONTENT: Record<LegalLocale, Record<LegalPageId, LegalContent>> = {
  zh: {
    privacy: {
      title: "隐私政策",
      documentTitle: "隐私政策 · 墨语笔记 InkScribe",
      description: "了解内容何时留在浏览器、何时发送给 AI 或保存为在线笔记，以及如何管理和删除这些数据。",
      updatedLabel: "更新日期",
      updatedDate: "2026-10-23",
      tocLabel: "本页目录",
      sections: [
        {
          id: "scope",
          title: "适用范围",
          paragraphs: [
            "本政策说明墨语笔记（InkScribe）当前网站与 API 如何处理你提供的内容和使用服务所需的数据。网站由项目维护者管理，网页编辑器目前无需注册账户。",
            "你自行选择的第三方 AI agent，以及由其他人部署的独立实例，可能有各自的数据处理方式。请同时查看这些服务的隐私说明。",
          ],
        },
        {
          id: "local-data",
          title: "保存在浏览器中的内容",
          paragraphs: [
            "导入的 TXT、Markdown、HTML、DOCX、PDF 文件先在浏览器本地解析；应用不会把原始文件上传到服务器。图片预览、导出与复制图片也在浏览器中完成。选择 AI 整理会进一步发送提取出的文字，具体见下一节。",
          ],
          items: [
            "草稿默认自动保存在当前浏览器的 IndexedDB 中，包括输入文字、整理后的笔记、外观、贴纸和插图等编辑状态；它不会自动跨设备同步。",
            "界面语言、主题和笔记外观偏好保存在 localStorage 中，用于下次打开时恢复设置。",
            "通过“保存到笔记库”保存的笔记也存放在当前浏览器的 IndexedDB 中，内容与草稿相同，包括原文、笔记、外观、贴纸和插图。笔记库不会上传，也不会跨设备同步；你可以在笔记库页面删除单条笔记，或把全部笔记导出为 JSON 备份文件，导出的备份文件由你自行保管。",
            "草稿栏可删除已保存的草稿并关闭自动保存。浏览器会保留一条标记，使自动保存保持关闭；当前画面中的内容不会立即消失，笔记库中的笔记以及外观、语言等偏好也不会随草稿一起删除。",
            "浏览器的“清除站点数据”功能可清除本地草稿、笔记库和偏好。清理浏览器数据、结束隐私浏览或更换设备可能使这些内容丢失，请定期导出需要保留的笔记或图片。",
          ],
        },
        {
          id: "ai-processing",
          title: "AI 整理与可选插图",
          paragraphs: [
            "点击 AI 整理时，应用把输入或提取出的文字，以及模板、输出语言、版式和详略设置发送到本网站的 /api/structure。Cloudflare Worker 使用配置的 Workers AI 模型处理这些信息并返回笔记；本地快速排版无需发送文字给 AI。",
            "如果站点启用了 AI 插图，你请求生成插图时，笔记的插图描述或标题（concept）会发送到 /api/doodle 并用于模型处理。生成后的图元可能在服务器缓存，缓存键使用描述的哈希值，缓存内容去除描述正文。",
            "应用的整理接口不会把原文或本次模型输出写入发布数据库，应用日志也不记录这些正文。AI Gateway 启用时，应用请求关闭网关正文日志；这不等于底层平台完全不处理或保留任何请求信息。平台处理说明见“服务提供商与外部链接”。",
          ],
        },
        {
          id: "published-notes",
          title: "在线发布与可见范围",
          paragraphs: [
            "通过发布 API 发布时，服务器会保存整理后的 note、外观设置、贴纸与插图数据，以及标题、摘要、语言、分类、可见性和发布时间等元数据，以提供查看与删除功能；用于发布限额和删除的客户端哈希见下一节。发布步骤本身不调用 AI。",
            "发布接口不接收独立的原文 text 字段，不另外保存原始文件或原文副本；你主动放进 note 的原文摘录、姓名或其他个人信息，仍会作为笔记内容保存和展示。",
          ],
          items: [
            "通过 API 发布的作品都是 unlisted：不列入公开图库，也不会被搜索引擎收录，但任何持有链接的人都能匿名读取。它不是需要登录的私有文档。",
            "预检不会保存笔记或占用幂等键，但仍会进行限流和请求元数据记录。仅在本机保存草稿、笔记库或导出图片不会创建在线发布记录。",
          ],
        },
        {
          id: "technical-data",
          title: "运行数据与防滥用",
          paragraphs: [
            "为了诊断故障、管理资源和防止滥用，应用记录请求标识、路径、状态与错误码、模型、耗时、输入字数、token 用量和重试次数等元数据。应用定义的日志字段不包含原文或模型输出正文。",
            "首次创作统计记录随机创作与操作标识、步骤结果、耗时、错误码、语言、模板、内容长度区间、设备宽度类别及是否为本浏览器首次创作；不记录原文、标题、笔记内容、文件名或页面 URL。创作标识不跨刷新保存，不用于跨站追踪。事件在 D1 中保留 30 天，由每日任务清理。启用浏览器 Do Not Track 时客户端不发送这些事件。",
            "AI 接口和发布接口会使用客户端 IP 信息限流。Cloudflare 的网络、安全和请求日志也可能处理 IP 地址及其他技术请求信息。",
          ],
          items: [
            "发布笔记时，服务器随笔记保存由客户端 IP 计算出的单向哈希，用于 24 小时发布次数上限，并区分不同发布者的幂等键。数据库不保存 IP 明文，但该哈希仍可能与特定 IP 关联。同时保存发布时返回的 manageToken 的哈希，用于授权删除；manageToken 明文不保存。",
            "提供 Idempotency-Key 时，服务器保存该键、请求内容的哈希、客户端哈希、笔记标识、处理状态和时间，以避免重试产生重复作品。请不要把敏感正文或其他秘密放进幂等键。",
            "这些技术与管理数据用于提供服务，不用于向你展示个性化广告。当前应用未集成第三方广告或跨站营销追踪脚本；基础设施提供商仍可能处理运行服务所需的数据。",
          ],
        },
        {
          id: "providers",
          title: "服务提供商与外部链接",
          paragraphs: [
            "网站使用 Cloudflare 提供运行、网络、Workers AI 推理与 D1 数据库等基础设施。Cloudflare 可能按其服务条款、隐私政策和实际部署配置处理请求及运行数据，相关数据可能在不同地区处理。",
            "Cloudflare 的 Workers AI 数据使用说明称，标准无状态推理按完成请求所需处理输入与输出，且不会用 Workers AI 客户内容训练模型。可选存储、网关日志、缓存、运行元数据以及安全或法律相关处理另有相应规则。这些说明不表示本网站已发布的笔记或你使用的第三方 agent 不会保存内容。",
            "访问 GitHub 等外部链接后，你与该平台的交互适用其规则和隐私政策。公开反馈的内容也可能被他人查看。",
          ],
          links: [
            { href: WORKERS_AI_DATA_USAGE, label: "Cloudflare Workers AI 数据使用说明" },
            { href: CLOUDFLARE_PRIVACY, label: "Cloudflare 隐私政策" },
            { href: GITHUB_PRIVACY, label: "GitHub 隐私声明" },
          ],
        },
        {
          id: "retention-deletion",
          title: "保存、删除与撤回分享",
          paragraphs: [
            "草稿、笔记库和偏好等本地数据由当前浏览器保存，直到你通过应用或浏览器清除它们，或浏览器不再保留它们。已发布笔记不会随你关闭页面而自动删除，当前发布功能也没有统一的自动到期删除期限。日志、平台备份和缓存的保留方式取决于相关平台与部署配置。",
            "已发布作品可使用发布时返回的 manageToken 通过 API 删除，或联系维护者协助处理。删除笔记后，为防止延迟重试重新创建作品，系统仍可保留幂等关联与必要管理记录；这些关联与管理记录目前没有自动到期清除期限。",
            "删除作品无法召回他人已下载、截图、转发或由第三方缓存的副本。",
          ],
        },
        {
          id: "contact",
          title: "联系、请求与政策更新",
          paragraphs: [
            `如有隐私疑问，或希望查询、纠正、删除与自己有关的数据，请发送邮件至 ${CONTACT_EMAIL}。处理时可能需要核实你的身份或对相关作品的权限。`,
            "一般问题和建议也可以在 Discord 社区或项目 GitHub 反馈入口提出。这两个都是公开渠道，并非私密表单：不要在其中粘贴原文、manageToken、个人敏感信息或未公开笔记的链接，涉及这些内容的请求请通过邮件联系。",
            "功能或数据处理方式变化时，本政策可能更新，并在页面标注新的更新日期。你在适用法律下享有的权利不因本说明受到限制。",
          ],
          links: [
            { href: CONTACT_MAILTO, label: `发送邮件（${CONTACT_EMAIL}）` },
            { href: DISCORD_INVITE, label: "加入 Discord 社区" },
            { href: PROJECT_ISSUES, label: "GitHub 公开反馈" },
          ],
        },
      ],
      relatedTitle: "相关页面",
      relatedLinks: [{ href: "/terms", label: "使用条款" }, { href: "/guide", label: "使用说明" }, { href: "/", label: "返回编辑器" }],
    },
    terms: {
      title: "使用条款",
      documentTitle: "使用条款 · 墨语笔记 InkScribe",
      description: "在编辑、导出和发布笔记前，了解内容权利、AI agent 的发布责任及服务的使用边界。",
      updatedLabel: "更新日期",
      updatedDate: "2026-10-23",
      tocLabel: "本页目录",
      sections: [
        {
          id: "scope",
          title: "服务与适用范围",
          paragraphs: [
            "墨语笔记（InkScribe）提供文字整理、笔记编辑、图片导出，以及通过发布 API 发布在线笔记的功能。本条款适用于当前网站与 API；使用时请同时阅读隐私政策，并遵守适用法律。若无法同意这些条款，请停止使用服务。",
            "如果你代表他人或组织使用服务，应取得相应授权。第三方 AI agent、外部网站和其他维护者部署的实例，可能有各自的使用条款。功能是否可用、使用额度和模型配置可能随部署及维护情况变化。",
          ],
          links: [{ href: "/privacy", label: "阅读隐私政策" }],
        },
        {
          id: "your-content",
          title: "你的内容与必要许可",
          paragraphs: [
            "你对所提交内容享有的权利不会因使用本服务而转让给项目维护者。你应拥有输入、编辑、处理和分享这些内容所需的权利与许可，并尊重他人的著作权、隐私和其他合法权益。",
            "为了交付你请求的功能，你允许维护者及必要的服务提供商在该目的所需范围内处理、复制、存储、展示和分发内容。例如，AI 整理需要处理输入文字，在线发布需要保存笔记并向具有相应访问方式的人展示。本许可限于提供、运行和维护你所选择的服务。",
            "通过 API 发布的作品为 unlisted，任何持有链接的人都能读取。发送链接或分享导出的图片前，请确认你有权向对方披露这些内容。他人能够查看你的作品，不代表其取得了你的著作权。",
          ],
        },
        {
          id: "ai-results",
          title: "AI 结果与发布前检查",
          paragraphs: [
            "AI 整理或插图可能出现遗漏、错误、误解或不合适的输出。你应在使用、导出或发布前检查事实、引用、个人信息和排版，并根据用途作出判断；服务不保证生成内容准确、完整或适合某个特定用途。",
            "结构预检通过只表示提交的数据符合接口契约，不表示内容已经经过事实、法律或页面视觉审查。API 发布本身不会再次调用 AI；需要确认固定尺寸效果时，请打开查看页检查字体、重点词和页面布局。",
          ],
        },
        {
          id: "agent-access",
          title: "AI agent 与自动发布",
          paragraphs: [
            "任何能够遵循接口契约的 agent 或程序都可以接入，发布的作品仅以 unlisted 方式分享。自动化调用者应在用户授权范围内行动，确认发布内容及可见范围，并遵守站点的请求大小、速率、每日发布次数和资源限制。",
          ],
          items: [
            "把发布返回的 manageToken 交给用户妥善保管，不要把它放进公开页面、代码仓库、共享笔记或 issue。manageToken 泄露时，及时删除相关作品或联系维护者处理。",
            "发布应提交准备好的结构化 note；可先预检并修正错误。对同一次发布的网络重试，应使用原幂等键和相同请求体，避免重复发布。",
            "不得绕过访问控制、试图获取未经授权的数据、通过更换网络地址等方式逃避限流和发布次数上限，或以自动化方式干扰服务。能够调用接口不意味着可以代替用户决定分享其内容。",
          ],
          links: [{ href: "/guide#agents", label: "查看 AI agent 接入说明" }, { href: "/api/v1/openapi.json", label: "查看 OpenAPI 规范" }],
        },
        {
          id: "acceptable-use",
          title: "合理使用与他人权益",
          paragraphs: [
            "请仅提交和发布你有权处理的内容。不得利用服务从事违法活动、侵犯他人权利、泄露未经授权的个人信息或机密，或者传播恶意代码、垃圾内容和用于攻击服务的请求。",
            "共享设备上的草稿和笔记库、导出的文件、分享出去的链接，以及你选择的第三方 agent，需要由你妥善管理。某项内容能通过本服务访问，不代表维护者认可其合法性或来源。",
          ],
        },
        {
          id: "availability",
          title: "服务可用性与法定权利",
          paragraphs: [
            "在适用法律允许的范围内，本服务按当前状态和实际可用情况提供，不承诺持续不中断、没有错误、永久保存内容或适合所有用途。模型、浏览器、网络和基础设施的限制可能影响结果与可用性。请自行保存重要内容的备份或导出文件。",
            "本条款不排除或限制适用法律规定不得排除或限制的责任、保障或用户权利，也不要求你放弃法定救济。",
          ],
        },
        {
          id: "removal-changes",
          title: "删除、限制访问与服务调整",
          paragraphs: [
            "维护者可以为维护服务、安全、防止滥用、处理侵权投诉或遵守适用法律，对内容或 API 访问进行调查、限制、移除或停用，并可调整或停止部分功能。这些处理应在适用法律允许的范围内进行。",
            "你可使用发布时返回的 manageToken 通过 API 删除自己的作品，或联系维护者寻求帮助。删除作品不能消除已经被他人取得的副本。具体数据处理方式见隐私政策。",
            "功能和条款可能随着维护迭代而调整，本页会标明更新日期。使用新的功能或发布方式前，请重新查看相关说明。",
          ],
          links: [{ href: "/privacy#retention-deletion", label: "了解保存与删除方式" }],
        },
        {
          id: "contact",
          title: "问题与反馈",
          paragraphs: [
            `如对使用条款、内容权利或访问限制有疑问，请发送邮件至 ${CONTACT_EMAIL}；删除请求、侵权投诉等敏感事项也请通过邮件联系。一般反馈可以在 Discord 社区或项目 GitHub 反馈入口提出，它们是公开渠道，不要在其中提供原文、manageToken、个人敏感信息或未公开链接。`,
          ],
          links: [
            { href: CONTACT_MAILTO, label: `发送邮件（${CONTACT_EMAIL}）` },
            { href: DISCORD_INVITE, label: "加入 Discord 社区" },
            { href: PROJECT_ISSUES, label: "GitHub 公开反馈" },
          ],
        },
      ],
      relatedTitle: "相关页面",
      relatedLinks: [{ href: "/privacy", label: "隐私政策" }, { href: "/guide", label: "使用说明" }, { href: "/", label: "返回编辑器" }],
    },
  },
  en: {
    privacy: {
      title: "Privacy policy",
      documentTitle: "Privacy policy · InkScribe",
      description: "Learn what stays in your browser, what is sent for AI processing or saved as a published note, and how to manage or delete that data.",
      updatedLabel: "Last updated",
      updatedDate: "2026-10-23",
      tocLabel: "On this page",
      sections: [
        {
          id: "scope",
          title: "Scope",
          paragraphs: [
            "This policy describes how the current InkScribe website and API handle the content you provide and the data needed to run the service. Project maintainers operate the website. The web editor currently requires no account registration.",
            "Third-party AI agents you choose to use, and separate instances deployed by other people, may handle data differently. Please also read those services' privacy information.",
          ],
        },
        {
          id: "local-data",
          title: "Content stored in your browser",
          paragraphs: [
            "Imported TXT, Markdown, HTML, DOCX, and PDF files are parsed in your browser. The application does not upload the original files to the server. Image previews, exports, and image copying also happen in the browser. Choosing AI organization sends the extracted text to the server, as explained below.",
          ],
          items: [
            "Drafts autosave by default in the current browser's IndexedDB, including input text, the prepared note, appearance, stickers, illustrations, and related editing state. They do not automatically sync across devices.",
            "Interface language, theme, and note appearance preferences are kept in localStorage so they can be restored on your next visit.",
            "Notes you add with “Save to library” are also kept in the current browser's IndexedDB, with the same contents as a draft: source text, note, appearance, stickers, and illustrations. The library is not uploaded and does not sync across devices. On the library page you can delete individual notes or export all of them as a JSON backup file, which you then keep yourself.",
            "The draft bar can delete the saved draft and disable autosave. The browser keeps a marker so autosave stays disabled. Content currently on screen is not immediately cleared, and library notes and appearance or language preferences are not deleted with the draft.",
            "Your browser's clear-site-data controls can remove local drafts, the library, and preferences. Browser cleanup, the end of a private session, or changing devices can cause them to be lost, so export the notes or images you want to keep.",
          ],
        },
        {
          id: "ai-processing",
          title: "AI organization and optional illustrations",
          paragraphs: [
            "When you request AI organization, the application sends the entered or extracted text, template, output language, layout, and detail settings to this site's /api/structure endpoint. The Cloudflare Worker uses the configured Workers AI model to process them and return a note. Quick local layout does not send text to AI.",
            "If AI illustrations are enabled, requesting one sends the note's illustration description or title, called concept, to /api/doodle for model processing. Generated drawing primitives may be cached on the server. The cache key uses a hash of the description, and the cached content omits the description text.",
            "The application's organization endpoint does not write the source text or the model's output to the publishing database, and application logs do not record those bodies. When AI Gateway is enabled, the application requests that gateway body logging be disabled. This does not mean the underlying platforms process or retain no request information. See the service-provider section below.",
          ],
        },
        {
          id: "published-notes",
          title: "Publishing and visibility",
          paragraphs: [
            "Publishing through the API saves the prepared note, appearance settings, stickers, and illustration data on the server. It also saves metadata such as title, summary, language, category, visibility, and publication time to support viewing and deletion. The client hash used for publishing limits and deletion is described in the next section. The publishing step itself makes no AI call.",
            "The publishing endpoint does not accept a separate source-text field named text or save an additional original file or source-text copy. Any source excerpts, names, or other personal information you choose to include in note are still saved and displayed as part of the note.",
          ],
          items: [
            "Every note published through the API is unlisted: it stays out of the public gallery and search engines, but anyone with its link can read it without signing in. It is not a private document protected by an account.",
            "Validation does not save a note or reserve an idempotency key, but rate limiting and request metadata logging still occur. Saving a local draft or library note, or exporting an image, does not create a published record.",
          ],
        },
        {
          id: "technical-data",
          title: "Operational data and abuse prevention",
          paragraphs: [
            "First-creation statistics record random creation and operation IDs, step outcomes, duration, error codes, language, template, input-length buckets, viewport-width categories and whether this is the browser’s first creation. They exclude source text, titles, note content, filenames and page URLs. Creation IDs do not persist across reloads and are not used for cross-site tracking. Events are retained in D1 for 30 days and removed by a daily task. The client does not send these events when browser Do Not Track is enabled.",
            "To diagnose problems, manage resources, and prevent abuse, the application records metadata such as request identifiers, paths, status and error codes, models, duration, input length, token usage, and retry counts. Its defined logging fields do not contain source text or model response bodies.",
            "AI and publishing endpoints use client IP information for rate limiting. Cloudflare's network, security, and request logging services may also process IP addresses and other technical request information.",
          ],
          items: [
            "When a note is published, the server stores a one-way hash computed from the client IP address with the note. It enforces the 24-hour publishing limit and keeps different publishers' idempotency keys apart. The database does not store the plaintext IP address, but the hash may still be linked to a specific IP address. The server also stores a hash of the returned manageToken to authorize deletion; the plaintext manageToken is not stored.",
            "If you provide an Idempotency-Key, the server stores that key, a hash of the request content, the client hash, the note identifier, processing state, and timestamps to prevent duplicate notes after retries. Do not put sensitive content or other secrets in an idempotency key.",
            "This operational and management data is used to provide the service, not to show personalized advertising. The current application has no third-party advertising or cross-site marketing tracking scripts integrated. Infrastructure providers may still process the data needed to run their services.",
          ],
        },
        {
          id: "providers",
          title: "Service providers and external links",
          paragraphs: [
            "The website uses Cloudflare for infrastructure including hosting, networking, Workers AI inference, and the D1 database. Cloudflare may process requests and operational data under its service terms, privacy policy, and the actual deployment configuration. Data may be processed across regions.",
            "Cloudflare's Workers AI data-usage documentation says standard stateless inference processes inputs and outputs as needed to complete requests and does not use Workers AI customer content to train models. Optional storage, gateway logging, caching, operational metadata, and security or legal processing have separate provisions. These statements do not mean published notes on this site or third-party agents you use will not retain content.",
            "After following external links such as GitHub, your interactions with that platform are governed by its own rules and privacy policy. Public feedback can also be seen by other people.",
          ],
          links: [
            { href: WORKERS_AI_DATA_USAGE, label: "Cloudflare Workers AI data usage" },
            { href: CLOUDFLARE_PRIVACY, label: "Cloudflare privacy policy" },
            { href: GITHUB_PRIVACY, label: "GitHub privacy statement" },
          ],
        },
        {
          id: "retention-deletion",
          title: "Retention, deletion, and withdrawing a share",
          paragraphs: [
            "Local data such as drafts, the library, and preferences stays in the current browser until you remove it through the application or browser, or the browser stops retaining it. Published notes do not disappear when you close a page, and the current publishing feature has no universal automatic expiry. Retention of logs, platform backups, and caches depends on the relevant platform and deployment settings.",
            "Published notes can be deleted through the API with the manageToken returned at publication, or you can ask the maintainers for help. After a note is deleted, idempotency associations and necessary management records may remain to prevent delayed retries from recreating it. The current application does not automatically expire these association or management records.",
            "Deleting a note cannot recall copies others have downloaded, captured, shared, or cached outside the service.",
          ],
        },
        {
          id: "contact",
          title: "Contact, requests, and policy updates",
          paragraphs: [
            `For privacy questions, or to ask about accessing, correcting, or deleting data relating to you, email ${CONTACT_EMAIL}. Your identity or authority over the relevant note may need to be verified.`,
            "General questions and suggestions are also welcome in the Discord community or on the project's GitHub feedback page. Both are public channels, not private forms: do not paste source text, manageTokens, sensitive personal information, or unlisted note links there, and use email for requests that involve them.",
            "This policy may change as features or data practices change, with a new update date shown on this page. This notice does not limit rights you have under applicable law.",
          ],
          links: [
            { href: CONTACT_MAILTO, label: `Email us (${CONTACT_EMAIL})` },
            { href: DISCORD_INVITE, label: "Join the Discord community" },
            { href: PROJECT_ISSUES, label: "Public GitHub feedback" },
          ],
        },
      ],
      relatedTitle: "Related pages",
      relatedLinks: [{ href: "/terms", label: "Terms of use" }, { href: "/guide", label: "User & agent guide" }, { href: "/", label: "Back to the editor" }],
    },
    terms: {
      title: "Terms of use",
      documentTitle: "Terms of use · InkScribe",
      description: "Before editing, exporting, or publishing notes, understand content rights, an AI agent's publishing responsibilities, and the boundaries of the service.",
      updatedLabel: "Last updated",
      updatedDate: "2026-10-23",
      tocLabel: "On this page",
      sections: [
        {
          id: "scope",
          title: "The service and these terms",
          paragraphs: [
            "InkScribe provides text organization, note editing, image export, and online publishing through the API. These terms apply to the current website and API. Please read the privacy policy and follow applicable law when using the service. If you cannot agree to these terms, stop using the service.",
            "If you use the service for another person or organization, you should have their authorization. Third-party AI agents, external websites, and instances deployed by other maintainers may have their own terms. Feature availability, usage allowances, and model configurations may change with deployment and maintenance.",
          ],
          links: [{ href: "/privacy", label: "Read the privacy policy" }],
        },
        {
          id: "your-content",
          title: "Your content and the permission needed to serve it",
          paragraphs: [
            "Using this service does not transfer your existing rights in submitted content to the maintainers. You should have the rights and permissions needed to submit, edit, process, and share that content, and respect other people's copyright, privacy, and other legal rights.",
            "To deliver the features you request, you permit the maintainers and necessary service providers to process, copy, store, display, and distribute content to the extent needed for that purpose. For example, AI organization processes input text, and publishing saves a note and shows it to people who can access it. This permission is limited to providing, operating, and maintaining the services you choose.",
            "Notes published through the API are unlisted, so anyone with the link can read them. Before sending a link or sharing an exported image, make sure you are authorized to disclose the content to those people. Others being able to view your note does not give them your copyright.",
          ],
        },
        {
          id: "ai-results",
          title: "AI results and checks before publishing",
          paragraphs: [
            "AI organization and illustrations can contain omissions, mistakes, misunderstandings, or unsuitable output. Check facts, references, personal information, and layout before using, exporting, or publishing a result, and exercise judgment for your intended use. The service does not guarantee that generated content is accurate, complete, or suitable for a particular purpose.",
            "Passing structural validation only means the submitted data follows the API contract. It does not mean the content has undergone factual, legal, or visual review. API publishing does not call AI again. If a specific page size matters, open the view page to check fonts, highlights, and layout.",
          ],
        },
        {
          id: "agent-access",
          title: "AI agents and automated publishing",
          paragraphs: [
            "Any agent or program that follows the API contract can connect. Published notes are shared only as unlisted. Automated clients should act within the user's authorization, confirm the content and its intended audience, and respect request-size, rate, daily publishing, and resource limits.",
          ],
          items: [
            "Give the manageToken returned by publishing to the user to keep safe. Do not put it in public pages, code repositories, shared notes, or issues. If a manageToken is exposed, delete the affected notes or contact the maintainers.",
            "Publish a prepared structured note. Validate it and correct errors first when appropriate. Network retries for the same publication should keep the original idempotency key and request body to avoid duplicates.",
            "Do not bypass access controls, obtain data without authorization, evade rate or daily publishing limits (for example, by changing network addresses), or use automation to disrupt the service. Being able to call the API does not authorize you to share a user's content on their behalf.",
          ],
          links: [{ href: "/guide#agents", label: "Read the AI agent guide" }, { href: "/api/v1/openapi.json", label: "Read the OpenAPI specification" }],
        },
        {
          id: "acceptable-use",
          title: "Acceptable use and other people's rights",
          paragraphs: [
            "Only submit and publish content you are authorized to process. Do not use the service for unlawful activities, to infringe others' rights, to disclose personal or confidential information without permission, or to distribute malicious code, spam, or requests intended to attack the service.",
            "You are responsible for drafts and library notes on shared devices, exported files, links you share, and any third-party agents you choose. The fact that content is available through the service does not mean the maintainers vouch for its legality or origin.",
          ],
        },
        {
          id: "availability",
          title: "Availability and statutory rights",
          paragraphs: [
            "To the extent permitted by applicable law, the service is provided as it currently exists and is available, without a promise of uninterrupted or error-free operation, permanent content storage, or suitability for every purpose. Model, browser, network, and infrastructure limitations may affect results and availability. Keep your own backups or exports of important content.",
            "These terms do not exclude or limit liabilities, protections, or user rights that applicable law does not allow to be excluded or limited, and do not require you to give up statutory remedies.",
          ],
        },
        {
          id: "removal-changes",
          title: "Removal, access limits, and service changes",
          paragraphs: [
            "Maintainers may investigate, restrict, remove, or disable content or API access to maintain the service, protect security, prevent abuse, address rights complaints, or comply with applicable law. They may also change or discontinue features. Such actions remain subject to applicable law.",
            "You may delete your notes through the API with the manageToken returned at publication, or contact the maintainers for help. Deleting a note cannot remove copies already obtained by others. The privacy policy explains the associated data handling.",
            "Features and terms may change as the service is maintained. This page identifies its update date. Review the relevant information before using new features or publishing methods.",
          ],
          links: [{ href: "/privacy#retention-deletion", label: "Learn about retention and deletion" }],
        },
        {
          id: "contact",
          title: "Questions and feedback",
          paragraphs: [
            `For questions about these terms, content rights, or access restrictions, email ${CONTACT_EMAIL}; please use email for deletion requests, rights complaints, and other sensitive matters too. General feedback is welcome in the Discord community or on the project's GitHub feedback page. Those are public channels, so do not put source text, manageTokens, sensitive personal information, or unlisted links there.`,
          ],
          links: [
            { href: CONTACT_MAILTO, label: `Email us (${CONTACT_EMAIL})` },
            { href: DISCORD_INVITE, label: "Join the Discord community" },
            { href: PROJECT_ISSUES, label: "Public GitHub feedback" },
          ],
        },
      ],
      relatedTitle: "Related pages",
      relatedLinks: [{ href: "/privacy", label: "Privacy policy" }, { href: "/guide", label: "User & agent guide" }, { href: "/", label: "Back to the editor" }],
    },
  },
};
