import { useT } from "../i18n/index.ts";
import { useNoteStore } from "../state/store.ts";

/** Shared diagram history controls, used by D2 parameter editing and D3 fine edit. */
export function DiagramHistoryButtons() {
  const t = useT().content.diagrams;
  const undoCount = useNoteStore((s) => s.diagramUndo.length);
  const redoCount = useNoteStore((s) => s.diagramRedo.length);
  const undoDiagram = useNoteStore((s) => s.undoDiagram);
  const redoDiagram = useNoteStore((s) => s.redoDiagram);
  return <>
    <button type="button" className="btn btn-link" disabled={undoCount === 0}
      onClick={undoDiagram}>{t.undo}</button>
    <button type="button" className="btn btn-link" disabled={redoCount === 0}
      onClick={redoDiagram}>{t.redo}</button>
  </>;
}
