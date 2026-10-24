import { signedRandom } from "../../lib/random.ts";
import { Frame, pt, smoothClosed, type ArtProps } from "./common.tsx";

/** 印章痕迹：朱文印章、邮戳、墨渍、咖啡渍、猫爪印。 */

/** 篆刻风格的部件，坐标在 22×22 的格子内；每枚印章按贴纸 ID 挑选四个组成印文。 */
const SEAL_GLYPHS = [
  "M2 2 H20 V20 H2 Z M2 11 H20",
  "M2 6 H20 M2 16 H20 M11 2 V20",
  "M2 20 H20 M3 8 V20 M11 2 V20 M19 8 V20",
  "M3 3 H19 M5 11 H17 M2 19 H20 M11 3 V19",
  "M2 20 V3 H20 V20 M7 9 H15 M7 14 H15",
  "M5 2 V20 M11 4 V18 M17 2 V20",
  "M2 2 H20 V20 H2 Z M11 2 V20 M2 11 H20",
  "M3 3 H19 M11 3 V19 M2 19 H20",
];

export function Seal({ color, seed }: ArtProps) {
  const rand = signedRandom(seed);
  const unit = () => (rand() + 1) / 2;
  const border = [
    [5, 5],
    [67, 5],
    [67, 67],
    [5, 67],
  ].map(([x, y]) => pt(x + rand() * 1.5, y + rand() * 1.5));
  const glyphs = [
    [13, 13],
    [37, 13],
    [13, 37],
    [37, 37],
  ].map(([x, y]) => ({ x, y, d: SEAL_GLYPHS[Math.floor(unit() * SEAL_GLYPHS.length)] }));
  const stroke = { fill: "none", stroke: color } as const;
  return (
    <Frame type="seal">
      <g style={{ opacity: 0.9 }}>
        <path d={`M${border.join(" L")} Z`} style={{ ...stroke, strokeWidth: 4.5, strokeLinejoin: "round" }} />
        {glyphs.map((g, i) => (
          <path key={i} d={g.d} transform={`translate(${g.x} ${g.y})`} style={{ ...stroke, strokeWidth: 3, strokeLinecap: "square" }} />
        ))}
        {/* 印泥没有压实的地方露出纸色 */}
        {Array.from({ length: 7 }, (_, i) => (
          <circle key={i} cx={(36 + rand() * 30).toFixed(1)} cy={(36 + rand() * 30).toFixed(1)} r={(0.8 + unit() * 2).toFixed(1)} style={{ fill: "var(--paper)" }} />
        ))}
      </g>
    </Frame>
  );
}

export function Postmark({ color, seed }: ArtProps) {
  const rand = signedRandom(seed);
  // 盖印时着墨不均：外圈用长短不一的虚线
  const dash = Array.from({ length: 6 }, () => `${(24 + rand() * 18).toFixed(1)} ${(1.5 + rand()).toFixed(1)}`).join(" ");
  const wave = (y: number) => `M80 ${y} ${Array.from({ length: 6 }, (_, i) => `q6 ${i % 2 ? 4 : -4} 12 0`).join(" ")}`;
  return (
    <Frame type="postmark">
      <g style={{ opacity: 0.72, fill: "none", stroke: color, strokeLinecap: "round" }}>
        <circle cx={42} cy={42} r={36} style={{ strokeWidth: 2.4, strokeDasharray: dash }} />
        <circle cx={42} cy={42} r={28} style={{ strokeWidth: 1.2 }} />
        <path d="M18 36 L66 36 M18 48 L66 48" style={{ strokeWidth: 1.4 }} />
        <path d="M26 42 h3 M33 42 h3 M42 42 h3 M49 42 h3 M56 42 h3" style={{ strokeWidth: 2.2 }} />
        <path d="M32 22 L52 22 M36 62 L48 62" style={{ strokeWidth: 2 }} />
        {[22, 34, 46, 58].map((y) => (
          <path key={y} d={wave(y)} style={{ strokeWidth: 2 }} />
        ))}
      </g>
    </Frame>
  );
}

export function InkBlot({ color, seed }: ArtProps) {
  const rand = signedRandom(seed);
  const unit = () => (rand() + 1) / 2;
  const n = 26;
  // 一圈起伏的轮廓，其中几处向外溅出
  const spikes = new Set([0, 1, 2, 3].map(() => Math.floor(unit() * n)));
  const blob = Array.from({ length: n }, (_, i): [number, number] => {
    const a = (i / n) * Math.PI * 2;
    const r = spikes.has(i) ? 46 + unit() * 8 : 21 + unit() * 10;
    return [60 + Math.cos(a) * r, 60 + Math.sin(a) * r];
  });
  const drops = Array.from({ length: 5 }, () => {
    const a = unit() * Math.PI * 2;
    const d = 44 + unit() * 10;
    return { cx: 60 + Math.cos(a) * d, cy: 60 + Math.sin(a) * d, r: 1.8 + unit() * 3 };
  });
  return (
    <Frame type="ink-blot">
      <g style={{ fill: color, opacity: 0.88 }}>
        <path d={smoothClosed(blob)} />
        {drops.map((d, i) => (
          <circle key={i} cx={d.cx.toFixed(1)} cy={d.cy.toFixed(1)} r={d.r.toFixed(1)} />
        ))}
      </g>
    </Frame>
  );
}

export function CoffeeStain({ color, seed }: ArtProps) {
  const rand = signedRandom(seed);
  const ring = Array.from({ length: 24 }, (_, i) => {
    const a = (i / 24) * Math.PI * 2;
    const r = 62 + rand() * 4;
    return pt(85 + Math.cos(a) * r, 85 + Math.sin(a) * r);
  });
  return (
    <Frame type="coffee-stain">
      <path d={`M${ring.join(" L")} Z`} style={{ fill: "none", stroke: color, strokeWidth: 7, strokeLinejoin: "round" }} />
      <path d={`M${ring.join(" L")} Z`} style={{ fill: "none", stroke: color, strokeWidth: 2, opacity: 0.8, transform: "translate(3px, 2px)" }} />
      <circle cx={150} cy={40} r={5} style={{ fill: color }} />
      <circle cx={158} cy={56} r={2.5} style={{ fill: color }} />
      <circle cx={24} cy={140} r={3.5} style={{ fill: color }} />
    </Frame>
  );
}

export function PawPrint({ color }: ArtProps) {
  return (
    <Frame type="paw-print">
      <g style={{ fill: color, opacity: 0.85 }}>
        <path d="M32 58 C20 58 14 50 18 43 C21 37 27 35 32 35 C37 35 43 37 46 43 C50 50 44 58 32 58 Z" />
        <ellipse cx={14} cy={30} rx={6} ry={7.5} transform="rotate(-25 14 30)" />
        <ellipse cx={25} cy={18} rx={6} ry={8} transform="rotate(-8 25 18)" />
        <ellipse cx={39} cy={18} rx={6} ry={8} transform="rotate(8 39 18)" />
        <ellipse cx={50} cy={30} rx={6} ry={7.5} transform="rotate(25 50 30)" />
      </g>
    </Frame>
  );
}
