import { useEffect, useRef, type CSSProperties, type PointerEvent as ReactPointerEvent } from "react";
import { PAGE_WIDTH } from "../config/appearance.ts";
import { StickerArt } from "./StickerArt.tsx";
import { STICKER_LABELS, STICKER_SIZES, type StickerItem } from "./types.ts";

type Props = {
  stickers: StickerItem[];
  selectedId: string | null;
  interactive: boolean;
  /** 页面在屏幕上的显示缩放比例，用于把指针位移换算回画布坐标。 */
  displayScale: number;
  pageHeight: number;
  naturalness: number;
  seed: number;
  onSelect: (id: string | null) => void;
  onChange: (id: string, patch: Partial<StickerItem>) => void;
  onRemove: (id: string) => void;
};

type Gesture =
  | { kind: "move"; id: string; startX: number; startY: number; originX: number; originY: number }
  | { kind: "rotate"; id: string; cx: number; cy: number; startAngle: number; originRotation: number }
  | { kind: "scale"; id: string; cx: number; cy: number; startDist: number; originScale: number };

const clamp = (n: number, min: number, max: number) => Math.min(max, Math.max(min, n));

/** 贴纸与选框共用的几何样式：x/y 为中心点，先旋转再缩放。 */
function boxStyle(item: StickerItem): CSSProperties {
  const size = STICKER_SIZES[item.type];
  return {
    left: item.x,
    top: item.y,
    width: size.w,
    height: size.h,
    transform: `translate(-50%, -50%) rotate(${item.rotation}deg) scale(${item.scale})`,
  };
}

function isEditableTarget(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  return !!el && (el.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(el.tagName));
}

