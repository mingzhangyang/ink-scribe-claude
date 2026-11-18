import { useEffect, useState } from "react";
import { DIAGRAM_LIMITS, FUNCTION_PRESETS, type DiagramBlock, type DiagramTemplate, type FunctionPreset } from "../../shared/diagram.ts";
import { cleanText } from "../../shared/text.ts";
import { editDiagram, removeDiagram, setDiagramCaption, updateTemplateParams } from "../diagrams/editor.ts";
import { activeNumberLineDraft, numberLineFields, parseNumberLineFields, useNumberLineDrafts } from "../diagrams/numberLineDrafts.ts";
import { useT } from "../i18n/index.ts";
import { useNoteStore } from "../state/store.ts";
import { DiagramBlockView } from "./note/DiagramBlock.tsx";
import { PrimitiveEditor } from "./PrimitiveEditor.tsx";

export function TemplateGlyph({ template }: { template: DiagramTemplate }) {
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

/** Number-line parameters are an atomic draft, never committed individually. */
function NumberParameter({ label, value, onChange, onCancel, invalid }: {
  label: string;
  value: string;
  onChange: (raw: string) => void;
  onCancel: () => void;
  invalid: boolean;
}) {
  return <label className="diagram-number">
    <span>{label}</span>
    <input type="number" inputMode="decimal" step="any" value={value}
      aria-label={label} aria-invalid={invalid}
      onChange={(event) => onChange(event.target.value)}
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          event.preventDefault();
          onCancel();
          event.currentTarget.blur();
        }
      }} />
  </label>;
}

function CaptionParameter({ caption, label, placeholder, onCommit }: {
  caption: string; label: string; placeholder: string; onCommit: (value: string) => void;
}) {
  const [draft, setDraft] = useState(caption);
  const [overflow, setOverflow] = useState(false);
  const t = useT().content.diagrams;
  useEffect(() => { setDraft(caption); }, [caption]);
  return <label className="field diagram-caption">
    <span>{label}</span>
    <input type="text" value={draft} placeholder={placeholder} aria-label={label}
      onChange={(event) => {
        // JS maxLength counts UTF-16 units, while the contract counts Unicode code points.
        const points = Array.from(event.target.value);
        setOverflow(points.length > DIAGRAM_LIMITS.maxCaption);
        const text = points.slice(0, DIAGRAM_LIMITS.maxCaption).join("");
        setDraft(text);
        if (cleanText(text, DIAGRAM_LIMITS.maxCaption) === text) onCommit(text);
      }}
      onBlur={() => {
        const cleaned = cleanText(draft, DIAGRAM_LIMITS.maxCaption);
        setDraft(cleaned);
        onCommit(cleaned);
      }} />
    <small className="hint" role="status">{Array.from(draft).length}/{DIAGRAM_LIMITS.maxCaption}
      {overflow ? " · " + t.captionLimitNotice : ""}</small>
  </label>;
}

