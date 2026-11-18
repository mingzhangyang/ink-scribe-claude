import { useEffect, useId, useRef, useState, type KeyboardEvent, type PointerEvent } from "react";
import { DIAGRAM_LIMITS, expandDiagram, type DiagramBlock, type DiagramPoint, type DiagramPrimitive } from "../../shared/diagram.ts";
import { cleanText } from "../../shared/text.ts";
import {
  addShape, defaultShape, deleteShape, DIAGRAM_GRID, editShape,
  moveFromPointers, resizeShape, rotateFromPointers, shapeCenter, shapeHandles,
} from "../diagrams/geometry.ts";
import { editDiagram } from "../diagrams/editor.ts";
import { diagramArcPath, diagramLabelFontSize, diagramLabelLayout, diagramViewport } from "../diagrams/svg-geometry.ts";
import { useT } from "../i18n/index.ts";
import { useNoteStore } from "../state/store.ts";
import { DiagramBlockView } from "./note/DiagramBlock.tsx";

type P = DiagramPoint;
type Primitive = DiagramPrimitive;
type Mode = "move" | "resize" | "rotate";
type Gesture = {
  pointerId: number; index: number; mode: Mode; handle?: string;
  from: P; shape: Primitive; base: DiagramBlock;
};
const primitiveTypes = [
  "line", "arrow", "polyline", "rect", "circle", "ellipse", "arc", "label",
] as const satisfies readonly Primitive["type"][];

function pointerPosition(svg: SVGSVGElement, event: PointerEvent<SVGElement>): P {
  const rect = svg.getBoundingClientRect();
  const view = svg.viewBox.baseVal;
  return [
    Math.max(0, Math.min(DIAGRAM_LIMITS.width, view.x + (event.clientX - rect.left) * view.width / rect.width)),
    Math.max(0, Math.min(DIAGRAM_LIMITS.height, view.y + (event.clientY - rect.top) * view.height / rect.height)),
  ];
}
function labelText(shape: Primitive): string | null {
  switch (shape.type) {
    case "label": return shape.text;
    case "line":
    case "arrow":
    case "arc": return shape.label ?? "";
    default: return null;
  }
}
function setLabelText(shape: Primitive, text: string): Primitive {
  const value = cleanText(text, DIAGRAM_LIMITS.maxLabel);
  switch (shape.type) {
    case "label": return value ? { ...shape, text: value } : shape;
    case "line":
    case "arrow":
    case "arc": {
      const { label: _prior, ...rest } = shape;
      return value ? { ...rest, label: value } as Primitive : rest as Primitive;
    }
    default: return shape;
  }
}
/**
 * Broad transparent targets let users select a stroke anywhere along its visible
 * length, not just at the shape's midpoint. This is vital on a small touch screen.
 */
