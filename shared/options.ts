/** 前后端共享的枚举选项。API 校验与界面选项都从这里派生，避免两边不一致。 */

export const TEMPLATES = [
  "general",
  "reading-notes",
  "meeting-minutes",
  "lecture-summary",
  "idea-fragments",
] as const;
export type Template = (typeof TEMPLATES)[number];

export const TEMPLATE_LABELS: Record<Template, string> = {
  general: "通用整理",
  "reading-notes": "读书摘抄",
  "meeting-minutes": "会议纪要",
  "lecture-summary": "课程总结",
  "idea-fragments": "思想碎片",
};

/** Shared with the English interface, published-note chrome, and crawler HTML. */
export const TEMPLATE_LABELS_EN: Record<Template, string> = {
  general: "General",
  "reading-notes": "Reading notes",
  "meeting-minutes": "Meeting minutes",
  "lecture-summary": "Lecture summary",
  "idea-fragments": "Idea fragments",
};

export const LANGUAGES = ["auto", "zh", "en"] as const;
export type Language = (typeof LANGUAGES)[number];

export const LANGUAGE_LABELS: Record<Language, string> = {
  auto: "跟随原文",
  zh: "中文",
  en: "English",
};

export const STYLES = ["hybrid-cornell", "classic-cornell", "free-journal", "minimal"] as const;
export type NoteStyle = (typeof STYLES)[number];

export const STYLE_LABELS: Record<NoteStyle, string> = {
  "hybrid-cornell": "混合康奈尔手账",
  "classic-cornell": "经典康奈尔",
  "free-journal": "自由手账",
  minimal: "简约手札",
};

export const DETAILS = ["concise", "standard", "detailed"] as const;
export type Detail = (typeof DETAILS)[number];

export const DETAIL_LABELS: Record<Detail, string> = {
  concise: "精简",
  standard: "标准",
  detailed: "详细",
};

export function isOneOf<T extends string>(values: readonly T[], value: unknown): value is T {
  return typeof value === "string" && (values as readonly string[]).includes(value);
}

/** Published-note template labels follow the content language, not the visitor's interface preference. */
export function templateLabel(value: string, locale: "zh" | "en"): string | undefined {
  return isOneOf(TEMPLATES, value) ? (locale === "en" ? TEMPLATE_LABELS_EN : TEMPLATE_LABELS)[value] : undefined;
}