function DiagramParameters({ block, index }: { block: DiagramBlock; index: number }) {
  const updateDiagram = useNoteStore((s) => s.updateDiagram);
  const t = useT().content.diagrams;
  const note = useNoteStore((s) => s.note);
  const noteSerial = useNoteStore((s) => s.noteSerial);
  const drafts = useNumberLineDrafts((s) => s.drafts);
  const setField = useNumberLineDrafts((s) => s.setField);
  const apply = useNumberLineDrafts((s) => s.apply);
  const discard = useNumberLineDrafts((s) => s.discard);
  const numberPending = activeNumberLineDraft(note, noteSerial, index, drafts);
  // Pass concrete discriminants to the shared editor. Generic Extract<T> at a
  // higher-order callback boundary is not reliably assignable under TypeScript 7.
  const changeSlope = (patch: Partial<Extract<DiagramBlock, { template: "inclined-plane" }>["params"]>) =>
    updateDiagram((note) => updateTemplateParams(note, index, "inclined-plane", patch));
  const changeTriangle = (patch: Partial<Extract<DiagramBlock, { template: "right-triangle" }>["params"]>) =>
    updateDiagram((note) => updateTemplateParams(note, index, "right-triangle", patch));
  const changeAxes = (patch: Partial<Extract<DiagramBlock, { template: "coordinate-plane" }>["params"]>) =>
    updateDiagram((note) => updateTemplateParams(note, index, "coordinate-plane", patch));


  switch (block.template) {
    case "inclined-plane":
      return <div className="diagram-parameters">
        <label className="diagram-range">
          <span>{t.angle}: <strong>{block.params.thetaDeg}°</strong></span>
          <input type="range" min={5} max={60} step={1} value={block.params.thetaDeg}
            aria-label={t.angle} onChange={(event) =>
              changeSlope({ thetaDeg: Number(event.target.value) })} />
        </label>
        <label className="diagram-check">
          <input type="checkbox" checked={block.params.friction}
            onChange={(event) => changeSlope({ friction: event.target.checked })} />
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
              changeTriangle({ legRatio: Number(Number(event.target.value).toFixed(2)) })} />
        </label>
      </div>;
    case "number-line": {
      const fields = numberPending?.fields ?? numberLineFields(block.params);
      const invalid = !!numberPending && !parseNumberLineFields(fields);
      return <form className="diagram-parameters diagram-number-form"
        onSubmit={(event) => { event.preventDefault(); if (!invalid) apply(index); }}>
        <div className="diagram-number-grid">
          <NumberParameter label={t.start} value={fields.start} invalid={invalid}
            onChange={(value) => setField(index, "start", value)} onCancel={() => discard(index)} />
          <NumberParameter label={t.end} value={fields.end} invalid={invalid}
            onChange={(value) => setField(index, "end", value)} onCancel={() => discard(index)} />
          <NumberParameter label={t.step} value={fields.step} invalid={invalid}
            onChange={(value) => setField(index, "step", value)} onCancel={() => discard(index)} />
        </div>
        <p className="hint">{t.tickLimit}</p>
        {numberPending ? <>
          <p className="hint is-warn diagram-preview-stale" role="status">{t.stalePreview}</p>
          {invalid ? <p className="hint is-warn" role="alert">{t.invalidRange}</p> : null}
          <div className="diagram-number-actions">
            <button type="submit" className="btn btn-primary" disabled={invalid}>{t.applyParameters}</button>
            <button type="button" className="btn btn-link" onClick={() => discard(index)}>{t.discardParameters}</button>
          </div>
        </> : null}
      </form>;
    }
    case "coordinate-plane":
      return <div className="diagram-parameters">
        <label className="diagram-check">
          <input type="checkbox" checked={block.params.grid}
            onChange={(event) => changeAxes({ grid: event.target.checked })} />
          <span>{t.showGrid}</span>
        </label>
        <label className="diagram-select">
          <span>{t.quadrants}</span>
          <select value={block.params.quadrants} aria-label={t.quadrants}
            onChange={(event) => changeAxes({ quadrants: event.target.value as "all" | "first" })}>
            <option value="all">{t.allQuadrants}</option>
            <option value="first">{t.firstQuadrant}</option>
          </select>
        </label>
        <label className="diagram-select">
          <span>{t.functionPreset}</span>
          <select aria-label={t.functionPreset} value={block.params.function ?? "none"}
            onChange={(event) => changeAxes({ function: event.target.value as FunctionPreset })}>
            {FUNCTION_PRESETS.map((preset) => <option key={preset} value={preset}>{t.functionNames[preset]}</option>)}
          </select>
        </label>
        {(block.params.function ?? "none") !== "none" ? <label className="diagram-check">
          <input type="checkbox" checked={block.params.keyPoints !== false}
            onChange={(event) => changeAxes({ keyPoints: event.target.checked })} />
          <span>{t.keyPoints}</span>
        </label> : null}
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
  const updateDiagram = useNoteStore((s) => s.updateDiagram);
  const t = useT().content.diagrams;
  const drafts = useNumberLineDrafts((s) => s.drafts);
  const noteSerial = useNoteStore((s) => s.noteSerial);
  // Content unmounts on the Export tab. Restore a pending inspector on remount
  // so the user can immediately apply or discard the still-active draft.
  const [expanded, setExpanded] = useState<number | null>(() => {
    const pendingIndex = note?.diagrams?.findIndex((block, index) =>
      block.afterSection === sectionIndex
      && activeNumberLineDraft(note, noteSerial, index, drafts) !== null);
    return pendingIndex !== undefined && pendingIndex >= 0 ? pendingIndex : null;
  });
  const [confirmRemoval, setConfirmRemoval] = useState<number | null>(null);
  const [shapeMode, setShapeMode] = useState<number | null>(null);
  // A section reorder, undo (D3) or document reload must never confirm deletion of another block.
  useEffect(() => { setConfirmRemoval(null); }, [note?.diagrams]);
  if (!note) return null;

  const diagrams = note.diagrams ?? [];
  const attached = diagrams.map((block, index) => ({ block, index }))
    .filter(({ block }) => block.afterSection === sectionIndex);
  if (!attached.length) return null;

  return <div className="diagram-section-controls" data-diagram-section={sectionIndex}>
    {attached.map(({ block, index }) => (
      <div key={index} className="diagram-editor-card" data-diagram-index={index}>
        <div className="diagram-editor-heading">
          <button type="button" className="diagram-expand" aria-expanded={expanded === index}
            aria-controls={"diagram-inspector-" + sectionIndex + "-" + index}
            onClick={() => {
              setConfirmRemoval(null);
              setExpanded(expanded === index ? null : index);
            }}>
            <span aria-hidden="true">{expanded === index ? "▾" : "▸"}</span>
            <span>{block.template ? t.templateNames[block.template] : t.customTitle}</span>
          </button>
          <button type="button" className="btn btn-link diagram-remove"
            aria-label={confirmRemoval === index ? t.confirmRemoveDiagram(index + 1) : t.removeDiagram(index + 1)}
            onClick={() => {
              if (confirmRemoval !== index) { setConfirmRemoval(index); return; }
              updateDiagram((current) => removeDiagram(current, index));
              setExpanded(null);
              setShapeMode(null);
              setConfirmRemoval(null);
            }}>{confirmRemoval === index ? t.confirmRemove : t.remove}</button>
          {confirmRemoval === index ? <button type="button" className="btn btn-link diagram-cancel-remove"
            onClick={() => setConfirmRemoval(null)}>{t.cancelRemove}</button> : null}
        </div>
        {expanded === index ? <div id={"diagram-inspector-" + sectionIndex + "-" + index}
          className="diagram-inspector">
          <button type="button" className="btn btn-link diagram-shape-mode"
            aria-expanded={shapeMode === index}
            onClick={() => setShapeMode((current) => current === index ? null : index)}>
            {shapeMode === index ? t.closeShapeEdit : t.editShapes}
          </button>
          {shapeMode === index
            ? <PrimitiveEditor block={block} index={index} />
            : <div className="diagram-edit-preview" aria-label={t.preview}>
              <DiagramBlockView block={block} seed={1978}
                pending={!!activeNumberLineDraft(note, noteSerial, index, drafts)} />
            </div>}
          <DiagramParameters block={block} index={index} />
          <CaptionParameter key={"caption-" + index} caption={block.caption ?? ""}
            label={t.caption} placeholder={t.captionPlaceholder}
            onCommit={(value) => updateDiagram((current) => setDiagramCaption(current, index, value))} />
          <label className="diagram-check">
            <input type="checkbox" checked={block.handDrawn !== false}
              onChange={(event) => updateDiagram((current) =>
                editDiagram(current, index, (existing) => ({ ...existing, handDrawn: event.target.checked })))} />
            <span>{t.handDrawn}</span>
          </label>
          <label className="diagram-range">
            <span>{t.jitterLabel}: <strong>{(block.jitterPx ?? 1.2).toFixed(1)}</strong></span>
            <input type="range" min={0} max={3} step={0.1} value={block.jitterPx ?? 1.2}
              aria-label={t.jitterLabel} disabled={block.handDrawn === false}
              onChange={(event) => updateDiagram((current) => editDiagram(current, index,
                (existing) => ({ ...existing, jitterPx: Number(event.target.value) })))} />
          </label>
        </div> : null}
      </div>
    ))}
  </div>;
}

