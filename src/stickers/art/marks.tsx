import { signedRandom } from "../../lib/random.ts";
import { Frame, pen, pt, shade, type ArtProps } from "./common.tsx";

/** 标注符号：手绘箭头、圈注、波浪线、大括号、对勾、叉号、感叹号、问号。 */

export function Arrow({ color, seed }: ArtProps) {
  const rand = signedRandom(seed);
  // 起点、控制点和箭尖都带一点抖动，每支箭头略有不同
  const [x0, y0] = [10 + rand() * 3, 64 + rand() * 4];
  const [c1x, c1y] = [38 + rand() * 6, 18 + rand() * 6];
  const [c2x, c2y] = [88 + rand() * 6, 10 + rand() * 6];
  const [tx, ty] = [128, 34 + rand() * 4];
  const angle = Math.atan2(ty - c2y, tx - c2x);
  const barb = (spread: number) => pt(tx - 16 * Math.cos(angle + spread), ty - 16 * Math.sin(angle + spread));
  return (
    <Frame type="arrow">
      <path d={`M${pt(x0, y0)} C${pt(c1x, c1y)} ${pt(c2x, c2y)} ${pt(tx, ty)}`} style={pen(color, 3)} />
      <path d={`M${barb(0.5)} L${pt(tx, ty)} L${barb(-0.5)}`} style={pen(color, 3)} />
    </Frame>
  );
}

export function CircleMark({ color, seed }: ArtProps) {
  const rand = signedRandom(seed);
  const phase = rand() * Math.PI;
  const start = -2.4 + rand() * 0.3;
  // 多绕小半圈且逐渐内收，首尾错开，像随手圈出的重点
  const points = Array.from({ length: 61 }, (_, i) => {
    const t = i / 60;
    const a = start + t * (Math.PI * 2 + 0.4);
    const k = (1 - 0.12 * t) * (1 + 0.03 * Math.sin(a * 3 + phase));
    return pt(85 + 76 * k * Math.cos(a), 42 + 34 * k * Math.sin(a));
  });
  return (
    <Frame type="circle-mark">
      <path d={`M${points.join(" L")}`} style={pen(color, 2.6)} />
    </Frame>
  );
}

export function WavyUnderline({ color }: ArtProps) {
  const waves = Array.from({ length: 18 }, (_, i) => `T${20 + i * 8} 11`).join(" ");
  return (
    <Frame type="wavy-underline">
      <path d={`M4 11 Q8 3 12 11 ${waves}`} style={pen(color, 2.6)} />
    </Frame>
  );
}

export function Bracket({ color }: ArtProps) {
  return (
    <Frame type="bracket">
      <path d="M6 4 Q18 4 18 18 L18 56 Q18 70 28 70 Q18 70 18 84 L18 122 Q18 136 6 136" style={pen(color, 2.8)} />
    </Frame>
  );
}

export function Check({ color }: ArtProps) {
  return (
    <Frame type="check">
      <path d="M8 30 Q15 35 22 46 Q31 24 50 8" style={pen(color, 4.5)} />
    </Frame>
  );
}

export function Cross({ color }: ArtProps) {
  return (
    <Frame type="cross">
      <path d="M10 10 Q25 24 40 41 M41 9 Q24 26 9 41" style={pen(color, 4.5)} />
    </Frame>
  );
}

/** 浅色底的徽章用深色符号，其余用白色。 */
const markOn = (variant: ArtProps["variant"]) => (variant.id === "yellow" ? "#713F12" : "#FFFFFF");

export function Exclaim({ color, variant }: ArtProps) {
  const mark = markOn(variant);
  return (
    <Frame type="exclaim">
      <circle cx={22} cy={22} r={19} style={{ fill: color, stroke: shade(color, 80), strokeWidth: 1.2 }} />
      <path d="M22 10.5 L22 25" style={pen(mark, 5)} />
      <circle cx={22} cy={32.5} r={3} style={{ fill: mark }} />
    </Frame>
  );
}

export function Question({ color, variant }: ArtProps) {
  const mark = markOn(variant);
  return (
    <Frame type="question">
      <circle cx={22} cy={22} r={19} style={{ fill: color, stroke: shade(color, 80), strokeWidth: 1.2 }} />
      <path d="M15.5 16 Q16 9.5 22 9.5 Q28.5 9.5 28.5 15.5 Q28.5 20 22 22.5 L22 25.5" style={pen(mark, 4.2)} />
      <circle cx={22} cy={32.5} r={2.8} style={{ fill: mark }} />
    </Frame>
  );
}
