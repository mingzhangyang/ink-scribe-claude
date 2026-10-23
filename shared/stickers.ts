import { normalizeDoodleSpec, type DoodleSpec } from "./doodle.ts";
import { DOODLE_THEMES, type DoodleTheme } from "./themes.ts";

// 新类型只能追加在末尾：OpenAPI 的 oneOf 按此顺序生成
export const STICKER_TYPES = [
  "tape", "sticky-note", "paperclip", "star", "coffee-stain", "custom-doodle",
  "masking-tape", "binder-clip", "push-pin", "staple", "photo-corner",
  "page-flag", "torn-paper", "kraft-tag", "ticket-stub", "postage-stamp", "dog-ear", "ribbon-bookmark",
  "arrow", "circle-mark", "wavy-underline", "bracket", "check", "cross", "exclaim", "question",
  "seal", "postmark", "ink-blot", "paw-print",
  "sparkles", "heart", "face", "pressed-flower",
  "orange", "apple", "banana", "strawberry", "mango", "watermelon", "grape",
  "pi", "pythagorean", "euler", "integral", "sigma", "sqrt", "infinity", "sine-wave",
  "bell-curve", "emc2", "fma", "ohm", "h2o", "co2", "nacl", "glucose-formula",
  "benzene", "water-molecule", "glucose-ring", "dna", "alpha-helix", "antibody", "trna",
  "atom", "magnet", "lens", "circuit", "beaker", "flask", "microscope",
  "greek-alpha", "greek-beta", "greek-gamma", "greek-delta", "greek-epsilon", "greek-theta",
  "greek-lambda", "greek-mu", "greek-pi", "greek-sigma", "greek-phi", "greek-omega",
  "greek-capital-delta", "greek-capital-sigma", "greek-capital-omega",
  "car", "train", "bullet-train", "ship", "sailboat",
  "airplane", "rocket", "starship", "satellite",
  "sun", "earth", "moon", "saturn", "jupiter",
  "comet", "galaxy", "black-hole", "big-dipper", "astronaut",
  "bird", "hedgehog", "dog", "chili", "detective",
  "hang", "geili", "tongyi", "zhixingheyi",
  "zhengnengliang", "yyds", "juan", "tangping", "wanmei", "tainiule", "zan",
  "letter-y", "wang",
] as const;
export type StickerType = (typeof STICKER_TYPES)[number];
/** 装饰贴纸：除手绘插图外，外观由 variant 在 STICKER_VARIANTS 中选择。 */
export type DecorStickerType = Exclude<StickerType, "custom-doodle">;

/**
 * 贴纸使用画布内部坐标系（宽 840）。x/y 为贴纸中心点，rotation 单位为度，
 * 预览与导出共用同一份 DOM，因此缩放和旋转在导出时保持一致。
 */
export type StickerItem = {
  id: string;
  type: StickerType;
  x: number;
  y: number;
  rotation: number;
  scale: number;
  /** 颜色或样式变体；custom-doodle 时为内置插图主题。 */
  variant?: string;
  /** AI 生成的插图（已校验的受限图元）。 */
  doodle?: DoodleSpec;
  /** 水平镜像，让箭头、交通工具等朝向另一边；缺省为不翻转。 */
  flip?: boolean;
};

