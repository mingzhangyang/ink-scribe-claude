import { useRef, useState, type RefObject } from "react";
import { byId, PAPERS, usedFamilies } from "../config/appearance.ts";
import { downloadBlob, fileNameFor, renderNoteBlob } from "../export/exportImage.ts";
import { useT } from "../i18n/index.ts";
import { useNoteStore } from "../state/store.ts";
import type { NoteFitState } from "./note/useNoteFit.ts";

/** 生成图片时的笔记状态：任一项变化后，之前生成的图片就不再对应当前画布。 */
type Snapshot = readonly unknown[];

function canShareFile(file: File): boolean {
  return typeof navigator.share === "function" && typeof navigator.canShare === "function" && navigator.canShare({ files: [file] });
}

function isDomError(error: unknown, name: string): boolean {
  return error instanceof DOMException && error.name === name;
}

/** 浮在画布右下角：把当前笔记渲染为 PNG，交给系统分享面板。 */
export function ShareButton({ pageRef, fit, onToast }: {
  pageRef: RefObject<HTMLDivElement | null>;
  fit: NoteFitState | null;
  onToast: (message: string) => void;
}) {
  const note = useNoteStore((s) => s.note);
  const settings = useNoteStore((s) => s.settings);
  const stickers = useNoteStore((s) => s.stickers);
  const aiDoodle = useNoteStore((s) => s.aiDoodle);
  const generating = useNoteStore((s) => s.status === "loading");
  const selectSticker = useNoteStore((s) => s.selectSticker);
  // 渲染图片与系统分享面板打开期间都不接受新的点击：同时发起第二次分享会被浏览器拒绝
  const [phase, setPhase] = useState<"idle" | "preparing" | "sharing">("idle");
  const prepared = useRef<{ snapshot: Snapshot; file: File } | null>(null);
  const t = useT();

  if (!note) return null;
  const snapshot: Snapshot = [note, settings, stickers, aiDoodle];
  const preparing = phase === "preparing";
  const disabled = phase !== "idle" || generating || fit?.status !== "ready";

  function cachedFile(): File | null {
    const cached = prepared.current;
    return cached && cached.snapshot.every((value, index) => value === snapshot[index]) ? cached.file : null;
  }

  async function share(file: File, freshGesture: boolean) {
    setPhase("sharing");
    try {
      await navigator.share({ files: [file], title: note!.title });
    } catch (error) {
      if (isDomError(error, "AbortError")) return;
      // 渲染耗时较长时点击手势已过期，浏览器会拒绝分享：图片已备好，再点一次即可立即分享
      if (!freshGesture && isDomError(error, "NotAllowedError")) onToast(t.share.ready);
      else onToast(t.share.failed);
    } finally {
      setPhase("idle");
    }
  }

  async function prepareAndShare() {
    const node = pageRef.current;
    if (!node) return;
    setPhase("preparing");
    selectSticker(null);
    try {
      const { blob } = await renderNoteBlob(node, {
        format: "png",
        scale: 2,
        families: usedFamilies(settings.zhFont, settings.enFont),
        background: byId(PAPERS, settings.paper).base,
      });
      const file = new File([blob], fileNameFor(note!.title, "png"), { type: "image/png" });
      if (!canShareFile(file)) {
        downloadBlob(blob, file.name);
        onToast(t.share.unsupported);
        return;
      }
      prepared.current = { snapshot, file };
      await share(file, false);
    } catch {
      onToast(t.share.failed);
    } finally {
      setPhase("idle");
    }
  }

  function handleClick() {
    // 已有对应当前画布的图片时在点击事件中同步调用分享，保留用户手势
    const file = cachedFile();
    if (file) void share(file, true);
    else void prepareAndShare();
  }

  return (
    <button
      type="button"
      className="share-fab"
      disabled={disabled}
      aria-busy={preparing}
      onClick={handleClick}
      aria-label={t.share.label}
      title={preparing ? t.share.preparing : t.share.label}
    >
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <circle cx="18" cy="5" r="3" />
        <circle cx="6" cy="12" r="3" />
        <circle cx="18" cy="19" r="3" />
        <path d="M8.6 13.5l6.8 4M15.4 6.5l-6.8 4" />
      </svg>
    </button>
  );
}
