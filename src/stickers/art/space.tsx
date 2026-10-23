import { Frame, INK, isInk, line, PAPER, pen, pt, shade, solid, type ArtProps } from "./common.tsx";

/** 宇宙：太阳、地球、月亮、土星、木星、彗星、螺旋星系、黑洞、北斗七星、宇航员。多数有彩色与墨线两款。 */

export function Sun({ variant }: ArtProps) {
  const ink = isInk(variant);
  const rays = Array.from({ length: 12 }, (_, i) => {
    const a = (i * Math.PI) / 6;
    const at = (r: number, da = 0) => pt(44 + Math.cos(a + da) * r, 44 + Math.sin(a + da) * r);
    return `M${at(27, -0.13)} L${at(40)} L${at(27, 0.13)} Z`;
  });
  return (
    <Frame type="sun">
      <path d={rays.join(" ")} style={ink ? { fill: PAPER, stroke: INK, strokeWidth: 1.6, strokeLinejoin: "round" } : { fill: "#F59E0B" }} />
      <circle cx={44} cy={44} r={23} style={solid(ink, "#FACC15", 1.6)} />
      {ink ? null : <ellipse cx={36} cy={35} rx={6} ry={3.6} transform="rotate(-35 36 35)" style={{ fill: "rgba(255,255,255,0.45)" }} />}
    </Frame>
  );
}

export function Earth({ variant }: ArtProps) {
  const ink = isInk(variant);
  const land = ink ? { fill: PAPER, stroke: INK, strokeWidth: 1.4, strokeLinejoin: "round" as const } : { fill: "#22C55E", stroke: "#15803D", strokeWidth: 1 };
  return (
    <Frame type="earth">
      <circle cx={42} cy={42} r={36} style={solid(ink, "#3B82F6", 1.6)} />
      {/* 大致的美洲、欧非与澳洲轮廓，都在圆内 */}
      <path
        d="M20 22 Q28 14 36 18 Q40 24 34 30 Q30 34 32 40 Q36 46 32 52 Q28 60 24 62 Q22 54 24 48 Q18 44 16 36 Q14 28 20 22 Z M50 14 Q60 12 64 20 Q60 24 62 30 Q68 34 66 44 Q62 54 56 56 Q52 48 54 40 Q48 36 50 28 Q46 20 50 14 Z M58 62 Q64 58 68 62 Q66 68 60 68 Q56 66 58 62 Z"
        style={land}
      />
      {ink ? null : <path d="M14 32 Q16 22 24 16" style={pen("rgba(255,255,255,0.5)", 2.5)} />}
    </Frame>
  );
}

export function Moon({ color, variant }: ArtProps) {
  if (variant.id === "full") {
    return (
      <Frame type="moon">
        <circle cx={40} cy={40} r={30} style={{ fill: color, stroke: shade(color, 75), strokeWidth: 1.4 }} />
        {[
          [30, 30, 6],
          [50, 46, 8],
          [48, 24, 3.5],
          [28, 52, 4],
        ].map(([cx, cy, r]) => (
          <circle key={`${cx}-${cy}`} cx={cx} cy={cy} r={r} style={{ fill: shade(color, 88), stroke: shade(color, 80), strokeWidth: 0.8 }} />
        ))}
      </Frame>
    );
  }
  // 弯月：外圆的一大段弧，再沿内圆的弧回到起点
  return (
    <Frame type="moon">
      <path d="M50.3 11.8 A30 30 0 1 0 68.2 50.3 A24 24 0 0 1 50.3 11.8 Z" style={{ fill: color, stroke: shade(color, 75), strokeWidth: 1.4, strokeLinejoin: "round" }} />
    </Frame>
  );
}

export function Saturn({ variant }: ArtProps) {
  const ink = isInk(variant);
  const ring = (sweep: 0 | 1) => `M6 36 A54 12 0 0 ${sweep} 114 36 M14 36 A46 9 0 0 ${sweep} 106 36`;
  const ringStyle = ink ? pen(INK, 1.6) : pen("#D97706", 3.2);
  return (
    <Frame type="saturn">
      {/* 光环上半段在行星后面，下半段在前面 */}
      <g transform="rotate(-12 60 36)">
        <path d={ring(1)} style={ringStyle} />
        <circle cx={60} cy={36} r={22} style={solid(ink, "#FCD34D", 1.4)} />
        <path d="M41 28 Q60 32 79 28 M39 40 Q60 44 81 40" style={line(ink, "#D97706", ink ? 1 : 2.2)} />
        <path d={ring(0)} style={ringStyle} />
      </g>
    </Frame>
  );
}

