import type { ComponentType } from "react";
import { Frame, pen, pt, shade, type ArtProps } from "./common.tsx";

/** 心情点缀：星星、闪光、爱心、表情、压花。 */

const INK = "var(--ink)";

export function Star({ color, variant }: ArtProps) {
  const points = Array.from({ length: 10 }, (_, i) => {
    const a = -Math.PI / 2 + (i * Math.PI) / 5;
    const r = i % 2 === 0 ? 30 : 13;
    return pt(32 + Math.cos(a) * r, 33 + Math.sin(a) * r);
  });
  const isInk = variant.color === "ink";
  return (
    <Frame type="star">
      <path
        d={`M${points.join(" L")} Z`}
        style={{
          fill: isInk ? "none" : color,
          stroke: isInk ? INK : "#CA8A04",
          strokeWidth: isInk ? 2.4 : 1.6,
          strokeLinejoin: "round",
        }}
      />
      {isInk ? null : <path d="M22 26 L28 20" style={{ stroke: "rgba(255,255,255,0.8)", strokeWidth: 2.5, strokeLinecap: "round" }} />}
    </Frame>
  );
}

/** 四角闪光：控制点放在中心，四条边向内收。 */
const sparkle = (cx: number, cy: number, r: number) =>
  `M${cx} ${cy - r} Q${cx} ${cy} ${cx + r} ${cy} Q${cx} ${cy} ${cx} ${cy + r} Q${cx} ${cy} ${cx - r} ${cy} Q${cx} ${cy} ${cx} ${cy - r} Z`;

export function Sparkles({ color, variant }: ArtProps) {
  const style = variant.color === "ink" ? pen(color, 2) : { fill: color, stroke: shade(color, 78), strokeWidth: 1.2, strokeLinejoin: "round" as const };
  return (
    <Frame type="sparkles">
      <path d={`${sparkle(26, 34, 21)} ${sparkle(50, 15, 10)} ${sparkle(49, 49, 7)}`} style={style} />
    </Frame>
  );
}

export function Heart({ color, variant }: ArtProps) {
  const d = "M30 52 C12 40 4 30 4 18 C4 9 11 4 18 4 C24 4 28 8 30 13 C32 8 36 4 42 4 C49 4 56 9 56 18 C56 30 48 40 30 52 Z";
  return (
    <Frame type="heart">
      {variant.color === "ink" ? (
        <path d={d} style={pen(color, 2.6)} />
      ) : (
        <>
          <path d={d} style={{ fill: color, stroke: shade(color, 78), strokeWidth: 1.4, strokeLinejoin: "round" }} />
          <path d="M11 17 Q12 10 18 9.5" style={pen("rgba(255,255,255,0.75)", 2.6)} />
        </>
      )}
    </Frame>
  );
}

export function Face({ color, variant }: ArtProps) {
  const line = pen(INK, 2.4);
  const dot = { fill: INK };
  return (
    <Frame type="face">
      <circle cx={32} cy={32} r={28} style={{ fill: color, stroke: INK, strokeWidth: 2.2 }} />
      {variant.id === "thinking" ? (
        <>
          <circle cx={23} cy={27} r={2.6} style={dot} />
          <circle cx={41} cy={27} r={2.6} style={dot} />
          <path d="M35 18 L46 15 M24 44 Q31 41 40 43" style={line} />
        </>
      ) : variant.id === "surprised" ? (
        <>
          <circle cx={23} cy={27} r={3.2} style={dot} />
          <circle cx={41} cy={27} r={3.2} style={dot} />
          <path d="M17 19 Q22 14 28 18 M36 18 Q42 14 47 19" style={line} />
          <ellipse cx={32} cy={44} rx={5} ry={6.5} style={line} />
        </>
      ) : (
        <>
          <path d="M19 28 Q23 22 27 28 M37 28 Q41 22 45 28 M20 38 Q32 51 44 38" style={line} />
          <circle cx={16} cy={38} r={4} style={{ fill: "rgba(244, 114, 182, 0.45)" }} />
          <circle cx={48} cy={38} r={4} style={{ fill: "rgba(244, 114, 182, 0.45)" }} />
        </>
      )}
    </Frame>
  );
}

