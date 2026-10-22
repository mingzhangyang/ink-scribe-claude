import { DETAIL_LABELS, DETAILS, LANGUAGE_LABELS, LANGUAGES, TEMPLATE_LABELS, TEMPLATES, type Detail, type Language } from "../../shared/options.ts";
import { charLength } from "../../shared/text.ts";
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

      <div className="textarea-wrap">
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
      {tooLong ? <p className="hint is-error">文本超出 {maxChars.toLocaleString()} 字上限，请删减后再生成。</p> : null}
      <button type="button" className="btn btn-link" disabled={empty || loading} onClick={generateLocally}>
        不使用 AI，按段落快速排版
      </button>
      <p className="hint">原文仅用于本次整理，服务端不保存、不记录原文内容。</p>
    </section>
  );
}
