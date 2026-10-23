import type { NoteCue, NoteSection, NoteStructure } from "../../shared/note.ts";
import { NOTE_LIMITS } from "../../shared/note.ts";
import { useT } from "../i18n/index.ts";
import { useNoteStore } from "../state/store.ts";

function splitHighlights(value: string): string[] {
  return value
    .split(/[;；,，、\n]/)
    .map((s) => s.trim())
    .filter(Boolean)
    .slice(0, NOTE_LIMITS.maxHighlights);
}

/** 结构化编辑：直接修改画布使用的 NoteStructure，便于修正 AI 的遗漏或措辞。 */
export function ContentEditor() {
  const note = useNoteStore((s) => s.note);
  const updateNote = useNoteStore((s) => s.updateNote);
  const t = useT();
  if (!note) return null;

  const patch = (p: Partial<NoteStructure>) => updateNote((n) => ({ ...n, ...p }));
  const patchCue = (i: number, p: Partial<NoteCue>) => patch({ cues: note.cues.map((c, j) => (j === i ? { ...c, ...p } : c)) });
  const patchSection = (i: number, p: Partial<NoteSection>) =>
    patch({ sections: note.sections.map((s, j) => (j === i ? { ...s, ...p } : s)) });
  const moveSection = (i: number, delta: number) => {
    const target = i + delta;
    if (target < 0 || target >= note.sections.length) return;
    const sections = [...note.sections];
    [sections[i], sections[target]] = [sections[target], sections[i]];
    patch({ sections });
  };

  return (
    <div className="panel-body content-editor">
      <label className="field">
        <span>{t.content.title}</span>
        <input type="text" value={note.title} maxLength={NOTE_LIMITS.title} onChange={(e) => patch({ title: e.target.value })} />
      </label>
      <label className="field">
        <span>{t.content.date}</span>
        <input type="text" value={note.date ?? ""} maxLength={NOTE_LIMITS.date} onChange={(e) => patch({ date: e.target.value || undefined })} />
      </label>

      <fieldset className="field">
        <legend>{t.content.cues(note.cues.length, NOTE_LIMITS.maxCues)}</legend>
        {note.cues.map((cue, i) => (
          <div key={i} className="editor-row">
            <input
              type="text"
              value={cue.keyword}
              maxLength={NOTE_LIMITS.cueKeyword}
              placeholder={t.content.cueKeyword}
              aria-label={t.content.cueKeywordLabel(i + 1)}
              onChange={(e) => patchCue(i, { keyword: e.target.value })}
            />
            <input
              type="text"
              value={cue.note}
              maxLength={NOTE_LIMITS.cueNote}
              placeholder={t.content.cueNote}
              aria-label={t.content.cueNoteLabel(i + 1)}
              onChange={(e) => patchCue(i, { note: e.target.value })}
            />
            <button type="button" className="icon-btn" aria-label={t.content.removeCue(i + 1)} onClick={() => patch({ cues: note.cues.filter((_, j) => j !== i) })}>
              ×
            </button>
          </div>
        ))}
        {note.cues.length < NOTE_LIMITS.maxCues ? (
          <button type="button" className="btn btn-link" onClick={() => patch({ cues: [...note.cues, { keyword: t.content.newCue, note: "" }] })}>
            {t.content.addCue}
          </button>
        ) : null}
      </fieldset>

      <fieldset className="field">
        <legend>{t.content.sections(note.sections.length, NOTE_LIMITS.maxSections)}</legend>
        {note.sections.map((section, i) => {
          const missing = section.highlights.filter((h) => !section.content.toLowerCase().includes(h.toLowerCase()));
          return (
            <div key={i} className="section-editor">
              <div className="editor-row">
                <input
                  type="text"
                  value={section.heading ?? ""}
                  maxLength={NOTE_LIMITS.heading}
                  placeholder={t.content.heading}
                  aria-label={t.content.headingLabel(i + 1)}
                  onChange={(e) => patchSection(i, { heading: e.target.value || undefined })}
                />
                <button type="button" className="icon-btn" aria-label={t.content.moveUp} disabled={i === 0} onClick={() => moveSection(i, -1)}>
                  ↑
                </button>
                <button type="button" className="icon-btn" aria-label={t.content.moveDown} disabled={i === note.sections.length - 1} onClick={() => moveSection(i, 1)}>
                  ↓
                </button>
                <button
                  type="button"
                  className="icon-btn"
                  aria-label={t.content.removeSection(i + 1)}
                  disabled={note.sections.length <= 1}
                  onClick={() => patch({ sections: note.sections.filter((_, j) => j !== i) })}
                >
                  ×
                </button>
              </div>
              <textarea
                value={section.content}
                rows={4}
                maxLength={NOTE_LIMITS.content}
                aria-label={t.content.bodyLabel(i + 1)}
                onChange={(e) => patchSection(i, { content: e.target.value })}
              />
              <input
                type="text"
                defaultValue={section.highlights.join("；")}
                key={`${i}-${section.highlights.join("|")}`}
                placeholder={t.content.highlights}
                aria-label={t.content.highlightsLabel(i + 1)}
                onBlur={(e) => patchSection(i, { highlights: splitHighlights(e.target.value) })}
              />
              {missing.length > 0 ? <p className="hint is-warn">{t.content.missing(missing)}</p> : null}
            </div>
          );
        })}
        {note.sections.length < NOTE_LIMITS.maxSections ? (
          <button
            type="button"
            className="btn btn-link"
            onClick={() => patch({ sections: [...note.sections, { heading: t.content.newSectionHeading, content: t.content.newSectionContent, highlights: [] }] })}
          >
            {t.content.addSection}
          </button>
        ) : null}
      </fieldset>

      <label className="field">
        <span>{t.content.summary}</span>
        <textarea value={note.summary} rows={3} maxLength={NOTE_LIMITS.summary} onChange={(e) => patch({ summary: e.target.value })} />
      </label>
    </div>
  );
}
