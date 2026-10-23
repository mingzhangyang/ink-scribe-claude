import type { Template } from "./options.ts";

/**
 * 内置插图主题。模型只能从这个枚举中选择，客户端用经过审核的内置 SVG 绘制，
 * 因此不会把模型生成的任意 SVG 注入页面。
 */
export const DOODLE_THEMES = [
  "lightbulb",
  "book",
  "coffee",
  "rocket",
  "brain",
  "heart",
  "clock",
  "target",
  "chart",
  "leaf",
  "pencil",
  "globe",
  "magnifier",
  "puzzle",
  "mountain",
  "chat",
  "calendar",
  "music",
  "star",
  "sun",
] as const;
export type DoodleTheme = (typeof DOODLE_THEMES)[number];

export const DOODLE_THEME_LABELS: Record<DoodleTheme, string> = {
  lightbulb: "灯泡·灵感",
  book: "书本·阅读",
  coffee: "咖啡·休憩",
  rocket: "火箭·增长",
  brain: "大脑·思考",
  heart: "爱心·情感",
  clock: "时钟·时间",
  target: "靶心·目标",
  chart: "图表·数据",
  leaf: "叶子·自然",
  pencil: "铅笔·写作",
  globe: "地球·世界",
  magnifier: "放大镜·研究",
  puzzle: "拼图·问题",
  mountain: "山峰·挑战",
  chat: "对话·讨论",
  calendar: "日历·计划",
  music: "音符·艺术",
  star: "星星·亮点",
  sun: "太阳·生活",
};

const THEME_KEYWORDS: Record<DoodleTheme, string[]> = {
  lightbulb: ["灵感", "想法", "创意", "点子", "启发", "idea", "insight", "inspiration", "creative"],
  book: ["书", "阅读", "作者", "章节", "小说", "摘抄", "book", "read", "author", "chapter", "novel"],
  coffee: ["咖啡", "休息", "下午茶", "coffee", "break", "cafe"],
  rocket: ["增长", "启动", "发布", "创业", "上线", "突破", "launch", "growth", "startup", "scale"],
  brain: ["思考", "认知", "大脑", "记忆", "学习", "心理", "思维", "think", "brain", "memory", "learn", "cognitive", "mind"],
  heart: ["爱", "情感", "健康", "幸福", "感恩", "love", "emotion", "health", "happiness", "grateful"],
  clock: ["时间", "效率", "截止", "拖延", "习惯", "time", "deadline", "habit", "productivity"],
  target: ["目标", "计划", "策略", "定位", "goal", "plan", "target", "objective", "strategy"],
  chart: ["数据", "统计", "收入", "销售", "指标", "增长率", "百分", "data", "revenue", "metric", "sales", "statistic"],
  leaf: ["自然", "环境", "植物", "生态", "绿色", "nature", "environment", "plant", "climate", "ecology"],
  pencil: ["写作", "笔记", "记录", "写", "文章", "writing", "note", "essay", "journal"],
  globe: ["世界", "全球", "国际", "旅行", "文化", "历史", "world", "global", "travel", "culture", "history"],
  magnifier: ["研究", "分析", "调查", "实验", "论文", "research", "analysis", "study", "experiment", "paper"],
  puzzle: ["问题", "解决", "方案", "难点", "原因", "problem", "solution", "solve", "issue"],
  mountain: ["挑战", "坚持", "困难", "攀登", "毅力", "challenge", "persist", "difficult", "resilience"],
  chat: ["会议", "讨论", "沟通", "对话", "反馈", "meeting", "discussion", "feedback", "conversation", "team"],
  calendar: ["日期", "周计划", "安排", "日程", "季度", "calendar", "schedule", "agenda", "quarter", "week"],
  music: ["音乐", "艺术", "歌", "绘画", "电影", "music", "art", "song", "movie", "painting"],
  star: ["重点", "亮点", "成就", "优秀", "highlight", "achievement", "key", "best"],
  sun: ["生活", "早晨", "阳光", "日常", "旅程", "life", "morning", "daily", "sunshine"],
};

export const TEMPLATE_DEFAULT_THEME: Record<Template, DoodleTheme> = {
  general: "star",
  "reading-notes": "book",
  "meeting-minutes": "chat",
  "lecture-summary": "brain",
  "idea-fragments": "lightbulb",
};

/** 基于关键词命中次数推断插图主题；没有命中时返回 undefined。 */
export function inferDoodleTheme(text: string): DoodleTheme | undefined {
  const haystack = text.toLowerCase();
  let best: DoodleTheme | undefined;
  let bestScore = 0;
  for (const theme of DOODLE_THEMES) {
    let score = 0;
    for (const keyword of THEME_KEYWORDS[theme]) {
      const isLatin = /^[a-z]+$/.test(keyword);
      const pattern = isLatin ? new RegExp(`\\b${keyword}`, "g") : new RegExp(keyword, "g");
      score += haystack.match(pattern)?.length ?? 0;
    }
    if (score > bestScore) {
      best = theme;
      bestScore = score;
    }
  }
  return best;
}
