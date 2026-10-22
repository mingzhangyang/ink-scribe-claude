import type { DoodleSpec } from "../../shared/doodle.ts";
import { DOODLE_THEMES, type DoodleTheme } from "../../shared/themes.ts";

export const STICKER_TYPES = ["tape", "sticky-note", "paperclip", "star", "coffee-stain", "custom-doodle"] as const;
export type StickerType = (typeof STICKER_TYPES)[number];

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
};

export const STICKER_LABELS: Record<StickerType, string> = {
  tape: "和纸胶带",
  "sticky-note": "便利贴",
  paperclip: "回形针",
  star: "星星",
  "coffee-stain": "咖啡渍",
  "custom-doodle": "手绘插图",
};

export const STICKER_SIZES: Record<StickerType, { w: number; h: number }> = {
  tape: { w: 150, h: 38 },
  "sticky-note": { w: 120, h: 120 },
  paperclip: { w: 36, h: 96 },
  star: { w: 64, h: 64 },
  "coffee-stain": { w: 170, h: 170 },
  "custom-doodle": { w: 120, h: 120 },
};

export const STICKER_VARIANTS: Record<Exclude<StickerType, "custom-doodle">, Array<{ id: string; label: string; color: string }>> = {
  tape: [
    { id: "yellow", label: "柠檬", color: "#FDE68A" },
    { id: "mint", label: "薄荷", color: "#A7F3D0" },
    { id: "pink", label: "樱粉", color: "#FBCFE8" },
    { id: "blue", label: "雾蓝", color: "#BFDBFE" },
    { id: "kraft", label: "牛皮", color: "#D6B98C" },
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
};

export function isDoodleTheme(value: string | undefined): value is DoodleTheme {
  return !!value && (DOODLE_THEMES as readonly string[]).includes(value);
}

export function newStickerId(): string {
  return `st_${Math.random().toString(36).slice(2, 10)}`;
}
