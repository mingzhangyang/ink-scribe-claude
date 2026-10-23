import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { isOneOf, TEMPLATES } from "../../shared/options.ts";
import { ApiRequestError, fetchPublishedNote, type ViewableNote } from "../api.ts";
import { NotePage } from "../components/note/NotePage.tsx";
import { NoteFitNotice, NoteFitStatus } from "../components/note/NoteFitStatus.tsx";
import type { NoteFitState } from "../components/note/useNoteFit.ts";
import { byId, PAGE_WIDTH, PAPERS, usedFamilies } from "../config/appearance.ts";
import { downloadBlob, fileNameFor, renderNoteBlob } from "../export/exportImage.ts";
import { errorMessage, useT } from "../i18n/index.ts";
import { linkProps, navigate } from "../router.ts";
import { useNoteStore, type RequestError } from "../state/store.ts";

const noop = () => {};

type State = { kind: "loading" } | { kind: "error"; code: string; message?: string } | { kind: "ready"; data: ViewableNote };

/** 已发布笔记的只读查看页：可复制链接、下载图片，或载入编辑器继续修改。 */
export function NoteViewPage({ id, onToast }: { id: string; onToast: (message: string) => void }) {
  const [state, setState] = useState<State>({ kind: "loading" });
  const pageRef = useRef<HTMLDivElement>(null);
  const frameRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(PAGE_WIDTH);
  const [pageHeight, setPageHeight] = useState(1188);
  const [exporting, setExporting] = useState(false);
  const [fit, setFit] = useState<NoteFitState | null>(null);
  const loadShared = useNoteStore((s) => s.loadShared);
  const t = useT();

  useEffect(() => {
    let cancelled = false;
    setState({ kind: "loading" });
    fetchPublishedNote(id)
      .then((data) => !cancelled && setState({ kind: "ready", data }))
      .catch((error: unknown) => {
        if (cancelled) return;
        // 文案在渲染时按当前界面语言生成，切换语言后提示也随之切换
        setState(error instanceof ApiRequestError ? { kind: "error", ...error.detail } : { kind: "error", code: "INTERNAL_ERROR" });
      });
    return () => {
      cancelled = true;
    };
  }, [id]);

  useEffect(() => {
    if (state.kind !== "ready") return;
    document.title = t.view.documentTitle(state.data.note.title);
  }, [state, t]);

  useLayoutEffect(() => {
    const frame = frameRef.current;
    if (!frame) return;
    const observer = new ResizeObserver(() => {
      setWidth(frame.clientWidth);
      if (pageRef.current) setPageHeight(pageRef.current.offsetHeight);
    });
    observer.observe(frame);
    if (pageRef.current) observer.observe(pageRef.current);
    return () => observer.disconnect();
  }, [state.kind]);

  if (state.kind === "loading") {
    return (
      <main className="page-center">
        <p className="hint">{t.view.loading}</p>
      </main>
    );
  }
  if (state.kind === "error") {
    return (
      <main className="page-center">
        <div className="empty-state">
          <h2>
            {state.code === "NOT_FOUND"
              ? t.view.notFound
              : state.message
                ? errorMessage(t, { code: state.code as RequestError["code"], message: state.message })
                : t.view.loadFailed}
          </h2>
          <a className="btn btn-secondary" {...linkProps("/gallery")}>
            {t.view.toGallery}
          </a>
        </div>
      </main>
    );
  }

  const { data } = state;
  const page = (
    <NotePage
      ref={pageRef}
      note={data.note}
      settings={data.settings}
      stickers={data.stickers}
      aiDoodle={data.doodle}
      selectedStickerId={null}
      interactive={false}
      displayScale={1}
      onSelectSticker={noop}
      onChangeSticker={noop}
      onRemoveSticker={noop}
      onFitChange={setFit}
    />
  );
  const scale = Math.min(1, width / PAGE_WIDTH);

  async function download() {
    if (!pageRef.current || fit?.status !== "ready") return;
    setExporting(true);
    try {
      const { blob } = await renderNoteBlob(pageRef.current, {
        format: "png",
        scale: 2,
        families: usedFamilies(data.settings.zhFont, data.settings.enFont),
        background: byId(PAPERS, data.settings.paper).base,
      });
      downloadBlob(blob, fileNameFor(data.note.title, "png"));
    } catch {
      onToast(t.view.exportFailed);
    } finally {
      setExporting(false);
    }
  }

  async function copyLink() {
    try {
      await navigator.clipboard.writeText(location.href.split("?")[0]);
      onToast(t.view.linkCopied);
    } catch {
      onToast(t.view.linkFailed);
    }
  }

  function openInEditor() {
    loadShared(data);
    navigate("/");
  }

  return (
    <main className="view-main">
      <div className="view-toolbar">
        <div className="view-meta">
          <h2>{data.note.title}</h2>
          <p className="hint">
            {isOneOf(TEMPLATES, data.summary.template) ? t.options.templates[data.summary.template] : t.view.note}
            {data.note.date ? ` · ${data.note.date}` : ""}
            {data.summary.visibility === "unlisted" ? t.view.unlisted : ""}
          </p>
        </div>
        <div className="button-row">
          <button type="button" className="btn btn-small btn-secondary" onClick={() => void copyLink()}>
            {t.view.copyLink}
          </button>
          <button type="button" className="btn btn-small btn-secondary" disabled={exporting || fit?.status !== "ready"} onClick={() => void download()}>
            {exporting ? t.view.exporting : t.view.download}
          </button>
          <button type="button" className="btn btn-small" onClick={openInEditor}>
            {t.view.openInEditor}
          </button>
        </div>
      </div>
      <NoteFitStatus fit={fit} />
      <NoteFitNotice fit={fit} fixed />
      <div className="view-frame" ref={frameRef}>
        <div className="page-frame" style={{ width: PAGE_WIDTH * scale, height: pageHeight * scale }}>
          <div className="page-scaler" style={{ transform: `scale(${scale})` }}>
            {page}
          </div>
        </div>
      </div>
    </main>
  );
}