export function Jupiter({ variant }: ArtProps) {
  const ink = isInk(variant);
  // 横向的云带：每条带在圆内的左右端点按圆的方程计算
  const band = (y1: number, y2: number) => {
    const half = (y: number) => Math.sqrt(34 * 34 - (y - 42) ** 2);
    return `M${pt(42 - half(y1), y1)} L${pt(42 + half(y1), y1)} L${pt(42 + half(y2), y2)} L${pt(42 - half(y2), y2)} Z`;
  };
  return (
    <Frame type="jupiter">
      <circle cx={42} cy={42} r={34} style={solid(ink, "#FDE7C8", 1.6)} />
      {ink ? (
        <path d="M12 26 Q42 30 72 26 M9 38 Q42 42 75 38 M9 50 Q42 54 75 50 M14 62 Q42 66 70 62" style={pen(INK, 1.2)} />
      ) : (
        <path d={[band(22, 28), band(36, 41), band(48, 54), band(60, 64)].join(" ")} style={{ fill: "#D97706", opacity: 0.55 }} />
      )}
      <ellipse cx={54} cy={51} rx={7} ry={3.8} style={ink ? pen(INK, 1.4) : { fill: "#DC2626", opacity: 0.8 }} />
      <circle cx={42} cy={42} r={34} style={line(ink, shade("#FDE7C8", 70), 1.6)} />
    </Frame>
  );
}

export function Comet({ variant }: ArtProps) {
  const ink = isInk(variant);
  return (
    <Frame type="comet">
      {ink ? (
        <path d="M90 18 Q52 30 10 62 M94 26 Q60 40 24 66 M86 14 Q56 20 20 44" style={pen(INK, 1.6)} />
      ) : (
        <>
          <path d="M88 12 Q50 26 6 66 Q54 42 102 30 Z" style={{ fill: "#93C5FD", opacity: 0.45 }} />
          <path d="M90 16 Q60 28 26 56 Q62 38 100 26 Z" style={{ fill: "#BFDBFE", opacity: 0.85 }} />
          <circle cx={96} cy={22} r={13} style={{ fill: "rgba(186, 230, 253, 0.55)" }} />
        </>
      )}
      <circle cx={96} cy={22} r={8} style={solid(ink, "#F0F9FF", 1.2)} />
    </Frame>
  );
}

export function Galaxy({ variant }: ArtProps) {
  const ink = isInk(variant);
  // 两条对数螺线旋臂
  const arm = (offset: number) =>
    `M${Array.from({ length: 60 }, (_, i) => {
      const t = (i / 59) * Math.PI * 3;
      const r = 5 * Math.exp(0.24 * t);
      return pt(50 + Math.cos(t + offset) * r, 50 + Math.sin(t + offset) * r * 0.75);
    }).join(" L")}`;
  const arms = `${arm(0)} ${arm(Math.PI)}`;
  const stars = [
    [16, 20],
    [84, 14],
    [88, 80],
    [12, 78],
    [70, 88],
    [26, 46],
  ];
  return (
    <Frame type="galaxy">
      {ink ? (
        <path d={arms} style={pen(INK, 2)} />
      ) : (
        <>
          <path d={arms} style={{ ...pen("#8B5CF6", 8), opacity: 0.35 }} />
          <path d={arms} style={pen("#C4B5FD", 2.6)} />
          <circle cx={50} cy={50} r={13} style={{ fill: "rgba(253, 230, 138, 0.5)" }} />
        </>
      )}
      <circle cx={50} cy={50} r={7} style={solid(ink, "#FDE68A", 1)} />
      {stars.map(([x, y]) => (
        <circle key={`${x}-${y}`} cx={x} cy={y} r={1.6} style={{ fill: ink ? INK : "#FACC15" }} />
      ))}
    </Frame>
  );
}