function StrokeHit({ shape, onDown }: {
  shape: Primitive; onDown: (event: PointerEvent<SVGElement>) => void;
}) {
  switch (shape.type) {
    case "line":
    case "arrow":
      return <line x1={shape.from[0]} y1={shape.from[1]} x2={shape.to[0]} y2={shape.to[1]}
        stroke="transparent" strokeWidth={75} pointerEvents="stroke" onPointerDown={onDown} />;
    case "polyline":
      return <polyline points={shape.points.map((p) => p.join(",")).join(" ")}
        fill="none" stroke="transparent" strokeWidth={75} pointerEvents="stroke"
        onPointerDown={onDown} />;
    case "rect": {
      const center = shapeCenter(shape);
      return <rect x={shape.at[0]} y={shape.at[1]} width={shape.width} height={shape.height}
        fill="transparent" stroke="transparent" strokeWidth={60} pointerEvents="all"
        transform={shape.rotation ? "rotate(" + shape.rotation + " " + center.join(" ") + ")" : undefined}
        onPointerDown={onDown} />;
    }
    case "circle":
      return <circle cx={shape.center[0]} cy={shape.center[1]} r={shape.r}
        fill="transparent" stroke="transparent" strokeWidth={60} pointerEvents="all"
        onPointerDown={onDown} />;
    case "ellipse":
      return <ellipse cx={shape.center[0]} cy={shape.center[1]} rx={shape.rx} ry={shape.ry}
        fill="transparent" stroke="transparent" strokeWidth={60} pointerEvents="all"
        transform={shape.rotation ? "rotate(" + shape.rotation + " " + shape.center.join(" ") + ")" : undefined}
        onPointerDown={onDown} />;
    case "arc":
      return <path d={diagramArcPath(shape.center, shape.radius, shape.startDeg, shape.sweepDeg)}
        fill="none" stroke="transparent" strokeWidth={75} pointerEvents="stroke"
        data-arc-hit-target onPointerDown={onDown} />;
    case "label": {
      // Match both the rendered anchor and glyph extents; long labels can be
      // selected by tapping visible text far from their center.
      const { at: [x, y], fontCap } = diagramLabelLayout(shape.at, shape.text);
      return <text x={x} y={y} textAnchor="middle" dominantBaseline="middle"
        className="diagram-label"
        style={{ fontSize: diagramLabelFontSize(fontCap), fontFamily: "var(--hand-font)",
          fontWeight: 500, letterSpacing: 0, fill: "transparent", stroke: "transparent" }}
        strokeWidth={75} pointerEvents="all" data-label-hit-target
        onPointerDown={onDown}>{shape.text}</text>;
    }
  }
}

function Selector({
  shape, index, active, startGesture, select, text,
}: {
  shape: Primitive; index: number; active: boolean;
  startGesture: (event: PointerEvent<SVGElement>, index: number, mode: Mode, handle?: string) => void;
  select: (index: number) => void; text: string;
}) {
  const center = shapeCenter(shape);
  const handles = active ? shapeHandles(shape) : [];
  return <g>
    <StrokeHit shape={shape} onDown={(event) => startGesture(event, index, "move")} />
    <circle className={"diagram-shape-target" + (active ? " is-selected" : "")}
      cx={center[0]} cy={center[1]} r={75}
      fill="transparent" stroke="none" role="button" tabIndex={0}
      aria-label={text + " " + (index + 1)}
      onFocus={() => select(index)}
      onPointerDown={(event) => startGesture(event, index, "move")}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          select(index);
        }
      }} />
    {active ? <>
      <circle className="diagram-selected-center" cx={center[0]} cy={center[1]} r={16}
        pointerEvents="none" />
      {handles.map((handle) => <g key={handle.id}>
        <circle className="diagram-handle-hit" cx={handle.point[0]} cy={handle.point[1]}
          r={75} fill="transparent" stroke="none"
          onPointerDown={(event) => startGesture(event, index, handle.kind, handle.id)} />
        <circle className={"diagram-handle" + (handle.kind === "rotate" ? " is-rotate" : "")}
          cx={handle.point[0]} cy={handle.point[1]} r={18} pointerEvents="none" />
      </g>)}
    </> : null}
  </g>;
}

/**
 * D3 direct manipulation uses a local render preview during a pointer gesture.
 * Only pointerup writes the final validated diagram to the shared NoteStructure.
 * This creates one atomic undo record per drag, rather than one per pointermove.
 */
