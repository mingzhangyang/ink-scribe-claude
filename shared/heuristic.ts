import { normalizeNoteStructure, type NoteStructure } from "./note.ts";
import type { Detail, Template } from "./options.ts";
import { cleanText, detectLanguage, truncate } from "./text.ts";
import { inferDoodleTheme, TEMPLATE_DEFAULT_THEME } from "./themes.ts";

/**
 * 不依赖模型的本地整理器：按段落、标题行、高频词等规则生成 NoteStructure。
 * 用于开发模式（AI_MOCK）以及 AI 不可用时的“本地快速排版”兜底，结果只做抽取不做改写，
 * 因此不会引入原文没有的事实，但整理质量明显低于模型。
 */

const DETAIL_BUDGET: Record<Detail, { sections: number; chars: number; cues: number }> = {
  concise: { sections: 3, chars: 140, cues: 4 },
  standard: { sections: 4, chars: 240, cues: 5 },
  detailed: { sections: 6, chars: 400, cues: 6 },
};

const CJK_STOP_CHARS = new Set(
  "的了是在和与也就都而及或一不我你他她它们这那有个上下中为以于对把被从到等着过很让会能要可还又被所其之".split(""),
);

const EN_STOPWORDS = new Set(
  (
    "the and for that with this from have has had are was were will would could should there their them they " +
    "what when where which while about into than then also more most some such only other over very just your " +
    "been being each does did doing because these those after before under again further once here here's its " +
    "it's our ours you you're not can cannot can't how why all any both few own same too out off down only"
  ).split(" "),
);

const ENDS_WITH_PUNCT = /[。！？!?；;，,：:.、…]$/;

