import { memo, type CSSProperties, type ReactNode } from "react";
import { hashString, mulberry32 } from "../../lib/random.ts";
import { graphemes, parseContentLines, splitHighlights } from "../../lib/segments.ts";

/** 超过该长度时按词而非按字抖动，控制 DOM 节点数量，保证拖拽与导出流畅。 */
const PER_CHAR_LIMIT = 2_400;

function jitter(text: string, rand: () => number, perChar: boolean): ReactNode[] {
  const nodes: ReactNode[] = [];
  const units = perChar ? graphemes(text) : text.split(/(\s+)/);
  units.forEach((unit, i) => {
    if (!unit) return;
    if (/^\s+$/.test(unit)) {
      nodes.push(unit);
      return;
    }
    nodes.push(
      <span key={i} className={`j j${Math.floor(rand() * 8)}`}>
        {unit}
      </span>,
    );
  });
  return nodes;
}

type HandTextProps = {
  text: string;
  highlights?: string[];
  seed: number;
  naturalness: number;
};

/** 单行或短文本：逐字轻微上下浮动，重点短语用荧光笔标记。 */
export const HandText = memo(function HandText({ text, highlights = [], seed, naturalness }: HandTextProps) {
  const runs = splitHighlights(text, highlights);
  const animate = naturalness > 0.02;
  const rand = mulberry32(seed ^ hashString(text));
  const perChar = text.length <= PER_CHAR_LIMIT;
  return (
    <>
      {runs.map((run, i) => {
        const content = animate ? jitter(run.text, rand, perChar) : run.text;
        return run.highlight === null ? (
          <span key={i}>{content}</span>
        ) : (
          <mark key={i} className={`hl hl-${(run.highlight + (seed % 3)) % 3}`}>
            {content}
          </mark>
        );
      })}
    </>
  );
});

type ContentProps = HandTextProps & { className?: string };

/** 段落正文：识别列表行，每行独立抖动。 */
export const HandContent = memo(function HandContent({ text, highlights = [], seed, naturalness, className }: ContentProps) {
  const lines = parseContentLines(text);
  return (
    <div className={`hand-content ${className ?? ""}`}>
      {lines.map((line, i) => {
        const lineSeed = seed + i * 101;
        switch (line.kind) {
          case "gap":
            return <div key={i} className="hand-gap" />;
          case "bullet":
            return (
              <p key={i} className="hand-line hand-bullet">
                <HandText text={line.text} highlights={highlights} seed={lineSeed} naturalness={naturalness} />
              </p>
            );
          case "numbered":
            return (
              <p key={i} className="hand-line hand-numbered" data-marker={line.marker}>
                <HandText text={line.text} highlights={highlights} seed={lineSeed} naturalness={naturalness} />
              </p>
            );
          default:
            return (
              <p key={i} className="hand-line">
                <HandText text={line.text} highlights={highlights} seed={lineSeed} naturalness={naturalness} />
              </p>
            );
        }
      })}
    </div>
  );
});

/** 块级元素的轻微旋转与位移，幅度受“自然度”控制。 */
export function blockJitter(seed: number, naturalness: number, maxDeg = 0.6, maxShift = 2): CSSProperties {
  if (naturalness <= 0.02) return {};
  const rand = mulberry32(seed);
  const deg = (rand() * 2 - 1) * maxDeg * naturalness;
  const dx = (rand() * 2 - 1) * maxShift * naturalness;
  return { transform: `translateX(${dx.toFixed(2)}px) rotate(${deg.toFixed(3)}deg)` };
}
