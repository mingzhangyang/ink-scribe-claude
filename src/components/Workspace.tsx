import { useCallback, useEffect, useLayoutEffect, useRef, useState, type RefObject } from "react";
import { PAGE_WIDTH } from "../config/appearance.ts";
import { errorMessage, useT } from "../i18n/index.ts";
import { generateLocally, generateNote } from "../state/actions.ts";
import { useNoteStore } from "../state/store.ts";
import { NotePage, pageHeightFor } from "./note/NotePage.tsx";

function measureOverflow(page: HTMLElement | null): boolean {
  if (!page || page.classList.contains("is-long")) return false;
  // 多栏布局溢出时会向右生成新栏，因此同时检查横向溢出
  return Array.from(page.querySelectorAll<HTMLElement>("[data-fit]")).some(
    (el) => el.scrollHeight > el.clientHeight + 2 || el.scrollWidth > el.clientWidth + 2,
  );
}

const nextFrame = () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));

export function Workspace({ pageRef }: { pageRef: RefObject<HTMLDivElement | null> }) {
  const note = useNoteStore((s) => s.note);
  const settings = useNoteStore((s) => s.settings);
  const stickers = useNoteStore((s) => s.stickers);
  const aiDoodle = useNoteStore((s) => s.aiDoodle);
  const selectedStickerId = useNoteStore((s) => s.selectedStickerId);
  const status = useNoteStore((s) => s.status);
  const error = useNoteStore((s) => s.error);
  const source = useNoteStore((s) => s.source);
  const meta = useNoteStore((s) => s.meta);
  const selectSticker = useNoteStore((s) => s.selectSticker);
  const updateSticker = useNoteStore((s) => s.updateSticker);
  const removeSticker = useNoteStore((s) => s.removeSticker);
  const setSettings = useNoteStore((s) => s.setSettings);
  const clearError = useNoteStore((s) => s.clearError);
  const hasInput = useNoteStore((s) => s.input.text.trim().length > 0);
  const t = useT();

  const viewportRef = useRef<HTMLDivElement>(null);
  const [viewport, setViewport] = useState({ width: PAGE_WIDTH, height: 1200 });
  const [zoom, setZoom] = useState<number | null>(null);
  const [pageHeight, setPageHeight] = useState(1188);
  const [overflow, setOverflow] = useState(false);
  const [fitting, setFitting] = useState(false);
  const fixedHeight = pageHeightFor(settings);
  // 固定尺寸的页面完整显示在视口内；长图只按宽度适配
  const fitScale = Math.max(
    0.3,
    Math.min(1, (viewport.width - 32) / PAGE_WIDTH, fixedHeight ? (viewport.height - 32) / fixedHeight : Infinity),
  );
  const scale = zoom ?? fitScale;

  useLayoutEffect(() => {
    const element = viewportRef.current;
    if (!element) return;
    const observer = new ResizeObserver(() => setViewport({ width: element.clientWidth, height: element.clientHeight }));
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  const check = useCallback(() => {
    const page = pageRef.current;
    if (!page) return;
    setPageHeight(page.offsetHeight);
    setOverflow(measureOverflow(page));
  }, [pageRef]);

  useLayoutEffect(() => {
    check();
  }, [check, note, settings, stickers, aiDoodle]);

  useEffect(() => {
    const page = pageRef.current;
    if (!page) return;
    const observer = new ResizeObserver(check);
    observer.observe(page);
    document.fonts?.addEventListener("loadingdone", check);
    return () => {
      observer.disconnect();
      document.fonts?.removeEventListener("loadingdone", check);
    };
  }, [check, pageRef, note]);

  async function autoFit() {
    setFitting(true);
    try {
      let { fontSize, lineHeight } = useNoteStore.getState().settings;
      for (let i = 0; i < 40 && measureOverflow(pageRef.current); i++) {
        if (lineHeight > 1.5) lineHeight = Math.round((lineHeight - 0.05) * 100) / 100;
        else if (fontSize > 12) fontSize = Math.round((fontSize - 0.5) * 10) / 10;
        else break;
        setSettings({ fontSize, lineHeight });
        await nextFrame();
        await nextFrame();
      }
    } finally {
      setFitting(false);
      check();
    }
  }

  // 原文仍在输入框中时，可以用“精简”档位重新整理来压缩内容
  const canCondense = hasInput && (source === "ai" || source === "local") && status !== "loading";
  function condense() {
    const { setInput } = useNoteStore.getState();
    setInput({ detail: "concise" });
    if (source === "local") generateLocally();
    else void generateNote();
  }

  if (!note) return null;

  return (
    <section className="workspace" aria-label={t.workspace.label}>
      <div className="workspace-toolbar">
        <div className="workspace-status">
          {source === "sample" ? <span className="badge">{t.workspace.sample}</span> : null}
          {source === "local" ? <span className="badge badge-muted">{t.workspace.local}</span> : null}
          {source === "shared" ? <span className="badge badge-muted">{t.workspace.shared}</span> : null}
          {source === "ai" && meta ? (
            <span className="badge badge-ai" title={t.workspace.model(meta.model)}>
              {meta.mock ? t.workspace.mock : t.workspace.ai((meta.latencyMs / 1000).toFixed(1))}
            </span>
          ) : null}
        </div>
        <div className="zoom-controls" role="group" aria-label={t.workspace.zoom}>
          <button type="button" className="icon-btn" onClick={() => setZoom(Math.max(0.3, Math.round((scale - 0.1) * 10) / 10))} aria-label={t.workspace.zoomOut}>
            −
          </button>
          <button type="button" className="zoom-value" onClick={() => setZoom(null)} title={t.workspace.fitWidth}>
            {Math.round(scale * 100)}%
          </button>
          <button type="button" className="icon-btn" onClick={() => setZoom(Math.min(1.6, Math.round((scale + 0.1) * 10) / 10))} aria-label={t.workspace.zoomIn}>
            +
          </button>
        </div>
      </div>

      {error ? (
        <div className="alert alert-error" role="alert">
          <div>
            <strong>{errorMessage(t, error)}</strong>
            {t.workspace.errorHints[error.code] ? <p>{t.workspace.errorHints[error.code]}</p> : null}
            <small>
              {t.workspace.errorCode(error.code)}
              {error.requestId ? t.workspace.requestId(error.requestId) : ""}
            </small>
          </div>
          <div className="alert-actions">
            <button type="button" className="btn btn-small" onClick={() => void generateNote()}>
              {t.workspace.retry}
            </button>
            <button type="button" className="btn btn-small btn-secondary" onClick={generateLocally}>
              {t.workspace.localFallback}
            </button>
            <button type="button" className="icon-btn" onClick={clearError} aria-label={t.workspace.dismiss}>
              ×
            </button>
          </div>
        </div>
      ) : null}

      {overflow && fixedHeight ? (
        <div className="alert alert-warn" role="status">
          <span>{t.workspace.overflow}</span>
          <div className="alert-actions">
            <button type="button" className="btn btn-small" disabled={fitting} onClick={() => void autoFit()}>
              {fitting ? t.workspace.fitting : t.workspace.autoFit}
            </button>
            <button type="button" className="btn btn-small btn-secondary" onClick={() => setSettings({ pageSize: "long" })}>
              {t.workspace.toLong}
            </button>
            {canCondense ? (
              <button type="button" className="btn btn-small btn-secondary" onClick={condense} title={t.workspace.condenseTitle}>
                {t.workspace.condense}
              </button>
            ) : null}
          </div>
        </div>
      ) : null}

      <div className="viewport" ref={viewportRef}>
        <div className="page-frame" style={{ width: PAGE_WIDTH * scale, height: pageHeight * scale }}>
          <div className="page-scaler" style={{ transform: `scale(${scale})` }}>
            <NotePage
              ref={pageRef}
              note={note}
              settings={settings}
              stickers={stickers}
              aiDoodle={aiDoodle}
              selectedStickerId={selectedStickerId}
              interactive
              displayScale={scale}
              onSelectSticker={selectSticker}
              onChangeSticker={updateSticker}
              onRemoveSticker={removeSticker}
            />
          </div>
          {status === "loading" ? (
            <div className="loading-overlay" role="status" aria-live="polite">
              <div className="loading-card">
                <span className="loading-pen" aria-hidden="true">
                  ✍️
                </span>
                <span>{t.workspace.loading}</span>
              </div>
            </div>
          ) : null}
        </div>
      </div>
    </section>
  );
}
