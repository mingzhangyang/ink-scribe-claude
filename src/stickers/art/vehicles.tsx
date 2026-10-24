import { Frame, pen, shade, type ArtProps } from "./common.tsx";

/** 交通工具：汽车、火车、高铁、轮船、帆船、飞机、火箭、星舰、卫星。变体是车身、涂装或船帆的颜色。 */

const WHITE = "#F8FAFC";
const STEEL = "#CBD5E1";
const DARK = "#1F2937";
const GLASS = "#BFDBFE";
const outline = (color: string, width = 1.3) => ({ fill: color, stroke: shade(color, 72), strokeWidth: width, strokeLinejoin: "round" }) as const;
const pale = (color: string) => ({ fill: color, stroke: "#94A3B8", strokeWidth: 1.2, strokeLinejoin: "round" }) as const;

function Wheel({ x, y, r }: { x: number; y: number; r: number }) {
  return (
    <>
      <circle cx={x} cy={y} r={r} style={{ fill: DARK }} />
      <circle cx={x} cy={y} r={r * 0.45} style={{ fill: "#D1D5DB" }} />
    </>
  );
}

const waves = (y: number, from: number, to: number) =>
  `M${from} ${y} ${Array.from({ length: Math.floor((to - from) / 12) }, () => "q3 -3 6 0 t6 0").join(" ")}`;

export function Car({ color }: ArtProps) {
  return (
    <Frame type="car">
      <path d="M6 46 L6 34 Q6 29 11 28 L30 25 L41 13 Q43 11 47 11 L72 11 Q76 11 79 14 L91 25 L101 27 Q106 28 106 34 L106 46 Z" style={outline(color)} />
      <path d="M33 25 L43 15 Q44 14 46 14 L56 14 L56 25 Z M60 14 L72 14 Q74 14 76 16 L85 25 L60 25 Z" style={pale(GLASS)} />
      <path d="M58 28 L58 44 M64 31 L68 31" style={pen(shade(color, 70), 1.2)} />
      <path d="M100 31 L105 32" style={pen("#FDE047", 3)} />
      <path d="M6.5 32 L10 32" style={pen("#B91C1C", 3)} />
      <Wheel x={28} y={46} r={10} />
      <Wheel x={84} y={46} r={10} />
    </Frame>
  );
}

export function Train({ color }: ArtProps) {
  return (
    <Frame type="train">
      {/* 蒸汽机车：左边是司机室，右边是锅炉、烟囱和排障器 */}
      <circle cx={100} cy={7} r={4} style={{ fill: "#E5E7EB" }} />
      <circle cx={109} cy={4} r={3} style={{ fill: "#E5E7EB" }} />
      <path d="M80 28 L80 15 L76 10 L92 10 L88 15 L88 28 Z" style={outline(DARK)} />
      <path d="M36 28 L96 28 Q104 28 104 40 Q104 52 96 52 L36 52 Z" style={outline(color)} />
      <path d="M54 28 A6 6 0 0 1 66 28 Z" style={outline(color)} />
      <path d="M50 28 L50 52 M72 28 L72 52" style={pen("#FACC15", 2)} />
      <path d="M8 16 L36 16 L36 52 L8 52 Z" style={outline(color)} />
      <path d="M5 16 L39 16 L39 11 L5 11 Z" style={outline(DARK)} />
      <rect x={14} y={22} width={16} height={12} rx={1.5} style={pale(GLASS)} />
      <path d="M104 52 L114 62 L100 62 Z" style={outline(DARK)} />
      <rect x={6} y={52} width={100} height={6} style={{ fill: DARK }} />
      <Wheel x={24} y={61} r={9} />
      {[52, 72, 92].map((x) => (
        <Wheel key={x} x={x} y={63} r={7} />
      ))}
      <path d="M52 63 L92 63" style={pen("#9CA3AF", 2)} />
    </Frame>
  );
}

