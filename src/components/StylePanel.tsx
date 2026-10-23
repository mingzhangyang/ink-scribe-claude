import type { CSSProperties } from "react";
import { STYLES } from "../../shared/options.ts";
import { DOODLE_THEMES, type DoodleTheme } from "../../shared/themes.ts";
import { ACCENTS, EN_FONTS, INKS, PAGE_SIZES, PAPERS, ZH_FONTS, type EnFontId, type PageSizeId, type ZhFontId } from "../config/appearance.ts";
import { useT } from "../i18n/index.ts";
import { useNoteStore, type Settings } from "../state/store.ts";

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
  const t = useT();

  return (
    <div className="panel-body">
      <fieldset className="field">
        <legend>{t.style.layout}</legend>
        <div className="layout-grid-options" role="radiogroup" aria-label={t.style.layout}>
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
              <strong>{t.options.styles[style]}</strong>
              <small>{t.options.layoutHints[style]}</small>
            </button>
          ))}
        </div>
      </fieldset>

      <fieldset className="field">
        <legend>{t.style.paper}</legend>
        <div className="swatch-group" role="radiogroup" aria-label={t.style.paper}>
          {PAPERS.map((paper) => (
            <button
              key={paper.id}
              type="button"
              role="radio"
              aria-checked={settings.paper === paper.id}
              className={`paper-swatch paper-${paper.id}${settings.paper === paper.id ? " is-active" : ""}`}
              style={{ "--paper": paper.base, "--paper-line": paper.lineColor } as CSSProperties}
              onClick={() => set({ paper: paper.id })}
              title={t.options.papers[paper.id]}
            >
              <span>{t.options.papers[paper.id]}</span>
            </button>
          ))}
        </div>
      </fieldset>

      <label className="field">
        <span>{t.style.pageSize}</span>
        <select value={settings.pageSize} onChange={(e) => set({ pageSize: e.target.value as PageSizeId })}>
          {PAGE_SIZES.map((size) => (
            <option key={size.id} value={size.id}>
              {t.options.pageSizes[size.id]}
            </option>
          ))}
        </select>
      </label>

      <label className="field">
        <span>{t.style.overflow}</span>
        <select value={settings.overflow} onChange={(e) => set({ overflow: e.target.value as Settings["overflow"] })}>
          <option value="expand">{t.style.overflowExpand}</option>
          <option value="error">{t.style.overflowError}</option>
        </select>
      </label>

      <div className="field-row">
        <label className="field">
          <span>{t.style.zhFont}</span>
          <select value={settings.zhFont} onChange={(e) => set({ zhFont: e.target.value as ZhFontId })}>
            {ZH_FONTS.map((font) => (
              <option key={font.id} value={font.id}>
                {t.options.zhFonts[font.id]}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span>{t.style.enFont}</span>
          <select value={settings.enFont} onChange={(e) => set({ enFont: e.target.value as EnFontId })}>
            {EN_FONTS.map((font) => (
              <option key={font.id} value={font.id}>
                {font.label}
              </option>
            ))}
          </select>
        </label>
      </div>

      <Range label={t.style.fontSize} value={settings.fontSize} min={12} max={28} step={0.5} format={(v) => `${v}px`} onChange={(v) => set({ fontSize: v })} />
      <Range label={t.style.lineHeight} value={settings.lineHeight} min={1.3} max={2.4} step={0.05} format={(v) => v.toFixed(2)} onChange={(v) => set({ lineHeight: v })} />
      <Range
        label={t.style.letterSpacing}
        value={settings.letterSpacing}
        min={-0.02}
        max={0.15}
        step={0.01}
        format={(v) => `${v.toFixed(2)}em`}
        onChange={(v) => set({ letterSpacing: v })}
      />

      <fieldset className="field">
        <legend>{t.style.ink}</legend>
        <div className="swatch-group" role="radiogroup" aria-label={t.style.inkLabel}>
          {INKS.map((ink) => (
            <button
              key={ink.id}
              type="button"
              role="radio"
              aria-checked={settings.ink === ink.id}
              className={`color-swatch${settings.ink === ink.id ? " is-active" : ""}`}
              style={{ background: ink.color }}
              onClick={() => set({ ink: ink.id })}
              title={t.options.inks[ink.id]}
              aria-label={t.options.inks[ink.id]}
            />
          ))}
        </div>
      </fieldset>

      <fieldset className="field">
        <legend>{t.style.accent}</legend>
        <div className="swatch-group" role="radiogroup" aria-label={t.style.accentLabel}>
          {ACCENTS.map((accent) => (
            <button
              key={accent.id}
              type="button"
              role="radio"
              aria-checked={settings.accent === accent.id}
              className={`color-swatch${settings.accent === accent.id ? " is-active" : ""}`}
              style={{ background: accent.color }}
              onClick={() => set({ accent: accent.id })}
              title={t.options.accents[accent.id]}
              aria-label={t.options.accents[accent.id]}
            />
          ))}
        </div>
      </fieldset>

      <Range
        label={t.style.naturalness}
        value={settings.naturalness}
        min={0}
        max={1}
        step={0.05}
        format={(v) => `${Math.round(v * 100)}%`}
        onChange={(v) => set({ naturalness: v })}
      />
      <button type="button" className="btn btn-small btn-secondary" onClick={() => set({ seed: Math.floor(Math.random() * 100_000) })}>
        {t.style.reseed}
      </button>

      <fieldset className="field">
        <legend>{t.style.doodle}</legend>
        <div className="field-row">
          <select
            aria-label={t.style.doodleSource}
            value={settings.doodleMode}
            onChange={(e) => set({ doodleMode: e.target.value as Settings["doodleMode"] })}
          >
            <option value="auto">{t.style.doodleModes.auto}</option>
            <option value="theme">{t.style.doodleModes.theme}</option>
            {doodleEnabled || aiDoodle ? <option value="ai">{t.style.doodleModes.ai}</option> : null}
            <option value="none">{t.style.doodleModes.none}</option>
          </select>
          {settings.doodleMode === "theme" ? (
            <select aria-label={t.style.doodleTheme} value={settings.doodleTheme} onChange={(e) => set({ doodleTheme: e.target.value as DoodleTheme })}>
              {DOODLE_THEMES.map((theme) => (
                <option key={theme} value={theme}>
                  {t.options.doodleThemes[theme]}
                </option>
              ))}
            </select>
          ) : null}
        </div>
        {settings.doodleMode === "ai" && doodleEnabled ? (
          <button type="button" className="btn btn-small btn-secondary" onClick={onRequestAiDoodle}>
            {aiDoodle ? t.style.regenerateAiDoodle : t.style.generateAiDoodle}
          </button>
        ) : null}
      </fieldset>

      <button type="button" className="btn btn-link" onClick={resetSettings}>
        {t.style.reset}
      </button>
    </div>
  );
}
