import { normalizeDoodleSpec, type DoodleSpec, type NormalizeResult } from "./doodle.ts";
import { cleanText } from "./text.ts";
import { DOODLE_THEMES, inferDoodleTheme, type DoodleTheme } from "./themes.ts";

export type NoteCue = {
  keyword: string;
  note: string;
};

export type NoteSection = {
  heading?: string;
  content: string;
  highlights: string[];
};

export type NoteStructure = {
  title: string;
  date?: string;
  cues: NoteCue[];
  sections: NoteSection[];
  doodlePrompt?: string;
  /** 从内置插图库中选择的主题；由模型给出或根据 doodlePrompt 推断。 */
  doodleTheme?: DoodleTheme;
  doodleSpec?: DoodleSpec;
  summary: string;
};

export const NOTE_LIMITS = {
  title: 60,
  date: 40,
  maxCues: 8,
  cueKeyword: 24,
  cueNote: 120,
  maxSections: 6,
  heading: 50,
  content: 900,
  maxHighlights: 5,
  highlight: 60,
  summary: 400,
  doodlePrompt: 160,
} as const;

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

/**
 * 重点词必须出现在所在段落正文中，否则无法在画布上标记。
 * 大小写不同的匹配会被替换为正文中的实际写法；找不到的重点词会被丢弃。
 */
function matchHighlights(rawHighlights: unknown, content: string): { highlights: string[]; dropped: number } {
  if (!Array.isArray(rawHighlights)) return { highlights: [], dropped: 0 };
  const lowerContent = content.toLowerCase();
  const seen = new Set<string>();
  const highlights: string[] = [];
  let dropped = 0;
  for (const item of rawHighlights) {
    const phrase = cleanText(item, NOTE_LIMITS.highlight);
    if (!phrase || phrase.endsWith("…")) {
      if (phrase) dropped++;
      continue;
    }
    let actual: string | undefined;
    if (content.includes(phrase)) actual = phrase;
    else {
      const index = lowerContent.indexOf(phrase.toLowerCase());
      if (index >= 0) actual = content.slice(index, index + phrase.length);
    }
    if (!actual) {
      dropped++;
      continue;
    }
    if (seen.has(actual)) continue;
    seen.add(actual);
    highlights.push(actual);
    if (highlights.length >= NOTE_LIMITS.maxHighlights) break;
  }
  return { highlights, dropped };
}

function normalizeCue(item: unknown): NoteCue | undefined {
  if (typeof item === "string") {
    const [keyword, ...rest] = item.split(/[:：]/);
    const cue = { keyword: cleanText(keyword, NOTE_LIMITS.cueKeyword), note: cleanText(rest.join("："), NOTE_LIMITS.cueNote) };
    return cue.keyword ? cue : undefined;
  }
  if (!isRecord(item)) return undefined;
  const keyword = cleanText(item.keyword ?? item.cue ?? item.term, NOTE_LIMITS.cueKeyword);
  if (!keyword) return undefined;
  return { keyword, note: cleanText(item.note ?? item.explanation ?? "", NOTE_LIMITS.cueNote) };
}

function normalizeSection(item: unknown, warnings: string[]): NoteSection | undefined {
  if (typeof item === "string") {
    const content = cleanText(item, NOTE_LIMITS.content, { multiline: true });
    return content ? { content, highlights: [] } : undefined;
  }
  if (!isRecord(item)) return undefined;
  const content = cleanText(item.content ?? item.text, NOTE_LIMITS.content, { multiline: true });
  if (!content) return undefined;
  const heading = cleanText(item.heading ?? item.title, NOTE_LIMITS.heading);
  const { highlights, dropped } = matchHighlights(item.highlights, content);
  if (dropped > 0) warnings.push(`丢弃了 ${dropped} 个未出现在正文中的重点词`);
  return heading ? { heading, content, highlights } : { content, highlights };
}