export const STICKER_LABELS: Record<StickerType, string> = {
  tape: "和纸胶带",
  "sticky-note": "便利贴",
  paperclip: "回形针",
  star: "星星",
  "coffee-stain": "咖啡渍",
  "custom-doodle": "手绘插图",
  "masking-tape": "美纹纸",
  "binder-clip": "长尾夹",
  "push-pin": "图钉",
  staple: "订书钉",
  "photo-corner": "相角",
  "page-flag": "索引贴",
  "torn-paper": "撕纸片",
  "kraft-tag": "吊牌",
  "ticket-stub": "票根",
  "postage-stamp": "邮票",
  "dog-ear": "折角",
  "ribbon-bookmark": "丝带书签",
  arrow: "手绘箭头",
  "circle-mark": "圈注",
  "wavy-underline": "波浪线",
  bracket: "大括号",
  check: "对勾",
  cross: "叉号",
  exclaim: "感叹号",
  question: "问号",
  seal: "朱文印章",
  postmark: "邮戳",
  "ink-blot": "墨渍",
  "paw-print": "猫爪印",
  sparkles: "闪光",
  heart: "爱心",
  face: "表情",
  "pressed-flower": "压花",
  orange: "橙子",
  apple: "苹果",
  banana: "香蕉",
  strawberry: "草莓",
  mango: "芒果",
  watermelon: "西瓜",
  grape: "葡萄",
  pi: "圆周率",
  pythagorean: "勾股定理",
  euler: "欧拉恒等式",
  integral: "积分",
  sigma: "求和",
  sqrt: "根号",
  infinity: "无穷",
  "sine-wave": "正弦曲线",
  "bell-curve": "正态分布",
  emc2: "质能方程",
  fma: "牛顿第二定律",
  ohm: "欧姆定律",
  h2o: "水",
  co2: "二氧化碳",
  nacl: "氯化钠",
  "glucose-formula": "葡萄糖分子式",
  benzene: "苯环",
  "water-molecule": "水分子",
  "glucose-ring": "葡萄糖结构式",
  dna: "DNA 双螺旋",
  "alpha-helix": "α 螺旋",
  antibody: "抗体",
  trna: "tRNA",
  atom: "原子模型",
  magnet: "磁铁",
  lens: "凸透镜",
  circuit: "电路",
  beaker: "烧杯",
  flask: "锥形瓶",
  microscope: "显微镜",
  "greek-alpha": "α 阿尔法",
  "greek-beta": "β 贝塔",
  "greek-gamma": "γ 伽马",
  "greek-delta": "δ 德尔塔",
  "greek-epsilon": "ε 艾普西隆",
  "greek-theta": "θ 西塔",
  "greek-lambda": "λ 兰布达",
  "greek-mu": "μ 缪",
  "greek-pi": "π 派",
  "greek-sigma": "σ 西格玛",
  "greek-phi": "φ 斐",
  "greek-omega": "ω 欧米伽",
  "greek-capital-delta": "Δ 大写德尔塔",
  "greek-capital-sigma": "Σ 大写西格玛",
  "greek-capital-omega": "Ω 大写欧米伽",
  car: "汽车",
  train: "火车",
  "bullet-train": "高铁",
  ship: "轮船",
  sailboat: "帆船",
  airplane: "飞机",
  rocket: "火箭",
  starship: "星舰",
  satellite: "卫星",
  sun: "太阳",
  earth: "地球",
  moon: "月亮",
  saturn: "土星",
  jupiter: "木星",
  comet: "彗星",
  galaxy: "螺旋星系",
  "black-hole": "黑洞",
  "big-dipper": "北斗七星",
  astronaut: "宇航员",
  bird: "小鸟",
  hedgehog: "刺猬",
  dog: "小狗",
  chili: "辣椒",
  detective: "侦探",
  hang: "夯",
  geili: "给力",
  tongyi: "同意",
  zhixingheyi: "知行合一",
  zhengnengliang: "正能量",
  yyds: "YYDS",
  juan: "卷",
  tangping: "躺平",
  wanmei: "完美",
  tainiule: "太牛了",
  zan: "赞",
  "letter-y": "Y",
  wang: "王",
};

/** 贴纸面板按分类展示装饰贴纸；每种装饰贴纸恰好属于一个分类。 */
export const STICKER_CATEGORIES = ["fasten", "paper", "marks", "stamps", "mood", "fruit", "animals", "people", "phrases", "formulas", "greek", "science", "vehicles", "space"] as const;
export type StickerCategory = (typeof STICKER_CATEGORIES)[number];

export const STICKER_CATEGORY_LABELS: Record<StickerCategory, string> = {
  fasten: "胶带夹子",
  paper: "纸品标签",
  marks: "标注符号",
  stamps: "印章痕迹",
  mood: "心情点缀",
  fruit: "果蔬",
  animals: "动物",
  people: "人物",
  phrases: "流行语",
  formulas: "公式",
  greek: "希腊字母",
  science: "科学图示",
  vehicles: "交通工具",
  space: "宇宙",
};

