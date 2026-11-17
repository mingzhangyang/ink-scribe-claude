import { useEffect, useState } from "react";
import { DIAGRAM_LIMITS, DIAGRAM_TEMPLATES, type DiagramBlock, type DiagramTemplate } from "../../shared/diagram.ts";
import { cleanText } from "../../shared/text.ts";
import { editDiagram, insertDiagram, removeDiagram, setDiagramCaption, updateTemplateParams } from "../diagrams/editor.ts";
import { useT } from "../i18n/index.ts";
import { useNoteStore } from "../state/store.ts";
import { DiagramBlockView } from "./note/DiagramBlock.tsx";

function TemplateGlyph({ template }: { template: DiagramTemplate }) {
  const common = { fill: "none", stroke: "currentColor", strokeWidth: 2.5, strokeLinecap: "round" as const, strokeLinejoin: "round" as const };
  switch (template) {
    case "inclined-plane":
      return <svg viewBox="0 0 80 60" aria-hidden="true" focusable="false" {...common}>
        <path d="M7 53 66 18 66 53" /><path d="m35 29 12-7 8 13-12 7z" /><path d="m47 33 0 18m-5-7 5 7 5-7" />
      </svg>;
    case "right-triangle":
      return <svg viewBox="0 0 80 60" aria-hidden="true" focusable="false" {...common}>
        <path d="M13 49H67V10Z M56 49V38H67" /><text x="35" y="58" stroke="none" fill="currentColor" fontSize="9">a</text>
      </svg>;
    case "number-line":
      return <svg viewBox="0 0 80 60" aria-hidden="true" focusable="false" {...common}>
        <path d="M7 30h67l-7-5m7 5-7 5M20 23v14M40 23v14M60 23v14" />
        <text x="20" y="48" stroke="none" fill="currentColor" textAnchor="middle" fontSize="9">−1</text>
        <text x="40" y="48" stroke="none" fill="currentColor" textAnchor="middle" fontSize="9">0</text>
        <text x="60" y="48" stroke="none" fill="currentColor" textAnchor="middle" fontSize="9">1</text>
      </svg>;
    case "coordinate-plane":
      return <svg viewBox="0 0 80 60" aria-hidden="true" focusable="false" {...common}>
        <path d="M7 33h68l-7-5m7 5-7 5M34 55V6l-5 7m5-7 5 7" />
        <path d="M43 10v40M52 10v40M61 10v40M11 20h56M11 46h56" strokeOpacity=".24" />
        <path d="M34 32q14-21 28-11" />
      </svg>;
  }
}

function NumberParameter({
  label, value, min, max, onCommit, invalidMessage,
}: {
  label: string; value: number; min: number; max: number;
  onCommit: (next: number) => boolean; invalidMessage: string;
}) {
  const [draft, setDraft] = useState(String(value));
  const [invalid, setInvalid] = useState(false);
  useEffect(() => { setDraft(String(value)); setInvalid(false); }, [value]);

  const commit = () => {
    const number = Number(draft);
    if (!draft.trim() || !Number.isFinite(number) || number < min || number > max) {
      setInvalid(true);
      return;
    }
    if (number === value) {
      setDraft(String(value));
      setInvalid(false);
      return;
    }
    const accepted = onCommit(number);
    setInvalid(!accepted);
    if (accepted) setDraft(String(number));
  };

  return <label className="diagram-number">
    <span>{label}</span>
    <input type="number" inputMode="decimal" step="any" min={min} max={max}
      value={draft} aria-label={label} aria-invalid={invalid}
      onChange={(event) => { setDraft(event.target.value); setInvalid(false); }}
      onBlur={commit}
      onKeyDown={(event) => {
        if (event.key === "Enter") event.currentTarget.blur();
        if (event.key === "Escape") { setDraft(String(value)); setInvalid(false); event.currentTarget.blur(); }
      }} />
    {invalid ? <span className="hint is-warn" role="alert">{invalidMessage}</span> : null}
  </label>;
}

