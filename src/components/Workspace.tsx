import { useCallback, useEffect, useLayoutEffect, useRef, useState, type RefObject } from "react";
import { PAGE_WIDTH } from "../config/appearance.ts";
import { generateLocally, generateNote } from "../state/actions.ts";
import { useNoteStore } from "../state/store.ts";
import { NotePage, pageHeightFor } from "./note/NotePage.tsx";

const ERROR_HINTS: Record<string, string> = {
  AI_TIMEOUT: "可以尝试把“详略”调为精简，或缩短原文。",
  AI_OUTPUT_INVALID: "模型这次没有给出合规的结构，重试通常可以解决。",
  AI_RATE_LIMITED: "AI 额度暂时用尽，可以先使用本地快速排版。",
  AI_UNAVAILABLE: "AI 服务暂时不可用，可以先使用本地快速排版。",
  RATE_LIMITED: "请求过于频繁，请稍等一分钟。",
  NETWORK_ERROR: "请检查网络连接。",
};

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
    <section className="workspace" aria-label="笔记画布">
      <div className="workspace-toolbar">
        <div className="workspace-status">
          {source === "sample" ? <span className="badge">示例笔记</span> : null}
          {source === "local" ? <span className="badge badge-muted">本地快速排版</span> : null}
          {source === "shared" ? <span className="badge badge-muted">来自已发布的笔记</span> : null}
          {source === "ai" && meta ? (
            <span className="badge badge-ai" title={`模型：${meta.model}`}>
              {meta.mock ? "演示模式（未调用 AI）" : `AI 整理 · ${(meta.latencyMs / 1000).toFixed(1)}s`}
            </span>
          ) : null}
        </div>
        <div className="zoom-controls" role="group" aria-label="缩放">
          <button type="button" className="icon-btn" onClick={() => setZoom(Math.max(0.3, Math.round((scale - 0.1) * 10) / 10))} aria-label="缩小">
            −
          </button>
          <button type="button" className="zoom-value" onClick={() => setZoom(null)} title="适应宽度">
            {Math.round(scale * 100)}%
          </button>
          <button type="button" className="icon-btn" onClick={() => setZoom(Math.min(1.6, Math.round((scale + 0.1) * 10) / 10))} aria-label="放大">
            +
          </button>
        </div>
      </div>

      {error ? (
        <div className="alert alert-error" role="alert">
          <div>
            <strong>{error.message}</strong>
            {ERROR_HINTS[error.code] ? <p>{ERROR_HINTS[error.code]}</p> : null}
            <small>
              错误码 {error.code}
              {error.requestId ? ` · 请求 ${error.requestId}` : ""}
            </small>
          </div>
          <div className="alert-actions">
            <button type="button" className="btn btn-small" onClick={() => void generateNote()}>
              重试
            </button>
            <button type="button" className="btn btn-small btn-secondary" onClick={generateLocally}>
              本地快速排版
            </button>
            <button type="button" className="icon-btn" onClick={clearError} aria-label="关闭提示">
              ×
            </button>
          </div>
        </div>
      ) : null}

      {overflow && fixedHeight ? (
        <div className="alert alert-warn" role="status">
          <span>内容超出了页面，部分文字被裁切。</span>
          <div className="alert-actions">
            <button type="button" className="btn btn-small" disabled={fitting} onClick={() => void autoFit()}>
              {fitting ? "适配中…" : "自动缩小字号"}
            </button>
            <button type="button" className="btn btn-small btn-secondary" onClick={() => setSettings({ pageSize: "long" })}>
              改为长图
            </button>
            {canCondense ? (
              <button type="button" className="btn btn-small btn-secondary" onClick={condense} title="以“精简”详略重新整理原文">
                精简后重新生成
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
                <span>AI 正在阅读并整理你的文字…</span>
              </div>
            </div>
          ) : null}
        </div>
      </div>
    </section>
  );
}