export function StickerLayer({
  stickers,
  selectedId,
  interactive,
  displayScale,
  pageHeight,
  naturalness,
  seed,
  onSelect,
  onChange,
  onRemove,
}: Props) {
  const gesture = useRef<Gesture | null>(null);

  useEffect(() => {
    if (!interactive || !selectedId) return;
    const onKey = (event: KeyboardEvent) => {
      if (isEditableTarget(event.target)) return;
      const item = stickers.find((s) => s.id === selectedId);
      if (!item) return;
      const step = event.shiftKey ? 10 : 2;
      switch (event.key) {
        case "Delete":
        case "Backspace":
          onRemove(item.id);
          break;
        case "Escape":
          onSelect(null);
          break;
        case "ArrowLeft":
          onChange(item.id, { x: item.x - step });
          break;
        case "ArrowRight":
          onChange(item.id, { x: item.x + step });
          break;
        case "ArrowUp":
          onChange(item.id, { y: item.y - step });
          break;
        case "ArrowDown":
          onChange(item.id, { y: item.y + step });
          break;
        default:
          return;
      }
      event.preventDefault();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [interactive, selectedId, stickers, onChange, onRemove, onSelect]);

  function centerOf(element: HTMLElement): { cx: number; cy: number } {
    const box = element.closest<HTMLElement>(".sticker, .sticker-selection")!.getBoundingClientRect();
    return { cx: box.left + box.width / 2, cy: box.top + box.height / 2 };
  }

  function begin(event: ReactPointerEvent<HTMLElement>, item: StickerItem, kind: Gesture["kind"]) {
    if (!interactive || event.button !== 0) return;
    event.stopPropagation();
    event.preventDefault();
    onSelect(item.id);
    event.currentTarget.setPointerCapture(event.pointerId);
    if (kind === "move") {
      gesture.current = { kind, id: item.id, startX: event.clientX, startY: event.clientY, originX: item.x, originY: item.y };
    } else {
      const { cx, cy } = centerOf(event.currentTarget);
      if (kind === "rotate") {
        gesture.current = {
          kind,
          id: item.id,
          cx,
          cy,
          startAngle: Math.atan2(event.clientY - cy, event.clientX - cx),
          originRotation: item.rotation,
        };
      } else {
        gesture.current = {
          kind,
          id: item.id,
          cx,
          cy,
          startDist: Math.max(8, Math.hypot(event.clientX - cx, event.clientY - cy)),
          originScale: item.scale,
        };
      }
    }
  }

  function update(event: ReactPointerEvent<HTMLElement>) {
    const g = gesture.current;
    if (!g) return;
    if (g.kind === "move") {
      const dx = (event.clientX - g.startX) / displayScale;
      const dy = (event.clientY - g.startY) / displayScale;
      onChange(g.id, {
        x: Math.round(clamp(g.originX + dx, -40, PAGE_WIDTH + 40)),
        y: Math.round(clamp(g.originY + dy, -40, pageHeight + 40)),
      });
    } else if (g.kind === "rotate") {
      const angle = Math.atan2(event.clientY - g.cy, event.clientX - g.cx);
      let rotation = g.originRotation + ((angle - g.startAngle) * 180) / Math.PI;
      if (event.shiftKey) rotation = Math.round(rotation / 15) * 15;
      rotation = ((((rotation + 180) % 360) + 360) % 360) - 180;
      onChange(g.id, { rotation: Math.round(rotation * 10) / 10 });
    } else {
      const dist = Math.hypot(event.clientX - g.cx, event.clientY - g.cy);
      onChange(g.id, { scale: Math.round(clamp((g.originScale * dist) / g.startDist, 0.3, 3) * 100) / 100 });
    }
  }

  function end(event: ReactPointerEvent<HTMLElement>) {
    if (!gesture.current) return;
    gesture.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  }

  const selectedItem = interactive ? stickers.find((s) => s.id === selectedId) : undefined;

  return (
    <div className="sticker-layer" aria-label="贴纸图层">
      {stickers.map((item) => {
        const selected = item.id === selectedItem?.id;
        return (
          <div
            key={item.id}
            className={`sticker sticker-${item.type}${selected ? " is-selected" : ""}${interactive ? " is-interactive" : ""}`}
            style={boxStyle(item)}
            role={interactive ? "button" : undefined}
            aria-label={interactive ? `${STICKER_LABELS[item.type]}（拖动移动，Delete 删除）` : undefined}
            tabIndex={interactive ? 0 : undefined}
            onFocus={interactive ? () => onSelect(item.id) : undefined}
            onPointerDown={(e) => begin(e, item, "move")}
            onPointerMove={update}
            onPointerUp={end}
            onPointerCancel={end}
          >
            <StickerArt item={item} naturalness={naturalness} seed={seed} />
          </div>
        );
      })}
      {selectedItem ? (
        // 选框与手柄单独渲染在所有贴纸之上，避免被层级更高的贴纸遮挡；导出时被过滤
        <div className="sticker-selection" data-export-ignore="true" style={boxStyle(selectedItem)}>
          <div className="sticker-frame" />
          <span
            className="sticker-handle handle-rotate"
            title="旋转（按住 Shift 以 15° 吸附）"
            style={{ transform: `translate(-50%, -50%) scale(${1 / (selectedItem.scale * displayScale)})` }}
            onPointerDown={(e) => begin(e, selectedItem, "rotate")}
            onPointerMove={update}
            onPointerUp={end}
            onPointerCancel={end}
          />
          <span
            className="sticker-handle handle-scale"
            title="缩放"
            style={{ transform: `translate(50%, 50%) scale(${1 / (selectedItem.scale * displayScale)})` }}
            onPointerDown={(e) => begin(e, selectedItem, "scale")}
            onPointerMove={update}
            onPointerUp={end}
            onPointerCancel={end}
          />
          <button
            type="button"
            className="sticker-handle handle-delete"
            title="删除"
            aria-label="删除贴纸"
            style={{ transform: `translate(50%, -50%) scale(${1 / (selectedItem.scale * displayScale)})` }}
            onPointerDown={(e) => e.stopPropagation()}
            onClick={() => onRemove(selectedItem.id)}
          >
            ×
          </button>
        </div>
      ) : null}
    </div>
  );
}
