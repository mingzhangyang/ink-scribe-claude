import { useEffect, useRef, useState } from "react";
import type { PublishedNoteSummary } from "../../shared/api.ts";
import { isOneOf, TEMPLATE_LABELS, TEMPLATES } from "../../shared/options.ts";
import { ApiRequestError, fetchGallery } from "../api.ts";
import { linkProps } from "../router.ts";

const LANGUAGE_FILTERS = [
  { id: "", label: "全部语言" },
  { id: "zh", label: "中文" },
  { id: "en", label: "English" },
] as const;

function GalleryCard({ item }: { item: PublishedNoteSummary }) {
  const template = isOneOf(TEMPLATES, item.template) ? TEMPLATE_LABELS[item.template] : "";
  const date = item.createdAt ? new Date(item.createdAt).toLocaleDateString("zh-CN") : "";
  return (
    <a className="gallery-card" {...linkProps(`/n/${item.id}`)}>
      <div className="gallery-thumb gallery-thumb-text" aria-hidden="true">
        <strong>{item.title}</strong>
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
      setError(e instanceof ApiRequestError ? e.detail.message : "加载失败，请稍后重试。");
      setStatus("error");
    }
  }

  useEffect(() => {
    document.title = "图库 · 墨语笔记 InkScribe";
    // 筛选条件变化时重新加载第一页
    void load(true);
  }, [template, language]);

  return (
    <main className="gallery-main">
      <div className="gallery-head">
        <div>
          <h2>图库</h2>
          <p className="hint">公开发布的手写笔记</p>
        </div>
        <div className="gallery-filters">
          <div className="chip-group" role="radiogroup" aria-label="模板筛选">
            <button type="button" role="radio" aria-checked={template === ""} className={`chip${template === "" ? " is-active" : ""}`} onClick={() => setTemplate("")}>
              全部
            </button>
            {TEMPLATES.map((t) => (
              <button key={t} type="button" role="radio" aria-checked={template === t} className={`chip${template === t ? " is-active" : ""}`} onClick={() => setTemplate(t)}>
                {TEMPLATE_LABELS[t]}
              </button>
            ))}
          </div>
          <select aria-label="语言筛选" value={language} onChange={(e) => setLanguage(e.target.value)}>
            {LANGUAGE_FILTERS.map((l) => (
              <option key={l.id} value={l.id}>
                {l.label}
              </option>
            ))}
          </select>
        </div>
      </div>

      {status === "error" ? (
        <div className="alert alert-error" role="alert">
          <span>{error}</span>
          <button type="button" className="btn btn-small" onClick={() => void load(items.length === 0)}>
            重试
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
          <h2>还没有公开的笔记</h2>
          <p className="hint">
            通过 API 发布笔记时把 <code>visibility</code> 设为 <code>public</code>，就会出现在这里。参见{" "}
            <a href="/llms.txt">接口说明</a>。
          </p>
        </div>
      ) : null}

      {status === "loading" ? <p className="hint gallery-loading">正在加载…</p> : null}
      {cursor && status === "idle" ? (
        <button type="button" className="btn btn-secondary gallery-more" onClick={() => void load(false)}>
          加载更多
        </button>
      ) : null}
    </main>
  );
}
