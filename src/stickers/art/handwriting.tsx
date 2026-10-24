import { signedRandom } from "../../lib/random.ts";
import { pen } from "./common.tsx";
import { layoutText } from "./glyphs.ts";

type Props = {
  text: string;
  /** 基线位置；anchor 为 middle 时 x 是整行的水平中心。 */
  x: number;
  y: number;
  /** 大写字母高度 */
  size: number;
  color: string;
  seed: number;
  weight?: number;
  anchor?: "start" | "middle";
};

/** 用笔画字形书写一行文字；每个字形带一点可复现的歪斜与起伏，像手写。 */
export function Handwriting({ text, x, y, size, color, seed, weight = 2, anchor = "start" }: Props) {
  const layout = layoutText(text);
  const k = size / 16;
  const left = anchor === "middle" ? x - (layout.width * k) / 2 : x;
  const rand = signedRandom(seed);
  return (
    <g style={pen(color, weight)}>
      {layout.glyphs.map((g, i) => {
        const s = k * g.scale;
        const transform = `translate(${(left + g.x * k).toFixed(2)} ${(y + g.y * k + rand() * 0.4 * k).toFixed(2)}) rotate(${(rand() * 2).toFixed(1)}) scale(${s.toFixed(3)})`;
        // 笔画宽度随字形缩放，这里按缩放比例还原，上下标与正文笔画一样粗
        return <path key={i} d={g.d} transform={transform} style={{ strokeWidth: weight / s }} />;
      })}
    </g>
  );
}

/** 把一行文字缩放到矩形内并居中，返回 Handwriting 的位置与字号。 */
export function fitText(text: string, box: { x: number; y: number; w: number; h: number }) {
  const layout = layoutText(text);
  const height = layout.bottom - layout.top;
  const k = Math.min(box.w / layout.width, box.h / height);
  return {
    x: box.x + box.w / 2,
    y: box.y + (box.h - height * k) / 2 - layout.top * k,
    size: 16 * k,
    anchor: "middle" as const,
  };
}