export const STICKER_CATEGORY_TYPES: Record<StickerCategory, readonly DecorStickerType[]> = {
  fasten: ["tape", "masking-tape", "paperclip", "binder-clip", "push-pin", "staple", "photo-corner"],
  paper: ["sticky-note", "page-flag", "torn-paper", "kraft-tag", "ticket-stub", "postage-stamp", "dog-ear", "ribbon-bookmark"],
  marks: ["arrow", "circle-mark", "wavy-underline", "bracket", "check", "cross", "exclaim", "question"],
  stamps: ["seal", "postmark", "ink-blot", "coffee-stain", "paw-print"],
  mood: ["star", "sparkles", "heart", "face", "pressed-flower"],
  fruit: ["orange", "apple", "banana", "strawberry", "mango", "watermelon", "grape", "chili"],
  animals: ["bird", "hedgehog", "dog"],
  people: ["detective"],
  phrases: [
    "hang", "juan", "zan", "wang", "geili", "tangping", "zhengnengliang", "tainiule", "yyds", "letter-y",
    "wanmei", "tongyi", "zhixingheyi",
  ],
  formulas: [
    "pi", "pythagorean", "euler", "integral", "sigma", "sqrt", "infinity", "sine-wave",
    "bell-curve", "emc2", "fma", "ohm", "h2o", "co2", "nacl", "glucose-formula",
  ],
  greek: [
    "greek-alpha", "greek-beta", "greek-gamma", "greek-delta", "greek-epsilon", "greek-theta",
    "greek-lambda", "greek-mu", "greek-pi", "greek-sigma", "greek-phi", "greek-omega",
    "greek-capital-delta", "greek-capital-sigma", "greek-capital-omega",
  ],
  science: [
    "benzene", "water-molecule", "glucose-ring", "dna", "alpha-helix", "antibody", "trna",
    "atom", "magnet", "lens", "circuit", "beaker", "flask", "microscope",
  ],
  vehicles: [
    "car", "train", "bullet-train", "ship", "sailboat",
    "airplane", "rocket", "starship", "satellite",
  ],
  space: [
    "sun", "earth", "moon", "saturn", "jupiter",
    "comet", "galaxy", "black-hole", "big-dipper", "astronaut",
  ],
};

export const STICKER_SIZES: Record<StickerType, { w: number; h: number }> = {
  tape: { w: 150, h: 38 },
  "sticky-note": { w: 120, h: 120 },
  paperclip: { w: 36, h: 96 },
  star: { w: 64, h: 64 },
  "coffee-stain": { w: 170, h: 170 },
  "custom-doodle": { w: 120, h: 120 },
  "masking-tape": { w: 150, h: 34 },
  "binder-clip": { w: 64, h: 84 },
  "push-pin": { w: 40, h: 44 },
  staple: { w: 60, h: 16 },
  "photo-corner": { w: 56, h: 56 },
  "page-flag": { w: 96, h: 28 },
  "torn-paper": { w: 180, h: 124 },
  "kraft-tag": { w: 72, h: 120 },
  "ticket-stub": { w: 156, h: 66 },
  "postage-stamp": { w: 72, h: 88 },
  "dog-ear": { w: 72, h: 72 },
  "ribbon-bookmark": { w: 34, h: 150 },
  arrow: { w: 140, h: 80 },
  "circle-mark": { w: 170, h: 84 },
  "wavy-underline": { w: 160, h: 22 },
  bracket: { w: 32, h: 140 },
  check: { w: 56, h: 56 },
  cross: { w: 50, h: 50 },
  exclaim: { w: 44, h: 44 },
  question: { w: 44, h: 44 },
  seal: { w: 72, h: 72 },
  postmark: { w: 160, h: 84 },
  "ink-blot": { w: 120, h: 120 },
  "paw-print": { w: 64, h: 64 },
  sparkles: { w: 64, h: 64 },
  heart: { w: 60, h: 56 },
  face: { w: 64, h: 64 },
  "pressed-flower": { w: 96, h: 96 },
  orange: { w: 72, h: 72 },
  apple: { w: 68, h: 74 },
  banana: { w: 96, h: 64 },
  strawberry: { w: 60, h: 70 },
  mango: { w: 84, h: 64 },
  watermelon: { w: 96, h: 72 },
  grape: { w: 64, h: 72 },
  pi: { w: 64, h: 64 },
  pythagorean: { w: 150, h: 48 },
  euler: { w: 140, h: 48 },
  integral: { w: 124, h: 56 },
  sigma: { w: 92, h: 80 },
  sqrt: { w: 72, h: 56 },
  infinity: { w: 84, h: 48 },
  "sine-wave": { w: 140, h: 90 },
  "bell-curve": { w: 140, h: 80 },
  emc2: { w: 120, h: 48 },
  fma: { w: 110, h: 44 },
  ohm: { w: 110, h: 44 },
  h2o: { w: 90, h: 48 },
  co2: { w: 90, h: 48 },
  nacl: { w: 100, h: 44 },
  "glucose-formula": { w: 150, h: 48 },
  benzene: { w: 80, h: 80 },
  "water-molecule": { w: 96, h: 76 },
  "glucose-ring": { w: 112, h: 92 },
  dna: { w: 72, h: 132 },
  "alpha-helix": { w: 124, h: 72 },
  antibody: { w: 80, h: 100 },
  trna: { w: 88, h: 112 },
  atom: { w: 92, h: 92 },
  magnet: { w: 112, h: 84 },
  lens: { w: 124, h: 84 },
  circuit: { w: 112, h: 84 },
  beaker: { w: 76, h: 88 },
  flask: { w: 76, h: 92 },
  microscope: { w: 84, h: 104 },
  "greek-alpha": { w: 56, h: 56 },
  "greek-beta": { w: 56, h: 56 },
  "greek-gamma": { w: 56, h: 56 },
  "greek-delta": { w: 56, h: 56 },
  "greek-epsilon": { w: 56, h: 56 },
  "greek-theta": { w: 56, h: 56 },
  "greek-lambda": { w: 56, h: 56 },
  "greek-mu": { w: 56, h: 56 },
  "greek-pi": { w: 56, h: 56 },
  "greek-sigma": { w: 56, h: 56 },
  "greek-phi": { w: 56, h: 56 },
  "greek-omega": { w: 56, h: 56 },
  "greek-capital-delta": { w: 56, h: 56 },
  "greek-capital-sigma": { w: 56, h: 56 },
  "greek-capital-omega": { w: 56, h: 56 },
  car: { w: 112, h: 60 },
  train: { w: 120, h: 72 },
  "bullet-train": { w: 140, h: 56 },
  ship: { w: 130, h: 80 },
  sailboat: { w: 96, h: 96 },
  airplane: { w: 130, h: 70 },
  rocket: { w: 64, h: 110 },
  starship: { w: 56, h: 140 },
  satellite: { w: 110, h: 80 },
  sun: { w: 88, h: 88 },
  earth: { w: 84, h: 84 },
  moon: { w: 80, h: 80 },
  saturn: { w: 120, h: 72 },
  jupiter: { w: 84, h: 84 },
  comet: { w: 120, h: 72 },
  galaxy: { w: 100, h: 100 },
  "black-hole": { w: 110, h: 80 },
  "big-dipper": { w: 120, h: 52 },
  astronaut: { w: 80, h: 100 },
  bird: { w: 96, h: 90 },
  hedgehog: { w: 100, h: 70 },
  dog: { w: 92, h: 102 },
  chili: { w: 84, h: 96 },
  detective: { w: 84, h: 96 },
  hang: { w: 72, h: 72 },
  geili: { w: 110, h: 66 },
  tongyi: { w: 100, h: 56 },
  zhixingheyi: { w: 80, h: 80 },
  zhengnengliang: { w: 140, h: 62 },
  yyds: { w: 120, h: 70 },
  juan: { w: 72, h: 72 },
  tangping: { w: 110, h: 66 },
  wanmei: { w: 100, h: 64 },
  tainiule: { w: 140, h: 62 },
  zan: { w: 72, h: 72 },
  "letter-y": { w: 64, h: 72 },
  wang: { w: 72, h: 72 },
};

