import { useEffect, useId, useRef, useState } from "react";
import { useT } from "../i18n/index.ts";
import { linkProps, type Route } from "../router.ts";
import { LOCALES, THEMES, usePreferences, type ThemePreference } from "../state/preferences.ts";

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

/** 普通导航链接与原生单选项：保留 Tab、方向键和修饰键点击的浏览器行为。 */
export function AppMenu({ route, mock }: { route: Route; mock: boolean }) {
  const t = useT();
  const locale = usePreferences((s) => s.locale);
  const theme = usePreferences((s) => s.theme);
  const setLocale = usePreferences((s) => s.setLocale);
  const setTheme = usePreferences((s) => s.setTheme);
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const toggleRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const panelId = useId();
  const routeKey = route.name === "note" ? `note:${route.id}` : route.name;
  const pages = [
    { name: "editor", href: "/", label: t.app.editor },
    { name: "gallery", href: "/gallery", label: t.app.gallery },
    { name: "library", href: "/library", label: t.app.library },
    { name: "guide", href: "/guide", label: t.app.guide },
  ];
  const legalPages = [
    { name: "privacy", href: "/privacy", label: t.app.privacy },
    { name: "terms", href: "/terms", label: t.app.terms },
  ];

  function renderPageLink(page: { name: string; href: string; label: string }, className: string) {
    const props = linkProps(page.href);
    const active = route.name === page.name;
    return (
      <a
        key={page.name}
        {...props}
        className={`${className}${active ? " is-active" : ""}`}
        aria-current={active ? "page" : undefined}
        onClick={(event) => {
          setOpen(false);
          toggleRef.current?.focus();
          props.onClick(event);
        }}
      >
        {page.label}
      </a>
    );
  }

  useEffect(() => {
    setOpen(false);
    if (panelRef.current?.contains(document.activeElement)) toggleRef.current?.focus();
  }, [routeKey]);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      if (event.target instanceof Node && !rootRef.current?.contains(event.target)) setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      setOpen(false);
      toggleRef.current?.focus();
    };
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  return (
    <div
      className="app-menu"
      ref={rootRef}
      onBlur={(event) => {
        // 点击面板空白或滚动条时 relatedTarget 可能为空；外部点击由 pointerdown 处理。
        if (event.relatedTarget && !event.currentTarget.contains(event.relatedTarget)) setOpen(false);
      }}
    >
      <button
        type="button"
        className="app-menu-toggle"
        ref={toggleRef}
        aria-label={t.app.menuLabel}
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => setOpen((value) => !value)}
      >
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true">
          {open ? <path d="m6 6 12 12M6 18 18 6" /> : <path d="M4 6h16M4 12h16M4 18h16" />}
        </svg>
        <span>{t.app.menu}</span>
      </button>
      <div className="app-menu-panel" id={panelId} ref={panelRef} hidden={!open}>
        <nav className="app-nav" aria-label={t.app.navLabel}>
          <p className="menu-group-title">{t.app.navLabel}</p>
          {pages.map((page) => renderPageLink(page, "nav-link"))}
        </nav>
        <div className="menu-preferences">
          <p className="menu-group-title">{t.app.preferencesLabel}</p>
          <fieldset className="menu-preference">
            <legend>{t.app.languageLabel}</legend>
            <div className="menu-options">
              {LOCALES.map((value) => (
                <label className="menu-option" key={value}>
                  <input type="radio" name="app-menu-locale" value={value} checked={locale === value} onChange={() => setLocale(value)} />
                  <span lang={value === "zh" ? "zh-CN" : "en"}>{value === "zh" ? "中文" : "English"}</span>
                </label>
              ))}
            </div>
          </fieldset>
          <fieldset className="menu-preference">
            <legend>{t.app.themeLabel}</legend>
            <div className="menu-options">
              {THEMES.map((value) => (
                <label className="menu-option" key={value}>
                  <input type="radio" name="app-menu-theme" value={value} checked={theme === value} onChange={() => setTheme(value)} />
                  <span>
                    <ThemeIcon theme={value} />
                    {t.app.themeNames[value]}
                  </span>
                </label>
              ))}
            </div>
          </fieldset>
        </div>
        {mock ? (
          <div className="menu-status">
            <span className="badge badge-warn" title={t.app.mockTitle}>
              {t.app.mockBadge}
            </span>
          </div>
        ) : null}
        <nav className="menu-legal" aria-label={t.app.legalLabel}>
          {legalPages.map((page) => renderPageLink(page, "menu-legal-link"))}
        </nav>
      </div>
    </div>
  );
}
