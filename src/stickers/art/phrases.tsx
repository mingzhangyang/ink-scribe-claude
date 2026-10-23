import { signedRandom } from "../../lib/random.ts";
import { Frame, PAPER, pen, pt, type ArtProps } from "./common.tsx";
import { PHRASE_PATHS } from "./phrase-paths.ts";

/** 流行语：“夯”“给力”“躺平”等是带白边的贴纸字，“同意”“完美”是印章，“知行合一”是方印。 */

/** 沿字形裁下来的贴纸：一圈白边，下面一层浅投影。 */
function DieCut({ d, color }: { d: string; color: string }) {
  const edge = { strokeWidth: 7, strokeLinejoin: "round" } as const;
  return (
    <>
      <path d={d} transform="translate(1.5 2)" style={{ ...edge, fill: "rgba(0,0,0,0.15)", stroke: "rgba(0,0,0,0.15)" }} />
      <path d={d} style={{ ...edge, fill: "#FFFFFF", stroke: "#FFFFFF" }} />
      <path d={d} style={{ fill: color }} />
    </>
  );
}

export function Hang({ color }: ArtProps) {
  return (
    <Frame type="hang">
      <DieCut d={PHRASE_PATHS.hang} color={color} />
      <path d="M60 12 L66 5 M64 21 L71 18 M53 8 L54 2" style={pen(color, 2.4)} />
    </Frame>
  );
}

export function Geili({ color }: ArtProps) {
  return (
    <Frame type="geili">
      <DieCut d={PHRASE_PATHS.geili} color={color} />
      <path d="M100 10 L106 4 M103 20 L109 18 M5 52 L1 58" style={pen(color, 2.4)} />
    </Frame>
  );
}

export function Juan({ color }: ArtProps) {
  // “卷”旁边一个小漩涡
  return (
    <Frame type="juan">
      <DieCut d={PHRASE_PATHS.juan} color={color} />
      <path d="M58 9 C64 3 72 8 69 14 C67 18 61 17 62 13 C63 11 65 11 66 12" style={pen(color, 2.2)} />
    </Frame>
  );
}

export function Tangping({ color }: ArtProps) {
  // 躺下睡着了：右上角的“Zz”
  return (
    <Frame type="tangping">
      <DieCut d={PHRASE_PATHS.tangping} color={color} />
      <path d="M95 8 L103 8 L95 16 L103 16 M101 0.5 L106 0.5 L101 5.5 L106 5.5" style={pen(color, 2)} />
    </Frame>
  );
}

export function Zhengnengliang({ color }: ArtProps) {
  return (
    <Frame type="zhengnengliang">
      <DieCut d={PHRASE_PATHS.zhengnengliang} color={color} />
      <path d="M6 9 L6 19 M1 14 L11 14 M134 42 L134 50 M130 46 L138 46" style={pen(color, 2.4)} />
    </Frame>
  );
}

export function Tainiule({ color }: ArtProps) {
  return (
    <Frame type="tainiule">
      <DieCut d={PHRASE_PATHS.tainiule} color={color} />
      <path d="M128 10 L134 3 M132 19 L139 16 M121 6 L122 0" style={pen(color, 2.4)} />
    </Frame>
  );
}

export function Yyds({ color }: ArtProps) {
  // YYDS（永远的神）：头顶一顶金色小皇冠
  return (
    <Frame type="yyds">
      <DieCut d={PHRASE_PATHS.yyds} color={color} />
      <path
        d="M48 17 L50 6 L56 12 L60 3 L64 12 L70 6 L72 17 Z"
        style={{ fill: "#FACC15", stroke: "#FFFFFF", strokeWidth: 4, strokeLinejoin: "round", paintOrder: "stroke" }}
      />
      <path d="M48 17 L50 6 L56 12 L60 3 L64 12 L70 6 L72 17 Z" style={{ fill: "none", stroke: "#CA8A04", strokeWidth: 1, strokeLinejoin: "round" }} />
    </Frame>
  );
}