function CaptionParameter({ caption, label, placeholder, onCommit }: {
  caption: string; label: string; placeholder: string; onCommit: (value: string) => void;
}) {
  const [draft, setDraft] = useState(caption);
  useEffect(() => { setDraft(caption); }, [caption]);
  return <label className="field diagram-caption">
    <span>{label}</span>
    <input type="text" value={draft} placeholder={placeholder} aria-label={label}
      onChange={(event) => {
        // JS maxLength counts UTF-16 units, while the contract counts Unicode code points.
        const text = Array.from(event.target.value).slice(0, DIAGRAM_LIMITS.maxCaption).join("");
        setDraft(text);
        if (cleanText(text, DIAGRAM_LIMITS.maxCaption) === text) onCommit(text);
      }}
      onBlur={() => {
        const cleaned = cleanText(draft, DIAGRAM_LIMITS.maxCaption);
        setDraft(cleaned);
        onCommit(cleaned);
      }} />;
  </label>;
}

function DiagramParameters({ block, index }: { block: DiagramBlock; index: number }) {
  const updateNote = useNoteStore((s) => s.updateNote);
  const t = useT().content.diagrams;
  const update = <T extends DiagramTemplate>(
    template: T, patch: Partial<Extract<DiagramBlock, { template: T }>["params"]>,
  ) => updateNote((note) => updateTemplateParams(note, index, template, patch));
  const changeNumberLine = (key: "start" | "end" | "step", value: number) => {
    let accepted = false;
    updateNote((note) => {
      const next = updateTemplateParams(note, index, "number-line", { [key]: value });
      accepted = next !== note;
      return next;
    });
    return accepted;
  };

  switch (block.template) {
    case "inclined-plane":
      return <div className="diagram-parameters">
        <label className="diagram-range">
          <span>{t.angle}: <strong>{block.params.thetaDeg}°</strong></span>
          <input type="range" min={5} max={60} step={1} value={block.params.thetaDeg}
            aria-label={t.angle} onChange={(event) =>
              update("inclined-plane", { thetaDeg: Number(event.target.value) })} />
        </label>
        <label className="diagram-check">
          <input type="checkbox" checked={block.params.friction}
            onChange={(event) => update("inclined-plane", { friction: event.target.checked })} />
          <span>{t.friction}</span>
        </label>
        <p className="hint">{t.frictionTip}</p>
      </div>;
    case "right-triangle":
      return <div className="diagram-parameters">
        <label className="diagram-range">
          <span>{t.legRatio}: <strong>{block.params.legRatio.toFixed(2)}</strong></span>
          <input type="range" min={0.25} max={4} step={0.05} value={block.params.legRatio}
            aria-label={t.legRatio} onChange={(event) =>
              update("right-triangle", { legRatio: Number(Number(event.target.value).toFixed(2)) })} />
        </label>
      </div>;
    case "number-line":
      return <div className="diagram-parameters">
        <div className="diagram-number-grid">
          <NumberParameter label={t.start} value={block.params.start} min={-1000} max={1000}
            invalidMessage={t.invalidRange} onCommit={(value) => changeNumberLine("start", value)} />
          <NumberParameter label={t.end} value={block.params.end} min={-1000} max={1000}
            invalidMessage={t.invalidRange} onCommit={(value) => changeNumberLine("end", value)} />
          <NumberParameter label={t.step} value={block.params.step} min={0.1} max={1000}
            invalidMessage={t.invalidRange} onCommit={(value) => changeNumberLine("step", value)} />
        </div>
        <p className="hint">{t.tickLimit}</p>
      </div>;
    case "coordinate-plane":
      return <div className="diagram-parameters">
        <label className="diagram-check">
          <input type="checkbox" checked={block.params.grid}
            onChange={(event) => update("coordinate-plane", { grid: event.target.checked })} />
          <span>{t.showGrid}</span>
        </label>
        <label className="diagram-select">
          <span>{t.quadrants}</span>
          <select value={block.params.quadrants} aria-label={t.quadrants}
            onChange={(event) => update("coordinate-plane",
              { quadrants: event.target.value as "all" | "first" })}>
            <option value="all">{t.allQuadrants}</option>
            <option value="first">{t.firstQuadrant}</option>
          </select>
        </label>
      </div>;
    default:
      return <p className="hint">{t.customReadOnly}</p>;
  }
}

/**
 * In-section insertion and inspection. Actual diagram shapes are always authored into
 * note.diagrams; there is no new canvas state to get out of sync with draft/export.
 */
