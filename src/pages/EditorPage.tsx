import { useEffect, useRef, useState } from "react";
import type { PublicConfig } from "../../shared/api.ts";
import { ApiRequestError, generateDoodle } from "../api.ts";
import { ContentEditor } from "../components/ContentEditor.tsx";
import { DraftBar } from "../components/DraftBar.tsx";
import { ExportPanel } from "../components/ExportPanel.tsx";
import { FileDropOverlay, isFileDrag } from "../components/FileDropOverlay.tsx";
import { InputPanel, InputTrigger } from "../components/InputPanel.tsx";
import { LibraryBar } from "../components/LibraryBar.tsx";
import { Sheet } from "../components/Sheet.tsx";
import { StickerPanel } from "../components/StickerPanel.tsx";
import { StylePanel } from "../components/StylePanel.tsx";
import { useFileImport } from "../components/useFileImport.ts";
import { Workspace } from "../components/Workspace.tsx";
import type { NoteFitState } from "../components/note/useNoteFit.ts";
import { errorMessage, useT } from "../i18n/index.ts";
import { SAMPLE_NOTE, SAMPLE_NOTE_EN } from "../samples.ts";
import { usePreferences } from "../state/preferences.ts";
import { useNoteStore } from "../state/store.ts";

const TABS = ["style", "stickers", "content", "export"] as const;
type TabId = (typeof TABS)[number];

export function EditorPage({ config, onToast }: { config: PublicConfig; onToast: (message: string) => void }) {
  const pageRef = useRef<HTMLDivElement>(null);
  const [tab, setTab] = useState<TabId>("style");
  const [fit, setFit] = useState<NoteFitState | null>(null);
  const [inputOpen, setInputOpen] = useState(false);
  const [pageDrop, setPageDrop] = useState(false);
  const { importState, importFile } = useFileImport();
  const hasNote = useNoteStore((s) => s.note !== null);
  const locale = usePreferences((s) => s.locale);
  const t = useT();

  useEffect(() => {
    // 首次打开时展示与界面语言一致的示例笔记；切换语言时，未经修改的示例笔记跟着切换。
    // 替换会重置状态、递增 noteSerial 并清除 AI 插图：生成中会丢弃生成结果，生成失败时会清掉错误提示与重试按钮，
    // 正在生成或已有 AI 插图时会丢掉插图，这些情况下保留原示例
    const { note, status, aiDoodle, settings, setResult } = useNoteStore.getState();
    const sample = locale === "en" ? SAMPLE_NOTE_EN : SAMPLE_NOTE;
    if (!note) {
      setResult(sample, null, "sample");
      return;
    }
    const untouchedSample = note !== sample && (note === SAMPLE_NOTE || note === SAMPLE_NOTE_EN);
    if (untouchedSample && status === "idle" && !aiDoodle && settings.doodleMode !== "ai") setResult(sample, null, "sample");
  }, [locale]);

  async function requestMainDoodle() {
    const { note, noteSerial } = useNoteStore.getState();
    const concept = (note?.doodlePrompt || note?.title || "").slice(0, 80);
    if (!concept) return;
    onToast(t.editor.doodleDrawing);
    try {
      const result = await generateDoodle(concept);
      // 等待期间用户可能已生成或载入了另一条笔记，此时丢弃结果
      if (useNoteStore.getState().noteSerial !== noteSerial) return;
      // 等待期间用户可能改选了“不显示插图”或内置主题，不能用结果覆盖新的选择
      if (useNoteStore.getState().settings.doodleMode !== "ai") return;
      useNoteStore.getState().setAiDoodle(result.doodle);
      onToast(t.editor.doodleUpdated);
    } catch (error) {
      onToast(error instanceof ApiRequestError ? errorMessage(t, error.detail) : t.editor.doodleFailed);
    }
  }

  const openInput = () => setInputOpen(true);
  const closeInput = () => setInputOpen(false);

  // 把文件拖到页面任意位置：打开原文弹窗并导入，解析结果显示在弹窗里
  function importDroppedFile(file: File) {
    openInput();
    void importFile(file);
  }

  function onSubmitted() {
    closeInput();
    // 窄屏上画布可能已滚出视野：滚回画布，让用户看到生成进度
    pageRef.current?.closest(".workspace")?.scrollIntoView({ block: "nearest" });
  }

  return (
    <main
      className="app-main"
      onDragEnter={(event) => {
        // 弹窗打开时由弹窗自己接收文件
        if (inputOpen || !isFileDrag(event)) return;
        event.preventDefault();
        setPageDrop(true);
      }}
    >
      {hasNote ? (
        <Workspace pageRef={pageRef} fit={fit} onFitChange={setFit} onEditInput={openInput} />
      ) : (
        <section className="workspace">
          <div className="workspace-toolbar">
            <InputTrigger onOpen={openInput} />
          </div>
        </section>
      )}
      <aside className="panel side-panel" aria-label={t.editor.panelLabel}>
        <DraftBar />
        <LibraryBar />
        <div className="tabs" role="tablist">
          {TABS.map((id) => (
            <button
              key={id}
              type="button"
              role="tab"
              id={`tab-${id}`}
              aria-selected={tab === id}
              aria-controls={`tabpanel-${id}`}
              className={`tab${tab === id ? " is-active" : ""}`}
              onClick={() => setTab(id)}
            >
              {t.editor.tabs[id]}
            </button>
          ))}
        </div>
        <div role="tabpanel" id={`tabpanel-${tab}`} aria-labelledby={`tab-${tab}`}>
          {tab === "style" ? <StylePanel doodleEnabled={config.doodleEnabled} onRequestAiDoodle={() => void requestMainDoodle()} /> : null}
          {tab === "stickers" ? <StickerPanel doodleEnabled={config.doodleEnabled} /> : null}
          {tab === "content" ? <ContentEditor /> : null}
          {tab === "export" ? <ExportPanel pageRef={pageRef} fit={fit} /> : null}
        </div>
      </aside>
      <Sheet open={inputOpen} onClose={closeInput} labelledBy="input-title" className="input-sheet">
        <InputPanel
          maxChars={config.maxInputChars}
          importState={importState}
          onImportFile={(file) => void importFile(file)}
          onClose={closeInput}
          onSubmitted={onSubmitted}
        />
      </Sheet>
      {pageDrop ? <FileDropOverlay className="is-page" onFile={importDroppedFile} onLeave={() => setPageDrop(false)} /> : null}
    </main>
  );
}
