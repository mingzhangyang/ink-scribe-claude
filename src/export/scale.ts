/** Safari 的单张画布面积上限约为 16.7M 像素，超出时自动降低倍率（必要时低于 1x）。 */
const MAX_CANVAS_PIXELS = 16_000_000;

export function effectiveScale(width: number, height: number, requested: number): number {
  const limit = Math.sqrt(MAX_CANVAS_PIXELS / Math.max(1, width * height));
  return Math.max(0.01, Math.min(requested, Math.floor(limit * 100) / 100));
}
