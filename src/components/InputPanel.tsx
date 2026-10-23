import { DETAILS, LANGUAGES, TEMPLATES, type Detail, type Language } from "../../shared/options.ts";
import { useRef, useState, type DragEvent } from "react";
import { charLength } from "../../shared/text.ts";
import { useT } from "../i18n/index.ts";
import { ACCEPTED_EXTENSIONS, extractTextFromFile, FileImportError, type ExtractResult, type ImportErrorKey } from "../import/extractText.ts";
import { SAMPLE_TEXTS } from "../samples.ts";
import { cancelGeneration, generateLocally, generateNote } from "../state/actions.ts";
import { usePreferences } from "../state/preferences.ts";
import { DraftBar } from "./DraftBar.tsx";
import { LibraryBar } from "./LibraryBar.tsx";
import { useNoteStore } from "../state/store.ts";

export function InputPanel({ maxChars }: { maxChars: number }) {
  const input = useNoteStore((s) => s.input);
  const status = useNoteStore((s) => s.status);
  const setInput = useNoteStore((s) => s.setInput);
  const locale = usePreferences((s) => s.locale);
  const t = useT();
  const length = charLength(input.text);
  const tooLong = length > maxChars;
  const empty = input.text.trim().length === 0;
  const loading = status === "loading";
  const fileInput = useRef<HTMLInputElement>(null);
  const [importState, setImportState] = useState<
    | { kind: "idle" }
    | { kind: "busy"; name: string }
    | { kind: "done"; name: string; result: Omit<ExtractResult, "text">; chars: number }
    | { kind: "error"; name: string; key?: ImportErrorKey }
  >({ kind: "idle" });
  const [dragging, setDragging] = useState(false);
  // 连续导入多个文件时，只采用最后一次导入的结果（较早的大文件可能更晚解析完）
  const importGeneration = useRef(0);

  async function importFile(file: File) {
    const current = ++importGeneration.current;
    setImportState({ kind: "busy", name: file.name });
    try {
      const result = await extractTextFromFile(file);
      if (current !== importGeneration.current) return;
      const { text, ...meta } = result;
      setInput({ text });
      setImportState({ kind: "done", name: file.name, result: meta, chars: charLength(text) });
    } catch (error) {
      if (current !== importGeneration.current) return;
      setImportState({ kind: "error", name: file.name, ...(error instanceof FileImportError ? { key: error.key } : {}) });
    }
  }

  // 提示在渲染时按当前界面语言生成，切换语言后随之切换
  function importMessage(): string | null {
    if (importState.kind === "error") return importState.key ? t.importErrors[importState.key] : t.input.importFailed(importState.name);
    if (importState.kind !== "done") return null;
    const { result, chars, name } = importState;
    const pages = !result.pages
      ? ""
      : result.pagesRead !== undefined && result.pagesRead < result.pages
        ? t.input.importPagesPartial(result.pages, result.pagesRead)
        : t.input.importPages(result.pages);
    return t.input.importDone(name, t.options.fileKinds[result.kind], pages, chars.toLocaleString());
  }

  function onDrop(event: DragEvent) {
    event.preventDefault();
    setDragging(false);
    const file = event.dataTransfer.files[0];
    if (file) void importFile(file);
  }

  return (
    <section className="panel input-panel" aria-labelledby="input-title">
      <div className="panel-head">
        <h2 id="input-title">{t.input.title}</h2>
        <label className="sample-picker">
          <span className="sr-only">{t.input.samplePicker}</span>
          <select
            value=""
            onChange={(e) => {
              const sample = SAMPLE_TEXTS.find((s) => s.id === e.target.value);
              if (sample) setInput({ text: sample.text, template: sample.template });
            }}
          >
            <option value="" disabled>
              {t.input.samplePlaceholder}
            </option>
            {SAMPLE_TEXTS.map((s) => (
              <option key={s.id} value={s.id}>
                {s.label[locale]}
              </option>
            ))}
          </select>
        </label>
      </div>

      <DraftBar />
      <LibraryBar />

      <div
        className={`textarea-wrap${dragging ? " is-dragging" : ""}`}
        onDragOver={(e) => {
          if (!e.dataTransfer.types.includes("Files")) return;
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={onDrop}
      >
        <textarea
          className="source-text"
          value={input.text}
          onChange={(e) => setInput({ text: e.target.value })}
          placeholder={t.input.placeholder}
          aria-label={t.input.textareaLabel}
          spellCheck={false}
        />
        <div className={`char-count${tooLong ? " is-over" : ""}`} aria-live="polite">
          {length.toLocaleString()} / {maxChars.toLocaleString()}
        </div>
        {dragging ? <div className="drop-hint">{t.input.dropHint}</div> : null}
      </div>

      <div className="upload-row">
        <button type="button" className="btn btn-small btn-secondary" disabled={importState.kind === "busy" || loading} onClick={() => fileInput.current?.click()}>
          {importState.kind === "busy" ? t.input.uploading : t.input.upload}
        </button>
        <span className="hint">{t.input.uploadHint}</span>
        <input
          ref={fileInput}
          type="file"
          hidden
          accept={ACCEPTED_EXTENSIONS.join(",")}
          aria-label={t.input.upload}
          onChange={(e) => {
            const file = e.target.files?.[0];
            e.target.value = "";
            if (file) void importFile(file);
          }}
        />
      </div>
      <div aria-live="polite">
        {importState.kind === "done" ? <p className="hint is-ok">{importMessage()}</p> : null}
        {importState.kind === "error" ? <p className="hint is-error">{importMessage()}</p> : null}
      </div>

      <fieldset className="field">
        <legend>{t.input.template}</legend>
        <div className="chip-group" role="radiogroup" aria-label={t.input.template}>
          {TEMPLATES.map((template) => (
            <button
              key={template}
              type="button"
              role="radio"
              aria-checked={input.template === template}
              className={`chip${input.template === template ? " is-active" : ""}`}
              onClick={() => setInput({ template })}
            >
              {t.options.templates[template]}
            </button>
          ))}
        </div>
      </fieldset>

      <div className="field-row">
        <label className="field">
          <span>{t.input.outputLanguage}</span>
          <select value={input.language} onChange={(e) => setInput({ language: e.target.value as Language })}>
            {LANGUAGES.map((l) => (
              <option key={l} value={l}>
                {t.options.languages[l]}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span>{t.input.detail}</span>
          <select value={input.detail} onChange={(e) => setInput({ detail: e.target.value as Detail })}>
            {DETAILS.map((d) => (
              <option key={d} value={d}>
                {t.options.details[d]}
              </option>
            ))}
          </select>
        </label>
      </div>

      {loading ? (
        <button type="button" className="btn btn-secondary btn-block" onClick={cancelGeneration}>
          {t.input.cancel}
        </button>
      ) : (
        <button type="button" className="btn btn-primary btn-block" disabled={empty || tooLong} onClick={() => void generateNote()}>
          <span aria-hidden="true">✒️</span> {t.input.generate}
        </button>
      )}
      {tooLong ? (
        <p className="hint is-error">
          {t.input.tooLong(maxChars.toLocaleString())}{" "}
          <button type="button" className="btn btn-link btn-inline" onClick={() => setInput({ text: Array.from(input.text).slice(0, maxChars).join("") })}>
            {t.input.truncate(maxChars.toLocaleString())}
          </button>
        </p>
      ) : null}
      <button type="button" className="btn btn-link" disabled={empty || loading} onClick={generateLocally}>
        {t.input.local}
      </button>
      <p className="hint">{t.input.privacy}</p>
    </section>
  );
}
