import { type EnFontId, type ZhFontId } from "../../shared/appearance.ts";

/**
 * Deliberately distinct writing styles, using only fonts already shipped by InkScribe.
 * The button used to change a tiny random jitter and appeared to do nothing.
 *
 * Using a predictable cycle prevents repeated clicks from randomly selecting
 * the same-looking result, while preserving manual font controls.
 */
const HANDWRITING_PAIRS = [
  { zhFont: "lxgw", enFont: "kalam" },
  { zhFont: "long-cang", enFont: "indie-flower" },
  { zhFont: "ma-shan-zheng", enFont: "caveat" },
  { zhFont: "zcool-kuaile", enFont: "patrick-hand" },
  { zhFont: "zhi-mang-xing", enFont: "caveat" },
] as const satisfies readonly { zhFont: ZhFontId; enFont: EnFontId }[];

type HandwritingSettings = { zhFont: ZhFontId; enFont: EnFontId; seed: number };

/** Always changes the Chinese font, changes the Latin font whenever possible,
 * and shifts the deterministic stroke offsets. Leaves ink, paper and sizing alone.
 */
export function nextHandwritingStyle(current: HandwritingSettings): HandwritingSettings {
  const exact = HANDWRITING_PAIRS.findIndex(
    ({ zhFont, enFont }) => zhFont === current.zhFont && enFont === current.enFont,
  );
  const byChinese = HANDWRITING_PAIRS.findIndex(({ zhFont }) => zhFont === current.zhFont);
  const index = exact >= 0 ? exact : byChinese;
  const next = HANDWRITING_PAIRS[(index + 1) % HANDWRITING_PAIRS.length];
  const seed = ((current.seed + 7919) % 100_000 + 100_000) % 100_000;
  return { zhFont: next.zhFont, enFont: next.enFont, seed };
}