/** 胶带花纹（dots / checks / stripes）与纸片格线（grid / lines）。 */
export type StickerPattern = "dots" | "checks" | "stripes" | "grid" | "lines";

/**
 * color 为 "ink" 时跟随笔记墨水色，为 "paper" 时跟随纸张底色。
 * 表情、压花、水果等贴纸的变体同时决定形状，color 是该款式的主色。
 */
export type StickerVariant = { id: string; label: string; color: string; pattern?: StickerPattern };

const INK_VARIANTS = {
  ink: { id: "ink", label: "墨色", color: "ink" },
  red: { id: "red", label: "红笔", color: "#DC2626" },
  blue: { id: "blue", label: "蓝笔", color: "#2563EB" },
  green: { id: "green", label: "绿笔", color: "#16A34A" },
} as const satisfies Record<string, StickerVariant>;

/** 公式与希腊字母：和标注符号一样用笔的颜色。 */
const PEN_VARIANTS = [INK_VARIANTS.ink, INK_VARIANTS.red, INK_VARIANTS.blue] as const;

/** 科学图示、宇宙与多色简笔画：彩色款用 color 作代表色；墨线款不上色，只用墨水色勾线。 */
const scienceVariants = <C extends string>(color: C) =>
  [
    { id: "color", label: "彩色", color },
    { id: "ink", label: "墨线", color: "ink" },
  ] as const;

