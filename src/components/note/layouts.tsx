import type { JSX } from "react";
import type { NoteStyle } from "../../../shared/options.ts";
import { blockJitter } from "./HandText.tsx";
import {
  CueList,
  DoodleSlot,
  headingNumbers,
  NoteDate,
  NoteTitle,
  SectionBlock,
  SummaryText,
  TapeDecoration,
  type LayoutProps,
} from "./parts.tsx";

/**
 * 四种版式共用同一份 NoteStructure。编辑器、分享页与导出使用相同的 data-fit 区域，
 * 先测量真实字体下的布局，再按策略适配字号、扩展长图或阻止裁切的导出。
 */

function HybridCornell({ note, labels, seed, naturalness, doodle }: LayoutProps) {
  const numbers = headingNumbers(note.sections);
  return (
    <div className="note-body layout-grid" data-fit>
      <header className="note-header" data-fit>
        <NoteTitle note={note} seed={seed} naturalness={naturalness} />
        <NoteDate date={note.date} seed={seed} naturalness={naturalness} />
      </header>
      <aside className="note-cues" data-fit>
        <div className="region-label">{labels.cues}</div>
        <CueList cues={note.cues} seed={seed + 100} naturalness={naturalness} />
      </aside>
      <main className="note-main" data-fit>
        {note.sections.map((section, i) => (
          <SectionBlock key={i} section={section} index={i} number={numbers[i]} seed={seed} naturalness={naturalness} />
        ))}
      </main>
      <footer className="note-footer">
        {note.summary ? (
          <div className="summary-sticky" style={blockJitter(seed + 77, naturalness, 0, 2)} data-fit>
            <TapeDecoration className="summary-tape" />
            <div className="region-label">{labels.summary}</div>
            <SummaryText text={note.summary} seed={seed} naturalness={naturalness} />
          </div>
        ) : (
          <div />
        )}
        <DoodleSlot doodle={doodle} seed={seed} naturalness={naturalness} />
      </footer>
    </div>
  );
}

function ClassicCornell({ note, labels, seed, naturalness, doodle }: LayoutProps) {
  const numbers = headingNumbers(note.sections);
  return (
    <div className="note-body layout-grid" data-fit>
      <header className="note-header" data-fit>
        <div className="classic-field">
          <span className="classic-field-label">{labels.topic}</span>
          <NoteTitle note={note} seed={seed} naturalness={naturalness} />
        </div>
        <NoteDate date={note.date} seed={seed} naturalness={naturalness} label={labels.date} />
      </header>
      <aside className="note-cues" data-fit>
        <div className="region-label">{labels.cues}</div>
        <CueList cues={note.cues} seed={seed + 100} naturalness={naturalness} variant="question" />
      </aside>
      <main className="note-main" data-fit>
        <div className="region-label">{labels.notes}</div>
        {note.sections.map((section, i) => (
          <SectionBlock key={i} section={section} index={i} number={numbers[i]} seed={seed} naturalness={naturalness} />
        ))}
      </main>
      <footer className="note-footer" data-fit>
        <div className="classic-summary">
          <div className="region-label">{labels.summary}</div>
          <SummaryText text={note.summary} seed={seed} naturalness={naturalness} />
        </div>
        <DoodleSlot doodle={doodle} seed={seed} naturalness={naturalness} className="doodle-small" />
      </footer>
    </div>
  );
}

function FreeJournal({ note, labels, seed, naturalness, doodle }: LayoutProps) {
  return (
    <div className="note-body journal-body" data-fit>
      <header className="note-header journal-header" data-fit>
        <TapeDecoration className="journal-title-tape" color="#FBCFE8" />
        <NoteTitle note={note} seed={seed} naturalness={naturalness} />
        {note.date ? (
          <div className="journal-stamp" style={blockJitter(seed + 5, naturalness, 8, 2)}>
            <NoteDate date={note.date} seed={seed} naturalness={naturalness} />
          </div>
        ) : null}
      </header>
      <CueList cues={note.cues} seed={seed + 100} naturalness={naturalness} variant="chips" />
      <main className="journal-cards" data-fit>
        {note.sections.map((section, i) => (
          <SectionBlock
            key={i}
            section={section}
            index={i}
            seed={seed}
            naturalness={Math.min(1, naturalness * 1.6)}
            className={`journal-card journal-card-${i % 4}`}
          />
        ))}
      </main>
      <footer className="journal-footer">
        {note.summary ? (
          <div className="summary-sticky" style={blockJitter(seed + 77, naturalness, 0, 2)} data-fit>
            <div className="region-label">{labels.summary}</div>
            <SummaryText text={note.summary} seed={seed} naturalness={naturalness} />
          </div>
        ) : (
          <div />
        )}
        <DoodleSlot doodle={doodle} seed={seed} naturalness={naturalness} className="doodle-large" />
      </footer>
    </div>
  );
}

function Minimal({ note, labels, seed, naturalness, doodle }: LayoutProps) {
  return (
    <div className="note-body minimal-body" data-fit>
      <DoodleSlot doodle={doodle} seed={seed} naturalness={naturalness} className="doodle-corner" />
      <header className="note-header minimal-header" data-fit>
        <NoteTitle note={note} seed={seed} naturalness={naturalness} />
        <div className="minimal-meta">
          <NoteDate date={note.date} seed={seed} naturalness={naturalness} />
          <CueList cues={note.cues} seed={seed + 100} naturalness={naturalness} variant="tags" />
        </div>
      </header>
      <main className="note-main minimal-main">
        {note.sections.map((section, i) => (
          <SectionBlock key={i} section={section} index={i} seed={seed} naturalness={naturalness} />
        ))}
      </main>
      {note.summary ? (
        <footer className="minimal-summary">
          <div className="region-label">{labels.summary}</div>
          <SummaryText text={note.summary} seed={seed} naturalness={naturalness} />
        </footer>
      ) : null}
    </div>
  );
}

export const LAYOUTS: Record<NoteStyle, (props: LayoutProps) => JSX.Element> = {
  "hybrid-cornell": HybridCornell,
  "classic-cornell": ClassicCornell,
  "free-journal": FreeJournal,
  minimal: Minimal,
};
