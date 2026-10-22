import { useEffect, useRef, useState } from "react";
import type { PublicConfig } from "../shared/api.ts";
import { ApiRequestError, fetchPublicConfig, generateDoodle } from "./api.ts";
import { ContentEditor } from "./components/ContentEditor.tsx";
import { ExportPanel } from "./components/ExportPanel.tsx";
import { InputPanel } from "./components/InputPanel.tsx";
import { StickerPanel } from "./components/StickerPanel.tsx";
import { StylePanel } from "./components/StylePanel.tsx";
import { Workspace } from "./components/Workspace.tsx";
import { SAMPLE_NOTE } from "./samples.ts";
import { useNoteStore } from "./state/store.ts";

const TABS = [
  { id: "style", label: "样式" },
  { id: "stickers", label: "贴纸" },
  { id: "content", label: "内容" },
  { id: "export", label: "导出" },
] as const;
type TabId = (typeof TABS)[number]["id"];

const DEFAULT_CONFIG: PublicConfig = { maxInputChars: 12_000, doodleEnabled: false, mock: false };

export function App() {
  const pageRef = useRef<HTMLDivElement>(null);
  const [config, setConfig] = useState<PublicConfig>(DEFAULT_CONFIG);
  const [tab, setTab] = useState<TabId>("style");
  const [toast, setToast] = useState<string | null>(null);
  const hasNote = useNoteStore((s) => s.note !== null);

  useEffect(() => {
    void fetchPublicConfig().then((c) => c && setConfig(c));
    const { note, setResult } = useNoteStore.getState();
    if (!note) setResult(SAMPLE_NOTE, null, "sample");
  }, []);

  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(null), 4000);
    return () => clearTimeout(timer);
  }, [toast]);

  async function requestMainDoodle() {
    const { note, setAiDoodle } = useNoteStore.getState();
    const concept = (note?.doodlePrompt || note?.title || "").slice(0, 80);
    if (!concept) return;
    setToast("AI 正在绘制插图…");
    try {
      const result = await generateDoodle(concept);
      setAiDoodle(result.doodle);
      setToast("插图已更新");
    } catch (error) {
      setToast(error instanceof ApiRequestError ? error.detail.message : "插图生成失败");
    }
  }

  return (
    <div className="app">
      <header className="app-header">
        <div className="brand">
          <span className="brand-mark" aria-hidden="true">
            墨
          </span>
          <div>
            <h1>墨语笔记</h1>
            <p>InkScribe · 把文字变成一页手写笔记</p>
          </div>
        </div>
        {config.mock ? (
          <span className="badge badge-warn" title="AI_MOCK 已开启：使用本地规则整理，不调用 Workers AI">
            开发演示模式
          </span>
        ) : null}
      </header>

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

      {toast ? (
        <div className="toast" role="status">
          {toast}
        </div>
      ) : null}
    </div>
  );
}
