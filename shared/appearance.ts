/** 纸张、墨水、重点色、字体与页面尺寸的可选项。 */

export const PAPERS = [
  { id: "grid", label: "方格纸", base: "#FDFBF7", lineColor: "rgba(30, 58, 138, 0.10)" },
  { id: "lined", label: "横线本", base: "#FDFBF7", lineColor: "rgba(37, 99, 235, 0.20)" },
  { id: "dot", label: "点阵纸", base: "#F8F4E9", lineColor: "rgba(68, 64, 60, 0.28)" },
  { id: "ivory", label: "象牙白纸", base: "#FDFBF7", lineColor: "transparent" },
  { id: "textured", label: "纹理纸", base: "#F5F5F3", lineColor: "transparent" },
  { id: "kraft", label: "牛皮纸", base: "#D8BF98", lineColor: "rgba(69, 26, 3, 0.10)" },
  { id: "parchment", label: "复古羊皮纸", base: "#EFE3CE", lineColor: "transparent" },
] as const;
export type PaperId = (typeof PAPERS)[number]["id"];

export const INKS = [
  { id: "carbon", label: "碳素黑", color: "#1C1917" },
  { id: "blue", label: "钢笔蓝", color: "#1E3A8A" },
  { id: "brown", label: "复古棕", color: "#451A03" },
  { id: "green", label: "黛绿", color: "#14532D" },
  { id: "bordeaux", label: "波尔多红", color: "#7F1D1D" },
] as const;
export type InkId = (typeof INKS)[number]["id"];

export const ACCENTS = [
  { id: "yellow", label: "柠檬黄", color: "#FEF08A" },
  { id: "green", label: "薄荷绿", color: "#BBF7D0" },
  { id: "orange", label: "杏橙", color: "#FED7AA" },
] as const;
export type AccentId = (typeof ACCENTS)[number]["id"];

export const ZH_FONTS = [
  { id: "lxgw", label: "霞鹜文楷", family: "LXGW WenKai Screen", note: "工整清晰" },
  { id: "long-cang", label: "龙藏体", family: "Long Cang", note: "随性手写" },
  { id: "ma-shan-zheng", label: "马善政楷书", family: "Ma Shan Zheng", note: "毛笔楷书" },
  { id: "zcool-kuaile", label: "站酷快乐体", family: "ZCOOL KuaiLe", note: "活泼圆润" },
  { id: "zhi-mang-xing", label: "志莽行书", family: "Zhi Mang Xing", note: "行书飘逸" },
] as const;
export type ZhFontId = (typeof ZH_FONTS)[number]["id"];

export const EN_FONTS = [
  { id: "kalam", label: "Kalam", family: "Kalam" },
  { id: "caveat", label: "Caveat", family: "Caveat" },
  { id: "patrick-hand", label: "Patrick Hand", family: "Patrick Hand" },
  { id: "indie-flower", label: "Indie Flower", family: "Indie Flower" },
] as const;
export type EnFontId = (typeof EN_FONTS)[number]["id"];

/** 内部画布坐标系：宽度固定为 840，导出时按 1x/2x/3x 放大。 */
export const PAGE_WIDTH = 840;

export const PAGE_SIZES = [
  { id: "a4", label: "A4 竖版", height: 1188 },
  { id: "portrait", label: "3:4 竖版", height: 1120 },
  { id: "square", label: "1:1 方形", height: 840 },
  { id: "long", label: "长图（自适应高度）", height: null },
] as const;
export type PageSizeId = (typeof PAGE_SIZES)[number]["id"];

export function byId<T extends { id: string }>(list: readonly T[], id: string): T {
  return list.find((item) => item.id === id) ?? list[0];
}

/** 中英文混排：英文手写字体在前（只覆盖拉丁字符），中文字体兜底中日韩字符。 */
export function fontStack(zh: ZhFontId, en: EnFontId): string {
  return `"${byId(EN_FONTS, en).family}", "${byId(ZH_FONTS, zh).family}", "Kaiti SC", "STKaiti", "KaiTi", cursive`;
}

export function usedFamilies(zh: ZhFontId, en: EnFontId): string[] {
  return [byId(EN_FONTS, en).family, byId(ZH_FONTS, zh).family];
}