/** “夯”“给力”这类贴纸字的颜色。 */
const SLANG_VARIANTS = [
  { id: "red", label: "红", color: "#EF4444" },
  { id: "orange", label: "橙", color: "#F97316" },
  { id: "purple", label: "紫", color: "#8B5CF6" },
  { id: "ink", label: "墨色", color: "ink" },
] as const satisfies readonly StickerVariant[];

/** “同意”“完美”这类印章的印泥颜色。 */
const STAMP_VARIANTS = [
  { id: "red", label: "朱红", color: "#C0392B" },
  { id: "blue", label: "蓝", color: "#1D4ED8" },
] as const satisfies readonly StickerVariant[];

const BADGE_VARIANTS = [
  { id: "red", label: "红", color: "#EF4444" },
  { id: "yellow", label: "黄", color: "#FACC15" },
  { id: "blue", label: "蓝", color: "#3B82F6" },
] as const satisfies readonly StickerVariant[];

export const STICKER_VARIANTS = {
  tape: [
    { id: "yellow", label: "柠檬", color: "#FDE68A" },
    { id: "mint", label: "薄荷", color: "#A7F3D0" },
    { id: "pink", label: "樱粉", color: "#FBCFE8" },
    { id: "blue", label: "雾蓝", color: "#BFDBFE" },
    { id: "kraft", label: "牛皮", color: "#D6B98C" },
    { id: "dots", label: "波点", color: "#F9A8D4", pattern: "dots" },
    { id: "checks", label: "格纹", color: "#93C5FD", pattern: "checks" },
    { id: "stripes", label: "条纹", color: "#6EE7B7", pattern: "stripes" },
  ],
  "sticky-note": [
    { id: "yellow", label: "黄", color: "#FEF08A" },
    { id: "green", label: "绿", color: "#BBF7D0" },
    { id: "orange", label: "橙", color: "#FED7AA" },
    { id: "blue", label: "蓝", color: "#BFDBFE" },
  ],
  paperclip: [
    { id: "silver", label: "银", color: "#9CA3AF" },
    { id: "gold", label: "金", color: "#CA8A04" },
    { id: "red", label: "红", color: "#DC2626" },
  ],
  star: [
    { id: "gold", label: "金色", color: "#FACC15" },
    { id: "ink", label: "手绘", color: "ink" },
  ],
  "coffee-stain": [
    { id: "coffee", label: "咖啡", color: "rgba(120, 72, 30, 0.32)" },
    { id: "tea", label: "茶渍", color: "rgba(146, 120, 40, 0.28)" },
  ],
  "masking-tape": [
    { id: "natural", label: "原色", color: "#E8DCC0" },
    { id: "white", label: "白", color: "#F4F2EE" },
    { id: "black", label: "黑", color: "#3F3F46" },
  ],
  "binder-clip": [
    { id: "black", label: "黑", color: "#27272A" },
    { id: "silver", label: "银", color: "#A1A1AA" },
    { id: "pink", label: "樱粉", color: "#F9A8D4" },
    { id: "mint", label: "薄荷", color: "#6EE7B7" },
    { id: "lilac", label: "丁香紫", color: "#C4B5FD" },
  ],
  "push-pin": [
    { id: "red", label: "红", color: "#DC2626" },
    { id: "blue", label: "蓝", color: "#2563EB" },
    { id: "yellow", label: "黄", color: "#EAB308" },
    { id: "white", label: "白", color: "#F5F5F4" },
  ],
  staple: [
    { id: "silver", label: "银", color: "#9CA3AF" },
    { id: "gold", label: "金", color: "#CA8A04" },
    { id: "pink", label: "粉", color: "#EC4899" },
  ],
  "photo-corner": [
    { id: "kraft", label: "牛皮", color: "#C8A27A" },
    { id: "black", label: "黑", color: "#27272A" },
    { id: "white", label: "白", color: "#F5F5F4" },
  ],
  "page-flag": [
    { id: "yellow", label: "黄", color: "#FDE047" },
    { id: "green", label: "绿", color: "#86EFAC" },
    { id: "orange", label: "橙", color: "#FDBA74" },
    { id: "blue", label: "蓝", color: "#93C5FD" },
    { id: "pink", label: "粉", color: "#F9A8D4" },
  ],
  "torn-paper": [
    { id: "grid", label: "方格", color: "#FCFAF5", pattern: "grid" },
    { id: "lined", label: "横线", color: "#FCFAF5", pattern: "lines" },
    { id: "kraft", label: "牛皮", color: "#D6B98C" },
  ],
  "kraft-tag": [
    { id: "kraft", label: "牛皮", color: "#D6B98C" },
    { id: "white", label: "白", color: "#FAF8F3" },
    { id: "pink", label: "樱粉", color: "#F9C6D8" },
  ],
  "ticket-stub": [
    { id: "cream", label: "奶油", color: "#FEF3C7" },
    { id: "pink", label: "粉", color: "#FBCFE8" },
    { id: "blue", label: "蓝", color: "#BFDBFE" },
  ],
  "postage-stamp": [
    { id: "blue", label: "蓝", color: "#3B82F6" },
    { id: "red", label: "红", color: "#EF4444" },
    { id: "green", label: "绿", color: "#22A06B" },
  ],
  "dog-ear": [
    { id: "paper", label: "同纸色", color: "paper" },
    { id: "white", label: "白", color: "#FFFFFF" },
    { id: "kraft", label: "牛皮", color: "#D6B98C" },
  ],
  "ribbon-bookmark": [
    { id: "red", label: "酒红", color: "#B91C1C" },
    { id: "navy", label: "藏青", color: "#1E3A8A" },
    { id: "green", label: "墨绿", color: "#166534" },
  ],
  arrow: [INK_VARIANTS.ink, INK_VARIANTS.red, INK_VARIANTS.blue],
  "circle-mark": [INK_VARIANTS.red, INK_VARIANTS.ink, INK_VARIANTS.blue],
  "wavy-underline": [INK_VARIANTS.red, INK_VARIANTS.ink, INK_VARIANTS.blue],
  bracket: [INK_VARIANTS.ink, INK_VARIANTS.red, INK_VARIANTS.blue],
  check: [INK_VARIANTS.green, INK_VARIANTS.ink, INK_VARIANTS.red],
  cross: [INK_VARIANTS.red, INK_VARIANTS.ink],
  exclaim: BADGE_VARIANTS,
  question: BADGE_VARIANTS,
  seal: [
    { id: "cinnabar", label: "朱砂", color: "#C0392B" },
    { id: "rouge", label: "胭脂", color: "#9F1239" },
  ],
  postmark: [
    { id: "black", label: "黑", color: "#1F2937" },
    { id: "blue", label: "蓝", color: "#1D4ED8" },
    { id: "red", label: "红", color: "#B91C1C" },
  ],
  "ink-blot": [
    { id: "carbon", label: "碳素黑", color: "#1C1917" },
    { id: "blue", label: "钢笔蓝", color: "#1E3A8A" },
    { id: "brown", label: "复古棕", color: "#451A03" },
  ],
  "paw-print": [
    { id: "ink", label: "墨色", color: "ink" },
    { id: "pink", label: "粉", color: "#F472B6" },
    { id: "brown", label: "棕", color: "#92400E" },
  ],
  sparkles: [
    { id: "gold", label: "金色", color: "#FACC15" },
    { id: "ink", label: "手绘", color: "ink" },
    { id: "pink", label: "粉", color: "#F472B6" },
  ],
  heart: [
    { id: "red", label: "红", color: "#EF4444" },
    { id: "pink", label: "粉", color: "#F9A8D4" },
    { id: "ink", label: "手绘", color: "ink" },
  ],
  face: [
    { id: "happy", label: "开心", color: "#FDE68A" },
    { id: "thinking", label: "思考", color: "#BFDBFE" },
    { id: "surprised", label: "惊讶", color: "#FBCFE8" },
  ],
  "pressed-flower": [
    { id: "sakura", label: "樱花", color: "#F9A8D4" },
    { id: "ginkgo", label: "银杏", color: "#EAB308" },
    { id: "maple", label: "枫叶", color: "#DC2626" },
    { id: "lavender", label: "薰衣草", color: "#A78BFA" },
  ],
  orange: [
    { id: "whole", label: "整个", color: "#F97316" },
    { id: "slice", label: "切片", color: "#FB923C" },
  ],
  apple: [
    { id: "red", label: "红苹果", color: "#DC2626" },
    { id: "green", label: "青苹果", color: "#84CC16" },
  ],
  banana: [
    { id: "single", label: "单根", color: "#FACC15" },
    { id: "bunch", label: "一串", color: "#FDE047" },
  ],
  strawberry: [
    { id: "whole", label: "整颗", color: "#EF4444" },
    { id: "half", label: "切半", color: "#F43F5E" },
  ],
  mango: [
    { id: "ripe", label: "金黄", color: "#F59E0B" },
    { id: "green", label: "青芒", color: "#A3E635" },
  ],
  watermelon: [
    { id: "slice", label: "瓜片", color: "#EF4444" },
    { id: "whole", label: "整个", color: "#16A34A" },
  ],
  grape: [
    { id: "purple", label: "紫葡萄", color: "#7C3AED" },
    { id: "green", label: "青提", color: "#A3E635" },
  ],
  pi: PEN_VARIANTS,
  pythagorean: PEN_VARIANTS,
  euler: PEN_VARIANTS,
  integral: PEN_VARIANTS,
  sigma: PEN_VARIANTS,
  sqrt: PEN_VARIANTS,
  infinity: PEN_VARIANTS,
  "sine-wave": PEN_VARIANTS,
  "bell-curve": PEN_VARIANTS,
  emc2: PEN_VARIANTS,
  fma: PEN_VARIANTS,
  ohm: PEN_VARIANTS,
  h2o: PEN_VARIANTS,
  co2: PEN_VARIANTS,
  nacl: PEN_VARIANTS,
  "glucose-formula": PEN_VARIANTS,
  benzene: scienceVariants("#0D9488"),
  "water-molecule": scienceVariants("#EF4444"),
  "glucose-ring": scienceVariants("#D97706"),
  dna: scienceVariants("#2563EB"),
  "alpha-helix": scienceVariants("#8B5CF6"),
  antibody: scienceVariants("#3B82F6"),
  trna: scienceVariants("#0EA5E9"),
  atom: scienceVariants("#3B82F6"),
  magnet: scienceVariants("#EF4444"),
  lens: scienceVariants("#0284C7"),
  circuit: scienceVariants("#FACC15"),
  beaker: scienceVariants("#60A5FA"),
  flask: scienceVariants("#34D399"),
  microscope: scienceVariants("#475569"),
  "greek-alpha": PEN_VARIANTS,
  "greek-beta": PEN_VARIANTS,
  "greek-gamma": PEN_VARIANTS,
  "greek-delta": PEN_VARIANTS,
  "greek-epsilon": PEN_VARIANTS,
  "greek-theta": PEN_VARIANTS,
  "greek-lambda": PEN_VARIANTS,
  "greek-mu": PEN_VARIANTS,
  "greek-pi": PEN_VARIANTS,
  "greek-sigma": PEN_VARIANTS,
  "greek-phi": PEN_VARIANTS,
  "greek-omega": PEN_VARIANTS,
  "greek-capital-delta": PEN_VARIANTS,
  "greek-capital-sigma": PEN_VARIANTS,
  "greek-capital-omega": PEN_VARIANTS,
  car: [
    { id: "red", label: "红", color: "#EF4444" },
    { id: "blue", label: "蓝", color: "#3B82F6" },
    { id: "yellow", label: "黄", color: "#FACC15" },
  ],
  train: [
    { id: "green", label: "绿", color: "#16A34A" },
    { id: "red", label: "红", color: "#DC2626" },
  ],
  "bullet-train": [
    { id: "blue", label: "蓝色涂装", color: "#2563EB" },
    { id: "red", label: "红色涂装", color: "#DC2626" },
  ],
  ship: [
    { id: "red", label: "红色船身", color: "#DC2626" },
    { id: "navy", label: "藏青船身", color: "#1E3A8A" },
  ],
  sailboat: [
    { id: "white", label: "白帆", color: "#F8FAFC" },
    { id: "red", label: "红帆", color: "#EF4444" },
  ],
  airplane: [
    { id: "blue", label: "蓝色尾翼", color: "#2563EB" },
    { id: "red", label: "红色尾翼", color: "#DC2626" },
  ],
  rocket: [
    { id: "red", label: "红", color: "#EF4444" },
    { id: "blue", label: "蓝", color: "#2563EB" },
  ],
  starship: [
    { id: "flight", label: "点火", color: "#F97316" },
    { id: "parked", label: "静置", color: "#CBD5E1" },
  ],
  satellite: [
    { id: "gold", label: "金色", color: "#EAB308" },
    { id: "silver", label: "银色", color: "#CBD5E1" },
  ],
  sun: scienceVariants("#FACC15"),
  earth: scienceVariants("#3B82F6"),
  moon: [
    { id: "crescent", label: "弯月", color: "#FDE68A" },
    { id: "full", label: "满月", color: "#E5E7EB" },
  ],
  saturn: scienceVariants("#F59E0B"),
  jupiter: scienceVariants("#D97706"),
  comet: scienceVariants("#93C5FD"),
  galaxy: scienceVariants("#8B5CF6"),
  "black-hole": scienceVariants("#F97316"),
  "big-dipper": [
    { id: "gold", label: "金色", color: "#FACC15" },
    { id: "ink", label: "墨线", color: "ink" },
  ],
  astronaut: scienceVariants("#94A3B8"),
  bird: scienceVariants("#F0468F"),
  hedgehog: scienceVariants("#F7941D"),
  dog: scienceVariants("#F9C22E"),
  chili: scienceVariants("#F0468F"),
  detective: scienceVariants("#1FB2BC"),
  hang: SLANG_VARIANTS,
  geili: SLANG_VARIANTS,
  tongyi: STAMP_VARIANTS,
  zhixingheyi: [
    { id: "zhuwen", label: "朱文", color: "#C0392B" },
    { id: "baiwen", label: "白文", color: "#A93226" },
  ],
  zhengnengliang: SLANG_VARIANTS,
  yyds: SLANG_VARIANTS,
  juan: SLANG_VARIANTS,
  tangping: SLANG_VARIANTS,
  wanmei: STAMP_VARIANTS,
  tainiule: SLANG_VARIANTS,
  zan: SLANG_VARIANTS,
  "letter-y": SLANG_VARIANTS,
  wang: SLANG_VARIANTS,
} as const satisfies Record<DecorStickerType, readonly StickerVariant[]>;

