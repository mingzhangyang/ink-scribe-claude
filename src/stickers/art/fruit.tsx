import { Frame, pen, pt, shade, SHADOW, tint, type ArtProps } from "./common.tsx";

/** 水果：橙子、苹果、香蕉、草莓、芒果、西瓜、葡萄。变体同时决定形状（整个 / 切开）或品种颜色。 */

const LEAF = "#16A34A";
const STEM = "#78350F";
const outline = (color: string) => ({ fill: color, stroke: shade(color, 78), strokeWidth: 1.4, strokeLinejoin: "round" }) as const;
const gloss = pen("rgba(255,255,255,0.6)", 3);

export function Orange({ color, variant }: ArtProps) {
  if (variant.id === "slice") {
    // 横切面：果皮、白色内皮和八瓣果肉
    const segments = Array.from({ length: 8 }, (_, i) => {
      const a0 = ((i * 45 + 4) * Math.PI) / 180;
      const a1 = (((i + 1) * 45 - 4) * Math.PI) / 180;
      const mid = (a0 + a1) / 2;
      const at = (a: number, r: number) => pt(36 + Math.cos(a) * r, 36 + Math.sin(a) * r);
      return `M${at(mid, 2.5)} L${at(a0, 23)} A23 23 0 0 1 ${at(a1, 23)} Z`;
    });
    return (
      <Frame type="orange">
        <circle cx={38} cy={38} r={31} style={SHADOW} />
        <circle cx={36} cy={36} r={31} style={outline(color)} />
        <circle cx={36} cy={36} r={27} style={{ fill: "#FFF7ED" }} />
        <path d={segments.join(" ")} style={{ fill: tint(color, 72), stroke: tint(color, 90), strokeWidth: 0.8, strokeLinejoin: "round" }} />
      </Frame>
    );
  }
  return (
    <Frame type="orange">
      <circle cx={36} cy={42} r={27} style={outline(color)} />
      {[
        [24, 50],
        [44, 56],
        [50, 40],
        [32, 62],
        [20, 38],
      ].map(([x, y]) => (
        <circle key={`${x}-${y}`} cx={x} cy={y} r={1} style={{ fill: shade(color, 85), opacity: 0.45 }} />
      ))}
      <ellipse cx={26} cy={32} rx={6} ry={3.6} transform="rotate(-35 26 32)" style={{ fill: "rgba(255,255,255,0.55)" }} />
      <path d="M36 16 L36 10" style={pen(STEM, 2.5)} />
      <path d="M37 12 Q47 3 58 8 Q48 17 37 12 Z" style={{ fill: LEAF, stroke: shade(LEAF, 75), strokeWidth: 1 }} />
    </Frame>
  );
}

export function Apple({ color }: ArtProps) {
  return (
    <Frame type="apple">
      <path
        d="M34 22 C26 16 10 16 8 34 C6 52 18 70 28 68 C31 67 33 66 34 66 C35 66 37 67 40 68 C50 70 62 52 60 34 C58 16 42 16 34 22 Z"
        style={outline(color)}
      />
      <path d="M17 34 Q18 26 25 24" style={gloss} />
      <path d="M34 22 Q34 14 38 7" style={pen(STEM, 2.6)} />
      <path d="M37 13 Q46 4 57 8 Q48 17 37 13 Z" style={{ fill: LEAF, stroke: shade(LEAF, 75), strokeWidth: 1 }} />
    </Frame>
  );
}

/** 一根香蕉：右端是果柄，左端是深色的果尖。 */
function BananaShape({ color }: { color: string }) {
  return (
    <>
      <path d="M12 18 C18 48 56 60 86 34 L90 27 L86 25 C60 40 28 34 18 15 Q14 13 12 18 Z" style={outline(color)} />
      <path d="M22 26 C32 42 56 48 80 33" style={{ fill: "none", stroke: shade(color, 85), strokeWidth: 1, opacity: 0.6 }} />
      <path d="M26 33 C36 42 50 45 64 44" style={pen("rgba(255,255,255,0.5)", 2)} />
      <circle cx={13} cy={17} r={2.3} style={{ fill: STEM }} />
      <path d="M86 33 L92 26 L95 29 L89 35 Z" style={{ fill: "#65A30D" }} />
    </>
  );
}

