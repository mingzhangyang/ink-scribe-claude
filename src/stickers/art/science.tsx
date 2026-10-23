import type { CSSProperties } from "react";
import { Frame, pen, pt, shade, tint, type ArtProps } from "./common.tsx";
import { Handwriting } from "./handwriting.tsx";

/**
 * 科学图示：化学结构式、生物大分子、物理示意与实验器材。
 * 彩色款上色；墨线款用纸色填充、墨水色勾线，像手绘的线稿，前面的形状会遮住后面的线。
 */

const INK = "var(--ink)";
const PAPER = "var(--paper)";

const isInk = (variant: ArtProps["variant"]) => variant.id === "ink";

/** 填色的形状：彩色款同色系描边，墨线款纸色填充加墨线。 */
function solid(ink: boolean, color: string, width = 1.4): CSSProperties {
  return ink
    ? { fill: PAPER, stroke: INK, strokeWidth: width + 0.4, strokeLinejoin: "round" }
    : { fill: color, stroke: shade(color, 70), strokeWidth: width, strokeLinejoin: "round" };
}

const line = (ink: boolean, color: string, width: number) => pen(ink ? INK : color, width);

/** 粗线条（DNA 骨架、抗体链、显微镜镜筒）：墨线款画成空心的双线。 */
function Band({ d, ink, color, width }: { d: string; ink: boolean; color: string; width: number }) {
  return ink ? (
    <>
      <path d={d} style={pen(INK, width)} />
      <path d={d} style={pen(PAPER, width - 3.2)} />
    </>
  ) : (
    <path d={d} style={pen(color, width)} />
  );
}

export function Benzene({ variant }: ArtProps) {
  const ink = isInk(variant);
  const ring = Array.from({ length: 6 }, (_, i) => {
    const a = ((-90 + i * 60) * Math.PI) / 180;
    return pt(40 + Math.cos(a) * 30, 40 + Math.sin(a) * 30);
  });
  return (
    <Frame type="benzene">
      <path d={`M${ring.join(" L")} Z`} style={ink ? pen(INK, 2.4) : { fill: tint("#0D9488", 16), stroke: "#0F766E", strokeWidth: 2.6, strokeLinejoin: "round" }} />
      <circle cx={40} cy={40} r={17} style={line(ink, "#0F766E", 2.2)} />
    </Frame>
  );
}

export function WaterMolecule({ variant, seed }: ArtProps) {
  const ink = isInk(variant);
  return (
    <Frame type="water-molecule">
      <Band d="M48 30 L24 52 M48 30 L72 52" ink={ink} color="#94A3B8" width={6} />
      {[24, 72].map((x, i) => (
        <g key={x}>
          <circle cx={x} cy={52} r={11} style={solid(ink, "#E5E7EB")} />
          <Handwriting text="H" x={x} y={56.5} size={9} color={ink ? INK : "#475569"} seed={seed + i} weight={1.6} anchor="middle" />
        </g>
      ))}
      <circle cx={48} cy={30} r={16} style={solid(ink, "#EF4444")} />
      {ink ? null : <ellipse cx={42} cy={23} rx={4.5} ry={3} transform="rotate(-30 42 23)" style={{ fill: "rgba(255,255,255,0.55)" }} />}
      <Handwriting text="O" x={48} y={36.5} size={13} color={ink ? INK : "#FFFFFF"} seed={seed + 2} weight={2} anchor="middle" />
    </Frame>
  );
}

