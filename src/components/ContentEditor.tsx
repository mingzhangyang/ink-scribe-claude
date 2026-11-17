import { useState } from "react";
import type { NoteCue, NoteSection, NoteStructure } from "../../shared/note.ts";
import { NOTE_LIMITS } from "../../shared/note.ts";
import { DIAGRAM_LIMITS, DIAGRAM_TEMPLATES, type DiagramBlock, type DiagramTemplate } from "../../shared/diagram.ts";
import { insertDiagram, removeSection, reorderSection } from "../diagrams/editor.ts";
import { DiagramSectionEditor, TemplateGlyph } from "./DiagramSectionEditor.tsx";
import { useT } from "../i18n/index.ts";
import { useNoteStore } from "../state/store.ts";

function splitHighlights(value: string): string[] {
  return value
    .split(/[;；,，、\n]/)
    .map((s) => s.trim())
    .filter(Boolean)
    .slice(0, NOTE_LIMITS.maxHighlights);
}

/** Quick insert is intentionally at the TOP of Content, not buried after every cue. */
function DiagramQuickInsert() {
  const note = useNoteStore((s) => s.note);
  const updateDiagram = useNoteStore((s) => s.updateDiagram);
  const t = useT().content.diagrams;
  const [selectedSection, setSelectedSection] = useState(0);
  const [lastAdded, setLastAdded] = useState<{ block: DiagramBlock; index: number } | null>(null);
  if (!note) return null;

  const section = Math.min(selectedSection, Math.max(0, note.sections.length - 1));
  const total = note.diagrams?.length ?? 0;
  const full = total >= DIAGRAM_LIMITS.maxBlocks;
  const inserted = lastAdded && note.diagrams?.[lastAdded.index] === lastAdded.block ? lastAdded : null;
  const add = (template: DiagramTemplate) => {
    const nextIndex = useNoteStore.getState().note?.diagrams?.length ?? 0;
    updateDiagram((current) => insertDiagram(current, section, template));
    const saved = useNoteStore.getState().note?.diagrams;
    if (saved?.length === nextIndex + 1) setLastAdded({ block: saved[nextIndex], index: nextIndex });
  };

  return <fieldset className="diagram-quick-insert" id="diagram-quick-insert">
    <legend>{t.quickTitle} ({total}/{DIAGRAM_LIMITS.maxBlocks})</legend>
    {full
      ? <p className="hint">{t.limitReached} {t.quickManage}</p>
      : <>
        <label className="field diagram-quick-location">
          <span>{t.quickLocation}</span>
          <select value={section} onChange={(event) => setSelectedSection(Number(event.target.value))}
            aria-label={t.quickLocation}>
            {note.sections.map((item, i) => <option key={i} value={i}>
              {t.quickSection(i + 1, item.heading || "")}
            </option>)}
          </select>
        </label>
        <div className="diagram-template-picker diagram-quick-templates" role="group" aria-label={t.chooseTemplate}>
          {DIAGRAM_TEMPLATES.map((template) => <button
            type="button" key={template} className="diagram-template-choice"
            aria-label={t.insertTemplate(t.templateNames[template])}
            onClick={() => add(template)}>
            <TemplateGlyph template={template} />
            <span>{t.templateNames[template]}</span>
          </button>)}
        </div>
        <p className="hint">{t.quickHelp}</p>
      </>}
    {inserted ? <p className="hint is-ok" role="status">
      {t.quickAdded} <button type="button" className="btn btn-link" onClick={() => {
        const node = document.querySelector<HTMLElement>(
          '.diagram-section-controls[data-diagram-section="' + inserted.block.afterSection + '"] .diagram-editor-card[data-diagram-index="' + inserted.index + '"] .diagram-expand',
        );
        node?.scrollIntoView({ block: "center", behavior: "smooth" });
        node?.click();
        node?.focus({ preventScroll: true });
      }}>{t.quickEdit}</button>
    </p> : null}
  </fieldset>;
}

/** 结构化编辑：直接修改画布使用的 NoteStructure，便于修正 AI 的遗漏或措辞。 */
export function ContentEditor() {
  const note = useNoteStore((s) => s.note);
  const updateNote = useNoteStore((s) => s.updateNote);
  const t = useT();
  // Tie destructive confirmation to the section object AND diagram revision.
  // Reordering, replacing a section, or changing diagrams invalidates the prompt.
  const [pendingSectionRemoval, setPendingSectionRemoval] = useState<{
    section: NoteSection; diagrams: NoteStructure["diagrams"];
  } | null>(null);
  if (!note) return null;

  const patch = (p: Partial<NoteStructure>) => updateNote((n) => ({ ...n, ...p }));
  const patchCue = (i: number, p: Partial<NoteCue>) => patch({ cues: note.cues.map((c, j) => (j === i ? { ...c, ...p } : c)) });
  const patchSection = (i: number, p: Partial<NoteSection>) =>
    patch({ sections: note.sections.map((s, j) => (j === i ? { ...s, ...p } : s)) });
  const moveSection = (i: number, delta: number) => updateNote((current) => reorderSection(current, i, delta));

  return (
    <div className="panel-body content-editor">
      <DiagramQuickInsert />
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
          const attachedDiagramCount = note.diagrams?.filter((diagram) => diagram.afterSection === i).length ?? 0;
          const confirmDelete = attachedDiagramCount > 0
            && pendingSectionRemoval?.section === section
            && pendingSectionRemoval.diagrams === note.diagrams;
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
                  onClick={() => {
                    if (attachedDiagramCount > 0) {
                      setPendingSectionRemoval({ section, diagrams: note.diagrams });
                      return;
                    }
                    updateNote((current) => current.sections[i] === section ? removeSection(current, i) : current);
                    setPendingSectionRemoval(null);
                  }}
                >
                  ×
                </button>
              </div>
              {confirmDelete ? <div className="section-remove-confirmation" role="group"
                aria-label={t.content.removeSection(i + 1)}>
                <p className="hint is-warn" role="alert">{t.content.sectionRemovesDiagrams(attachedDiagramCount)}</p>
                <button type="button" className="btn btn-link"
                  onClick={() => {
                    updateNote((current) => current.sections[i] === section && current.diagrams === note.diagrams
                      ? removeSection(current, i) : current);
                    setPendingSectionRemoval(null);
                  }}>{t.content.confirmRemoveSectionWithDiagrams(i + 1)}</button>
                <button type="button" className="btn btn-link"
                  onClick={() => setPendingSectionRemoval(null)}>{t.content.cancelRemoveSection}</button>
              </div> : null}
              <textarea
                value={section.content}
                rows={4}
                maxLength={NOTE_LIMITS.content}
                aria-label={t.content.bodyLabel(i + 1)}
                onChange={(e) => patchSection(i, { content: e.target.value })}
              />
              <input
                type="text"
                value={section.highlightInput ?? section.highlights.join("；")}
                placeholder={t.content.highlights}
                aria-label={t.content.highlightsLabel(i + 1)}
                onChange={(e) => patchSection(i, { highlightInput: e.target.value, highlights: splitHighlights(e.target.value) })}
              />
              {missing.length > 0 ? <p className="hint is-warn">{t.content.missing(missing)}</p> : null}
              <DiagramSectionEditor sectionIndex={i} />
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
