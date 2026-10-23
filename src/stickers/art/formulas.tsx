import { STICKER_SIZES, type StickerType } from "../types.ts";
import { Frame, pen, pt, type ArtProps } from "./common.tsx";
import { FORMULA_TEXT, GREEK_LETTERS } from "./glyphs.ts";
import { fitText, Handwriting } from "./handwriting.tsx";

/** 公式与希腊字母：数学、物理公式与化学式，用笔画手写，颜色跟随所选的笔。 */

const WEIGHT = 2.4;

/** 一行公式或一个字母，缩放到贴纸内居中。 */
function written(type: StickerType, text: string) {
  return function Formula({ color, seed }: ArtProps) {
    const { w, h } = STICKER_SIZES[type];
    return (
      <Frame type={type}>
        <Handwriting
          text={text}
          {...fitText(text, { x: 5, y: 5, w: w - 10, h: h - 10 })}
          color={color}
          seed={seed}
          weight={WEIGHT}
        />
      </Frame>
    );
  };
}

export const Pi = written("pi", FORMULA_TEXT.pi);
export const Pythagorean = written("pythagorean", FORMULA_TEXT.pythagorean);
export const Euler = written("euler", FORMULA_TEXT.euler);
export const Integral = written("integral", FORMULA_TEXT.integral);
export const InfinitySign = written("infinity", FORMULA_TEXT.infinity);
export const MassEnergy = written("emc2", FORMULA_TEXT.emc2);
export const NewtonSecond = written("fma", FORMULA_TEXT.fma);
export const Ohm = written("ohm", FORMULA_TEXT.ohm);
export const WaterFormula = written("h2o", FORMULA_TEXT.h2o);
export const CarbonDioxide = written("co2", FORMULA_TEXT.co2);
export const SodiumChloride = written("nacl", FORMULA_TEXT.nacl);
export const GlucoseFormula = written("glucose-formula", FORMULA_TEXT["glucose-formula"]);

/** 每个希腊字母一张贴纸。 */
export const GREEK_ART = Object.fromEntries(
  Object.entries(GREEK_LETTERS).map(([type, letter]) => [type, written(type as keyof typeof GREEK_LETTERS, letter)]),
) as Record<keyof typeof GREEK_LETTERS, ReturnType<typeof written>>;

export function Sigma({ color, seed }: ArtProps) {
  // 大写 Σ，上下是求和范围，右边是通项
  return (
    <Frame type="sigma">
      <Handwriting text="Σ" x={8} y={56} size={34} color={color} seed={seed} weight={WEIGHT} />
      <Handwriting text="n" x={23} y={16} size={12} color={color} seed={seed + 1} weight={1.8} anchor="middle" />
      <Handwriting text="i=1" x={23} y={74} size={10} color={color} seed={seed + 2} weight={1.6} anchor="middle" />
      <Handwriting text="a_i" x={48} y={50} size={26} color={color} seed={seed + 3} weight={WEIGHT} />
    </Frame>
  );
}

export function SquareRoot({ color, seed }: ArtProps) {
  return (
    <Frame type="sqrt">
      <path d="M6 34 L12 30 L20 48 L30 8 L66 8" style={pen(color, WEIGHT)} />
      <Handwriting text="2" x={48} y={46} size={30} color={color} seed={seed} weight={WEIGHT} anchor="middle" />
    </Frame>
  );
}

export function SineWave({ color, seed }: ArtProps) {
  // 一个周期，在箭头前结束
  const curve = Array.from({ length: 50 }, (_, i) => {
    const x = 16 + i * 2;
    return pt(x, 48 - 26 * Math.sin(((x - 16) / 98) * Math.PI * 2));
  });
  return (
    <Frame type="sine-wave">
      <path d="M8 48 L132 48 M126 44 L132 48 L126 52 M16 86 L16 6 M12 12 L16 6 L20 12" style={pen(color, 1.6)} />
      <path d={`M${curve.join(" L")}`} style={pen(color, 2.6)} />
      <Handwriting text="x" x={126} y={64} size={13} color={color} seed={seed} weight={1.6} anchor="middle" />
      <Handwriting text="y" x={28} y={14} size={13} color={color} seed={seed + 1} weight={1.6} anchor="middle" />
    </Frame>
  );
}

export function BellCurve({ color }: ArtProps) {
  const curve = Array.from({ length: 61 }, (_, i) => {
    const x = 10 + i * 2;
    return pt(x, 66 - 52 * Math.exp(-(((x - 70) / 20) ** 2) / 2));
  });
  return (
    <Frame type="bell-curve">
      {/* 曲线下的面积用同色浅涂 */}
      <path d={`M10 66 L${curve.join(" L")} L130 66 Z`} style={{ fill: color, fillOpacity: 0.12 }} />
      <path d="M6 66 L134 66 M50 63 L50 69 M90 63 L90 69" style={pen(color, 1.6)} />
      <path d="M70 66 L70 14" style={{ ...pen(color, 1.2), strokeDasharray: "3 3" }} />
      <path d={`M${curve.join(" L")}`} style={pen(color, 2.6)} />
    </Frame>
  );
}
