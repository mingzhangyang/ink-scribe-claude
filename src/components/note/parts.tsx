import type { CSSProperties } from "react";
import type { DoodleSpec } from "../../../shared/doodle.ts";
import type { NoteCue, NoteSection, NoteStructure } from "../../../shared/note.ts";
import { detectLanguage } from "../../../shared/text.ts";
import { blockJitter, HandContent, HandText } from "./HandText.tsx";
import { DoodleArt } from "./DoodleArt.tsx";

export type Labels = { lang: "zh-CN" | "en"; cues: string; summary: string; notes: string; topic: string; date: string; keywords: string };

const ZH_LABELS: Labels = { lang: "zh-CN", cues: "线索", summary: "总结", notes: "笔记", topic: "主题", date: "日期", keywords: "关键词" };
const EN_LABELS: Labels = { lang: "en", cues: "Cues", summary: "Summary", notes: "Notes", topic: "Topic", date: "Date", keywords: "Keywords" };

export function labelsFor(note: NoteStructure): Labels {
  const sample = [note.title, note.summary, ...note.sections.map((s) => s.content)].join("\n");
  return detectLanguage(sample) === "zh" ? ZH_LABELS : EN_LABELS;
}

export type LayoutProps = {
  note: NoteStructure;
  labels: Labels;
  seed: number;
  naturalness: number;
  doodle: DoodleSpec | null;
};

/** 手绘下划线（略带起伏的线条），用于标题与小标题。 */
export function Underline({ seed, width = 100, className }: { seed: number; width?: number; className?: string }) {
  const wobble = ((seed % 7) - 3) * 0.35;
  return (
    <svg className={`hand-underline ${className ?? ""}`} viewBox={`0 0 ${width} 8`} preserveAspectRatio="none" aria-hidden="true">
      <path
        d={`M1 ${4.5 + wobble} C ${width * 0.25} ${2 - wobble}, ${width * 0.55} ${6.5 + wobble}, ${width - 1} ${3.5 - wobble}`}
        style={{ fill: "none", stroke: "var(--doodle-accent)", strokeWidth: 2.2, strokeLinecap: "round", opacity: 0.85 }}
      />
    </svg>
  );
}

export function NoteTitle({ note, seed, naturalness, style }: { note: NoteStructure; seed: number; naturalness: number; style?: CSSProperties }) {
  return (
    <h1 className="note-title" style={{ ...blockJitter(seed, naturalness, 0.8, 3), ...style }}>
      <HandText text={note.title} seed={seed} naturalness={naturalness} />
      <Underline seed={seed} width={300} />
    </h1>
  );
}

export function NoteDate({ date, seed, naturalness, label }: { date?: string; seed: number; naturalness: number; label?: string }) {
  if (!date) return null;
  return (
    <div className="note-date">
      {label ? <span className="note-date-label">{label}：</span> : null}
      <HandText text={date} seed={seed + 3} naturalness={naturalness} />
    </div>
  );
}

export function CueList({
  cues,
  seed,
  naturalness,
  variant = "list",
}: {
  cues: NoteCue[];
  seed: number;
  naturalness: number;
  variant?: "list" | "question" | "chips" | "tags";
}) {
  if (cues.length === 0) return null;
  if (variant === "chips" || variant === "tags") {
    return (
      <div className={`cue-${variant}`}>
        {cues.map((cue, i) => (
          <span key={i} className={`cue-chip cue-chip-${i % 3}`} style={blockJitter(seed + i * 17, naturalness, 2.2, 1)}>
            {variant === "tags" ? "#" : null}
            <HandText text={cue.keyword} seed={seed + i} naturalness={naturalness} />
            {variant === "chips" && cue.note && Array.from(cue.note).length <= 18 ? (
              <small>
                <HandText text={cue.note} seed={seed + i + 50} naturalness={naturalness} />
              </small>
            ) : null}
          </span>
        ))}
      </div>
    );
  }
  return (
    <ul className={`cue-list cue-list-${variant}`}>
      {cues.map((cue, i) => (
        <li key={i} className="cue-item" style={blockJitter(seed + i * 31, naturalness, 0.9, 2)}>
          <div className="cue-keyword">
            <HandText text={cue.keyword} seed={seed + i} naturalness={naturalness} />
          </div>
          {cue.note ? (
            <div className="cue-note">
              <HandText text={cue.note} seed={seed + i + 50} naturalness={naturalness} />
            </div>
          ) : null}
        </li>
      ))}
    </ul>
  );
}

/** 只给带小标题的段落编号，避免第一个段落没有标题时编号从 2 开始。 */
export function headingNumbers(sections: NoteSection[]): Array<number | undefined> {
  let n = 0;
  return sections.map((s) => (s.heading ? ++n : undefined));
}

export function SectionBlock({
  section,
  index,
  number,
  seed,
  naturalness,
  className,
}: {
  section: NoteSection;
  index: number;
  /** 小标题前的序号；不传则不显示。 */
  number?: number;
  seed: number;
  naturalness: number;
  className?: string;
}) {
  const s = seed + index * 977;
  return (
    <section className={`note-section ${className ?? ""}`} style={blockJitter(s, naturalness)}>
      {section.heading ? (
        <h2 className="section-heading">
          {number !== undefined ? <span className="section-index">{number}</span> : null}
          <HandText text={section.heading} seed={s + 1} naturalness={naturalness} />
        </h2>
      ) : null}
      <HandContent text={section.content} highlights={section.highlights} seed={s + 2} naturalness={naturalness} />
    </section>
  );
}

export function SummaryText({ text, seed, naturalness }: { text: string; seed: number; naturalness: number }) {
  if (!text) return null;
  return <HandContent className="summary-text" text={text} seed={seed + 4242} naturalness={naturalness} />;
}

export function DoodleSlot({ doodle, seed, naturalness, className }: { doodle: DoodleSpec | null; seed: number; naturalness: number; className?: string }) {
  if (!doodle) return null;
  return (
    <div className={`doodle-slot ${className ?? ""}`} style={blockJitter(seed + 9, naturalness, 4, 4)}>
      <DoodleArt spec={doodle} seed={seed} naturalness={naturalness} className="doodle-svg" />
    </div>
  );
}

/** 纸胶带装饰（版式的一部分，不可拖动）。 */
export function TapeDecoration({ className, color = "#FDE68A", style }: { className?: string; color?: string; style?: CSSProperties }) {
  return (
    <svg className={`tape-deco ${className ?? ""}`} viewBox="0 0 120 30" preserveAspectRatio="none" aria-hidden="true" style={style}>
      <path d="M3 2 L117 1 L114 6 L118 11 L114 16 L118 21 L115 29 L2 28 L5 22 L1 16 L5 10 L1 5 Z" style={{ fill: color, opacity: 0.78 }} />
      <path d="M8 9 L112 8 M8 20 L112 19" style={{ stroke: "rgba(255,255,255,0.55)", strokeWidth: 2, fill: "none" }} />
    </svg>
  );
}
