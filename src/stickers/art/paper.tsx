import { signedRandom } from "../../lib/random.ts";
import { STICKER_SIZES } from "../types.ts";
import { Frame, PatternMarks, pt, shade, SHADOW, type ArtProps } from "./common.tsx";

/** 纸品标签：便利贴、索引贴、撕纸片、吊牌、票根、邮票、折角、丝带书签。 */

export function StickyNote({ color }: ArtProps) {
  const { w, h } = STICKER_SIZES["sticky-note"];
  return (
    <Frame type="sticky-note">
      <path d={`M6 8 L${w - 2} 6 L${w - 4} ${h - 2} L24 ${h} L4 ${h - 20} Z`} style={{ fill: "rgba(0,0,0,0.12)" }} />
      <path d={`M2 2 L${w - 6} 2 L${w - 6} ${h - 6} L22 ${h - 6} L2 ${h - 26} Z`} style={{ fill: color }} />
      <path d={`M2 ${h - 26} L22 ${h - 26} L22 ${h - 6} Z`} style={{ fill: "rgba(0,0,0,0.1)" }} />
      <path d={`M2 2 L${w - 6} 2 L${w - 6} 16 L2 16 Z`} style={{ fill: "rgba(0,0,0,0.04)" }} />
    </Frame>
  );
}

export function PageFlag({ color }: ArtProps) {
  return (
    <Frame type="page-flag">
      {/* 半透明的一段贴在正文上，实色的一端露在外面 */}
      <rect x={2} y={4} width={72} height={21} style={{ fill: color, opacity: 0.5 }} />
      <rect x={73} y={6} width={22} height={21} rx={1.5} style={SHADOW} />
      <rect x={72} y={4} width={22} height={21} rx={1.5} style={{ fill: color }} />
      <path d="M74 7.5 L92 7.5" style={{ stroke: "rgba(255,255,255,0.5)", strokeWidth: 1.2 }} />
    </Frame>
  );
}

export function TornPaper({ color, variant, seed }: ArtProps) {
  const { w, h } = STICKER_SIZES["torn-paper"];
  const rand = signedRandom(seed);
  const across = 14;
  const down = 8;
  const x = (i: number) => 6 + (i * (w - 12)) / across;
  const y = (i: number) => 6 + (i * (h - 12)) / down;
  // 上下两边是撕开的毛边，左右两边只有轻微起伏
  const points: Array<[number, number]> = [
    ...Array.from({ length: across + 1 }, (_, i): [number, number] => [x(i), 6 + rand() * 4]),
    ...Array.from({ length: down - 1 }, (_, i): [number, number] => [w - 6 + rand() * 1.5, y(i + 1)]),
    ...Array.from({ length: across + 1 }, (_, i): [number, number] => [x(across - i), h - 6 + rand() * 4]),
    ...Array.from({ length: down - 1 }, (_, i): [number, number] => [6 + rand() * 1.5, y(down - 1 - i)]),
  ];
  const outline = `M${points.map(([px, py]) => pt(px, py)).join(" L")} Z`;
  return (
    <Frame type="torn-paper">
      <path d={outline} transform="translate(2 3)" style={SHADOW} />
      <path d={outline} style={{ fill: color }} />
      {variant.pattern ? <PatternMarks pattern={variant.pattern} x={14} y={16} w={w - 28} h={h - 32} /> : null}
    </Frame>
  );
}

export function KraftTag({ color }: ArtProps) {
  const body = "M22 30 L50 30 L64 44 L64 114 Q64 118 60 118 L12 118 Q8 118 8 114 L8 44 Z";
  const cord = { fill: "none", stroke: "#A8A29E", strokeWidth: 1.6, strokeLinecap: "round" } as const;
  return (
    <Frame type="kraft-tag">
      <path d={body} transform="translate(2 2)" style={SHADOW} />
      <path d={body} style={{ fill: color, stroke: shade(color, 85), strokeWidth: 1 }} />
      <circle cx={36} cy={44} r={7} style={{ fill: "rgba(255,255,255,0.45)" }} />
      <circle cx={36} cy={44} r={3.5} style={{ fill: "rgba(0,0,0,0.28)" }} />
      {[72, 86, 100].map((y) => (
        <path key={y} d={`M18 ${y} L54 ${y}`} style={{ stroke: "rgba(0,0,0,0.13)", strokeWidth: 1.2 }} />
      ))}
      {/* 系绳穿过孔眼 */}
      <path d="M36 44 C22 26 46 14 30 2" style={cord} />
      <path d="M36 44 C50 28 28 16 42 2" style={cord} />
    </Frame>
  );
}