/**
 * 校验并规范化模型输出（或客户端导入的数据）。
 * 返回值只包含契约中声明的字段；字符串经过清理与长度限制。
 */
export function normalizeNoteStructure(input: unknown): NormalizeResult<NoteStructure> {
  if (!isRecord(input)) return { ok: false, errors: ["根节点必须是 JSON 对象"] };

  const errors: string[] = [];
  const warnings: string[] = [];

  const title = cleanText(input.title, NOTE_LIMITS.title);
  if (!title) errors.push("缺少 title");

  const rawSections = input.sections;
  if (!Array.isArray(rawSections)) errors.push("sections 必须是数组");
  const sections = (Array.isArray(rawSections) ? rawSections : [])
    .map((item) => normalizeSection(item, warnings))
    .filter((s): s is NoteSection => s !== undefined);
  if (Array.isArray(rawSections) && sections.length === 0) errors.push("sections 中没有有效段落");
  if (sections.length > NOTE_LIMITS.maxSections) warnings.push(`段落超过 ${NOTE_LIMITS.maxSections} 个，已截断`);

  const cues = (Array.isArray(input.cues) ? input.cues : [])
    .map(normalizeCue)
    .filter((c): c is NoteCue => c !== undefined)
    .slice(0, NOTE_LIMITS.maxCues);

  const summary = cleanText(input.summary, NOTE_LIMITS.summary, { multiline: true });
  if (!summary) warnings.push("缺少 summary");

  if (errors.length > 0) return { ok: false, errors };

  const note: NoteStructure = {
    title,
    cues,
    sections: sections.slice(0, NOTE_LIMITS.maxSections),
    summary,
  };

  const date = cleanText(input.date, NOTE_LIMITS.date);
  if (date) note.date = date;

  const doodlePrompt = cleanText(input.doodlePrompt, NOTE_LIMITS.doodlePrompt);
  if (doodlePrompt) note.doodlePrompt = doodlePrompt;

  const theme = input.doodleTheme;
  if (typeof theme === "string" && (DOODLE_THEMES as readonly string[]).includes(theme)) {
    note.doodleTheme = theme as DoodleTheme;
  } else {
    const inferred = inferDoodleTheme(`${doodlePrompt} ${title}`);
    if (inferred) note.doodleTheme = inferred;
  }

  if (input.doodleSpec !== undefined && input.doodleSpec !== null) {
    const spec = normalizeDoodleSpec(input.doodleSpec);
    if (spec.ok) note.doodleSpec = spec.value;
    else warnings.push("doodleSpec 不合法，已忽略");
  }

  return { ok: true, value: note, warnings };
}

/** 提供给 Workers AI JSON 模式的 Schema。doodleSpec 由 /api/doodle 单独生成，不在此处要求。 */
export const NOTE_JSON_SCHEMA = {
  type: "object",
  properties: {
    title: { type: "string", description: "笔记标题，简短有力" },
    date: { type: "string", description: "原文中明确出现的日期；没有则省略" },
    cues: {
      type: "array",
      maxItems: NOTE_LIMITS.maxCues,
      items: {
        type: "object",
        properties: {
          keyword: { type: "string" },
          note: { type: "string" },
        },
        required: ["keyword", "note"],
      },
    },
    sections: {
      type: "array",
      minItems: 1,
      maxItems: NOTE_LIMITS.maxSections,
      items: {
        type: "object",
        properties: {
          heading: { type: "string" },
          content: { type: "string" },
          highlights: { type: "array", maxItems: NOTE_LIMITS.maxHighlights, items: { type: "string" } },
        },
        required: ["heading", "content", "highlights"],
      },
    },
    summary: { type: "string" },
    doodlePrompt: { type: "string" },
    doodleTheme: { type: "string", enum: [...DOODLE_THEMES] },
  },
  required: ["title", "cues", "sections", "summary", "doodlePrompt", "doodleTheme"],
} as const;