export function GlucoseRing({ variant, seed }: ArtProps) {
  const ink = isInk(variant);
  const ringColor = ink ? INK : "#B45309";
  const label = ink ? INK : "#B91C1C";
  // 哈沃斯投影：O 在右后方，C2–C3 是靠近读者的粗边
  const [c5, o, c1, c2, c3, c4] = [
    [42, 34],
    [66, 34],
    [88, 46],
    [72, 62],
    [40, 62],
    [22, 46],
  ];
  const edge = (a: number[], b: number[]) => `M${a[0]} ${a[1]} L${b[0]} ${b[1]}`;
  const text = (t: string, x: number, y: number, i: number) => (
    <Handwriting text={t} x={x} y={y} size={7.5} color={label} seed={seed + i} weight={1.3} anchor="middle" />
  );
  return (
    <Frame type="glucose-ring">
      {ink ? null : <path d={`M${[c5, o, c1, c2, c3, c4].map(([x, y]) => pt(x, y)).join(" L")} Z`} style={{ fill: tint("#D97706", 14) }} />}
      <path d={[edge(c4, c5), edge(c5, o), edge(o, c1)].join(" ")} style={pen(ringColor, 2)} />
      <path d={[edge(c1, c2), edge(c3, c4)].join(" ")} style={pen(ringColor, 3)} />
      <path d={edge(c2, c3)} style={pen(ringColor, 5)} />
      {/* 取代基：竖线加标注，β-葡萄糖 */}
      <path d="M42 34 L42 22 M88 46 L88 34 M72 62 L72 74 M40 62 L40 52 M22 46 L22 58" style={pen(ringColor, 1.6)} />
      <circle cx={66} cy={34} r={6.5} style={{ fill: ink ? PAPER : tint("#D97706", 14) }} />
      {text("O", 66, 37.8, 0)}
      {text("CH_2OH", 42, 17, 1)}
      {text("OH", 90, 29, 2)}
      {text("OH", 72, 85, 3)}
      {text("OH", 40, 49, 4)}
      {text("HO", 20, 69, 5)}
    </Frame>
  );
}

export function Dna({ variant }: ArtProps) {
  const ink = isInk(variant);
  const turn = (y: number) => ((y - 6) / 60) * Math.PI * 2;
  const strand = (phase: number) =>
    `M${Array.from({ length: 49 }, (_, i) => {
      const y = 6 + i * 2.5;
      return pt(36 + 22 * Math.sin(turn(y) + phase), y);
    }).join(" L")}`;
  // 碱基对：两条链之间的横档，链交叉处太短的不画
  const pairs = ["#F59E0B", "#10B981", "#3B82F6", "#EF4444"];
  const rungs = Array.from({ length: 17 }, (_, i) => 10 + i * 7)
    .map((y) => ({ y, s: Math.sin(turn(y)) }))
    .filter(({ s }) => Math.abs(s) > 0.3);
  return (
    <Frame type="dna">
      <Band d={strand(Math.PI)} ink={ink} color="#DB2777" width={5} />
      {rungs.map(({ y, s }, i) => (
        <g key={y}>
          <path d={`M${pt(36 - 22 * s, y)} L36 ${y}`} style={line(ink, pairs[(i * 2) % 4], ink ? 1.6 : 3)} />
          <path d={`M36 ${y} L${pt(36 + 22 * s, y)}`} style={line(ink, pairs[(i * 2 + 1) % 4], ink ? 1.6 : 3)} />
        </g>
      ))}
      <Band d={strand(0)} ink={ink} color="#2563EB" width={5} />
    </Frame>
  );
}

export function AlphaHelix({ variant }: ArtProps) {
  const ink = isInk(variant);
  const turns = 3;
  // 每一圈是一个斜向的椭圆环，像侧面看到的弹簧
  const at = (t: number) => {
    const a = t * turns * Math.PI * 2;
    return { x: 22 + t * 80 + 12 * Math.sin(a), y: 36 - 24 * Math.cos(a), front: Math.sin(a) > 0 };
  };
  const points = Array.from({ length: 151 }, (_, i) => at(i / 150));
  // 每圈右侧向下的半圈在前面：先画整条螺旋，再把前面的半圈画在上面
  const front: string[] = [];
  let run: string[] = [];
  points.forEach((p) => {
    if (p.front) run.push(pt(p.x, p.y));
    else if (run.length) {
      front.push(`M${run.join(" L")}`);
      run = [];
    }
  });
  if (run.length) front.push(`M${run.join(" L")}`);
  return (
    <Frame type="alpha-helix">
      <Band d={`M${points.map((p) => pt(p.x, p.y)).join(" L")}`} ink={ink} color="#6D28D9" width={6} />
      {front.map((d) => (
        <Band key={d} d={d} ink={ink} color="#A78BFA" width={6} />
      ))}
    </Frame>
  );
}

