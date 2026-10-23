import { useEffect, useMemo } from "react";
import { useT } from "../i18n/index.ts";
import { checkLibraryLink, isModified, saveToLibrary, useLibraryStatus } from "../library/controller.ts";
import { onLibraryChange } from "../library/storage.ts";
import { linkProps } from "../router.ts";
import { useNoteStore } from "../state/store.ts";

/** Saves the editor into the local library and shows whether it has changes the library lacks. */
export function LibraryBar() {
  const t = useT().library;
  const { status, baseline } = useLibraryStatus();
  const link = useNoteStore((s) => s.libraryLink);
  const hasNote = useNoteStore((s) => s.note !== null);
  const input = useNoteStore((s) => s.input);
  const note = useNoteStore((s) => s.note);
  const settings = useNoteStore((s) => s.settings);
  const stickers = useNoteStore((s) => s.stickers);
  const aiDoodle = useNoteStore((s) => s.aiDoodle);
  const source = useNoteStore((s) => s.source);
  const modified = useMemo(
    () => !!link && isModified({ input, note, settings, stickers, aiDoodle, source }, link, baseline),
    [link, baseline, input, note, settings, stickers, aiDoodle, source],
  );

  // Always read the entry: changes made while the editor was unmounted sent messages nobody received.
  useEffect(() => { void checkLibraryLink(true); }, [link]);
  // Another tab may have changed or deleted the linked entry.
  useEffect(() => onLibraryChange(() => void checkLibraryLink(true)), []);

  const state = status === "idle" || status === "saved" ? (link ? (modified ? "modified" : "linked") : "unsaved") : status;
  const message = status === "saved" && !modified ? t.saved : t.state[state];
  return (
    <section className="library-bar" aria-label={t.label}>
      <span role="status" data-library-status={state}>{message}</span>
      <div className="button-row">
        {state === "conflict" ? (
          <button type="button" className="btn btn-small" onClick={() => { if (window.confirm(t.overwriteConfirm)) void saveToLibrary({ force: true }); }}>
            {t.overwrite}
          </button>
        ) : (
          <button type="button" className="btn btn-small" disabled={!hasNote || status === "saving" || state === "linked"}
            onClick={() => void saveToLibrary({ asNew: state === "deleted" })}>
            {link && state !== "deleted" ? t.save : t.saveNew}
          </button>
        )}
        {link && state !== "deleted" ? (
          <button type="button" className="btn btn-small btn-secondary" disabled={!hasNote || status === "saving"} onClick={() => void saveToLibrary({ asNew: true })}>
            {t.saveCopy}
          </button>
        ) : null}
        <a className="btn btn-small btn-secondary" {...linkProps("/library")}>{t.open}</a>
      </div>
    </section>
  );
}
