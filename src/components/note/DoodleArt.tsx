import { memo, useMemo } from "react";
import { normalizeDoodleSpec, type DoodleFill, type DoodleSpec, type DoodleStroke } from "../../../shared/doodle.ts";
import { hashString, signedRandom } from "../../lib/random.ts";
import { sketchElements } from "../../lib/sketch.ts";

const STROKE_COLORS: Record<DoodleStroke, string> = {
  ink: "var(--ink)",
  accent: "var(--doodle-accent)",
  muted: "var(--ink-muted)",
};

const FILL_COLORS: Record<Exclude<DoodleFill, "none">, string> = {
  yellow: "#FEF08A",
  green: "#BBF7D0",
  orange: "#FED7AA",
  ink: "var(--ink)",
};

type Props = {
  spec: DoodleSpec;
  seed: number;
  naturalness: number;
  className?: string;
  title?: string;
};

/**
 * 受控 SVG 渲染：只输出 <svg>/<g>/<path>，颜色来自固定调色板。
 * 渲染前再次执行规范化，即使调用方传入未经校验的数据也不会渲染额外内容。
 */
export const DoodleArt = memo(function DoodleArt({ spec, seed, naturalness, className, title }: Props) {
  const shape = useMemo(() => {
    const safe = normalizeDoodleSpec(spec);
    if (!safe.ok) return null;
    const rand = signedRandom(seed ^ hashString(safe.value.concept));
    return sketchElements(safe.value.elements, rand, naturalness);
  }, [spec, seed, naturalness]);

  if (!shape) return null;
  return (
    <svg className={className} viewBox="-4 -4 108 108" role="img" aria-label={title ?? spec.concept}>
      <g style={{ mixBlendMode: "multiply" }}>
        {shape.fills.map((f, i) => (
          <path key={`f${i}`} d={f.d} style={{ fill: FILL_COLORS[f.fill], opacity: f.fill === "ink" ? 0.9 : 0.85 }} />
        ))}
      </g>
      <g style={{ fill: "none", strokeLinecap: "round", strokeLinejoin: "round" }}>
        {shape.strokes.map((s, i) => (
          <path key={`s${i}`} d={s.d} style={{ stroke: STROKE_COLORS[s.stroke], strokeWidth: s.width, opacity: s.opacity }} />
        ))}
      </g>
    </svg>
  );
});