/** 印泥没有压实的地方露出纸色，按贴纸 ID 撒在印面上。 */
function Speckles({ seed, x, y, w, h, count }: { seed: number; x: number; y: number; w: number; h: number; count: number }) {
  const rand = signedRandom(seed);
  const unit = () => (rand() + 1) / 2;
  return (
    <>
      {Array.from({ length: count }, (_, i) => (
        <circle key={i} cx={(x + unit() * w).toFixed(1)} cy={(y + unit() * h).toFixed(1)} r={(0.6 + unit() * 1.6).toFixed(1)} style={{ fill: PAPER }} />
      ))}
    </>
  );
}

/** 略不平整的矩形印边。 */
function roughRect(seed: number, x: number, y: number, w: number, h: number): string {
  const rand = signedRandom(seed);
  return `M${[
    [x, y],
    [x + w, y],
    [x + w, y + h],
    [x, y + h],
  ]
    .map(([px, py]) => pt(px + rand() * 1.2, py + rand() * 1.2))
    .join(" L")} Z`;
}

export function Tongyi({ color, seed }: ArtProps) {
  return (
    <Frame type="tongyi">
      <g style={{ opacity: 0.9 }}>
        <path d={roughRect(seed, 5, 5, 90, 46)} style={{ fill: "none", stroke: color, strokeWidth: 3.4, strokeLinejoin: "round" }} />
        <path d={roughRect(seed + 1, 10, 9.5, 80, 37)} style={{ fill: "none", stroke: color, strokeWidth: 1.2 }} />
        <path d={PHRASE_PATHS.tongyi} style={{ fill: color }} />
        <Speckles seed={seed} x={6} y={6} w={88} h={44} count={10} />
      </g>
    </Frame>
  );
}

/** 椭圆形的批改章，两侧各一颗小星。 */
export function Wanmei({ color, seed }: ArtProps) {
  const star = (cx: number) => {
    const points = Array.from({ length: 10 }, (_, i) => {
      const a = -Math.PI / 2 + (i * Math.PI) / 5;
      const r = i % 2 === 0 ? 4.5 : 1.9;
      return pt(cx + Math.cos(a) * r, 32 + Math.sin(a) * r);
    });
    return `M${points.join(" L")} Z`;
  };
  return (
    <Frame type="wanmei">
      <g style={{ opacity: 0.9 }}>
        <ellipse cx={50} cy={32} rx={46} ry={28} style={{ fill: "none", stroke: color, strokeWidth: 3.2 }} />
        <ellipse cx={50} cy={32} rx={41} ry={23.5} style={{ fill: "none", stroke: color, strokeWidth: 1.1 }} />
        <path d={`${PHRASE_PATHS.wanmei} ${star(17)} ${star(83)}`} style={{ fill: color }} />
        <Speckles seed={seed} x={8} y={6} w={84} h={52} count={10} />
      </g>
    </Frame>
  );
}

export function Zhixingheyi({ color, variant, seed }: ArtProps) {
  const border = roughRect(seed, 5, 5, 70, 70);
  return (
    <Frame type="zhixingheyi">
      <g style={{ opacity: 0.92 }}>
        {variant.id === "baiwen" ? (
          // 白文：字刻掉，印面红底，字露出纸色
          <>
            <path d={border} style={{ fill: color, stroke: color, strokeWidth: 2, strokeLinejoin: "round" }} />
            <path d={PHRASE_PATHS.zhixingheyi} style={{ fill: PAPER }} />
          </>
        ) : (
          // 朱文：字与印边是红色
          <>
            <path d={border} style={{ fill: "none", stroke: color, strokeWidth: 4.2, strokeLinejoin: "round" }} />
            <path d={PHRASE_PATHS.zhixingheyi} style={{ fill: color }} />
          </>
        )}
        <Speckles seed={seed} x={6} y={6} w={68} h={68} count={12} />
      </g>
    </Frame>
  );
}