export function BlackHole({ variant }: ArtProps) {
  const ink = isInk(variant);
  const disk = (sweep: 0 | 1) => `M7 40 A48 14 0 0 ${sweep} 103 40`;
  const glow = ink ? pen(INK, 2) : pen("#F97316", 6);
  const core = ink ? pen(INK, 0.8) : pen("#FDE047", 2);
  return (
    <Frame type="black-hole">
      {/* 吸积盘后半段、被引力弯折到上方的光、黑洞本身，再画前半段吸积盘 */}
      <path d={disk(1)} style={glow} />
      <path d={disk(1)} style={core} />
      <path d="M31 38 A24 24 0 0 1 79 38" style={ink ? pen(INK, 1.6) : pen("#FB923C", 4)} />
      <circle cx={55} cy={40} r={20} style={line(ink, "#FDBA74", 2)} />
      <circle cx={55} cy={40} r={17} style={{ fill: ink ? INK : "#0B0B0F" }} />
      <path d={disk(0)} style={glow} />
      <path d={disk(0)} style={core} />
    </Frame>
  );
}

/** 北斗七星：天枢、天璇、天玑、天权组成斗身，玉衡、开阳、摇光组成斗柄。 */
const DIPPER = [
  [100, 12],
  [102, 32],
  [78, 38],
  [74, 20],
  [52, 16],
  [32, 20],
  [10, 32],
];

export function BigDipper({ color, variant }: ArtProps) {
  const ink = isInk(variant);
  const at = (i: number) => pt(DIPPER[i][0], DIPPER[i][1]);
  const sparkle = ([x, y]: number[], r: number) =>
    `M${x} ${y - r} Q${x} ${y} ${x + r} ${y} Q${x} ${y} ${x} ${y + r} Q${x} ${y} ${x - r} ${y} Q${x} ${y} ${x} ${y - r} Z`;
  return (
    <Frame type="big-dipper">
      <path
        d={`M${at(0)} L${at(1)} L${at(2)} L${at(3)} Z M${at(3)} L${at(4)} L${at(5)} L${at(6)}`}
        style={{ ...pen(ink ? INK : "#94A3B8", 1.2), strokeDasharray: "3 3" }}
      />
      <path d={DIPPER.map((p) => sparkle(p, 6)).join(" ")} style={ink ? { fill: INK } : { fill: color, stroke: shade(color, 75), strokeWidth: 0.8 }} />
    </Frame>
  );
}

export function Astronaut({ variant }: ArtProps) {
  const ink = isInk(variant);
  const suit = ink ? PAPER : "#F8FAFC";
  const seam = ink ? INK : "#94A3B8";
  /** 手臂和腿：先画一道粗的轮廓线，再在里面画宇航服的颜色。 */
  const limb = (d: string) => (
    <>
      <path d={d} style={pen(seam, 12)} />
      <path d={d} style={pen(suit, 9)} />
    </>
  );
  return (
    <Frame type="astronaut">
      <rect x={16} y={40} width={48} height={36} rx={6} style={solid(ink, "#CBD5E1", 1.2)} />
      {limb("M24 48 Q12 54 12 70")}
      {limb("M56 48 Q68 54 68 70")}
      {limb("M32 76 L32 92")}
      {limb("M48 76 L48 92")}
      <path d="M26.5 94 L37.5 94 M42.5 94 L53.5 94" style={pen(ink ? INK : "#475569", 5)} />
      <rect x={22} y={42} width={36} height={38} rx={8} style={{ fill: suit, stroke: seam, strokeWidth: 1.4 }} />
      <rect x={32} y={52} width={16} height={11} rx={2} style={solid(ink, "#CBD5E1", 1)} />
      <path d="M35 57.5 L37 57.5 M40 57.5 L42 57.5 M45 57.5 L45 57.5" style={line(ink, "#EF4444", 2.4)} />
      <rect x={24} y={46} width={7} height={5} style={{ fill: ink ? INK : "#EF4444" }} />
      <circle cx={40} cy={26} r={18} style={{ fill: suit, stroke: seam, strokeWidth: 1.4 }} />
      <ellipse cx={40} cy={27} rx={12} ry={9} style={{ fill: ink ? INK : "#1E3A8A" }} />
      <path d="M33 23 Q35 20 39 20" style={pen(ink ? PAPER : "rgba(255,255,255,0.7)", 2)} />
    </Frame>
  );
}