export function TicketStub({ color }: ArtProps) {
  // 左右两侧各有一个半圆缺口
  const body = "M4 4 L152 4 L152 26 A7 7 0 0 0 152 40 L152 62 L4 62 L4 40 A7 7 0 0 0 4 26 Z";
  const print = { stroke: "rgba(0,0,0,0.2)", strokeLinecap: "round" } as const;
  return (
    <Frame type="ticket-stub">
      <path d={body} transform="translate(2 2)" style={SHADOW} />
      <path d={body} style={{ fill: color, stroke: shade(color, 85), strokeWidth: 1 }} />
      <path d="M112 8 L112 58" style={{ stroke: "rgba(0,0,0,0.25)", strokeWidth: 1.2, strokeDasharray: "3 4" }} />
      <path d="M18 20 L80 20" style={{ ...print, strokeWidth: 3.5 }} />
      <path d="M18 32 L96 32 M18 42 L70 42 M18 50 L58 50" style={{ ...print, strokeWidth: 1.4 }} />
      <circle cx={132} cy={33} r={10} style={{ fill: "none", stroke: "rgba(0,0,0,0.2)", strokeWidth: 1.4 }} />
      <circle cx={132} cy={33} r={3} style={{ fill: "rgba(0,0,0,0.2)" }} />
    </Frame>
  );
}

/** 邮票齿孔：沿四边顺时针走，每个齿孔是一段向内凹的半圆弧。 */
function perforated(w: number, h: number, r: number, step: number): string {
  const parts = ["M0 0"];
  for (let x = step; x < w; x += step) parts.push(`L${x - r} 0 A${r} ${r} 0 0 0 ${x + r} 0`);
  parts.push(`L${w} 0`);
  for (let y = step; y < h; y += step) parts.push(`L${w} ${y - r} A${r} ${r} 0 0 0 ${w} ${y + r}`);
  parts.push(`L${w} ${h}`);
  for (let x = w - step; x > 0; x -= step) parts.push(`L${x + r} ${h} A${r} ${r} 0 0 0 ${x - r} ${h}`);
  parts.push(`L0 ${h}`);
  for (let y = h - step; y > 0; y -= step) parts.push(`L0 ${y + r} A${r} ${r} 0 0 0 0 ${y - r}`);
  return `${parts.join(" ")} Z`;
}

export function PostageStamp({ color }: ArtProps) {
  const { w, h } = STICKER_SIZES["postage-stamp"];
  const edge = perforated(w, h, 2.6, 8);
  return (
    <Frame type="postage-stamp">
      <path d={edge} transform="translate(1.5 2)" style={SHADOW} />
      <path d={edge} style={{ fill: "#FFFDF8", stroke: "rgba(0,0,0,0.1)", strokeWidth: 0.8 }} />
      <rect x={8} y={8} width={56} height={72} style={{ fill: color }} />
      <circle cx={48} cy={24} r={7} style={{ fill: "rgba(255,255,255,0.75)" }} />
      <path d="M8 68 L25 42 L35 55 L46 36 L64 62 L64 80 L8 80 Z" style={{ fill: "rgba(255,255,255,0.35)" }} />
      <path d="M8 80 L8 70 L22 60 L34 70 L48 61 L64 72 L64 80 Z" style={{ fill: "rgba(0,0,0,0.16)" }} />
      <rect x={12} y={12} width={14} height={4} rx={1} style={{ fill: "rgba(255,255,255,0.85)" }} />
    </Frame>
  );
}

export function DogEar({ color }: ArtProps) {
  // 斜边是折痕，直角一侧是翻过来的纸背；把右上角对准页角使用
  const flap = "M0 0 L72 72 L0 72 Z";
  return (
    <Frame type="dog-ear">
      <path d={flap} transform="translate(-3 3)" style={SHADOW} />
      <path d={flap} style={{ fill: color }} />
      <path d={flap} style={{ fill: "rgba(0,0,0,0.06)" }} />
      <path d="M0 0 L72 72" style={{ stroke: "rgba(255,255,255,0.75)", strokeWidth: 1.5 }} />
      <path d="M0 0 L0 72 L72 72" style={{ fill: "none", stroke: "rgba(0,0,0,0.12)", strokeWidth: 1 }} />
    </Frame>
  );
}

export function RibbonBookmark({ color }: ArtProps) {
  const ribbon = "M6 0 L28 0 L28 146 L17 133 L6 146 Z";
  return (
    <Frame type="ribbon-bookmark">
      <path d={ribbon} transform="translate(2 2)" style={SHADOW} />
      <path d={ribbon} style={{ fill: color }} />
      <path d="M12 0 L12 138" style={{ stroke: "rgba(255,255,255,0.2)", strokeWidth: 3 }} />
      <rect x={6} y={0} width={22} height={9} style={{ fill: "rgba(0,0,0,0.18)" }} />
    </Frame>
  );
}
