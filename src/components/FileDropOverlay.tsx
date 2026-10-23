import type { DragEvent } from "react";
import { useT } from "../i18n/index.ts";

/** 拖动的是文件，而不是选中的文字或链接。 */
export function isFileDrag(event: DragEvent): boolean {
  return event.dataTransfer.types.includes("Files");
}

/**
 * 拖入文件时盖住整个区域的接收层，由父元素在 dragenter 时显示。
 * 接收层下没有其他元素，只有真正离开区域或取消拖动时才会收到 dragleave，提示不会闪烁。
 */
export function FileDropOverlay({ className, onFile, onLeave }: {
  className?: string;
  onFile: (file: File) => void;
  onLeave: () => void;
}) {
  const t = useT();
  return (
    <div
      className={`drop-overlay${className ? ` ${className}` : ""}`}
      onDragOver={(event) => {
        event.preventDefault();
        event.dataTransfer.dropEffect = "copy";
      }}
      onDragLeave={onLeave}
      onDrop={(event) => {
        event.preventDefault();
        onLeave();
        const file = event.dataTransfer.files[0];
        if (file) onFile(file);
      }}
    >
      <div className="drop-card">
        <strong>{t.input.dropHint}</strong>
        <small>{t.input.dropFormats}</small>
      </div>
    </div>
  );
}