export function PrimitiveEditor({ block, index }: { block: DiagramBlock; index: number }) {
  const t = useT().content.diagrams;
  const updateDiagram = useNoteStore((s) => s.updateDiagram);
  const undo = useNoteStore((s) => s.diagramUndo.length);
  const redo = useNoteStore((s) => s.diagramRedo.length);
  const undoDiagram = useNoteStore((s) => s.undoDiagram);
  const redoDiagram = useNoteStore((s) => s.redoDiagram);
  const [working, setWorking] = useState(block);
  // Capture the exact SVG frame on pointerdown so a concurrent label commit
  // cannot shift pointer coordinates mid-drag.
  const [gestureFrame, setGestureFrame] = useState<ReturnType<typeof diagramViewport> | null>(null);
  const [selected, setSelected] = useState<number | null>(null);
  const [showGrid, setShowGrid] = useState(true);
  const [detachConfirmed, setDetachConfirmed] = useState(!block.template);
  const [labelDraft, setLabelDraft] = useState("");
  const skipLabelBlur = useRef(false);
  const pendingLabelRef = useRef<{ index: number; text: string } | null>(null);
  const stageRef = useRef<SVGSVGElement>(null);
  const gestureRef = useRef<Gesture | null>(null);
  const workingRef = useRef(block);
  const patternId = useId().replace(/:/g, "");
  useEffect(() => {
    // A label committed on pointerdown becomes the gesture's base; do not
    // cancel that gesture when the newly committed block flows back as props.
    if (gestureRef.current?.base === block) return;
    pendingLabelRef.current = null;
    setGestureFrame(null);
    workingRef.current = block;
    setWorking(block);
    gestureRef.current = null;
  }, [block]);

  // Freeze framing to the committed diagram during a pointer gesture; resizing
  // must not move the handles underneath the pointer.
  const pendingDetach = !!block.template && !detachConfirmed;
  const viewport = gestureFrame ?? diagramViewport(pendingLabelRef.current && !gestureRef.current ? working : block);
  const primitives = expandDiagram(working);
  const currentIndex = selected !== null && primitives[selected] ? selected : null;
  const current = currentIndex !== null ? primitives[currentIndex] : null;
  useEffect(() => {
    const selectedShape = selected !== null ? expandDiagram(block)[selected] : undefined;
    setLabelDraft(selectedShape ? labelText(selectedShape) ?? "" : "");
  }, [selected, block]);

  const commit = (base: DiagramBlock, next: DiagramBlock) => {
    if (next === base) return;
    updateDiagram((note) => {
      if (note.diagrams?.[index] !== base) return note;
      return editDiagram(note, index, () => next);
    });
  };

  // Pointerdown suppresses the input's native blur. Flush by shape index, not
  // by the selection that may change while React unmounts the old input.
  const commitPendingLabel = (): DiagramBlock => {
    const pending = pendingLabelRef.current;
    pendingLabelRef.current = null;
    if (!pending || pendingDetach) return block;
    const shape = expandDiagram(block)[pending.index];
    if (!shape) return block;
    const next = editShape(block, pending.index, setLabelText(shape, pending.text));
    commit(block, next);
    return next;
  };
  const selectShape = (shapeIndex: number) => {
    const next = commitPendingLabel();
    if (next !== block) {
      workingRef.current = next;
      setWorking(next);
    }
    setSelected(shapeIndex);
  };

  const immediate = (operation: (base: DiagramBlock) => DiagramBlock) => {
    if (pendingDetach) return;
    const base = block;
    const next = operation(base);
    commit(base, next);
  };

  const startGesture = (event: PointerEvent<SVGElement>, shapeIndex: number, mode: Mode, handle?: string) => {
    if (pendingDetach || (event.pointerType === "mouse" && event.button !== 0)) return;
    const svg = stageRef.current;
    if (!svg) return;
    const liveFrame = svg.viewBox.baseVal;
    const frozenFrame: ReturnType<typeof diagramViewport> = [
      liveFrame.x, liveFrame.y, liveFrame.width, liveFrame.height,
    ];
    const base = commitPendingLabel();
    const shape = expandDiagram(base)[shapeIndex];
    if (!shape) return;
    event.preventDefault();
    event.stopPropagation();
    setGestureFrame(frozenFrame);
    setSelected(shapeIndex);
    gestureRef.current = {
      pointerId: event.pointerId, index: shapeIndex, mode, handle,
      from: pointerPosition(svg, event), shape, base,
    };
    workingRef.current = base;
    setWorking(base);
    svg.setPointerCapture(event.pointerId);
  };
  const onPointerMove = (event: PointerEvent<SVGSVGElement>) => {
    const drag = gestureRef.current;
    const svg = stageRef.current;
    if (!drag || drag.pointerId !== event.pointerId || !svg) return;
    event.preventDefault();
    const to = pointerPosition(svg, event);
    // An arc may cross the -180/180 seam during one gesture. Unwrap each move
    // relative to the last valid preview, not the original pointerdown angle.
    const resizing = drag.mode === "resize" && drag.shape.type === "arc"
      ? expandDiagram(workingRef.current)[drag.index] ?? drag.shape
      : drag.shape;
    const next = drag.mode === "move" ? moveFromPointers(drag.shape, drag.from, to, showGrid)
      : drag.mode === "rotate" ? rotateFromPointers(drag.shape, drag.from, to)
      : resizeShape(resizing, drag.handle ?? "", to, showGrid);
    const updated = editShape(drag.base, drag.index, next);
    workingRef.current = updated;
    setWorking(updated);
  };
  const release = (event: PointerEvent<SVGSVGElement>, canceled: boolean) => {
    const drag = gestureRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    gestureRef.current = null;
    setGestureFrame(null);
    if (stageRef.current?.hasPointerCapture(event.pointerId)) stageRef.current.releasePointerCapture(event.pointerId);
    const next = workingRef.current;
    if (!canceled) commit(drag.base, next);
    workingRef.current = canceled ? block : next;
    if (canceled) setWorking(block);
  };

  const addPrimitive = (type: Primitive["type"]) => {
    const count = expandDiagram(block).length;
    immediate((base) => addShape(base, defaultShape(type)));
    if (count < DIAGRAM_LIMITS.maxPrimitives) setSelected(count);
  };
  const deleteSelected = () => {
    if (currentIndex === null) return;
    immediate((base) => deleteShape(base, currentIndex));
    setSelected(null);
  };
  const previewLabel = (raw: string) => {
    if (currentIndex === null || pendingDetach) return;
    const capped = Array.from(raw).slice(0, DIAGRAM_LIMITS.maxLabel).join("");
    pendingLabelRef.current = { index: currentIndex, text: capped };
    setLabelDraft(capped);
    const shape = expandDiagram(block)[currentIndex];
    if (!shape) return;
    const preview = editShape(block, currentIndex, setLabelText(shape, capped));
    // Typing updates only the local SVG; blur creates one atomic undo entry.
    workingRef.current = preview;
    setWorking(preview);
  };
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    // Arrow/Delete shortcuts belong to the focused SVG canvas, never toolbar buttons
    // or text inputs (whose native keyboard semantics must remain intact).
    if (event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement
      || event.target instanceof HTMLSelectElement || event.target instanceof HTMLButtonElement) return;
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "z") {
      event.preventDefault();
      if (event.shiftKey) redoDiagram();
      else undoDiagram();
      return;
    }
    if ((event.key === "Delete" || event.key === "Backspace") && currentIndex !== null) {
      event.preventDefault();
      deleteSelected();
      return;
    }
    const steps: Record<string, P> = {
      ArrowLeft: [-DIAGRAM_GRID, 0], ArrowRight: [DIAGRAM_GRID, 0],
      ArrowUp: [0, -DIAGRAM_GRID], ArrowDown: [0, DIAGRAM_GRID],
    };
    const delta = steps[event.key];
    if (delta && currentIndex !== null) {
      event.preventDefault();
      immediate((base) => {
        const next = expandDiagram(base)[currentIndex];
        return editShape(base, currentIndex, moveFromPointers(next, [0, 0], delta));
      });
    }
  };

  return <div className="diagram-primitive-editor" onKeyDown={onKeyDown}>
    {pendingDetach ? <div className="diagram-detach-warning" role="note">
      <p className="hint is-warn">{t.detachWarning}</p>
      <button type="button" className="btn btn-link" onClick={() => setDetachConfirmed(true)}>
        {t.detachContinue}
      </button>
    </div> : null}
    <div className="diagram-edit-toolbar" role="toolbar" aria-label={t.shapeTools}>
      <button type="button" className="btn btn-link" disabled={!undo} onClick={undoDiagram}>{t.undo}</button>
      <button type="button" className="btn btn-link" disabled={!redo} onClick={redoDiagram}>{t.redo}</button>
      <label className="diagram-grid-toggle"><input type="checkbox" checked={showGrid}
        onChange={(event) => setShowGrid(event.target.checked)} />{t.snapGrid}</label>
    </div>
    <div className="diagram-primitive-stage">
      <DiagramBlockView block={working} seed={1978} viewport={viewport} />
      <svg ref={stageRef} className="diagram-interaction-overlay"
        viewBox={viewport.join(" ")} aria-label={t.shapeCanvas}
        aria-disabled={pendingDetach} style={pendingDetach ? { pointerEvents: "none" } : undefined}
        onPointerMove={onPointerMove} onPointerUp={(event) => release(event, false)}
        onPointerCancel={(event) => release(event, true)}
        onLostPointerCapture={() => {
          if (gestureRef.current) {
            gestureRef.current = null;
            setGestureFrame(null);
            workingRef.current = block;
            setWorking(block);
          }
        }}>
        <defs><pattern id={patternId} width={DIAGRAM_GRID} height={DIAGRAM_GRID} patternUnits="userSpaceOnUse">
          <path d={"M " + DIAGRAM_GRID + " 0 L 0 0 0 " + DIAGRAM_GRID}
            fill="none" stroke="currentColor" strokeWidth="1.5" opacity=".24" />
        </pattern></defs>
        {showGrid ? <rect width="1000" height="750" fill={"url(#" + patternId + ")"}
          pointerEvents="none" /> : null}
        {current ? <>
          <line x1={shapeCenter(current)[0]} x2={shapeCenter(current)[0]} y1={0} y2={750}
            className="diagram-alignment-guide" pointerEvents="none" />
          <line x1={0} x2={1000} y1={shapeCenter(current)[1]} y2={shapeCenter(current)[1]}
            className="diagram-alignment-guide" pointerEvents="none" />
        </> : null}
        {primitives.map((shape, i) => <Selector key={i} shape={shape} index={i}
          active={currentIndex === i} select={selectShape} startGesture={startGesture}
          text={t.selectShape} />)}
      </svg>
    </div>
    <p className="hint">{t.dragHelp}</p>
    <div className="diagram-shape-palette" role="group" aria-label={t.addShape}>
      {primitiveTypes.map((type) => <button type="button" key={type} className="btn btn-link"
        disabled={pendingDetach || primitives.length >= DIAGRAM_LIMITS.maxPrimitives}
        onClick={() => addPrimitive(type)}>{t.primitiveNames[type]}</button>)}
    </div>
    {current ? <div className="diagram-selected-controls">
      <span>{t.selectedShape(currentIndex! + 1, t.primitiveNames[current.type])}</span>
      {labelText(current) !== null ? <label className="diagram-shape-label">
        {t.shapeLabel}
        <input key={index + "-" + currentIndex}
          type="text" disabled={pendingDetach} value={labelDraft}
          onChange={(event) => previewLabel(event.currentTarget.value)}
          onBlur={() => {
            if (skipLabelBlur.current) {
              skipLabelBlur.current = false;
              pendingLabelRef.current = null;
              workingRef.current = block;
              setWorking(block);
            } else commitPendingLabel();
          }}
          onKeyDown={(event) => {
            if (event.key === "Enter") event.currentTarget.blur();
            if (event.key === "Escape") {
              skipLabelBlur.current = true;
              pendingLabelRef.current = null;
              const initial = currentIndex !== null ? expandDiagram(block)[currentIndex] : undefined;
              setLabelDraft(initial ? labelText(initial) ?? "" : "");
              event.currentTarget.blur();
            }
          }} />
      </label> : null}
      <button type="button" className="btn btn-link" disabled={pendingDetach || primitives.length <= 1}
        onClick={deleteSelected}>{t.deleteShape}</button>
    </div> : null}
  </div>;
}
