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
import { useT } from "../i18n/index.ts";
import { useNoteStore } from "../state/store.ts";

type Status = { kind: "idle" } | { kind: "working"; label: string } | { kind: "done"; message: string } | { kind: "error"; message: string };

export function ExportPanel({ pageRef }: { pageRef: RefObject<HTMLDivElement | null> }) {
  const note = useNoteStore((s) => s.note);
  const settings = useNoteStore((s) => s.settings);
  const selectSticker = useNoteStore((s) => s.selectSticker);
  const [format, setFormat] = useState<ExportFormat>("png");
  const [scale, setScale] = useState<ExportScale>(2);
  const [status, setStatus] = useState<Status>({ kind: "idle" });
  const t = useT();
  const clipboard = clipboardSupport();
  const page = pageRef.current;
  const width = page?.offsetWidth ?? 840;
  const height = page?.offsetHeight ?? 1188;
  const actualScale = effectiveScale(width, height, scale);

  if (!note) return null;
  const busy = status.kind === "working";

  async function render(fmt: ExportFormat) {
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
    setStatus({ kind: "working", label: t.export.rendering });
    try {
      const { blob, scale: used } = await render(format);
      downloadBlob(blob, fileNameFor(note!.title, format));
      setStatus({
        kind: "done",
        message: used < scale ? t.export.downloadedReduced(used.toFixed(2)) : t.export.downloaded,
      });
    } catch {
      setStatus({ kind: "error", message: t.export.failed });
    }
  }

  function handleCopy() {
    if (!clipboard.supported) return;
    setStatus({ kind: "working", label: t.export.copying });
    const fail = () => setStatus({ kind: "error", message: t.export.copyFailed });
    // ClipboardItem 必须在点击事件中同步创建，图片内容以 Promise 形式提供
    const blob = render("png").then((r) => r.blob);
    try {
      copyToClipboard(blob)
        .then(() => setStatus({ kind: "done", message: t.export.copied }))
        .catch(fail);
    } catch {
      blob.catch(() => undefined);
      fail();
    }
  }

  return (
    <div className="panel-body">
      <fieldset className="field">
        <legend>{t.export.format}</legend>
        <div className="chip-group" role="radiogroup" aria-label={t.export.formatLabel}>
          {(["png", "jpeg"] as const).map((f) => (
            <button key={f} type="button" role="radio" aria-checked={format === f} className={`chip${format === f ? " is-active" : ""}`} onClick={() => setFormat(f)}>
              {f === "png" ? t.export.png : t.export.jpeg}
            </button>
          ))}
        </div>
      </fieldset>
      <fieldset className="field">
        <legend>{t.export.scale}</legend>
        <div className="chip-group" role="radiogroup" aria-label={t.export.scaleLabel}>
          {([1, 2, 3] as const).map((s) => (
            <button key={s} type="button" role="radio" aria-checked={scale === s} className={`chip${scale === s ? " is-active" : ""}`} onClick={() => setScale(s)}>
              {s}x
            </button>
          ))}
        </div>
        <p className="hint">
          {t.export.size(Math.round(width * actualScale), Math.round(height * actualScale))}
          {actualScale < scale ? t.export.sizeLimited : ""}
        </p>
      </fieldset>

      <button type="button" className="btn btn-primary btn-block" disabled={busy} onClick={() => void handleDownload()}>
        {t.export.download}
      </button>
      <button
        type="button"
        className="btn btn-secondary btn-block"
        disabled={busy || !clipboard.supported}
        onClick={handleCopy}
        title={clipboard.supported ? t.export.copyTitle : clipboard.reason}
      >
        {t.export.copy}
      </button>
      {!clipboard.supported ? <p className="hint">{t.export.copyUnsupported(clipboard.reason)}</p> : null}

      <div className="export-status" aria-live="polite">
        {status.kind === "working" ? <p className="hint">{status.label}</p> : null}
        {status.kind === "done" ? <p className="hint is-ok">{status.message}</p> : null}
        {status.kind === "error" ? <p className="hint is-error">{status.message}</p> : null}
      </div>
      <p className="hint">{t.export.local}</p>
    </div>
  );
}