function Sakura({ color }: { color: string }) {
  const petal = "M0 0 C-15 -9 -15 -31 -5 -37 L0 -31 L5 -37 C15 -31 15 -9 0 0 Z";
  return (
    <g transform="translate(48 48)" style={{ opacity: 0.88 }}>
      {[0, 72, 144, 216, 288].map((a) => (
        <path key={a} d={petal} transform={`rotate(${a})`} style={{ fill: color, stroke: shade(color, 82), strokeWidth: 1 }} />
      ))}
      {[36, 108, 180, 252, 324].map((a) => (
        <g key={a} transform={`rotate(${a})`} style={{ fill: "#BE185D", stroke: "#BE185D", opacity: 0.6 }}>
          <path d="M0 0 L0 -12" style={{ strokeWidth: 1 }} />
          <circle cy={-12} r={1.4} />
        </g>
      ))}
      <circle r={4} style={{ fill: "#FDE68A" }} />
    </g>
  );
}

function Ginkgo({ color }: { color: string }) {
  const veins = Array.from({ length: 8 }, (_, i) => {
    const a = ((220 + (i * 100) / 7) * Math.PI) / 180;
    return `M48 60 L${pt(48 + Math.cos(a) * 28, 60 + Math.sin(a) * 28)}`;
  });
  return (
    <g style={{ opacity: 0.9 }}>
      <path d="M48 60 Q47 76 52 92" style={pen(shade(color, 70), 2)} />
      <path
        d="M48 60 C36 54 16 44 10 26 Q28 10 45 18 L48 28 L51 18 Q68 10 86 26 C80 44 60 54 48 60 Z"
        style={{ fill: color, stroke: shade(color, 80), strokeWidth: 1, strokeLinejoin: "round" }}
      />
      <path d={veins.join(" ")} style={{ stroke: shade(color, 75), strokeWidth: 0.8, opacity: 0.55 }} />
    </g>
  );
}

function Maple({ color }: { color: string }) {
  // [角度, 半径]：上、左右上、左右下五片裂叶，叶柄在正下方
  const lobes = [
    [-90, 40],
    [-30, 36],
    [22, 27],
    [158, 27],
    [210, 36],
  ];
  const at = (deg: number, r: number) => pt(48 + Math.cos((deg * Math.PI) / 180) * r, 46 + Math.sin((deg * Math.PI) / 180) * r);
  const outline = lobes.flatMap(([a, r], i) => {
    const next = i === lobes.length - 1 ? lobes[0][0] + 360 : lobes[i + 1][0];
    return [at(a - 10, r * 0.7), at(a, r), at(a + 10, r * 0.7), at((a + next) / 2, 12)];
  });
  return (
    <g style={{ opacity: 0.9 }}>
      <path d="M48 56 Q48 76 51 92" style={pen(shade(color, 70), 2)} />
      <path d={`M${outline.join(" L")} Z`} style={{ fill: color, stroke: shade(color, 80), strokeWidth: 1, strokeLinejoin: "round" }} />
      <path d={lobes.map(([a, r]) => `M48 46 L${at(a, r * 0.85)}`).join(" ")} style={{ stroke: shade(color, 70), strokeWidth: 1, opacity: 0.6 }} />
    </g>
  );
}

function Lavender({ color }: { color: string }) {
  // 花穗沿弯曲的花茎左右交错排列
  const stem = (t: number): [number, number] => {
    const u = 1 - t;
    return [u * u * 48 + 2 * u * t * 44 + t * t * 54, u * u * 92 + 2 * u * t * 58 + t * t * 10];
  };
  const buds = Array.from({ length: 12 }, (_, i) => {
    const [x, y] = stem(0.5 + i * 0.042);
    const side = i % 2 ? 1 : -1;
    return { x: (x + side * 3.6).toFixed(1), y: y.toFixed(1), rotate: side * 25 };
  });
  return (
    <g>
      <path d="M48 92 Q44 58 54 10" style={pen("#65A30D", 2)} />
      <path d="M47 82 Q34 74 31 60 Q42 66 47 82 Z M47 72 Q58 64 60 52 Q52 60 47 72 Z" style={{ fill: "#84CC16", opacity: 0.8 }} />
      {buds.map((b, i) => (
        <ellipse
          key={i}
          cx={b.x}
          cy={b.y}
          rx={3.2}
          ry={4.6}
          transform={`rotate(${b.rotate} ${b.x} ${b.y})`}
          style={{ fill: color, stroke: shade(color, 75), strokeWidth: 0.8 }}
        />
      ))}
    </g>
  );
}

const FLOWERS: Record<string, ComponentType<{ color: string }>> = { sakura: Sakura, ginkgo: Ginkgo, maple: Maple, lavender: Lavender };

export function PressedFlower({ color, variant }: ArtProps) {
  const Flower = FLOWERS[variant.id] ?? Sakura;
  return (
    <Frame type="pressed-flower">
      <Flower color={color} />
    </Frame>
  );
}