export function BulletTrain({ color }: ArtProps) {
  return (
    <Frame type="bullet-train">
      <path d="M2 50 L138 50" style={pen("#94A3B8", 1.5)} />
      <path d="M50 18 L56 10 L62 18 M54 10 L66 10" style={pen("#64748B", 1.4)} />
      {/* 车头在右，流线型 */}
      <path d="M6 18 L96 18 Q120 18 134 38 Q136 43 130 44 L6 44 Z" style={pale(WHITE)} />
      <path d="M6 34 L127 34 Q130 36 131.5 38.5 L6 38.5 Z" style={{ fill: color }} />
      <path d="M100 20 Q114 22 122 30 L104 30 Z" style={{ fill: "#1E293B" }} />
      {Array.from({ length: 7 }, (_, i) => (
        <rect key={i} x={12 + i * 12} y={23} width={8} height={6} rx={1.5} style={{ fill: "#1E293B" }} />
      ))}
      {[20, 30, 100, 110].map((x) => (
        <circle key={x} cx={x} cy={46} r={3.5} style={{ fill: DARK }} />
      ))}
    </Frame>
  );
}

export function Ship({ color }: ArtProps) {
  return (
    <Frame type="ship">
      <path d="M56 24 L58 8 L68 8 L70 24 Z M74 24 L76 8 L86 8 L88 24 Z" style={outline("#F59E0B")} />
      <path d="M57.5 8 L68.5 8 L68 12 L57.6 12 Z M75.5 8 L86.5 8 L86 12 L75.6 12 Z" style={{ fill: DARK }} />
      <rect x={44} y={24} width={52} height={10} style={pale(WHITE)} />
      <rect x={30} y={34} width={76} height={16} style={pale(WHITE)} />
      {Array.from({ length: 8 }, (_, i) => (
        <rect key={i} x={35 + i * 9} y={39} width={5} height={5} rx={1} style={{ fill: "#1E3A8A" }} />
      ))}
      <path d="M6 50 L124 50 L112 70 L18 70 Z" style={outline(color)} />
      <path d="M14 64 L116 64 L112 70 L18 70 Z" style={{ fill: shade(color, 60) }} />
      {Array.from({ length: 7 }, (_, i) => (
        <circle key={i} cx={30 + i * 12} cy={57} r={2.2} style={{ fill: "rgba(255,255,255,0.85)" }} />
      ))}
      <path d={waves(74, 4, 128)} style={pen("#60A5FA", 2)} />
    </Frame>
  );
}

export function Sailboat({ color }: ArtProps) {
  return (
    <Frame type="sailboat">
      <path d="M48 8 L48 70" style={pen("#78350F", 2.5)} />
      <path d="M48 8 L58 11 L48 14 Z" style={{ fill: "#EF4444" }} />
      <path d="M50 12 L50 64 L82 64 Z" style={{ fill: color, stroke: shade(color, 78), strokeWidth: 1.2, strokeLinejoin: "round" }} />
      <path d="M46 16 L46 64 L18 64 Z" style={{ fill: color, stroke: shade(color, 78), strokeWidth: 1.2, strokeLinejoin: "round", opacity: 0.85 }} />
      <path d="M12 70 L84 70 L74 84 L22 84 Z" style={outline("#92400E")} />
      <path d="M16 75 L80 75" style={pen("#FDE68A", 1.5)} />
      <path d={waves(90, 4, 92)} style={pen("#60A5FA", 2)} />
    </Frame>
  );
}

export function Airplane({ color }: ArtProps) {
  return (
    <Frame type="airplane">
      {/* 侧视，机头朝右；先画远侧机翼，再画机身和近侧机翼 */}
      <path d="M60 28 L78 10 L88 10 L76 28 Z" style={pale("#E2E8F0")} />
      <path d="M14 27 L8 5 L20 5 L33 27 Z" style={outline(color)} />
      <path d="M10 34 Q10 26 20 26 L104 26 Q122 26 126 34 Q122 41 104 41 L20 41 Q10 41 10 34 Z" style={pale(WHITE)} />
      <path d="M20 37 L119 37" style={pen(color, 2)} />
      {Array.from({ length: 12 }, (_, i) => (
        <circle key={i} cx={30 + i * 6} cy={31} r={1.4} style={{ fill: "#1E3A8A" }} />
      ))}
      <path d="M111 29 L119 30.5 L118 33 L110 32.5 Z" style={{ fill: "#1E293B" }} />
      <path d="M54 37 L78 62 L90 62 L74 37 Z" style={pale("#E2E8F0")} />
      <ellipse cx={70} cy={47} rx={8} ry={3.8} style={pale("#94A3B8")} />
    </Frame>
  );
}

