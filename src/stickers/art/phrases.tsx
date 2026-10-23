import { signedRandom } from "../../lib/random.ts";
import { Frame, PAPER, pen, pt, type ArtProps } from "./common.tsx";
import { PHRASE_PATHS } from "./phrase-paths.ts";

/** 流行语：“夯”“给力”是带白边的贴纸字，“同意”是审批章，“知行合一”是方印。 */

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
