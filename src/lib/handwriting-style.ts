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

/** Always changes both font families and shifts the deterministic stroke offsets.
 * Leaves ink, paper and sizing alone.
 */
export function nextHandwritingStyle(current: HandwritingSettings): HandwritingSettings {
  const exact = HANDWRITING_PAIRS.findIndex(
    ({ zhFont, enFont }) => zhFont === current.zhFont && enFont === current.enFont,
  );
  const byChinese = HANDWRITING_PAIRS.findIndex(({ zhFont }) => zhFont === current.zhFont);
  const index = exact >= 0 ? exact : byChinese;
  // A manual mixed pair may share its Latin font with the next preset. Skip it
  // rather than changing Chinese alone, which is invisible in English-only notes.
  for (let step = 1; step <= HANDWRITING_PAIRS.length; step++) {
    const candidate = HANDWRITING_PAIRS[(index + step) % HANDWRITING_PAIRS.length];
    if (candidate.zhFont !== current.zhFont && candidate.enFont !== current.enFont) {
      const seed = ((current.seed + 7919) % 100_000 + 100_000) % 100_000;
      return { zhFont: candidate.zhFont, enFont: candidate.enFont, seed };
    }
  }
  throw new Error("No handwriting preset changes both font families");
}
