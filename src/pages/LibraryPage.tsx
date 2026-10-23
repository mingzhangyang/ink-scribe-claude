import { useEffect, useMemo, useRef, useState } from "react";
import { isOneOf, TEMPLATES } from "../../shared/options.ts";
import { downloadBlob } from "../export/exportImage.ts";
import { useT } from "../i18n/index.ts";
import { hasUnsavedWork, openEntry, removeEntry } from "../library/controller.ts";
import { backupOf, importBackup, listEntries, onLibraryChange, searchTextOf, type LibraryEntry } from "../library/storage.ts";
import { linkProps, navigate } from "../router.ts";
import { useNoteStore } from "../state/store.ts";

type Notice = { kind: "ok" | "error"; text: string } | null;

function summaryOf(entry: LibraryEntry): string {
  const note = entry.document.note;
  return (note?.summary || note?.sections.map((s) => s.content).join(" ") || entry.document.input.text).slice(0, 160);
}

function LibraryCard({ entry, current, onOpen, onDelete }: { entry: LibraryEntry; current: boolean; onOpen: () => void; onDelete: () => void }) {
  const t = useT();
  const template = isOneOf(TEMPLATES, entry.document.input.template) ? t.options.templates[entry.document.input.template] : "";
  const title = entry.title || t.library.untitled;
  const updated = new Date(entry.updatedAt).toLocaleString(t.dateLocale, { dateStyle: "medium", timeStyle: "short" });
  return (
    <article className="gallery-card library-card">
      <button type="button" className="library-open" onClick={onOpen} aria-label={t.library.openLabel(title)}>
        <div className="gallery-thumb gallery-thumb-text">
          <strong aria-hidden="true">{title}</strong>
          <span>{summaryOf(entry)}</span>
        </div>
      </button>
      <div className="gallery-caption">
        <strong>{title}</strong>
        <small>
          {template}
          {template ? " · " : ""}
          {t.library.updated(updated)}
          {current ? <span className="badge library-current">{t.library.current}</span> : null}
        </small>
      </div>
      <div className="button-row">
        <button type="button" className="btn btn-small" onClick={onOpen}>{t.library.openButton}</button>
        <button type="button" className="btn btn-small btn-secondary" onClick={onDelete} aria-label={t.library.deleteLabel(title)}>
          {t.library.delete}
        </button>
      </div>
    </article>
  );
}

export function LibraryPage() {
  const t = useT();
  const [entries, setEntries] = useState<LibraryEntry[]>([]);
  const [unreadable, setUnreadable] = useState(0);
  const [status, setStatus] = useState<"loading" | "idle" | "error">("loading");
  const [query, setQuery] = useState("");
  const [notice, setNotice] = useState<Notice>(null);
  const currentId = useNoteStore((s) => s.libraryLink?.id ?? null);
  const fileInput = useRef<HTMLInputElement>(null);
  const generation = useRef(0);

  async function load() {
    const current = ++generation.current;
    try {
      const result = await listEntries();
      if (current !== generation.current) return;
      setEntries(result.entries);
      setUnreadable(result.unreadable);
      setStatus("idle");
    } catch {
      if (current !== generation.current) return;
      setStatus("error");
    }
  }

  useEffect(() => {
    void load();
    return onLibraryChange(() => void load());
  }, []);

  useEffect(() => {
    document.title = t.library.documentTitle;
  }, [t]);

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return entries;
    return entries.filter((e) => `${e.title.toLowerCase()}\n${searchTextOf(e.document)}`.includes(q));
  }, [entries, query]);

  function open(entry: LibraryEntry) {
    // Imported copies can share a revision, so the id must match too.
    const link = useNoteStore.getState().libraryLink;
    const alreadyOpen = link?.id === entry.id && link.revision === entry.revision;
    // The editor cannot notice a deletion made elsewhere while it is unmounted; then its copy is all that is left.
    const linkedGone = !!link && status === "idle" && !entries.some((e) => e.id === link.id);
    if (!alreadyOpen) {
      if ((linkedGone || hasUnsavedWork()) && !window.confirm(t.library.replaceConfirm)) return;
      openEntry(entry);
    }
    navigate("/");
  }

  async function remove(entry: LibraryEntry) {
    if (!window.confirm(t.library.deleteConfirm(entry.title || t.library.untitled))) return;
    try {
      await removeEntry(entry.id);
      setNotice(null);
    } catch {
      setNotice({ kind: "error", text: t.library.deleteFailed });
    }
    await load();
  }

  function exportBackup() {
    const date = new Date().toISOString().slice(0, 10);
    downloadBlob(new Blob([backupOf(entries)], { type: "application/json" }), `ink-scribe-library-${date}.json`);
  }

  async function restore(file: File) {
    try {
      const { added, skipped } = await importBackup(await file.text());
      setNotice({ kind: "ok", text: t.library.imported(added, skipped) });
    } catch {
      setNotice({ kind: "error", text: t.library.importFailed });
    }
    await load();
  }

  return (
    <main className="gallery-main library-main">
      <div className="gallery-head">
        <div>
          <h2>{t.library.title}</h2>
          <p className="hint">{t.library.subtitle}</p>
        </div>
        <div className="gallery-filters">
          <input type="search" className="library-search" value={query} onChange={(e) => setQuery(e.target.value)}
            placeholder={t.library.search} aria-label={t.library.search} />
          <button type="button" className="btn btn-small btn-secondary" disabled={entries.length === 0} onClick={exportBackup}>
            {t.library.exportBackup}
          </button>
          <button type="button" className="btn btn-small btn-secondary" onClick={() => fileInput.current?.click()}>
            {t.library.importBackup}
          </button>
          <input ref={fileInput} type="file" hidden accept="application/json,.json" aria-label={t.library.importBackup}
            onChange={(e) => {
              const file = e.target.files?.[0];
              e.target.value = "";
              if (file) void restore(file);
            }} />
        </div>
      </div>

      <div aria-live="polite">
        {notice ? <p className={`hint ${notice.kind === "ok" ? "is-ok" : "is-error"}`}>{notice.text}</p> : null}
        {unreadable > 0 ? <p className="hint is-error">{t.library.unreadable(unreadable)}</p> : null}
      </div>

      {status === "error" ? (
        <div className="alert alert-error" role="alert">
          <span>{t.library.loadFailed}</span>
          <button type="button" className="btn btn-small" onClick={() => void load()}>{t.library.retry}</button>
        </div>
      ) : null}

      {visible.length > 0 ? (
        <div className="gallery-grid">
          {visible.map((entry) => (
            <LibraryCard key={entry.id} entry={entry} current={entry.id === currentId} onOpen={() => open(entry)} onDelete={() => void remove(entry)} />
          ))}
        </div>
      ) : status === "idle" ? (
        <div className="empty-state">
          <h2>{entries.length === 0 ? t.library.emptyTitle : t.library.noMatches}</h2>
          {entries.length === 0 ? <p className="hint">{t.library.emptyHint}</p> : null}
          <a className="btn btn-secondary" {...linkProps("/")}>{t.app.backToEditor}</a>
        </div>
      ) : null}

      {status === "loading" ? <p className="hint gallery-loading">{t.library.loading}</p> : null}
    </main>
  );
}
