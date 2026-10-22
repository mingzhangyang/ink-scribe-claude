import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { TEMPLATE_LABELS, isOneOf, TEMPLATES } from "../../shared/options.ts";
import { ApiRequestError, fetchPublishedNote, type ViewableNote } from "../api.ts";
import { NotePage } from "../components/note/NotePage.tsx";
import { byId, PAGE_WIDTH, PAPERS, usedFamilies } from "../config/appearance.ts";
import { downloadBlob, fileNameFor, renderNoteBlob } from "../export/exportImage.ts";
import { ensureFontsLoaded } from "../export/fontEmbed.ts";
import { loadFontCss } from "../fonts.ts";
import { linkProps, navigate } from "../router.ts";
import { useNoteStore } from "../state/store.ts";

const noop = () => {};

type State = { kind: "loading" } | { kind: "error"; code: string; message: string } | { kind: "ready"; data: ViewableNote };

/**
 * 已发布笔记的只读查看页。render 模式（?render=1）只输出笔记页面本身，
 * 供 Browser Rendering 截图生成预览图：字体加载完成后在 <html> 上标记 data-render-ready。
 */
export function NoteViewPage({ id, render, onToast }: { id: string; render: boolean; onToast: (message: string) => void }) {
  const [state, setState] = useState<State>({ kind: "loading" });
  const pageRef = useRef<HTMLDivElement>(null);
  const frameRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(PAGE_WIDTH);
  const [pageHeight, setPageHeight] = useState(1188);
  const [exporting, setExporting] = useState(false);
  const loadShared = useNoteStore((s) => s.loadShared);

  useEffect(() => {
    let cancelled = false;
    setState({ kind: "loading" });
    fetchPublishedNote(id)
      .then((data) => !cancelled && setState({ kind: "ready", data }))
      .catch((error: unknown) => {
        if (cancelled) return;
        const detail = error instanceof ApiRequestError ? error.detail : { code: "INTERNAL_ERROR", message: "加载失败，请稍后重试。" };
        setState({ kind: "error", code: detail.code, message: detail.code === "NOT_FOUND" ? "这条笔记不存在或已被删除。" : detail.message });
      });
    return () => {
      cancelled = true;
    };
  }, [id]);

  useEffect(() => {
    if (state.kind !== "ready") return;
    document.title = `${state.data.note.title} · 墨语笔记`;
    if (!render) return;
    // 截图前确保所需字体分片全部加载
    const families = usedFamilies(state.data.settings.zhFont, state.data.settings.enFont);
    void (async () => {
      await Promise.all(families.map(loadFontCss));
      await ensureFontsLoaded(families, pageRef.current?.textContent ?? "");
      await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      document.documentElement.dataset.renderReady = "true";
    })();
  }, [state, render]);

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
    return <main className="page-center">{render ? null : <p className="hint">正在加载笔记…</p>}</main>;
  }
  if (state.kind === "error") {
    return (
      <main className="page-center">
        <div className="empty-state">
          <h2>{state.message}</h2>
          <a className="btn btn-secondary" {...linkProps("/gallery")}>
            去图库看看
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
    />
  );
  if (render) return <div className="render-root">{page}</div>;

  const scale = Math.min(1, width / PAGE_WIDTH);

  async function download() {
    if (!pageRef.current) return;
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
      onToast("导出失败，请稍后重试");
    } finally {
      setExporting(false);
    }
  }

  async function copyLink() {
    try {
      await navigator.clipboard.writeText(location.href.split("?")[0]);
      onToast("链接已复制");
    } catch {
      onToast("无法访问剪贴板，请手动复制地址栏中的链接");
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
            {isOneOf(TEMPLATES, data.summary.template) ? TEMPLATE_LABELS[data.summary.template] : "笔记"}
            {data.note.date ? ` · ${data.note.date}` : ""}
            {data.summary.visibility === "unlisted" ? " · 仅持有链接可见" : ""}
          </p>
        </div>
        <div className="button-row">
          <button type="button" className="btn btn-small btn-secondary" onClick={() => void copyLink()}>
            复制链接
          </button>
          <button type="button" className="btn btn-small btn-secondary" disabled={exporting} onClick={() => void download()}>
            {exporting ? "正在导出…" : "下载图片"}
          </button>
          <button type="button" className="btn btn-small" onClick={openInEditor}>
            在编辑器中打开
          </button>
        </div>
      </div>
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
