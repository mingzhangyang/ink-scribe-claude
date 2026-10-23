import { useEffect, useState } from "react";
import type { PublicConfig } from "../shared/api.ts";
import { fetchPublicConfig } from "./api.ts";
import { AppMenu } from "./components/AppMenu.tsx";
import { ConfirmDialog } from "./components/ConfirmDialog.tsx";
import { useT } from "./i18n/index.ts";
import { EditorPage } from "./pages/EditorPage.tsx";
import { GalleryPage } from "./pages/GalleryPage.tsx";
import { GuidePage } from "./pages/GuidePage.tsx";
import { LegalPage } from "./pages/LegalPage.tsx";
import { LibraryPage } from "./pages/LibraryPage.tsx";
import { NoteViewPage } from "./pages/NoteViewPage.tsx";
import { linkProps, useRoute } from "./router.ts";
import { resolveTheme, subscribeToPreferenceSync, usePreferences } from "./state/preferences.ts";

const DEFAULT_CONFIG: PublicConfig = { maxInputChars: 12_000, doodleEnabled: false, mock: false };
const THEME_COLORS = { light: "#f4f2ee", dark: "#18181b" } as const;

/** 把外观偏好写到 <html data-theme>；跟随系统时监听系统配色变化。 */
function useAppliedTheme() {
  const theme = usePreferences((s) => s.theme);
  useEffect(() => {
    const apply = () => {
      const resolved = resolveTheme(theme);
      document.documentElement.dataset.theme = resolved;
      // index.html 按系统配色提供两个 theme-color；手动选择主题后两者都改成当前主题的颜色
      document.querySelectorAll('meta[name="theme-color"]').forEach((meta) => meta.setAttribute("content", THEME_COLORS[resolved]));
    };
    apply();
    if (theme !== "system" || typeof matchMedia !== "function") return;
    const query = matchMedia("(prefers-color-scheme: light)");
    query.addEventListener("change", apply);
    return () => query.removeEventListener("change", apply);
  }, [theme]);
}

export function App() {
  const route = useRoute();
  const t = useT();
  const [config, setConfig] = useState<PublicConfig>(DEFAULT_CONFIG);
  const [toast, setToast] = useState<string | null>(null);
  // 页面可把自己的操作按钮渲染到顶栏菜单左侧
  const [headerActions, setHeaderActions] = useState<HTMLDivElement | null>(null);
  useAppliedTheme();

  useEffect(() => subscribeToPreferenceSync(), []);

  useEffect(() => {
    // 直接访问英文笔记时 Worker 会把 <html lang> 设为笔记语言；应用界面按界面语言标注，笔记画布自行标注语言
    document.documentElement.lang = t.htmlLang;
  }, [t]);

  useEffect(() => {
    void fetchPublicConfig().then((c) => c && setConfig(c));
  }, []);

  useEffect(() => {
    if (route.name === "editor") document.title = t.app.documentTitle;
    if (route.name === "not-found") document.title = `${t.app.notFound} · ${t.app.name}`;
  }, [route.name, t]);

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
            <h1>{t.app.name}</h1>
            <p>{t.app.tagline}</p>
          </div>
        </a>
        <div className="app-header-actions">
          <div className="app-header-slot" ref={setHeaderActions} />
          <AppMenu route={route} mock={config.mock} />
        </div>
      </header>

      {route.name === "editor" ? <EditorPage config={config} headerActions={headerActions} onToast={setToast} /> : null}
      {route.name === "gallery" ? <GalleryPage /> : null}
      {route.name === "library" ? <LibraryPage /> : null}
      {route.name === "guide" ? <GuidePage /> : null}
      {route.name === "privacy" || route.name === "terms" ? <LegalPage page={route.name} /> : null}
      {route.name === "note" ? <NoteViewPage id={route.id} onToast={setToast} /> : null}
      {route.name === "not-found" ? (
        <main className="page-center">
          <div className="empty-state">
            <h2>{t.app.notFound}</h2>
            <p className="hint">{t.app.notFoundDescription}</p>
            <div className="button-row">
              <a className="btn btn-secondary" {...linkProps("/")}>{t.app.backToEditor}</a>
              <a className="btn btn-secondary" {...linkProps("/gallery")}>{t.app.gallery}</a>
            </div>
          </div>
        </main>
      ) : null}

      <ConfirmDialog />

      {toast ? (
        <div className="toast" role="status">
          {toast}
        </div>
      ) : null}
    </div>
  );
}
