import { isOneOf, STYLES, type NoteStyle } from "../../shared/options.ts";
import { DOODLE_THEMES, type DoodleTheme } from "../../shared/themes.ts";
import {
  ACCENTS,
  EN_FONTS,
  INKS,
  PAGE_SIZES,
  PAPERS,
  ZH_FONTS,
  type AccentId,
  type EnFontId,
  type InkId,
  type PageSizeId,
  type PaperId,
  type ZhFontId,
} from "../config/appearance.ts";

export const DOODLE_MODES = ["auto", "theme", "ai", "none"] as const;

export type Settings = {
  layout: NoteStyle;
  paper: PaperId;
  zhFont: ZhFontId;
  enFont: EnFontId;
  fontSize: number;
  lineHeight: number;
  letterSpacing: number;
  ink: InkId;
  accent: AccentId;
  /** 0–1，控制手写抖动、旋转与墨色深浅变化的幅度。 */
  naturalness: number;
  pageSize: PageSizeId;
  doodleMode: (typeof DOODLE_MODES)[number];
  doodleTheme: DoodleTheme;
  seed: number;
};

export const DEFAULT_SETTINGS: Settings = {
  layout: "hybrid-cornell",
  paper: "grid",
  zhFont: "lxgw",
  enFont: "kalam",
  fontSize: 19,
  lineHeight: 1.75,
  letterSpacing: 0.02,
  ink: "blue",
  accent: "yellow",
  naturalness: 0.55,
  pageSize: "a4",
  doodleMode: "auto",
  doodleTheme: "lightbulb",
  seed: 7,
};

const ids = <T extends { id: string }>(list: readonly T[]) => list.map((item) => item.id) as T["id"][];

function pick<T extends string>(values: readonly T[], value: unknown, fallback: T): T {
  return isOneOf(values, value) ? value : fallback;
}

function range(value: unknown, min: number, max: number, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? Math.min(max, Math.max(min, value)) : fallback;
}

/**
 * 校验本地保存的外观偏好。旧版本或被篡改的数据中出现的未知取值会回退为默认值，
 * 避免因为一项无效设置导致整个页面无法渲染。
 */
export function sanitizeSettings(raw: unknown): Settings {
  const r = raw && typeof raw === "object" && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
  const d = DEFAULT_SETTINGS;
  return {
    layout: pick(STYLES, r.layout, d.layout),
    paper: pick(ids(PAPERS), r.paper, d.paper),
    zhFont: pick(ids(ZH_FONTS), r.zhFont, d.zhFont),
    enFont: pick(ids(EN_FONTS), r.enFont, d.enFont),
    fontSize: range(r.fontSize, 12, 28, d.fontSize),
    lineHeight: range(r.lineHeight, 1.3, 2.4, d.lineHeight),
    letterSpacing: range(r.letterSpacing, -0.02, 0.15, d.letterSpacing),
    ink: pick(ids(INKS), r.ink, d.ink),
    accent: pick(ids(ACCENTS), r.accent, d.accent),
    naturalness: range(r.naturalness, 0, 1, d.naturalness),
    pageSize: pick(ids(PAGE_SIZES), r.pageSize, d.pageSize),
    doodleMode: pick(DOODLE_MODES, r.doodleMode, d.doodleMode),
    doodleTheme: pick(DOODLE_THEMES, r.doodleTheme, d.doodleTheme),
    seed: typeof r.seed === "number" && Number.isSafeInteger(r.seed) ? r.seed : d.seed,
  };
}
