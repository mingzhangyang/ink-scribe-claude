import type { NoteStructure } from "../shared/note.ts";
import type { Template } from "../shared/options.ts";
import type { Locale } from "./state/preferences.ts";

export const SAMPLE_TEXTS: Array<{ id: string; label: Record<Locale, string>; template: Template; text: string }> = [
  {
    id: "zh-reading",
    label: { zh: "读书摘抄 ·《深度工作》", en: "Reading notes · Deep Work (Chinese)" },
    template: "reading-notes",
    text: `《深度工作》读书笔记

卡尔·纽波特把“深度工作”定义为：在无干扰的状态下专注进行职业活动，使个人的认知能力达到极限。这种努力能够创造新价值，提升技能，而且难以复制。与之相对的是“浮浅工作”——对认知要求不高的事务性任务，往往在受到干扰的情况下开展，不会为世界创造太多新价值，且容易复制。

作者认为，在新经济中有三类人会脱颖而出：能够与智能机器高效协作的人、在某个领域做到顶尖的人，以及拥有资本的人。而要快速掌握复杂的事物、并在质量和速度上产出精英水平的成果，都离不开深度工作的能力。

注意力残留：当你从任务 A 切换到任务 B 时，你的注意力并不会立即跟过去，一部分注意力仍停留在任务 A 上。频繁查看邮件和消息，会让我们长期处于注意力残留的低效状态。

书中给出的四条准则：工作要深入；拥抱无聊；远离社交媒体；摒弃浮浅。其中“拥抱无聊”是指不要一感到无聊就立刻掏出手机，专注力就像肌肉，需要刻意训练。

我的思考：与其追求“看起来很忙”，不如每天为自己留出两段不被打扰的整块时间，并把最重要的事情放进去。`,
  },
  {
    id: "zh-meeting",
    label: { zh: "会议纪要 · 产品周会", en: "Meeting minutes · product sync (Chinese)" },
    template: "meeting-minutes",
    text: `2024年5月20日 产品周会

参会：王敏（产品）、李响（前端）、陈思（后端）、赵琳（设计）

一、上周进度
导出功能已完成 PNG 下载，剪贴板复制在 Safari 上仍有兼容问题。手写字体加载时间偏长，首屏平均 2.8 秒。

二、讨论
赵琳提出纸张纹理在牛皮纸上对比度不够，建议墨水默认改为碳素黑。陈思认为 AI 接口需要增加超时与重试，避免用户长时间等待。大家一致同意先做字体按需加载，再优化动画。

三、结论与待办
1. 李响：本周五前修复 Safari 剪贴板问题，并提供下载兜底。
2. 陈思：为整理接口增加 45 秒超时和一次自动修复重试。
3. 赵琳：输出牛皮纸配色的新版视觉稿。
4. 王敏：整理用户反馈，下周一同步优先级。`,
  },
  {
    id: "en-lecture",
    label: { zh: "课程总结 · 间隔重复（英文）", en: "Lecture · Spaced Repetition" },
    template: "lecture-summary",
    text: `Lecture 4: How Memory Works — Spaced Repetition and Active Recall

The forgetting curve, first described by Hermann Ebbinghaus in 1885, shows that newly learned information decays rapidly: without review, we may forget more than half of it within a day.

Spaced repetition counters the forgetting curve by scheduling reviews at increasing intervals — for example after 1 day, 3 days, 7 days and 21 days. Each successful review flattens the curve, so the next review can wait longer.

Active recall means retrieving information from memory instead of re-reading it. Testing yourself with flashcards or blank-page summaries feels harder, but this "desirable difficulty" is exactly what strengthens long-term retention.

Combining both techniques is the most efficient strategy: use active recall as the review method, and spaced repetition to decide when to review.

Takeaway for the exam: plan short daily review sessions rather than one long cramming session the night before.`,
  },
];

export const SAMPLE_NOTE: NoteStructure = {
  title: "深度工作：专注是稀缺的超能力",
  date: "读书笔记",
  cues: [
    { keyword: "深度工作", note: "无干扰、认知能力达到极限" },
    { keyword: "浮浅工作", note: "事务性任务，易被复制" },
    { keyword: "注意力残留", note: "切换任务的隐形成本" },
    { keyword: "拥抱无聊", note: "专注力像肌肉，需要训练" },
  ],
  sections: [
    {
      heading: "两种工作",
      content: "深度工作在无干扰状态下进行，能创造新价值、提升技能且难以复制；浮浅工作对认知要求不高，常在被打断时完成，容易被替代。",
      highlights: ["难以复制", "容易被替代"],
    },
    {
      heading: "为什么重要",
      content: "新经济中，能与智能机器协作的人、领域顶尖的人更容易脱颖而出。\n- 快速掌握复杂事物\n- 在质量与速度上产出精英水平的成果",
      highlights: ["领域顶尖"],
    },
    {
      heading: "四条准则",
      content: "1. 工作要深入\n2. 拥抱无聊\n3. 远离社交媒体\n4. 摒弃浮浅",
      highlights: ["拥抱无聊"],
    },
  ],
  summary: "与其追求“看起来很忙”，不如每天留出两段不被打扰的整块时间，把最重要的事情放进去。",
  doodlePrompt: "一盏亮着的台灯照在摊开的书上",
  doodleTheme: "lightbulb",
};

/** 英文界面首次打开时展示的示例笔记。 */
export const SAMPLE_NOTE_EN: NoteStructure = {
  title: "How Memory Works: Spaced Repetition",
  date: "Lecture 4",
  cues: [
    { keyword: "Forgetting curve", note: "Ebbinghaus, 1885" },
    { keyword: "Spaced repetition", note: "Review at growing intervals" },
    { keyword: "Active recall", note: "Retrieve, don't re-read" },
    { keyword: "Desirable difficulty", note: "Harder now, stronger later" },
  ],
  sections: [
    {
      heading: "Why we forget",
      content: "Newly learned information decays fast: without review, we may forget more than half of it within a day.",
      highlights: ["more than half"],
    },
    {
      heading: "Spaced repetition",
      content: "Schedule reviews at increasing intervals:\n- after 1 day\n- after 3 days\n- after 7 and 21 days\nEach successful review flattens the curve.",
      highlights: ["increasing intervals"],
    },
    {
      heading: "Active recall",
      content: "Test yourself with flashcards or blank-page summaries instead of re-reading. It feels harder, but that is what builds long-term memory.",
      highlights: ["Test yourself"],
    },
  ],
  summary: "Use active recall as the review method and spaced repetition to decide when to review: short daily sessions beat one long cram.",
  doodlePrompt: "a brain with a calendar of review dates",
  doodleTheme: "brain",
};
