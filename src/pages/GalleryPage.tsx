import { useEffect, useRef, useState } from "react";
import type { PublishedNoteSummary } from "../../shared/api.ts";
import { isOneOf, TEMPLATES } from "../../shared/options.ts";
import { ApiRequestError, fetchGallery } from "../api.ts";
import { errorMessage, useT } from "../i18n/index.ts";
import { linkProps } from "../router.ts";

function GalleryCard({ item }: { item: PublishedNoteSummary }) {
  const t = useT();
  const template = isOneOf(TEMPLATES, item.template) ? t.options.templates[item.template] : "";
  const date = item.createdAt ? new Date(item.createdAt).toLocaleDateString(t.dateLocale) : "";
  return (
    <a className="gallery-card" {...linkProps(`/n/${item.id}`)}>
      <div className="gallery-thumb gallery-thumb-text">
        {/* 标题在下方说明中已有，这里只对视觉用户显示；摘要只出现在这里，需要读屏可读 */}
        <strong aria-hidden="true">{item.title}</strong>
        <span>{item.summary}</span>
      </div>
      <div className="gallery-caption">
        <strong>{item.title}</strong>
        <small>
          {template}
          {template && date ? " · " : ""}
          {date}
        </small>
      </div>
    </a>
  );
}

export function GalleryPage() {
  const t = useT();
  const [template, setTemplate] = useState("");
  const [language, setLanguage] = useState("");
  const [items, setItems] = useState<PublishedNoteSummary[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [status, setStatus] = useState<"loading" | "idle" | "error">("loading");
  const [error, setError] = useState("");
  // 每次请求递增；只有最新一次请求的结果会写入状态，避免切换筛选后旧请求覆盖或追加到新结果
  const generation = useRef(0);

  async function load(reset: boolean) {
    const current = ++generation.current;
    if (reset) {
      setItems([]);
      setCursor(null);
    }
    setStatus("loading");
    try {
      const page = await fetchGallery({ cursor: reset ? null : cursor, template, language });
      if (current !== generation.current) return;
      setItems((prev) => (reset ? page.items : [...prev, ...page.items]));
      setCursor(page.nextCursor);
      setStatus("idle");
    } catch (e) {
      if (current !== generation.current) return;
      setError(e instanceof ApiRequestError ? errorMessage(t, e.detail) : t.gallery.loadFailed);
      setStatus("error");
    }
  }

  useEffect(() => {
    // 筛选条件变化时重新加载第一页
    void load(true);
  }, [template, language]);

  useEffect(() => {
    document.title = t.gallery.documentTitle;
  }, [t]);

  return (
    <main className="gallery-main">
      <div className="gallery-head">
        <div>
          <h2>{t.gallery.title}</h2>
          <p className="hint">{t.gallery.subtitle}</p>
        </div>
        <div className="gallery-filters">
          <div className="chip-group" role="radiogroup" aria-label={t.gallery.templateFilter}>
            <button type="button" role="radio" aria-checked={template === ""} className={`chip${template === "" ? " is-active" : ""}`} onClick={() => setTemplate("")}>
              {t.gallery.all}
            </button>
            {TEMPLATES.map((id) => (
              <button key={id} type="button" role="radio" aria-checked={template === id} className={`chip${template === id ? " is-active" : ""}`} onClick={() => setTemplate(id)}>
                {t.options.templates[id]}
              </button>
            ))}
          </div>
          <select aria-label={t.gallery.languageFilter} value={language} onChange={(e) => setLanguage(e.target.value)}>
            <option value="">{t.gallery.allLanguages}</option>
            <option value="zh">{t.options.languages.zh}</option>
            <option value="en">{t.options.languages.en}</option>
          </select>
        </div>
      </div>

      {status === "error" ? (
        <div className="alert alert-error" role="alert">
          <span>{error}</span>
          <button type="button" className="btn btn-small" onClick={() => void load(items.length === 0)}>
            {t.gallery.retry}
          </button>
        </div>
      ) : null}

      {items.length > 0 ? (
        <div className="gallery-grid">
          {items.map((item) => (
            <GalleryCard key={item.id} item={item} />
          ))}
        </div>
      ) : status === "idle" ? (
        <div className="empty-state">
          <h2>{t.gallery.emptyTitle}</h2>
          <p className="hint">
            {t.gallery.emptyBefore}
            <code>visibility</code>
            {t.gallery.emptyMiddle}
            <code>public</code>
            {t.gallery.emptyAfter}
            <a href="/llms.txt">{t.gallery.apiDocs}</a>
            {t.htmlLang === "en" ? "." : "。"}
          </p>
        </div>
      ) : null}

      {status === "loading" ? <p className="hint gallery-loading">{t.gallery.loading}</p> : null}
      {cursor && status === "idle" ? (
        <button type="button" className="btn btn-secondary gallery-more" onClick={() => void load(false)}>
          {t.gallery.more}
        </button>
      ) : null}
    </main>
  );
}
