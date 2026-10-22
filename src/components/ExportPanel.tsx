import { useState, type RefObject } from "react";
import { byId, PAPERS, usedFamilies } from "../config/appearance.ts";
import {
  clipboardSupport,
  copyToClipboard,
  downloadBlob,
  effectiveScale,
  fileNameFor,
  renderNoteBlob,
  type ExportFormat,
  type ExportScale,
} from "../export/exportImage.ts";
import { useNoteStore } from "../state/store.ts";

type Status = { kind: "idle" } | { kind: "working"; label: string } | { kind: "done"; message: string } | { kind: "error"; message: string };

export function ExportPanel({ pageRef }: { pageRef: RefObject<HTMLDivElement | null> }) {
  const note = useNoteStore((s) => s.note);
  const settings = useNoteStore((s) => s.settings);
  const selectSticker = useNoteStore((s) => s.selectSticker);
  const [format, setFormat] = useState<ExportFormat>("png");
  const [scale, setScale] = useState<ExportScale>(2);
  const [status, setStatus] = useState<Status>({ kind: "idle" });
  const clipboard = clipboardSupport();
  const page = pageRef.current;
  const width = page?.offsetWidth ?? 840;
  const height = page?.offsetHeight ?? 1188;
  const actualScale = effectiveScale(width, height, scale);

  if (!note) return null;
  const busy = status.kind === "working";

  function render(fmt: ExportFormat) {
    const node = pageRef.current;
    if (!node) throw new Error("画布尚未就绪");
    selectSticker(null);
    return renderNoteBlob(node, {
      format: fmt,
      scale,
      families: usedFamilies(settings.zhFont, settings.enFont),
      background: byId(PAPERS, settings.paper).base,
    });
  }

  async function handleDownload() {
    setStatus({ kind: "working", label: "正在渲染高清图片…" });
    try {
      const { blob, scale: used } = await render(format);
      downloadBlob(blob, fileNameFor(note!.title, format));
      setStatus({
        kind: "done",
        message: used < scale ? `已下载（画面过大，已自动降为 ${used.toFixed(2)}x）。` : "图片已下载。",
      });
    } catch {
      setStatus({ kind: "error", message: "导出失败，请稍后重试。" });
    }
  }

  function handleCopy() {
    if (!clipboard.supported) return;
    setStatus({ kind: "working", label: "正在复制到剪贴板…" });
    // ClipboardItem 必须在点击事件中同步创建，图片内容以 Promise 形式提供
    const blob = render("png").then((r) => r.blob);
    copyToClipboard(blob)
      .then(() => setStatus({ kind: "done", message: "已复制到剪贴板，可直接粘贴到聊天或文档中。" }))
      .catch(() =>
        setStatus({
          kind: "error",
          message: "复制失败：浏览器可能拒绝了剪贴板权限。可以改用下载图片。",
        }),
      );
  }

  return (
    <div className="panel-body">
      <fieldset className="field">
        <legend>格式</legend>
        <div className="chip-group" role="radiogroup" aria-label="导出格式">
          {(["png", "jpeg"] as const).map((f) => (
            <button key={f} type="button" role="radio" aria-checked={format === f} className={`chip${format === f ? " is-active" : ""}`} onClick={() => setFormat(f)}>
              {f === "png" ? "PNG（无损）" : "JPG（体积小）"}
            </button>
          ))}
        </div>
      </fieldset>
      <fieldset className="field">
        <legend>清晰度</legend>
        <div className="chip-group" role="radiogroup" aria-label="导出倍率">
          {([1, 2, 3] as const).map((s) => (
            <button key={s} type="button" role="radio" aria-checked={scale === s} className={`chip${scale === s ? " is-active" : ""}`} onClick={() => setScale(s)}>
              {s}x
            </button>
          ))}
        </div>
        <p className="hint">
          输出尺寸约 {Math.round(width * actualScale)} × {Math.round(height * actualScale)} 像素
          {actualScale < scale ? "（长图过大，已自动限制倍率）" : ""}
        </p>
      </fieldset>

      <button type="button" className="btn btn-primary btn-block" disabled={busy} onClick={() => void handleDownload()}>
        下载图片
      </button>
      <button
        type="button"
        className="btn btn-secondary btn-block"
        disabled={busy || !clipboard.supported}
        onClick={handleCopy}
        title={clipboard.supported ? "复制 PNG 到剪贴板" : clipboard.reason}
      >
        复制到剪贴板
      </button>
      {!clipboard.supported ? <p className="hint">{clipboard.reason}，请使用下载图片。</p> : null}

      <div className="export-status" aria-live="polite">
        {status.kind === "working" ? <p className="hint">{status.label}</p> : null}
        {status.kind === "done" ? <p className="hint is-ok">{status.message}</p> : null}
        {status.kind === "error" ? <p className="hint is-error">{status.message}</p> : null}
      </div>
      <p className="hint">导出在浏览器本地完成，图片不会上传到服务器。</p>
    </div>
  );
}