export type StickerVariantId<T extends DecorStickerType> = (typeof STICKER_VARIANTS)[T][number]["id"];

export function isDecorStickerType(value: string): value is DecorStickerType {
  return value !== "custom-doodle" && (STICKER_TYPES as readonly string[]).includes(value);
}

/** 按 ID 取变体；ID 缺省或无效时用该贴纸的第一个变体，与绘制时的兜底一致。 */
export function stickerVariant(type: DecorStickerType, id: string | undefined): StickerVariant {
  const variants: readonly StickerVariant[] = STICKER_VARIANTS[type];
  return variants.find((v) => v.id === id) ?? variants[0];
}

export function isDoodleTheme(value: string | undefined): value is DoodleTheme {
  return !!value && (DOODLE_THEMES as readonly string[]).includes(value);
}

export function newStickerId(): string {
  return `st_${Math.random().toString(36).slice(2, 10)}`;
}

export const MAX_STICKERS = 40;

/**
 * 校验贴纸列表（用于持久化的笔记与 API 输入）：只保留已知类型与字段，
 * 坐标、旋转与缩放钳制到合理范围，AI 插图贴纸的图元再次规范化。
 */
/** 贴纸纵坐标上限：远高于导出允许的长图高度（见 src/export/scale.ts）。 */
export const MAX_STICKER_Y = 100_000;

