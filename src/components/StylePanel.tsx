import type { CSSProperties } from "react";
import { STYLE_LABELS, STYLES, type NoteStyle } from "../../shared/options.ts";
import { DOODLE_THEME_LABELS, DOODLE_THEMES, type DoodleTheme } from "../../shared/themes.ts";
import { ACCENTS, EN_FONTS, INKS, PAGE_SIZES, PAPERS, ZH_FONTS, type EnFontId, type PageSizeId, type ZhFontId } from "../config/appearance.ts";
import { useNoteStore, type Settings } from "../state/store.ts";

const LAYOUT_HINTS: Record<NoteStyle, string> = {
  "hybrid-cornell": "左侧线索 · 中间笔记 · 底部便签",
  "classic-cornell": "标准三分区，适合复习自测",
  "free-journal": "卡片拼贴，活泼随性",
  minimal: "单栏留白，安静克制",
};

function Range({
  label,
  value,
  min,
  max,
  step,
  format,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  format: (v: number) => string;
  onChange: (v: number) => void;
}) {
  return (
    <label className="field range-field">
      <span>
        {label}
        <output>{format(value)}</output>
      </span>
      <input type="range" min={min} max={max} step={step} value={value} onChange={(e) => onChange(Number(e.target.value))} />
    </label>
  );
}

export function StylePanel({ doodleEnabled, onRequestAiDoodle }: { doodleEnabled: boolean; onRequestAiDoodle: () => void }) {
  const settings = useNoteStore((s) => s.settings);
  const setSettings = useNoteStore((s) => s.setSettings);
  const resetSettings = useNoteStore((s) => s.resetSettings);
  const aiDoodle = useNoteStore((s) => s.aiDoodle);
  const set = (patch: Partial<Settings>) => setSettings(patch);

  return (
    <div className="panel-body">
      <fieldset className="field">
        <legend>版式</legend>
        <div className="layout-grid-options" role="radiogroup" aria-label="版式">
          {STYLES.map((style) => (
            <button
              key={style}
              type="button"
              role="radio"
              aria-checked={settings.layout === style}
              className={`layout-option${settings.layout === style ? " is-active" : ""}`}
              onClick={() => set({ layout: style })}
            >
              <span className={`layout-thumb thumb-${style}`} aria-hidden="true">
                <i />
                <i />
                <i />
              </span>
              <strong>{STYLE_LABELS[style]}</strong>
              <small>{LAYOUT_HINTS[style]}</small>
            </button>
          ))}
        </div>
      </fieldset>

      <fieldset className="field">
        <legend>纸张</legend>
        <div className="swatch-group" role="radiogroup" aria-label="纸张">
          {PAPERS.map((paper) => (
            <button
              key={paper.id}
              type="button"
              role="radio"
              aria-checked={settings.paper === paper.id}
              className={`paper-swatch paper-${paper.id}${settings.paper === paper.id ? " is-active" : ""}`}
              style={{ "--paper": paper.base, "--paper-line": paper.lineColor } as CSSProperties}
              onClick={() => set({ paper: paper.id })}
              title={paper.label}
            >
              <span>{paper.label}</span>
            </button>
          ))}
        </div>
      </fieldset>

      <label className="field">
        <span>页面尺寸</span>
        <select value={settings.pageSize} onChange={(e) => set({ pageSize: e.target.value as PageSizeId })}>
          {PAGE_SIZES.map((size) => (
            <option key={size.id} value={size.id}>
              {size.label}
            </option>
          ))}
        </select>
      </label>

      <div className="field-row">
        <label className="field">
          <span>中文字体</span>
          <select value={settings.zhFont} onChange={(e) => set({ zhFont: e.target.value as ZhFontId })}>
            {ZH_FONTS.map((font) => (
              <option key={font.id} value={font.id}>
                {font.label} · {font.note}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span>英文字体</span>
          <select value={settings.enFont} onChange={(e) => set({ enFont: e.target.value as EnFontId })}>
            {EN_FONTS.map((font) => (
              <option key={font.id} value={font.id}>
                {font.label}
              </option>
            ))}
          </select>
        </label>
      </div>

      <Range label="字号" value={settings.fontSize} min={12} max={28} step={0.5} format={(v) => `${v}px`} onChange={(v) => set({ fontSize: v })} />
      <Range label="行距" value={settings.lineHeight} min={1.3} max={2.4} step={0.05} format={(v) => v.toFixed(2)} onChange={(v) => set({ lineHeight: v })} />
      <Range
        label="字距"
        value={settings.letterSpacing}
        min={-0.02}
        max={0.15}
        step={0.01}
        format={(v) => `${v.toFixed(2)}em`}
        onChange={(v) => set({ letterSpacing: v })}
      />

      <fieldset className="field">
        <legend>墨水</legend>
        <div className="swatch-group" role="radiogroup" aria-label="墨水颜色">
          {INKS.map((ink) => (
            <button
              key={ink.id}
              type="button"
              role="radio"
              aria-checked={settings.ink === ink.id}
              className={`color-swatch${settings.ink === ink.id ? " is-active" : ""}`}
              style={{ background: ink.color }}
              onClick={() => set({ ink: ink.id })}
              title={ink.label}
              aria-label={ink.label}
            />
          ))}
        </div>
      </fieldset>

      <fieldset className="field">
        <legend>荧光笔</legend>
        <div className="swatch-group" role="radiogroup" aria-label="重点颜色">
          {ACCENTS.map((accent) => (
            <button
              key={accent.id}
              type="button"
              role="radio"
              aria-checked={settings.accent === accent.id}
              className={`color-swatch${settings.accent === accent.id ? " is-active" : ""}`}
              style={{ background: accent.color }}
              onClick={() => set({ accent: accent.id })}
              title={accent.label}
              aria-label={accent.label}
            />
          ))}
        </div>
      </fieldset>

      <Range
        label="自然手写感"
        value={settings.naturalness}
        min={0}
        max={1}
        step={0.05}
        format={(v) => `${Math.round(v * 100)}%`}
        onChange={(v) => set({ naturalness: v })}
      />
      <button type="button" className="btn btn-small btn-secondary" onClick={() => set({ seed: Math.floor(Math.random() * 100_000) })}>
        换一种笔迹
      </button>

      <fieldset className="field">
        <legend>插图</legend>
        <div className="field-row">
          <select
            aria-label="插图来源"
            value={settings.doodleMode}
            onChange={(e) => set({ doodleMode: e.target.value as Settings["doodleMode"] })}
          >
            <option value="auto">按笔记内容自动选择</option>
            <option value="theme">指定内置插图</option>
            {doodleEnabled || aiDoodle ? <option value="ai">AI 生成插图</option> : null}
            <option value="none">不显示插图</option>
          </select>
          {settings.doodleMode === "theme" ? (
            <select aria-label="内置插图" value={settings.doodleTheme} onChange={(e) => set({ doodleTheme: e.target.value as DoodleTheme })}>
              {DOODLE_THEMES.map((theme) => (
                <option key={theme} value={theme}>
                  {DOODLE_THEME_LABELS[theme]}
                </option>
              ))}
            </select>
          ) : null}
        </div>
        {settings.doodleMode === "ai" && doodleEnabled ? (
          <button type="button" className="btn btn-small btn-secondary" onClick={onRequestAiDoodle}>
            {aiDoodle ? "重新生成 AI 插图" : "生成 AI 插图"}
          </button>
        ) : null}
      </fieldset>

      <button type="button" className="btn btn-link" onClick={resetSettings}>
        恢复默认样式
      </button>
    </div>
  );
}