export function splitSentences(text: string): string[] {
  return text
    .split(/\n+|(?<=[。！？!?；;])\s*|(?<=[.])\s+(?=[A-Z0-9"“])/)
    .map((s) => s.trim())
    .filter(Boolean);
}

/** 以逗号、句号、冒号和换行切分出短小句段，用于线索提示。 */
function splitClauses(text: string): string[] {
  return text
    .split(/[，,。！？!?；;：:\n]|(?<=[.])\s+/)
    .map((s) => s.trim().replace(/^[-*•·\d.、)）\s]+/, ""))
    .filter(Boolean);
}

function isHeadingLine(line: string, lang: "zh" | "en"): boolean {
  const stripped = line.replace(/^#{1,6}\s*/, "").trim();
  if (!stripped) return false;
  if (/^#{1,6}\s/.test(line)) return true;
  const max = lang === "zh" ? 24 : 60;
  return Array.from(stripped).length <= max && !ENDS_WITH_PUNCT.test(stripped);
}

function stripHeadingMarks(line: string): string {
  return line.replace(/^#{1,6}\s*/, "").replace(/^[一二三四五六七八九十\d]+[、.．)]\s*/, "").trim();
}

type Block = { heading?: string; body: string };

function toBlocks(text: string, lang: "zh" | "en"): Block[] {
  let paragraphs = text.split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean);
  if (paragraphs.length === 1) {
    const lines = paragraphs[0].split("\n").map((l) => l.trim()).filter(Boolean);
    if (lines.length > 1) paragraphs = lines;
  }
  const blocks: Block[] = [];
  let pendingHeading: string | undefined;
  for (const paragraph of paragraphs) {
    const lines = paragraph.split("\n").map((l) => l.trim()).filter(Boolean);
    if (lines.length === 1 && isHeadingLine(lines[0], lang)) {
      pendingHeading = stripHeadingMarks(lines[0]);
      continue;
    }
    if (lines.length > 1 && isHeadingLine(lines[0], lang)) {
      blocks.push({ heading: stripHeadingMarks(lines[0]), body: lines.slice(1).join("\n") });
    } else {
      blocks.push({ heading: pendingHeading, body: lines.join("\n") });
    }
    pendingHeading = undefined;
  }
  if (blocks.length === 1) {
    // 只有一大段时按句子切分为若干组，避免整页只有一个段落
    const sentences = splitSentences(blocks[0].body);
    if (sentences.length > 3) {
      const groups: Block[] = [];
      const per = Math.ceil(sentences.length / Math.min(4, Math.ceil(sentences.length / 3)));
      for (let i = 0; i < sentences.length; i += per) {
        groups.push({ body: sentences.slice(i, i + per).join(lang === "zh" ? "" : " ") });
      }
      groups[0].heading = blocks[0].heading;
      return groups;
    }
  }
  return blocks;
}

function mergeBlocks(blocks: Block[], max: number): Block[] {
  if (blocks.length <= max) return blocks;
  const per = Math.ceil(blocks.length / max);
  const merged: Block[] = [];
  for (let i = 0; i < blocks.length; i += per) {
    const group = blocks.slice(i, i + per);
    merged.push({
      heading: group.find((b) => b.heading)?.heading,
      body: group.map((b) => b.body).join("\n"),
    });
  }
  return merged;
}

function takeSentences(text: string, maxChars: number): string {
  const lines = text.split("\n");
  const isList = lines.length > 1 && lines.every((l) => /^([-*•·]|\d+[.、)])\s*/.test(l.trim()));
  if (isList) {
    const kept: string[] = [];
    let used = 0;
    for (const line of lines) {
      const len = Array.from(line).length;
      if (used + len > maxChars && kept.length > 0) break;
      kept.push(line.replace(/^([*•·])\s*/, "- "));
      used += len;
    }
    return kept.join("\n");
  }
  const sentences = splitSentences(text);
  let result = "";
  for (const sentence of sentences) {
    const next = result ? `${result}${/[㐀-鿿]$/.test(result) || /[。！？；]$/.test(result) ? "" : " "}${sentence}` : sentence;
    if (Array.from(next).length > maxChars && result) break;
    result = next;
  }
  return truncate(result || text, maxChars);
}

/** 统计候选关键词：英文取非停用词，中文取不含虚词的 2–6 字片段。 */
export function extractKeywords(text: string, limit: number): string[] {
  const lang = detectLanguage(text);
  const counts = new Map<string, number>();
  if (lang === "en") {
    for (const word of text.toLowerCase().match(/[a-z][a-z'-]{3,}/g) ?? []) {
      if (EN_STOPWORDS.has(word)) continue;
      counts.set(word, (counts.get(word) ?? 0) + 1);
    }
  } else {
    for (const run of text.match(/[㐀-鿿]+/g) ?? []) {
      const chars = Array.from(run);
      for (let n = 2; n <= 6; n++) {
        for (let i = 0; i + n <= chars.length; i++) {
          const gram = chars.slice(i, i + n);
          if (gram.some((c) => CJK_STOP_CHARS.has(c))) continue;
          const key = gram.join("");
          counts.set(key, (counts.get(key) ?? 0) + 1);
        }
      }
    }
  }
  const scored = [...counts.entries()]
    .filter(([, count]) => count >= 2)
    .map(([term, count]) => ({ term, score: count * Math.pow(Array.from(term).length, 1.3) }))
    .sort((a, b) => b.score - a.score);

  const overlaps = (a: string, b: string) => {
    if (a.includes(b) || b.includes(a)) return true;
    // “注意力”与“意力残留”这类首尾相接的片段视为同一个词
    for (let k = 2; k < Math.min(a.length, b.length); k++) {
      if (a.endsWith(b.slice(0, k)) || b.endsWith(a.slice(0, k))) return true;
    }
    return false;
  };
  const chosen: string[] = [];
  for (const { term } of scored) {
    if (chosen.some((c) => overlaps(c, term))) continue;
    chosen.push(term);
    if (chosen.length >= limit) break;
  }
  return chosen;
}

const QUOTED = /[“"「『]([^”"」』\n]{2,20})[”"」』]/g;

function pickHighlights(content: string, keywords: string[]): string[] {
  const result: string[] = [];
  for (const match of content.matchAll(QUOTED)) result.push(match[1]);
  for (const keyword of keywords) {
    if (result.length >= 2) break;
    const index = content.toLowerCase().indexOf(keyword.toLowerCase());
    if (index >= 0) result.push(content.slice(index, index + keyword.length));
  }
  if (result.length === 0) {
    const clause = content.split(/[，,。.;；:：\n]/)[0]?.trim();
    if (clause && Array.from(clause).length <= 18) result.push(clause);
  }
  return result.slice(0, 3);
}

const DATE_PATTERNS = [
  /\d{4}\s*年\s*\d{1,2}\s*月\s*\d{1,2}\s*日/,
  /\d{4}[-/.]\d{1,2}[-/.]\d{1,2}/,
  /\d{1,2}\s*月\s*\d{1,2}\s*日/,
  /(January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{1,2}(,\s*\d{4})?/i,
];

function findDate(text: string): string | undefined {
  for (const pattern of DATE_PATTERNS) {
    const match = text.match(pattern);
    if (match) return match[0].replace(/\s+/g, match[0].match(/[a-z]/i) ? " " : "");
  }
  return undefined;
}

export type LocalStructureOptions = {
  template: Template;
  detail?: Detail;
};

export function structureLocally(input: string, options: LocalStructureOptions): NoteStructure {
  const text = cleanText(input, 50_000, { multiline: true });
  const lang = detectLanguage(text);
  const budget = DETAIL_BUDGET[options.detail ?? "standard"];

  let blocks = toBlocks(text, lang);
  let title: string | undefined;
  if (blocks.length > 0 && blocks[0].heading) {
    title = blocks[0].heading;
    blocks[0] = { body: blocks[0].body };
  }
  if (!title) {
    const first = splitSentences(blocks[0]?.body ?? text)[0] ?? text;
    title = truncate(first.replace(/[。！？!?.;；]$/, ""), lang === "zh" ? 18 : 48);
  }
  blocks = mergeBlocks(blocks, budget.sections);

  const keywords = extractKeywords(text, budget.cues + 2);
  const sections = blocks.map((block) => {
    const content = takeSentences(block.body, budget.chars);
    return {
      heading: block.heading ?? "",
      content,
      highlights: pickHighlights(content, keywords),
    };
  });

  const body = blocks.map((b) => b.body).join("\n");
  const clauses = splitClauses(body);
  const cueTerms = keywords.length > 0 ? keywords : sections.map((s) => s.heading).filter(Boolean);
  const cues = cueTerms.slice(0, budget.cues).map((keyword) => {
    const lower = keyword.toLowerCase();
    // 优先选择除关键词本身外还有信息量的句段
    const clause =
      clauses.find((c) => c.toLowerCase().includes(lower) && Array.from(c).length > Array.from(keyword).length + 3) ??
      clauses.find((c) => c.toLowerCase().includes(lower)) ??
      "";
    return { keyword, note: truncate(clause, 36) };
  });

  // 抽取式摘要：选出包含最多高频关键词的句子
  const top = keywords.slice(0, 3);
  const sentences = splitSentences(body).filter((s) => Array.from(s).length >= 6);
  let lead = sentences[0] ?? "";
  let best = -1;
  for (const sentence of sentences) {
    const lowerSentence = sentence.toLowerCase();
    const score = keywords.reduce((n, k) => n + (lowerSentence.includes(k.toLowerCase()) ? 1 : 0), 0);
    if (score > best) {
      best = score;
      lead = sentence;
    }
  }
  lead = truncate(lead, 80);
  const summary =
    lang === "zh"
      ? `${lead}${top.length ? `\n要点围绕「${top.join("」「")}」展开。` : ""}`
      : `${lead}${top.length ? `\nKey ideas: ${top.join(", ")}.` : ""}`;

  const result = normalizeNoteStructure({
    title,
    date: findDate(text),
    cues,
    sections,
    summary,
    doodlePrompt: top[0] ? (lang === "zh" ? `与「${top[0]}」相关的手绘小插图` : `a doodle about ${top[0]}`) : "",
    doodleTheme: inferDoodleTheme(text) ?? TEMPLATE_DEFAULT_THEME[options.template],
  });
  if (result.ok) return result.value;
  // 极端输入（例如只有符号）时仍返回一个合法的最小结构
  return {
    title: truncate(text, 20) || "未命名笔记",
    cues: [],
    sections: [{ content: truncate(text, budget.chars) || "（空）", highlights: [] }],
    summary: "",
    doodleTheme: TEMPLATE_DEFAULT_THEME[options.template],
  };
}