export function normalizeStickers(input: unknown): StickerItem[] {
  if (!Array.isArray(input)) return [];
  const result: StickerItem[] = [];
  // ID 用作 React key 与编辑操作的目标，重复时重新生成
  const seen = new Set<string>();
  for (const raw of input.slice(0, MAX_STICKERS)) {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) continue;
    const r = raw as Record<string, unknown>;
    if (typeof r.type !== "string" || !(STICKER_TYPES as readonly string[]).includes(r.type)) continue;
    const type = r.type as StickerType;
    const num = (value: unknown, min: number, max: number, fallback: number) =>
      typeof value === "number" && Number.isFinite(value) ? Math.min(max, Math.max(min, value)) : fallback;
    const item: StickerItem = {
      id: typeof r.id === "string" && /^[\w-]{1,40}$/.test(r.id) && !seen.has(r.id) ? r.id : newStickerId(),
      type,
      x: Math.round(num(r.x, -40, 880, 420)),
      // 长图的高度随内容增长，纵坐标只设一个宽松的上限
      y: Math.round(num(r.y, -40, MAX_STICKER_Y, 420)),
      rotation: Math.round(num(r.rotation, -180, 180, 0) * 10) / 10,
      scale: Math.round(num(r.scale, 0.3, 3, 1) * 100) / 100,
    };
    seen.add(item.id);
    if (r.flip === true) item.flip = true;
    if (type === "custom-doodle") {
      if (typeof r.variant === "string" && isDoodleTheme(r.variant)) item.variant = r.variant;
      const doodle = normalizeDoodleSpec(r.doodle);
      if (doodle.ok) item.doodle = doodle.value;
      if (!item.variant && !item.doodle) item.variant = "star";
    } else if (typeof r.variant === "string" && STICKER_VARIANTS[type].some((v) => v.id === r.variant)) {
      item.variant = r.variant;
    }
    result.push(item);
  }
  return result;
}
