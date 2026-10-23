import { useEffect, useState } from "react";
import type { PublicConfig } from "../shared/api.ts";
import { fetchPublicConfig } from "./api.ts";
import { useT } from "./i18n/index.ts";
import { EditorPage } from "./pages/EditorPage.tsx";
import { GalleryPage } from "./pages/GalleryPage.tsx";
import { NoteViewPage } from "./pages/NoteViewPage.tsx";
import { linkProps, useRoute } from "./router.ts";
import { resolveTheme, THEMES, usePreferences, type ThemePreference } from "./state/preferences.ts";

const DEFAULT_CONFIG: PublicConfig = { maxInputChars: 12_000, doodleEnabled: false, mock: false };
const THEME_COLORS = { light: "#f4f2ee", dark: "#18181b" } as const;

/** 主题图标：跟随系统（半明半暗）、浅色（太阳）、深色（月亮）。 */
function ThemeIcon({ theme }: { theme: ThemePreference }) {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
      {theme === "system" ? (
        <>
          <circle cx="12" cy="12" r="8" />
          <path d="M12 4a8 8 0 0 1 0 16z" fill="currentColor" />
        </>
      ) : theme === "light" ? (
        <>
          <circle cx="12" cy="12" r="4" />
          <path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
        </>
      ) : (
        <path d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5z" />
      )}
    </svg>
  );
}

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

function PreferenceControls() {
  const t = useT();
  const locale = usePreferences((s) => s.locale);
  const theme = usePreferences((s) => s.theme);
  const setLocale = usePreferences((s) => s.setLocale);
  const setTheme = usePreferences((s) => s.setTheme);
  const nextTheme = THEMES[(THEMES.indexOf(theme) + 1) % THEMES.length];
  const themeLabel = t.app.themeButton(t.app.themeNames[theme], t.app.themeNames[nextTheme]);
  return (
    <div className="pref-controls" role="group" aria-label={t.app.preferencesLabel}>
      <button type="button" className="pref-btn" onClick={() => setTheme(nextTheme)} title={themeLabel} aria-label={themeLabel}>
        <ThemeIcon theme={theme} />
      </button>
      <button
        type="button"
        className="pref-btn pref-lang"
        lang={locale === "zh" ? "en" : "zh-CN"}
        onClick={() => setLocale(locale === "zh" ? "en" : "zh")}
        title={t.app.switchLanguage}
        aria-label={t.app.switchLanguage}
      >
        {t.app.switchLanguageShort}
      </button>
    </div>
  );
}

export function App() {
  const route = useRoute();
  const t = useT();
  const [config, setConfig] = useState<PublicConfig>(DEFAULT_CONFIG);
  const [toast, setToast] = useState<string | null>(null);
  useAppliedTheme();

  useEffect(() => {
    // 直接访问英文笔记时 Worker 会把 <html lang> 设为笔记语言；应用界面按界面语言标注，笔记画布自行标注语言
    document.documentElement.lang = t.htmlLang;
  }, [t]);

  useEffect(() => {
    void fetchPublicConfig().then((c) => c && setConfig(c));
  }, []);

  useEffect(() => {
    if (route.name === "editor") document.title = t.app.documentTitle;
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
        <nav className="app-nav" aria-label={t.app.navLabel}>
          <a className={`nav-link${route.name === "editor" ? " is-active" : ""}`} {...linkProps("/")}>
            {t.app.editor}
          </a>
          <a className={`nav-link${route.name === "gallery" ? " is-active" : ""}`} {...linkProps("/gallery")}>
            {t.app.gallery}
          </a>
          {config.mock ? (
            <span className="badge badge-warn" title={t.app.mockTitle}>
              {t.app.mockBadge}
            </span>
          ) : null}
          <PreferenceControls />
        </nav>
      </header>

      {route.name === "editor" ? <EditorPage config={config} onToast={setToast} /> : null}
      {route.name === "gallery" ? <GalleryPage /> : null}
      {route.name === "note" ? <NoteViewPage id={route.id} onToast={setToast} /> : null}
      {route.name === "not-found" ? (
        <main className="page-center">
          <div className="empty-state">
            <h2>{t.app.notFound}</h2>
            <a className="btn btn-secondary" {...linkProps("/")}>
              {t.app.backToEditor}
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
