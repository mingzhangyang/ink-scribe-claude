import { useEffect, useId, useRef, useState } from "react";
import { CONTACT_EMAIL, DISCORD_INVITE } from "../../shared/contact.ts";
import { useT } from "../i18n/index.ts";
import { promptInstall, usePwa } from "../pwa/register.ts";
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
  const { installable } = usePwa();
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
        {installable ? (
          <div className="menu-install">
            <button
              type="button"
              className="btn btn-secondary btn-block"
              onClick={() => {
                setOpen(false);
                toggleRef.current?.focus();
                void promptInstall();
              }}
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M12 4v11M7 10l5 5 5-5M5 20h14" />
              </svg>
              {t.app.installApp}
            </button>
            <p className="hint">{t.app.installHint}</p>
          </div>
        ) : null}
        {mock ? (
          <div className="menu-status">
            <span className="badge badge-warn" title={t.app.mockTitle}>
              {t.app.mockBadge}
            </span>
          </div>
        ) : null}
        <div className="menu-contact">
          <p className="menu-group-title">{t.app.contactLabel}</p>
          <div className="menu-contact-actions">
            <a className="contact-icon-link" href={`mailto:${CONTACT_EMAIL}`} aria-label={t.app.contactEmail} title={t.app.contactEmail}>
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <rect x="3" y="5" width="18" height="14" rx="2" />
                <path d="m3 7 9 6 9-6" />
              </svg>
            </a>
            <a className="contact-icon-link" href={DISCORD_INVITE} target="_blank" rel="noopener noreferrer" aria-label={`Discord · ${t.app.contactDiscord}`} title={`Discord · ${t.app.contactDiscord}`}>
              <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                <path d="M20.317 4.3698a19.7913 19.7913 0 00-4.8851-1.5152.0741.0741 0 00-.0785.0371c-.211.3753-.4447.8648-.6083 1.2495-1.8447-.2762-3.68-.2762-5.4868 0-.1636-.3933-.4058-.8742-.6177-1.2495a.077.077 0 00-.0785-.037 19.7363 19.7363 0 00-4.8852 1.515.0699.0699 0 00-.0321.0277C.5334 9.0458-.319 13.5799.0992 18.0578a.0824.0824 0 00.0312.0561c2.0528 1.5076 4.0413 2.4228 5.9929 3.0294a.0777.0777 0 00.0842-.0276c.4616-.6304.8731-1.2952 1.226-1.9942a.076.076 0 00-.0416-.1057c-.6528-.2476-1.2743-.5495-1.8722-.8923a.077.077 0 01-.0076-.1277c.1258-.0943.2517-.1923.3718-.2914a.0743.0743 0 01.0776-.0105c3.9278 1.7933 8.18 1.7933 12.0614 0a.0739.0739 0 01.0785.0095c.1202.099.246.1981.3728.2924a.077.077 0 01-.0066.1276 12.2986 12.2986 0 01-1.873.8914.0766.0766 0 00-.0407.1067c.3604.698.7719 1.3628 1.225 1.9932a.076.076 0 00.0842.0286c1.961-.6067 3.9495-1.5219 6.0023-3.0294a.077.077 0 00.0313-.0552c.5004-5.177-.8382-9.6739-3.5485-13.6604a.061.061 0 00-.0312-.0286zM8.02 15.3312c-1.1825 0-2.1569-1.0857-2.1569-2.419 0-1.3332.9555-2.4189 2.157-2.4189 1.2108 0 2.1757 1.0952 2.1568 2.419 0 1.3332-.9555 2.4189-2.1569 2.4189zm7.9748 0c-1.1825 0-2.1569-1.0857-2.1569-2.419 0-1.3332.9554-2.4189 2.1569-2.4189 1.2108 0 2.1757 1.0952 2.1568 2.419 0 1.3332-.946 2.4189-2.1568 2.4189Z" />
              </svg>
            </a>
          </div>
        </div>
        <nav className="menu-legal" aria-label={t.app.legalLabel}>
          {legalPages.map((page) => renderPageLink(page, "menu-legal-link"))}
        </nav>
      </div>
    </div>
  );
}