export function Rocket({ color }: ArtProps) {
  return (
    <Frame type="rocket">
      <path d="M24 92 Q32 112 40 92 Z" style={{ fill: "#F59E0B" }} />
      <path d="M28 92 Q32 104 36 92 Z" style={{ fill: "#FDE047" }} />
      <path d="M24 84 L22 92 L42 92 L40 84 Z" style={outline("#64748B")} />
      <path d="M18 62 L6 86 L18 82 Z M46 62 L58 86 L46 82 Z" style={outline(color)} />
      <path d="M32 4 Q46 18 46 40 L46 84 L18 84 L18 40 Q18 18 32 4 Z" style={pale(WHITE)} />
      <path d="M32 4 Q42 14 44.5 28 L19.5 28 Q22 14 32 4 Z" style={outline(color)} />
      <circle cx={32} cy={46} r={7} style={{ fill: GLASS, stroke: color, strokeWidth: 2.5 }} />
      <path d="M28.5 42.5 Q30 41 32 41" style={pen("rgba(255,255,255,0.9)", 1.5)} />
    </Frame>
  );
}

export function Starship({ variant }: ArtProps) {
  const body = "M28 6 Q40 14 40 34 L40 118 L16 118 L16 34 Q16 14 28 6 Z";
  return (
    <Frame type="starship">
      {variant.id === "flight" ? (
        <>
          <path d="M18 122 Q28 146 38 122 Z" style={{ fill: "#F97316" }} />
          <path d="M22 122 Q28 136 34 122 Z" style={{ fill: "#FDE047" }} />
        </>
      ) : null}
      <path d="M19 118 L18 123 L24 123 L23 118 Z M25 118 L24.5 123 L31.5 123 L31 118 Z M33 118 L32 123 L38 123 L37 118 Z" style={{ fill: "#64748B" }} />
      <path d={body} style={{ fill: STEEL, stroke: "#64748B", strokeWidth: 1.2, strokeLinejoin: "round" }} />
      {/* 迎风面的黑色隔热瓦 */}
      <path d="M16 34 Q16 14 28 6 Q22 16 22 34 L22 118 L16 118 Z" style={{ fill: DARK }} />
      <path d="M22 50 L40 50 M22 70 L40 70 M22 90 L40 90 M22 108 L40 108" style={pen("#94A3B8", 0.8)} />
      <path d="M16 30 L8 38 L8 50 L16 46 Z M40 30 L48 38 L48 50 L40 46 Z M16 96 L6 106 L6 120 L16 118 Z M40 96 L50 106 L50 120 L40 118 Z" style={{ fill: "#475569" }} />
    </Frame>
  );
}

export function Satellite({ color }: ArtProps) {
  const panel = (x: number) => (
    <g key={x}>
      <rect x={x} y={30} width={32} height={20} style={{ fill: "#1D4ED8", stroke: "#1E3A8A", strokeWidth: 1 }} />
      <path d={`M${x + 8} 30 L${x + 8} 50 M${x + 16} 30 L${x + 16} 50 M${x + 24} 30 L${x + 24} 50 M${x} 40 L${x + 32} 40`} style={pen("rgba(255,255,255,0.35)", 0.8)} />
    </g>
  );
  return (
    <Frame type="satellite">
      <path d="M36 40 L42 40 M68 40 L74 40 M55 54 L55 64" style={pen("#94A3B8", 2)} />
      {panel(4)}
      {panel(74)}
      <circle cx={55} cy={66} r={2.2} style={{ fill: "#94A3B8" }} />
      <rect x={42} y={26} width={26} height={28} rx={2} style={outline(color)} />
      <path d="M46 32 L64 32 M46 40 L60 40 M46 48 L62 48" style={pen(shade(color, 80), 0.8)} />
      <path d="M52 26 L50 18" style={pen("#94A3B8", 1.6)} />
      <path d="M40 12 Q50 24 62 14 Z" style={pale(WHITE)} />
      <path d="M51 16 L55 9" style={pen("#94A3B8", 1.2)} />
    </Frame>
  );
}
