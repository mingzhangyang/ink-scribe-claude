import { DETAIL_LABELS, DETAILS, LANGUAGE_LABELS, LANGUAGES, TEMPLATE_LABELS, TEMPLATES, type Detail, type Language } from "../../shared/options.ts";
import { useRef, useState, type DragEvent } from "react";
import { charLength } from "../../shared/text.ts";
import { ACCEPTED_EXTENSIONS, extractTextFromFile, FileImportError, type FileKind } from "../import/extractText.ts";
import { SAMPLE_TEXTS } from "../samples.ts";
import { cancelGeneration, generateLocally, generateNote } from "../state/actions.ts";
import { useNoteStore } from "../state/store.ts";

export function InputPanel({ maxChars }: { maxChars: number }) {
  const input = useNoteStore((s) => s.input);
  const status = useNoteStore((s) => s.status);
  const setInput = useNoteStore((s) => s.setInput);
  const length = charLength(input.text);
  const tooLong = length > maxChars;
  const empty = input.text.trim().length === 0;
  const loading = status === "loading";
  const fileInput = useRef<HTMLInputElement>(null);
  const [importState, setImportState] = useState<
    { kind: "idle" } | { kind: "busy"; name: string } | { kind: "done"; message: string } | { kind: "error"; message: string }
  >({ kind: "idle" });
  const [dragging, setDragging] = useState(false);

  async function importFile(file: File) {
    setImportState({ kind: "busy", name: file.name });
    try {
      const result = await extractTextFromFile(file);
      setInput({ text: result.text });
      const pages = !result.pages
        ? ""
        : result.pagesRead !== undefined && result.pagesRead < result.pages
          ? `，共 ${result.pages} 页，只读取了前 ${result.pagesRead} 页`
          : `，${result.pages} 页`;
      setImportState({ kind: "done", message: `已导入「${file.name}」（${KIND_LABELS[result.kind]}${pages}，${charLength(result.text).toLocaleString()} 字）` });
    } catch (error) {
      setImportState({ kind: "error", message: error instanceof FileImportError ? error.message : `无法读取「${file.name}」，请确认文件未损坏。` });
    }
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
        <h2 id="input-title">原文</h2>
        <label className="sample-picker">
          <span className="sr-only">填入示例文本</span>
          <select
            value=""
            onChange={(e) => {
              const sample = SAMPLE_TEXTS.find((s) => s.id === e.target.value);
              if (sample) setInput({ text: sample.text, template: sample.template });
            }}
          >
            <option value="" disabled>
              填入示例…
            </option>
            {SAMPLE_TEXTS.map((s) => (
              <option key={s.id} value={s.id}>
                {s.label}
              </option>
            ))}
          </select>
        </label>
      </div>

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
          placeholder={"粘贴文章、读书摘抄、会议记录或零散想法……\n\nAI 会提炼标题、线索、重点和总结，排成一页手写笔记。"}
          aria-label="需要整理的原文"
          spellCheck={false}
        />
        <div className={`char-count${tooLong ? " is-over" : ""}`} aria-live="polite">
          {length.toLocaleString()} / {maxChars.toLocaleString()}
        </div>
        {dragging ? <div className="drop-hint">松开以导入文件</div> : null}
      </div>

      <div className="upload-row">
        <button type="button" className="btn btn-small btn-secondary" disabled={importState.kind === "busy" || loading} onClick={() => fileInput.current?.click()}>
          {importState.kind === "busy" ? "正在读取…" : "上传文件"}
        </button>
        <span className="hint">TXT / Markdown / HTML / Word / PDF，可拖入上方文本框</span>
        <input
          ref={fileInput}
          type="file"
          hidden
          accept={ACCEPTED_EXTENSIONS.join(",")}
          aria-label="上传文件"
          onChange={(e) => {
            const file = e.target.files?.[0];
            e.target.value = "";
            if (file) void importFile(file);
          }}
        />
      </div>
      <div aria-live="polite">
        {importState.kind === "done" ? <p className="hint is-ok">{importState.message}</p> : null}
        {importState.kind === "error" ? <p className="hint is-error">{importState.message}</p> : null}
      </div>

      <fieldset className="field">
        <legend>模板</legend>
        <div className="chip-group" role="radiogroup" aria-label="模板">
          {TEMPLATES.map((t) => (
            <button
              key={t}
              type="button"
              role="radio"
              aria-checked={input.template === t}
              className={`chip${input.template === t ? " is-active" : ""}`}
              onClick={() => setInput({ template: t })}
            >
              {TEMPLATE_LABELS[t]}
            </button>
          ))}
        </div>
      </fieldset>

      <div className="field-row">
        <label className="field">
          <span>输出语言</span>
          <select value={input.language} onChange={(e) => setInput({ language: e.target.value as Language })}>
            {LANGUAGES.map((l) => (
              <option key={l} value={l}>
                {LANGUAGE_LABELS[l]}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span>详略</span>
          <select value={input.detail} onChange={(e) => setInput({ detail: e.target.value as Detail })}>
            {DETAILS.map((d) => (
              <option key={d} value={d}>
                {DETAIL_LABELS[d]}
              </option>
            ))}
          </select>
        </label>
      </div>

      {loading ? (
        <button type="button" className="btn btn-secondary btn-block" onClick={cancelGeneration}>
          取消生成
        </button>
      ) : (
        <button type="button" className="btn btn-primary btn-block" disabled={empty || tooLong} onClick={() => void generateNote()}>
          <span aria-hidden="true">✒️</span> 转化为手写笔记
        </button>
      )}
      {tooLong ? (
        <p className="hint is-error">
          文本超出 {maxChars.toLocaleString()} 字上限，请删减后再生成，或{" "}
          <button type="button" className="btn btn-link btn-inline" onClick={() => setInput({ text: Array.from(input.text).slice(0, maxChars).join("") })}>
            只保留前 {maxChars.toLocaleString()} 字
          </button>
        </p>
      ) : null}
      <button type="button" className="btn btn-link" disabled={empty || loading} onClick={generateLocally}>
        不使用 AI，按段落快速排版
      </button>
      <p className="hint">上传的文件在浏览器本地解析，不会上传；原文仅用于本次整理，服务端不保存、不记录原文内容。</p>
    </section>
  );
}

const KIND_LABELS: Record<FileKind, string> = { text: "文本", html: "网页", docx: "Word", pdf: "PDF" };
