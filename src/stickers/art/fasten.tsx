import { signedRandom } from "../../lib/random.ts";
import { STICKER_SIZES } from "../types.ts";
import { Frame, PatternMarks, pt, shade, SHADOW, type ArtProps } from "./common.tsx";

/** 胶带夹子：和纸胶带、美纹纸、回形针、长尾夹、图钉、订书钉、相角。 */

export function Tape({ color, variant }: ArtProps) {
  const { w, h } = STICKER_SIZES.tape;
  return (
    <Frame type="tape">
      <path
        d={`M4 3 L${w - 4} 1 L${w - 8} 8 L${w - 2} 14 L${w - 7} 21 L${w - 2} 28 L${w - 5} ${h - 1} L3 ${h - 2} L7 ${h - 9} L1 ${h - 16} L6 ${h - 23} L1 9 Z`}
        style={{ fill: color, opacity: 0.8 }}
      />
      {variant.pattern ? (
        <PatternMarks pattern={variant.pattern} x={10} y={5} w={w - 20} h={h - 10} />
      ) : (
        [0, 1, 2, 3, 4, 5, 6].map((i) => (
          <path key={i} d={`M${14 + i * 20} 4 l10 ${h - 8}`} style={{ stroke: "rgba(255,255,255,0.45)", strokeWidth: 5 }} />
        ))
      )}
    </Frame>
  );
}

export function MaskingTape({ color, seed }: ArtProps) {
  const { w, h } = STICKER_SIZES["masking-tape"];
  const rand = signedRandom(seed);
  // 两端是手撕的细齿，上下边保持平直
  const edge = (x: number) => Array.from({ length: 9 }, (_, i): [number, number] => [x + rand() * 2.5, 2 + (i * (h - 4)) / 8]);
  const outline = [...edge(w - 5), ...edge(5).reverse()];
  return (
    <Frame type="masking-tape">
      <path d={`M${outline.map(([x, y]) => pt(x, y)).join(" L")} Z`} style={{ fill: color, opacity: 0.92 }} />
      {[10, 17, 25].map((y) => (
        <path key={y} d={`M10 ${y} L${w - 10} ${y + 1}`} style={{ stroke: "rgba(0,0,0,0.06)", strokeWidth: 1 }} />
      ))}
    </Frame>
  );
}

export function Paperclip({ color }: ArtProps) {
  return (
    <Frame type="paperclip">
      <path
        d="M24 30 L24 74 C24 84 12 84 12 74 L12 18 C12 4 32 4 32 18 L32 80 C32 96 4 96 4 80 L4 26"
        style={{ fill: "none", stroke: color, strokeWidth: 3.2, strokeLinecap: "round" }}
      />
      <path
        d="M24 30 L24 74 C24 84 12 84 12 74 L12 18 C12 4 32 4 32 18"
        style={{ fill: "none", stroke: "rgba(255,255,255,0.5)", strokeWidth: 1, strokeLinecap: "round" }}
      />
    </Frame>
  );
}

export function BinderClip({ color, variant }: ArtProps) {
  const wire = { fill: "none", stroke: variant.id === "silver" ? "#52525B" : "#A1A1AA", strokeLinejoin: "round" } as const;
  const body = "M9 46 L55 46 L60 80 L4 80 Z";
  return (
    <Frame type="binder-clip">
      {/* 两根钢丝把手向上翻起，前后错开 */}
      <path d="M15 48 L12 9 Q12 3 18 3 L46 3 Q52 3 52 9 L49 48" style={{ ...wire, strokeWidth: 3 }} />
      <path d="M21 48 L19 16 Q19 11 24 11 L40 11 Q45 11 45 16 L43 48" style={{ ...wire, strokeWidth: 2.4, opacity: 0.8 }} />
      <path d={body} transform="translate(2 2)" style={SHADOW} />
      <path d={body} style={{ fill: color, stroke: shade(color, 75), strokeWidth: 1, strokeLinejoin: "round" }} />
      <path d="M9 46 L55 46 L56 53 L8 53 Z" style={{ fill: "rgba(255,255,255,0.28)" }} />
      <path d="M5 74 L59 74" style={{ stroke: "rgba(0,0,0,0.18)", strokeWidth: 1.5 }} />
    </Frame>
  );
}

export function PushPin({ color }: ArtProps) {
  return (
    <Frame type="push-pin">
      <ellipse cx={25} cy={37} rx={9} ry={3.5} style={{ fill: "rgba(0,0,0,0.16)" }} />
      <path d="M21 24 L27 38" style={{ stroke: "#9CA3AF", strokeWidth: 1.6, strokeLinecap: "round" }} />
      <circle cx={19} cy={19} r={14} style={{ fill: shade(color, 80), stroke: "rgba(0,0,0,0.2)", strokeWidth: 1 }} />
      <circle cx={18} cy={17} r={10} style={{ fill: color }} />
      <ellipse cx={14} cy={12.5} rx={3.6} ry={2.4} transform="rotate(-30 14 12.5)" style={{ fill: "rgba(255,255,255,0.65)" }} />
    </Frame>
  );
}

export function Staple({ color }: ArtProps) {
  return (
    <Frame type="staple">
      <path d="M6 10 L54 10" style={{ stroke: "rgba(0,0,0,0.16)", strokeWidth: 3.4, strokeLinecap: "round" }} />
      <path d="M5 7.5 L55 7.5" style={{ stroke: color, strokeWidth: 3.2, strokeLinecap: "round" }} />
      <path d="M8 6.6 L52 6.6" style={{ stroke: "rgba(255,255,255,0.55)", strokeWidth: 1 }} />
      <circle cx={5} cy={7.5} r={1.6} style={{ fill: shade(color, 60) }} />
      <circle cx={55} cy={7.5} r={1.6} style={{ fill: shade(color, 60) }} />
    </Frame>
  );
}

export function PhotoCorner({ color }: ArtProps) {
  const corner = "M2 2 L54 2 L2 54 Z";
  return (
    <Frame type="photo-corner">
      <path d={corner} transform="translate(2 2)" style={SHADOW} />
      <path d={corner} style={{ fill: color, stroke: "rgba(0,0,0,0.12)", strokeWidth: 1, strokeLinejoin: "round" }} />
      {/* 斜边是插入照片的开口 */}
      <path d="M46 7 L7 46" style={{ stroke: "rgba(255,255,255,0.4)", strokeWidth: 1.5, strokeLinecap: "round" }} />
    </Frame>
  );
}