/** 以果柄 (88, 30) 为轴旋转、缩放，让一串香蕉呈扇形散开。 */
const fan = (angle: number, scale: number, dy: number) =>
  `translate(0 ${dy}) rotate(${angle} 88 30) translate(88 30) scale(${scale}) translate(-88 -30)`;

export function Banana({ color, variant }: ArtProps) {
  return (
    <Frame type="banana">
      {variant.id === "bunch" ? (
        // 三根共用果柄，从后往前画
        <>
          <g transform={fan(13, 0.88, 4)}>
            <BananaShape color={shade(color, 94)} />
          </g>
          <g transform={fan(0, 0.92, 4)}>
            <BananaShape color={color} />
          </g>
          <g transform={fan(-14, 0.9, 6)}>
            <BananaShape color={tint(color, 92)} />
          </g>
        </>
      ) : (
        <BananaShape color={color} />
      )}
    </Frame>
  );
}

const STRAWBERRY = "M30 66 C16 58 6 40 8 28 C10 18 20 16 30 20 C40 16 50 18 52 28 C54 40 44 58 30 66 Z";

export function Strawberry({ color, variant }: ArtProps) {
  const half = variant.id === "half";
  // 切开后果肉由外向内变浅，中心是一道浅色的心
  const inset = (scale: number) => `translate(30 40) scale(${scale}) translate(-30 -40)`;
  return (
    <Frame type="strawberry">
      <path d={STRAWBERRY} style={outline(color)} />
      {half ? (
        <>
          <path d={STRAWBERRY} transform={inset(0.8)} style={{ fill: tint(color, 45) }} />
          <path d={STRAWBERRY} transform={inset(0.45)} style={{ fill: tint(color, 20) }} />
        </>
      ) : (
        [
          [20, 30],
          [30, 28],
          [40, 30],
          [15, 40],
          [25, 40],
          [35, 40],
          [45, 40],
          [21, 50],
          [31, 51],
          [40, 50],
          [30, 60],
        ].map(([x, y]) => <ellipse key={`${x}-${y}`} cx={x} cy={y} rx={1.2} ry={2} style={{ fill: "rgba(254,240,138,0.95)" }} />)
      )}
      <path d="M30 23 L19 14 L27 16 L24 7 L30 14 L36 7 L33 16 L41 14 Z" style={{ fill: LEAF, stroke: shade(LEAF, 75), strokeWidth: 1, strokeLinejoin: "round" }} />
      <path d="M30 13 L31 4" style={pen("#15803D", 2)} />
    </Frame>
  );
}

export function Mango({ color, variant }: ArtProps) {
  const body = "M14 40 C10 22 28 8 48 10 C66 12 78 24 76 38 C74 52 58 60 40 58 C26 57 16 52 14 40 Z";
  // 熟芒果向阳的一面泛红，青芒泛黄；两层半透明椭圆叠出柔和的过渡
  const blush = variant.id === "green" ? "rgba(250, 204, 21, 0.3)" : "rgba(239, 68, 68, 0.2)";
  return (
    <Frame type="mango">
      <path d={body} style={{ fill: color }} />
      <ellipse cx={56} cy={28} rx={20} ry={14} transform="rotate(20 56 28)" style={{ fill: blush }} />
      <ellipse cx={58} cy={26} rx={12} ry={8} transform="rotate(20 58 26)" style={{ fill: blush }} />
      <path d={body} style={{ fill: "none", stroke: shade(color, 78), strokeWidth: 1.4 }} />
      <path d="M24 32 Q27 22 37 18" style={gloss} />
      <path d="M46 11 Q45 6 48 3" style={pen(STEM, 2.5)} />
      <path d="M47 7 Q57 1 67 5 Q57 12 47 7 Z" style={{ fill: LEAF, stroke: shade(LEAF, 75), strokeWidth: 1 }} />
    </Frame>
  );
}