export function Antibody({ variant }: ArtProps) {
  const ink = isInk(variant);
  return (
    <Frame type="antibody">
      {/* 两条轻链在外侧，两条重链组成 Y 形，铰链处有二硫键 */}
      <Band d="M23.3 50.6 L6.8 17.6 M56.7 50.6 L73.2 17.6" ink={ink} color="#F472B6" width={7} />
      <Band d="M36 96 L36 58 L14 14 M44 96 L44 58 L66 14" ink={ink} color="#3B82F6" width={7} />
      <path d="M36 64 L44 64 M36 70 L44 70" style={line(ink, "#F59E0B", 2)} />
    </Frame>
  );
}

/** 茎区：两条平行的链，中间是配对的碱基。 */
function stem(x1: number, y1: number, x2: number, y2: number): { strands: string; pairs: string } {
  const len = Math.hypot(x2 - x1, y2 - y1);
  const [ux, uy] = [(x2 - x1) / len, (y2 - y1) / len];
  const [nx, ny] = [-uy * 3.2, ux * 3.2];
  const strands = `M${pt(x1 + nx, y1 + ny)} L${pt(x2 + nx, y2 + ny)} M${pt(x1 - nx, y1 - ny)} L${pt(x2 - nx, y2 - ny)}`;
  const pairs = Array.from({ length: Math.floor(len / 4.5) }, (_, i) => {
    const t = 2.5 + i * 4.5;
    const [cx, cy] = [x1 + ux * t, y1 + uy * t];
    return `M${pt(cx + nx, cy + ny)} L${pt(cx - nx, cy - ny)}`;
  }).join(" ");
  return { strands, pairs };
}

export function TRna({ variant }: ArtProps) {
  const ink = isInk(variant);
  const stems = [stem(44, 6, 44, 44), stem(39, 50, 21, 50), stem(49, 50, 67, 50), stem(44, 55, 44, 80)];
  const backbone = ink ? INK : "#0EA5E9";
  return (
    <Frame type="trna">
      <path d={stems.map((s) => s.pairs).join(" ")} style={line(ink, "#F59E0B", 1.4)} />
      <path d={stems.map((s) => s.strands).join(" ")} style={pen(backbone, 2)} />
      <circle cx={44} cy={50} r={5.5} style={pen(backbone, 2)} />
      <circle cx={13} cy={50} r={8} style={pen(backbone, 2)} />
      <circle cx={75} cy={50} r={8} style={pen(backbone, 2)} />
      <circle cx={44} cy={92} r={11} style={pen(backbone, 2)} />
      {/* 反密码子 */}
      <path d="M38.5 101.5 L36.5 105 M44 103 L44 107 M49.5 101.5 L51.5 105" style={line(ink, "#EF4444", 3)} />
      {/* 3′ 端伸出的单链 */}
      <path d="M47.2 6 L47.2 2 L52 2" style={pen(backbone, 2)} />
    </Frame>
  );
}

export function Atom({ variant }: ArtProps) {
  const ink = isInk(variant);
  const orbits = [0, 60, 120];
  const electron = (orbit: number, phi: number) => {
    const [ex, ey] = [40 * Math.cos(phi), 14 * Math.sin(phi)];
    const a = (orbit * Math.PI) / 180;
    return { cx: 46 + ex * Math.cos(a) - ey * Math.sin(a), cy: 46 + ex * Math.sin(a) + ey * Math.cos(a) };
  };
  const nucleus: Array<[number, number, string]> = [
    [-3, -3, "#EF4444"],
    [3.5, -2.5, "#94A3B8"],
    [-4, 3, "#94A3B8"],
    [3, 3.5, "#EF4444"],
    [0, 0, "#EF4444"],
  ];
  return (
    <Frame type="atom">
      {orbits.map((r) => (
        <ellipse key={r} cx={46} cy={46} rx={40} ry={14} transform={`rotate(${r} 46 46)`} style={line(ink, "#64748B", 1.4)} />
      ))}
      {nucleus.map(([dx, dy, color]) => (
        <circle key={`${dx}-${dy}`} cx={46 + dx} cy={46 + dy} r={4.6} style={solid(ink, color, 1)} />
      ))}
      {orbits.map((r, i) => {
        const e = electron(r, 0.7 + i * 1.9);
        return <circle key={r} cx={e.cx.toFixed(1)} cy={e.cy.toFixed(1)} r={3.4} style={{ fill: ink ? INK : "#3B82F6" }} />;
      })}
    </Frame>
  );
}