export function DiagramSectionEditor({ sectionIndex }: { sectionIndex: number }) {
  const note = useNoteStore((s) => s.note);
  const updateNote = useNoteStore((s) => s.updateNote);
  const t = useT().content.diagrams;
  const [pickerOpen, setPickerOpen] = useState(false);
  const [expanded, setExpanded] = useState<number | null>(null);
  const [confirmRemoval, setConfirmRemoval] = useState<number | null>(null);
  // A section reorder, undo (D3) or document reload must never confirm deletion of another block.
  useEffect(() => { setConfirmRemoval(null); }, [note?.diagrams]);
  if (!note) return null;

  const diagrams = note.diagrams ?? [];
  const attached = diagrams.map((block, index) => ({ block, index }))
    .filter(({ block }) => block.afterSection === sectionIndex);
  const canAdd = diagrams.length < DIAGRAM_LIMITS.maxBlocks;
  if (!attached.length && !canAdd) return null;

  const add = (template: DiagramTemplate) => {
    const index = diagrams.length;
    updateNote((current) => insertDiagram(current, sectionIndex, template));
    setPickerOpen(false);
    setConfirmRemoval(null);
    setExpanded(index);
  };

  return <div className="diagram-section-controls" data-diagram-section={sectionIndex}>
    {attached.map(({ block, index }) => (
      <div key={index} className="diagram-editor-card">
        <div className="diagram-editor-heading">
          <button type="button" className="diagram-expand" aria-expanded={expanded === index}
            aria-controls={"diagram-inspector-" + sectionIndex + "-" + index}
            onClick={() => { setConfirmRemoval(null); setExpanded(expanded === index ? null : index); }}>
            <span aria-hidden="true">{expanded === index ? "▾" : "▸"}</span>
            <span>{block.template ? t.templateNames[block.template] : t.customTitle}</span>
          </button>
          <button type="button" className="btn btn-link diagram-remove"
            aria-label={confirmRemoval === index ? t.confirmRemoveDiagram(index + 1) : t.removeDiagram(index + 1)}
            onClick={() => {
              if (confirmRemoval !== index) { setConfirmRemoval(index); return; }
              updateNote((current) => removeDiagram(current, index));
              setExpanded(null);
              setConfirmRemoval(null);
            }}>{confirmRemoval === index ? t.confirmRemove : t.remove}</button>
          {confirmRemoval === index ? <button type="button" className="btn btn-link diagram-cancel-remove"
            onClick={() => setConfirmRemoval(null)}>{t.cancelRemove}</button> : null}
        </div>
        {expanded === index ? <div id={"diagram-inspector-" + sectionIndex + "-" + index}
          className="diagram-inspector">
          <div className="diagram-edit-preview" aria-label={t.preview}>
            <DiagramBlockView block={block} seed={1978} />
          </div>
          <DiagramParameters block={block} index={index} />
          <CaptionParameter key={"caption-" + index} caption={block.caption ?? ""}
            label={t.caption} placeholder={t.captionPlaceholder}
            onCommit={(value) => updateNote((current) => setDiagramCaption(current, index, value))} />
          <label className="diagram-check">
            <input type="checkbox" checked={block.handDrawn !== false}
              onChange={(event) => updateNote((current) =>
                editDiagram(current, index, (existing) => ({ ...existing, handDrawn: event.target.checked })))} />
            <span>{t.handDrawn}</span>
          </label>
        </div> : null}
      </div>
    ))}
    {canAdd ? <>
      <button type="button" className="btn btn-link diagram-add" aria-expanded={pickerOpen}
        onClick={() => { setConfirmRemoval(null); setPickerOpen(!pickerOpen); }}>
        {t.add} <span className="diagram-limit">({diagrams.length}/{DIAGRAM_LIMITS.maxBlocks})</span>
      </button>
      {pickerOpen ? <div className="diagram-template-picker" role="group" aria-label={t.chooseTemplate}>
        {DIAGRAM_TEMPLATES.map((template) =>
          <button key={template} type="button" className="diagram-template-choice"
            aria-label={t.insertTemplate(t.templateNames[template])} onClick={() => add(template)}>
            <TemplateGlyph template={template} />
            <span>{t.templateNames[template]}</span>
          </button>)}
      </div> : null}
    </> : <p className="hint diagram-limit-reached">{t.limitReached}</p>}
  </div>;
}

