import { useEffect, useRef, useState } from "react";
import type { PublicConfig } from "../../shared/api.ts";
import { ApiRequestError, generateDoodle } from "../api.ts";
import { ContentEditor } from "../components/ContentEditor.tsx";
import { ExportPanel } from "../components/ExportPanel.tsx";
import { InputPanel } from "../components/InputPanel.tsx";
import { StickerPanel } from "../components/StickerPanel.tsx";
import { StylePanel } from "../components/StylePanel.tsx";
import { Workspace } from "../components/Workspace.tsx";
import { SAMPLE_NOTE } from "../samples.ts";
import { useNoteStore } from "../state/store.ts";

const TABS = [
  { id: "style", label: "样式" },
  { id: "stickers", label: "贴纸" },
  { id: "content", label: "内容" },
  { id: "export", label: "导出" },
] as const;
type TabId = (typeof TABS)[number]["id"];

export function EditorPage({ config, onToast }: { config: PublicConfig; onToast: (message: string) => void }) {
  const pageRef = useRef<HTMLDivElement>(null);
  const [tab, setTab] = useState<TabId>("style");
  const hasNote = useNoteStore((s) => s.note !== null);

  useEffect(() => {
    const { note, setResult } = useNoteStore.getState();
    if (!note) setResult(SAMPLE_NOTE, null, "sample");
  }, []);

  async function requestMainDoodle() {
    const { note, setAiDoodle } = useNoteStore.getState();
    const concept = (note?.doodlePrompt || note?.title || "").slice(0, 80);
    if (!concept) return;
    onToast("AI 正在绘制插图…");
    try {
      const result = await generateDoodle(concept);
      setAiDoodle(result.doodle);
      onToast("插图已更新");
    } catch (error) {
      onToast(error instanceof ApiRequestError ? error.detail.message : "插图生成失败");
    }
  }

  return (
    <main className="app-main">
      <InputPanel maxChars={config.maxInputChars} />
      {hasNote ? <Workspace pageRef={pageRef} /> : <section className="workspace" />}
      <aside className="panel side-panel" aria-label="编辑面板">
        <div className="tabs" role="tablist">
          {TABS.map((t) => (
            <button
              key={t.id}
              type="button"
              role="tab"
              id={`tab-${t.id}`}
              aria-selected={tab === t.id}
              aria-controls={`tabpanel-${t.id}`}
              className={`tab${tab === t.id ? " is-active" : ""}`}
              onClick={() => setTab(t.id)}
            >
              {t.label}
            </button>
          ))}
        </div>
        <div role="tabpanel" id={`tabpanel-${tab}`} aria-labelledby={`tab-${tab}`}>
          {tab === "style" ? <StylePanel doodleEnabled={config.doodleEnabled} onRequestAiDoodle={() => void requestMainDoodle()} /> : null}
          {tab === "stickers" ? <StickerPanel doodleEnabled={config.doodleEnabled} /> : null}
          {tab === "content" ? <ContentEditor /> : null}
          {tab === "export" ? <ExportPanel pageRef={pageRef} /> : null}
        </div>
      </aside>
    </main>
  );
}
