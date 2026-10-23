import { DETAILS, LANGUAGES, TEMPLATES, type Detail, type Language } from "../../shared/options.ts";
import { useId, useRef, useState, type KeyboardEvent } from "react";
import { charLength } from "../../shared/text.ts";
import { useT } from "../i18n/index.ts";
import { ACCEPTED_EXTENSIONS } from "../import/extractText.ts";
import { SAMPLE_TEXTS } from "../samples.ts";
import { cancelGeneration, generateLocally, generateNote } from "../state/actions.ts";
import { usePreferences } from "../state/preferences.ts";
import { useNoteStore } from "../state/store.ts";
import { FileDropOverlay, isFileDrag } from "./FileDropOverlay.tsx";
import type { ImportState } from "./useFileImport.ts";

/** 打开原文弹窗的按钮：宽屏位于顶栏，窄屏（CSS）固定在屏幕底部。 */
export function InputTrigger({ onOpen }: { onOpen: () => void }) {
  const text = useNoteStore((s) => s.input.text);
  // 还在看示例笔记、尚未输入原文时提示从这里开始
  const attention = useNoteStore((s) => s.source === "sample") && text.trim().length === 0;
  const t = useT();
  return (
    <button type="button" className={`btn btn-primary input-trigger${attention ? " is-attention" : ""}`} aria-haspopup="dialog" onClick={onOpen}>
      <span aria-hidden="true">✍️</span> {t.input.open}
    </button>
  );
}

/** 原文弹窗的内容。生成后调用 onSubmitted，由页面关闭弹窗并展示画布。 */
export function InputPanel({ maxChars, importState, onImportFile, onClose, onSubmitted }: {
  maxChars: number;
  importState: ImportState;
  onImportFile: (file: File) => void;
  onClose: () => void;
  onSubmitted: () => void;
}) {
  const input = useNoteStore((s) => s.input);
  const status = useNoteStore((s) => s.status);
  const setInput = useNoteStore((s) => s.setInput);
  const locale = usePreferences((s) => s.locale);
  const t = useT();
  const length = charLength(input.text);
  const tooLong = length > maxChars;
  const empty = input.text.trim().length === 0;
  const loading = status === "loading";
  const canGenerate = !empty && !tooLong && !loading;
  const fileInput = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  // 窄屏下模板、语言与详略默认收起，只显示摘要
  const [optionsOpen, setOptionsOpen] = useState(false);
  const optionsId = useId();
  const modKey = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.userAgent) ? "⌘" : "Ctrl";

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

  function submit(run: () => void) {
    run();
    onSubmitted();
  }

  // ⌘/Ctrl + Enter 生成；输入法组字时的回车不算
  function onKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key !== "Enter" || !(event.metaKey || event.ctrlKey) || event.nativeEvent.isComposing) return;
    event.preventDefault();
    if (canGenerate) submit(() => void generateNote());
  }

  return (
    <section
      className="input-panel"
      aria-labelledby="input-title"
      onDragEnter={(event) => {
        if (!isFileDrag(event)) return;
        event.preventDefault();
        setDragging(true);
      }}
    >
      <header className="sheet-head" data-sheet-drag>
        <span className="sheet-handle" aria-hidden="true" />
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
        <button type="button" className="icon-btn sheet-close" onClick={onClose} aria-label={t.input.close}>
          ×
        </button>
      </header>

      <div className="sheet-body input-body">
        <div className="input-main">
          <div className="textarea-wrap">
            <textarea
              className="source-text"
              value={input.text}
              onChange={(e) => setInput({ text: e.target.value })}
              onKeyDown={onKeyDown}
              placeholder={t.input.placeholder}
              aria-label={t.input.textareaLabel}
              spellCheck={false}
              data-autofocus
            />
            <div className={`char-count${tooLong ? " is-over" : ""}`} aria-live="polite">
              {length.toLocaleString()} / {maxChars.toLocaleString()}
            </div>
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
                if (file) onImportFile(file);
              }}
            />
          </div>
          <div aria-live="polite">
            {importState.kind === "done" ? <p className="hint is-ok">{importMessage()}</p> : null}
            {importState.kind === "error" ? <p className="hint is-error">{importMessage()}</p> : null}
          </div>
        </div>

        <div className="input-options">
          <button
            type="button"
            className="options-toggle"
            aria-expanded={optionsOpen}
            aria-controls={optionsId}
            onClick={() => setOptionsOpen((open) => !open)}
          >
            <span>{t.input.options}</span>
            <span className="options-summary">
              {t.options.templates[input.template]} · {t.options.languages[input.language]} · {t.options.details[input.detail]}
            </span>
          </button>
          <div id={optionsId} className={`options-fields${optionsOpen ? " is-open" : ""}`}>
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
          </div>
          <p className="hint">{t.input.privacy}</p>
        </div>
      </div>

      <footer className="sheet-foot">
        {tooLong ? (
          <p className="hint is-error">
            {t.input.tooLong(maxChars.toLocaleString())}{" "}
            <button type="button" className="btn btn-link btn-inline" onClick={() => setInput({ text: Array.from(input.text).slice(0, maxChars).join("") })}>
              {t.input.truncate(maxChars.toLocaleString())}
            </button>
          </p>
        ) : null}
        <div className="sheet-actions">
          <kbd className="shortcut-hint" aria-hidden="true">{t.input.shortcut(modKey)}</kbd>
          <button type="button" className="btn btn-link" disabled={empty || loading} onClick={() => submit(generateLocally)}>
            {t.input.local}
          </button>
          {loading ? (
            <button type="button" className="btn btn-secondary" onClick={cancelGeneration}>
              {t.input.cancel}
            </button>
          ) : (
            <button
              type="button"
              className="btn btn-primary"
              disabled={!canGenerate}
              aria-keyshortcuts="Meta+Enter Control+Enter"
              onClick={() => submit(() => void generateNote())}
            >
              <span aria-hidden="true">✒️</span> {t.input.generate}
            </button>
          )}
        </div>
      </footer>
      {dragging ? <FileDropOverlay onFile={onImportFile} onLeave={() => setDragging(false)} /> : null}
    </section>
  );
}