/** 以 (48, 20) 为圆心、向下的半圆。 */
const halfDisc = (r: number) => `M${48 - r} 20 L${48 + r} 20 A${r} ${r} 0 0 1 ${48 - r} 20 Z`;

/** 整个西瓜的一道瓜纹：沿经线从顶到底，左右交替错开成锯齿。 */
function stripe(k: number): string[] {
  return Array.from({ length: 11 }, (_, i) => {
    const t = i / 10;
    const u = 1 - t;
    const x = u * u * 48 + 2 * u * t * (48 + k * 80) + t * t * 48;
    const y = u * u * 9 + 2 * u * t * 38 + t * t * 67;
    const zigzag = i === 0 || i === 10 ? 0 : i % 2 ? 2 : -2;
    return pt(x + zigzag * (1 - Math.abs(k) * 0.6), y);
  });
}

export function Watermelon({ color, variant }: ArtProps) {
  if (variant.id === "whole") {
    return (
      <Frame type="watermelon">
        <ellipse cx={50} cy={40} rx={40} ry={30} style={SHADOW} />
        <ellipse cx={48} cy={38} rx={40} ry={30} style={outline(color)} />
        {[-0.7, -0.35, 0, 0.35, 0.7].map((k) => (
          <path key={k} d={`M${stripe(k).join(" L")}`} style={pen(shade(color, 60), 3.4)} />
        ))}
        <ellipse cx={30} cy={26} rx={8} ry={4.5} transform="rotate(-25 30 26)" style={{ fill: "rgba(255,255,255,0.3)" }} />
        <path d="M48 8 Q50 3 55 3" style={pen("#65A30D", 2.2)} />
      </Frame>
    );
  }
  return (
    <Frame type="watermelon">
      <path d={halfDisc(40)} transform="translate(2 2)" style={SHADOW} />
      <path d={halfDisc(40)} style={{ fill: "#15803D" }} />
      <path d={halfDisc(36.5)} style={{ fill: "#BBF7D0" }} />
      <path d={halfDisc(33)} style={{ fill: color }} />
      {[
        [34, 30, -20],
        [48, 34, 0],
        [62, 30, 20],
        [41, 44, -10],
        [55, 44, 10],
        [48, 25, 0],
      ].map(([x, y, r]) => (
        <ellipse key={`${x}-${y}`} cx={x} cy={y} rx={1.6} ry={2.7} transform={`rotate(${r} ${x} ${y})`} style={{ fill: "#1C1917" }} />
      ))}
    </Frame>
  );
}

/** 一串葡萄：自上而下 4、3、2、1 颗，从后往前画，下面的果粒压住上面的。 */
const GRAPE_ROWS = [4, 3, 2, 1].flatMap((count, row) =>
  Array.from({ length: count }, (_, i) => ({ x: 32 + (i - (count - 1) / 2) * 12, y: 27 + row * 10.5 })),
);

export function Grape({ color }: ArtProps) {
  return (
    <Frame type="grape">
      <path d="M32 20 L33 8" style={pen(STEM, 2.4)} />
      <path d="M33 13 Q24 12 23 6 Q23 2 27 4" style={pen("#65A30D", 1.2)} />
      <path d="M34 11 Q46 1 58 8 Q49 19 34 11 Z" style={{ fill: LEAF, stroke: shade(LEAF, 75), strokeWidth: 1 }} />
      {GRAPE_ROWS.map(({ x, y }) => (
        <g key={`${x}-${y}`}>
          <circle cx={x} cy={y} r={7.5} style={outline(color)} />
          <ellipse cx={x - 2.5} cy={y - 2.8} rx={2.2} ry={1.4} transform={`rotate(-30 ${x - 2.5} ${y - 2.8})`} style={{ fill: "rgba(255,255,255,0.55)" }} />
        </g>
      ))}
    </Frame>
  );
}
