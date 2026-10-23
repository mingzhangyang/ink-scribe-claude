import { useEffect, useState } from "react";
import type { PublicConfig } from "../shared/api.ts";
import { fetchPublicConfig } from "./api.ts";
import { EditorPage } from "./pages/EditorPage.tsx";
import { GalleryPage } from "./pages/GalleryPage.tsx";
import { NoteViewPage } from "./pages/NoteViewPage.tsx";
import { linkProps, useRoute } from "./router.ts";

const DEFAULT_CONFIG: PublicConfig = { maxInputChars: 12_000, doodleEnabled: false, mock: false };

export function App() {
  const route = useRoute();
  const [config, setConfig] = useState<PublicConfig>(DEFAULT_CONFIG);
  const [toast, setToast] = useState<string | null>(null);

  useEffect(() => {
    // 直接访问英文笔记时 Worker 会把 <html lang> 设为 en；应用界面本身是中文，笔记画布自行标注语言
    document.documentElement.lang = "zh-CN";
  }, []);

  useEffect(() => {
    void fetchPublicConfig().then((c) => c && setConfig(c));
  }, []);

  useEffect(() => {
    if (route.name === "editor") document.title = "墨语笔记 InkScribe · 把文字变成一页手写笔记";
  }, [route.name]);

  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(null), 4000);
    return () => clearTimeout(timer);
  }, [toast]);

  return (
    <div className="app">
      <header className="app-header">
        <a className="brand" {...linkProps("/")}>
          <img className="brand-mark" src="/logo.svg" alt="" width={38} height={38} />
          <div>
            <h1>墨语笔记</h1>
            <p>InkScribe · 把文字变成一页手写笔记</p>
          </div>
        </a>
        <nav className="app-nav" aria-label="主导航">
          <a className={`nav-link${route.name === "editor" ? " is-active" : ""}`} {...linkProps("/")}>
            编辑器
          </a>
          <a className={`nav-link${route.name === "gallery" ? " is-active" : ""}`} {...linkProps("/gallery")}>
            图库
          </a>
          {config.mock ? (
            <span className="badge badge-warn" title="AI_MOCK 已开启：使用本地规则整理，不调用 Workers AI">
              开发演示模式
            </span>
          ) : null}
        </nav>
      </header>

      {route.name === "editor" ? <EditorPage config={config} onToast={setToast} /> : null}
      {route.name === "gallery" ? <GalleryPage /> : null}
      {route.name === "note" ? <NoteViewPage id={route.id} onToast={setToast} /> : null}
      {route.name === "not-found" ? (
        <main className="page-center">
          <div className="empty-state">
            <h2>页面不存在</h2>
            <a className="btn btn-secondary" {...linkProps("/")}>
              回到编辑器
            </a>
          </div>
        </main>
      ) : null}

      {toast ? (
        <div className="toast" role="status">
          {toast}
        </div>
      ) : null}
    </div>
  );
}
