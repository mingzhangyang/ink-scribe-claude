/** Safari 的单张画布面积上限约为 16.7M 像素，超出时自动降低倍率（必要时低于 1x）。 */
const MAX_CANVAS_PIXELS = 16_000_000;
/** Chromium 与 Firefox 的画布单边上限为 32767 像素，面积不超限的长图也可能超出这个高度。 */
export const MAX_CANVAS_DIMENSION = 32_767;

export function effectiveScale(width: number, height: number, requested: number): number {
  const byArea = Math.sqrt(MAX_CANVAS_PIXELS / Math.max(1, width * height));
  const bySide = MAX_CANVAS_DIMENSION / Math.max(1, width, height);
  return Math.max(0.01, Math.min(requested, Math.floor(Math.min(byArea, bySide) * 100) / 100));
}