export function Magnet({ variant, seed }: ArtProps) {
  const ink = isInk(variant);
  // 磁感线在磁铁外部从 N 极出发回到 S 极
  const field = [
    "M31 38 C14 34 14 14 56 14 C98 14 98 34 81 38",
    "M31 36 C4 28 6 4 56 4 C106 4 108 28 81 36",
    "M31 46 C14 50 14 70 56 70 C98 70 98 50 81 46",
    "M31 48 C4 56 6 80 56 80 C106 80 108 56 81 48",
  ];
  return (
    <Frame type="magnet">
      <path d={field.join(" ")} style={line(ink, "#64748B", 1.4)} />
      <path d="M53 11 L58 14 L53 17 M53 1 L58 4 L53 7 M53 67 L58 70 L53 73 M53 77 L58 80 L53 83" style={line(ink, "#64748B", 1.4)} />
      <rect x={31} y={34} width={25} height={16} style={ink ? { fill: INK, stroke: INK, strokeWidth: 1.8 } : solid(false, "#EF4444")} />
      <rect x={56} y={34} width={25} height={16} style={solid(ink, "#3B82F6")} />
      <Handwriting text="N" x={43.5} y={46.5} size={9} color={ink ? PAPER : "#FFFFFF"} seed={seed} weight={1.8} anchor="middle" />
      <Handwriting text="S" x={68.5} y={46.5} size={9} color={ink ? INK : "#FFFFFF"} seed={seed + 1} weight={1.8} anchor="middle" />
    </Frame>
  );
}

export function Lens({ variant, seed }: ArtProps) {
  const ink = isInk(variant);
  const ray = line(ink, "#F59E0B", 1.8);
  return (
    <Frame type="lens">
      <path d="M4 42 L120 42" style={{ ...line(ink, "#94A3B8", 1), strokeDasharray: "4 3" }} />
      {/* 平行光经凸透镜会聚到焦点 F */}
      <path d="M6 20 L62 20 L120 53.6 M6 42 L120 42 M6 64 L62 64 L120 30.4" style={ray} />
      <path d="M30 17 L34 20 L30 23 M30 39 L34 42 L30 45 M30 61 L34 64 L30 67" style={ray} />
      <path d="M62 8 Q78 42 62 76 Q46 42 62 8 Z" style={ink ? { fill: "none", stroke: INK, strokeWidth: 2 } : { fill: "#BAE6FD", fillOpacity: 0.75, stroke: "#0284C7", strokeWidth: 1.8 }} />
      {[24, 100].map((x, i) => (
        <g key={x}>
          <circle cx={x} cy={42} r={2.2} style={{ fill: ink ? INK : "#0284C7" }} />
          <Handwriting text="F" x={x} y={56} size={8} color={ink ? INK : "#0284C7"} seed={seed + i} weight={1.4} anchor="middle" />
        </g>
      ))}
    </Frame>
  );
}

export function Circuit({ variant, seed }: ArtProps) {
  const ink = isInk(variant);
  const wire = line(ink, "#334155", 2.2);
  return (
    <Frame type="circuit">
      {/* 电池在左边，灯泡在上边，电阻在右边 */}
      <path d="M16 38 L16 18 L46 18 M64 18 L96 18 L96 32 L90 35 L102 39 L90 43 L102 47 L90 51 L96 54 L96 70 L16 70 L16 50" style={wire} />
      <path d="M6 40 L26 40" style={line(ink, "#334155", 2.2)} />
      <path d="M11 48 L21 48" style={line(ink, "#334155", 4.2)} />
      <Handwriting text="+" x={31} y={41} size={7} color={ink ? INK : "#DC2626"} seed={seed} weight={1.4} anchor="middle" />
      {ink ? null : (
        <path d="M55 4 L55 1 M44 8 L42 6 M66 8 L68 6 M41 18 L38 18 M69 18 L72 18" style={pen("#F59E0B", 1.6)} />
      )}
      <circle cx={55} cy={18} r={9} style={solid(ink, "#FDE047")} />
      <path d="M48.6 11.6 L61.4 24.4 M61.4 11.6 L48.6 24.4" style={line(ink, "#334155", 1.6)} />
    </Frame>
  );
}

