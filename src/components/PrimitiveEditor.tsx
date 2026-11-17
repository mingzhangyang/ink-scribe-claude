import { useEffect, useId, useRef, useState, type KeyboardEvent, type PointerEvent } from "react";
import { DIAGRAM_LIMITS, expandDiagram, type DiagramBlock, type DiagramPoint, type DiagramPrimitive } from "../../shared/diagram.ts";
import { cleanText } from "../../shared/text.ts";
import {
  addShape, defaultShape, deleteShape, DIAGRAM_GRID, editShape,
  moveFromPointers, resizeShape, rotateFromPointers, shapeCenter, shapeHandles,
} from "../diagrams/geometry.ts";
import { editDiagram } from "../diagrams/editor.ts";
import { diagramArcPath, diagramLabelFontSize, diagramLabelLayout } from "../diagrams/svg-geometry.ts";
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
  return [
    Math.max(0, Math.min(DIAGRAM_LIMITS.width, (event.clientX - rect.left) * DIAGRAM_LIMITS.width / rect.width)),
    Math.max(0, Math.min(DIAGRAM_LIMITS.height, (event.clientY - rect.top) * DIAGRAM_LIMITS.height / rect.height)),
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
  const [selected, setSelected] = useState<number | null>(null);
  const [showGrid, setShowGrid] = useState(true);
  const stageRef = useRef<SVGSVGElement>(null);
  const gestureRef = useRef<Gesture | null>(null);
  const workingRef = useRef(block);
  const patternId = useId().replace(/:/g, "");
  useEffect(() => {
    workingRef.current = block;
    setWorking(block);
    gestureRef.current = null;
  }, [block]);

  const primitives = expandDiagram(working);
  const currentIndex = selected !== null && primitives[selected] ? selected : null;
  const current = currentIndex !== null ? primitives[currentIndex] : null;

  const commit = (base: DiagramBlock, next: DiagramBlock) => {
    if (next === base) return;
    updateDiagram((note) => {
      if (note.diagrams?.[index] !== base) return note;
      return editDiagram(note, index, () => next);
    });
  };

  const immediate = (operation: (base: DiagramBlock) => DiagramBlock) => {
    const base = block;
    const next = operation(base);
    commit(base, next);
  };

  const startGesture = (event: PointerEvent<SVGElement>, shapeIndex: number, mode: Mode, handle?: string) => {
    if (event.pointerType === "mouse" && event.button !== 0) return;
    const svg = stageRef.current;
    const shape = expandDiagram(block)[shapeIndex];
    if (!svg || !shape) return;
    event.preventDefault();
    event.stopPropagation();
    setSelected(shapeIndex);
    gestureRef.current = {
      pointerId: event.pointerId, index: shapeIndex, mode, handle,
      from: pointerPosition(svg, event), shape, base: block,
    };
    workingRef.current = block;
    setWorking(block);
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
  const applyLabel = (raw: string) => {
    if (currentIndex === null) return;
    const changed = setLabelText(expandDiagram(block)[currentIndex], raw);
    immediate((base) => editShape(base, currentIndex, changed));
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
    <div className="diagram-edit-toolbar" role="toolbar" aria-label={t.shapeTools}>
      <button type="button" className="btn btn-link" disabled={!undo} onClick={undoDiagram}>{t.undo}</button>
      <button type="button" className="btn btn-link" disabled={!redo} onClick={redoDiagram}>{t.redo}</button>
      <label className="diagram-grid-toggle"><input type="checkbox" checked={showGrid}
        onChange={(event) => setShowGrid(event.target.checked)} />{t.snapGrid}</label>
    </div>
    <div className="diagram-primitive-stage">
      <DiagramBlockView block={working} seed={1978} />
      <svg ref={stageRef} className="diagram-interaction-overlay"
        viewBox="0 0 1000 750" aria-label={t.shapeCanvas}
        onPointerMove={onPointerMove} onPointerUp={(event) => release(event, false)}
        onPointerCancel={(event) => release(event, true)}
        onLostPointerCapture={() => {
          if (gestureRef.current) {
            gestureRef.current = null;
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
          active={currentIndex === i} select={setSelected} startGesture={startGesture}
          text={t.selectShape} />)}
      </svg>
    </div>
    <p className="hint">{t.dragHelp}</p>
    <div className="diagram-shape-palette" role="group" aria-label={t.addShape}>
      {primitiveTypes.map((type) => <button type="button" key={type} className="btn btn-link"
        disabled={primitives.length >= DIAGRAM_LIMITS.maxPrimitives}
        onClick={() => addPrimitive(type)}>{t.primitiveNames[type]}</button>)}
    </div>
    {current ? <div className="diagram-selected-controls">
      <span>{t.selectedShape(currentIndex! + 1, t.primitiveNames[current.type])}</span>
      {labelText(current) !== null ? <label className="diagram-shape-label">
        {t.shapeLabel}
        <input key={index + "-" + currentIndex + "-" + labelText(current)}
          type="text" defaultValue={labelText(current) ?? ""}
          onInput={(event) => {
            const input = event.currentTarget;
            // Count Unicode code points, not UTF-16 units (emoji/rare CJK must work).
            const capped = Array.from(input.value).slice(0, DIAGRAM_LIMITS.maxLabel).join("");
            if (input.value !== capped) input.value = capped;
          }}
          onBlur={(event) => applyLabel(event.currentTarget.value)}
          onKeyDown={(event) => { if (event.key === "Enter") event.currentTarget.blur(); }} />
      </label> : null}
      <button type="button" className="btn btn-link" disabled={primitives.length <= 1}
        onClick={deleteSelected}>{t.deleteShape}</button>
    </div> : null}
  </div>;
}