export function Beaker({ variant }: ArtProps) {
  const ink = isInk(variant);
  const glass = ink ? INK : "#64748B";
  return (
    <Frame type="beaker">
      <path
        d="M15 48 Q26 45 37 48 T59 48 L59 76 Q59 81 54 81 L20 81 Q15 81 15 76 Z"
        style={ink ? { fill: "none" } : { fill: "#60A5FA", fillOpacity: 0.55 }}
      />
      {ink ? <path d="M15 48 Q26 45 37 48 T59 48" style={pen(INK, 1.4)} /> : null}
      {[
        [30, 66, 2.5],
        [40, 58, 1.8],
        [34, 73, 1.5],
      ].map(([cx, cy, r]) => (
        <circle key={cx} cx={cx} cy={cy} r={r} style={pen(ink ? INK : "rgba(255,255,255,0.85)", 1)} />
      ))}
      <path d="M8 6 Q12 6 14 10 L14 76 Q14 82 20 82 L54 82 Q60 82 60 76 L60 10 L63 8" style={pen(glass, 2.2)} />
      <path d="M48 22 L58 22 M52 30 L58 30 M48 38 L58 38 M52 46 L58 46 M48 54 L58 54 M52 62 L58 62" style={pen(glass, 1.2)} />
    </Frame>
  );
}

export function Flask({ variant }: ArtProps) {
  const ink = isInk(variant);
  const glass = ink ? INK : "#64748B";
  return (
    <Frame type="flask">
      <path
        d="M17.2 60 Q28 57 38 60 T58.8 60 L67 79 Q68.5 84 63 84 L13 84 Q7.5 84 9 79 Z"
        style={ink ? { fill: "none" } : { fill: "#34D399", fillOpacity: 0.6 }}
      />
      {ink ? <path d="M17.2 60 Q28 57 38 60 T58.8 60" style={pen(INK, 1.4)} /> : null}
      {[
        [32, 74, 2.4],
        [44, 68, 1.7],
        [50, 78, 1.4],
      ].map(([cx, cy, r]) => (
        <circle key={cx} cx={cx} cy={cy} r={r} style={pen(ink ? INK : "rgba(255,255,255,0.85)", 1)} />
      ))}
      <path d="M30 6 L30 32 L8 80 Q6 86 12 86 L64 86 Q70 86 68 80 L46 32 L46 6 M27 6 L49 6" style={pen(glass, 2.2)} />
    </Frame>
  );
}

export function Microscope({ variant }: ArtProps) {
  const ink = isInk(variant);
  return (
    <Frame type="microscope">
      <rect x={12} y={90} width={56} height={9} rx={3} style={solid(ink, "#475569")} />
      <Band d="M58 92 L58 66 Q58 44 44 34" ink={ink} color="#475569" width={8} />
      <rect x={16} y={62} width={42} height={6} rx={1.5} style={solid(ink, "#1F2937")} />
      <rect x={28} y={58.5} width={20} height={3.5} style={ink ? { fill: "none", stroke: INK, strokeWidth: 1 } : { fill: "#BAE6FD" }} />
      <Band d="M27 12 L39 46" ink={ink} color="#64748B" width={10} />
      <Band d="M39 46 L41.5 54" ink={ink} color="#94A3B8" width={5} />
      <Band d="M22 7 L32 3.5" ink={ink} color="#1F2937" width={6} />
      <circle cx={60} cy={50} r={6} style={solid(ink, "#94A3B8")} />
    </Frame>
  );
}
