import { useId, useState, type CSSProperties } from "react";
import type { DoodleSpec } from "../../shared/doodle.ts";
import { DOODLE_THEMES } from "../../shared/themes.ts";
import { ApiRequestError, generateDoodle } from "../api.ts";
import { byId, INKS, PAPERS } from "../config/appearance.ts";
import { builtinDoodle } from "../doodles/library.ts";
import { en } from "../i18n/en.ts";
import { errorMessage, useT } from "../i18n/index.ts";
import { zh } from "../i18n/zh.ts";
import { usePreferences } from "../state/preferences.ts";
import { useNoteStore, type RequestError } from "../state/store.ts";
import { paint } from "../stickers/art/common.tsx";
import { StickerArt } from "../stickers/StickerArt.tsx";
import {
  isDecorStickerType,
  STICKER_CATEGORIES,
  STICKER_CATEGORY_TYPES,
  STICKER_VARIANTS,
  stickerVariant,
  type DecorStickerType,
  type StickerItem,
  type StickerPattern,
  type StickerVariant,
} from "../stickers/types.ts";
import { DoodleArt } from "./note/DoodleArt.tsx";

/** 色块上的花纹示意，与胶带花纹、纸片格线对应。 */
const PATTERN_SWATCHES: Record<StickerPattern, CSSProperties> = {
  dots: { backgroundImage: "radial-gradient(rgba(255,255,255,0.9) 28%, transparent 32%)", backgroundSize: "7px 7px" },
  checks: {
    backgroundImage: "linear-gradient(90deg, rgba(255,255,255,0.45) 50%, transparent 50%), linear-gradient(rgba(255,255,255,0.45) 50%, transparent 50%)",
    backgroundSize: "8px 8px",
  },
  stripes: { backgroundImage: "linear-gradient(90deg, rgba(255,255,255,0.7) 40%, transparent 40%)", backgroundSize: "6px 100%" },
  grid: {
    backgroundImage: "linear-gradient(rgba(96,165,250,0.6) 1px, transparent 1px), linear-gradient(90deg, rgba(96,165,250,0.6) 1px, transparent 1px)",
    backgroundSize: "5px 5px",
  },
  lines: { backgroundImage: "linear-gradient(rgba(96,165,250,0.6) 1px, transparent 1px)", backgroundSize: "100% 5px" },
};

const swatchStyle = (variant: StickerVariant): CSSProperties => ({
  backgroundColor: paint(variant.color),
  ...(variant.pattern ? PATTERN_SWATCHES[variant.pattern] : {}),
});

const normalize = (text: string) => text.toLowerCase().replace(/\s+/g, "");

/** 所有装饰贴纸，按分类顺序排列；搜索结果沿用这个顺序。 */
const DECOR_ORDER = STICKER_CATEGORIES.flatMap((category) => STICKER_CATEGORY_TYPES[category].map((type) => ({ type, category })));

/**
 * 搜索索引：中英文名称、分组名和类型 ID（如 rocket、h2o），以及每个颜色与款式的中英文名，
 * 两种界面语言下用中文或英文都能搜到。
 */
const SEARCH_INDEX = DECOR_ORDER.map(({ type, category }) => ({
  type,
  text: normalize([type.replace(/-/g, " "), ...[zh, en].flatMap((m) => [m.options.stickers[type], m.options.stickerCategories[category]])].join(" ")),
  variants: STICKER_VARIANTS[type].map((v: StickerVariant) => ({
    id: v.id,
    text: normalize([zh, en].map((m) => (m.options.stickerVariants[type] as Record<string, string>)[v.id]).join(" ")),
  })),
}));

/** 按名称搜到的贴纸沿用记住的款式；只按颜色或款式名搜到的（如“红”“银杏”），直接用那个款式。 */
function searchStickers(needle: string): Array<{ type: DecorStickerType; variant?: string }> {
  return SEARCH_INDEX.flatMap((entry) => {
    if (entry.text.includes(needle)) return [{ type: entry.type }];
    const variant = entry.variants.find((v) => v.text.includes(needle));
    return variant ? [{ type: entry.type, variant: variant.id }] : [];
  });
}

/** 面板预览用固定 ID，墨渍、印章等按 ID 生成形状的贴纸在面板里保持不变。 */
const preview = (type: DecorStickerType, variant: string): StickerItem => ({ id: `preview-${type}`, type, x: 0, y: 0, rotation: 0, scale: 1, variant });

export function StickerPanel({ doodleEnabled }: { doodleEnabled: boolean }) {
  const stickers = useNoteStore((s) => s.stickers);
  const selectedId = useNoteStore((s) => s.selectedStickerId);
  const note = useNoteStore((s) => s.note);
  const settings = useNoteStore((s) => s.settings);
  const addSticker = useNoteStore((s) => s.addSticker);
  const updateSticker = useNoteStore((s) => s.updateSticker);
  const removeSticker = useNoteStore((s) => s.removeSticker);
  const moveLayer = useNoteStore((s) => s.moveStickerLayer);
  const clearStickers = useNoteStore((s) => s.clearStickers);
  const setAiDoodle = useNoteStore((s) => s.setAiDoodle);
  const selected = stickers.find((s) => s.id === selectedId) ?? null;
  const selectedDecor = selected && isDecorStickerType(selected.type) ? selected.type : null;
  const category = usePreferences((p) => p.stickerCategory);
  const setCategory = usePreferences((p) => p.setStickerCategory);
  const lastVariants = usePreferences((p) => p.stickerVariants);
  const rememberVariant = usePreferences((p) => p.rememberStickerVariant);
  const recent = usePreferences((p) => p.recentStickers);
  const rememberRecent = usePreferences((p) => p.rememberRecentSticker);
  const [query, setQuery] = useState("");
  const needle = normalize(query);
  const results = needle ? searchStickers(needle) : null;
  const variantsLabelId = useId();
  const t = useT();
  // 预览与画布一致：跟随当前笔记的墨水色和纸张底色
  const artVars = { "--ink": byId(INKS, settings.ink).color, "--paper": byId(PAPERS, settings.paper).base } as CSSProperties;

  /** 贴纸预览按钮：默认沿用这类贴纸上次选的颜色或款式；“最近使用”一行用不带名称的紧凑样式。 */
  function tile(type: DecorStickerType, options: { compact?: boolean; variant?: string } = {}) {
    const { compact = false } = options;
    const name = t.options.stickers[type];
    const variant = options.variant ?? stickerVariant(type, lastVariants[type]).id;
    return (
      <button
        key={type}
        type="button"
        className={`sticker-option${compact ? " is-compact" : ""}`}
        onClick={() => {
          addSticker(type, { variant });
          rememberRecent(type);
        }}
        title={t.stickers.addTitle(name)}
        aria-label={t.stickers.addSticker(name)}
      >
        <span className="sticker-option-art">
          <StickerArt item={preview(type, variant)} naturalness={0} seed={0} />
        </span>
        {compact ? null : <span className="sticker-option-name">{name}</span>}
      </button>
    );
  }

  const [concept, setConcept] = useState("");
  const [aiState, setAiState] = useState<{ status: "idle" | "loading" | "error"; error?: RequestError; spec?: DoodleSpec }>({ status: "idle" });

  async function requestDoodle() {
    const prompt = (concept || note?.doodlePrompt || note?.title || "").trim();
    if (!prompt) return;
    setAiState({ status: "loading" });
    try {
      const result = await generateDoodle(prompt.slice(0, 80));
      setAiState({ status: "idle", spec: result.doodle });
    } catch (error) {
      setAiState({ status: "error", ...(error instanceof ApiRequestError ? { error: error.detail } : {}) });
    }
  }

  return (
    <div className="panel-body">
      <fieldset className="field" style={artVars}>
        <legend>{t.stickers.decor}</legend>
        <input
          type="search"
          value={query}
          placeholder={t.stickers.searchPlaceholder}
          aria-label={t.stickers.searchLabel}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Escape" && query) setQuery("");
          }}
        />
        {results ? (
          <>
            <p className="hint" role="status">
              {results.length > 0 ? t.stickers.searchResults(results.length) : t.stickers.searchEmpty}
            </p>
            {results.length > 0 ? <div className="sticker-palette">{results.map(({ type, variant }) => tile(type, { variant }))}</div> : null}
          </>
        ) : (
          <>
            {recent.length > 0 ? (
              <div className="sticker-recent">
                <span className="hint">{t.stickers.recent}</span>
                <div className="sticker-recent-grid">{recent.map((type) => tile(type, { compact: true }))}</div>
              </div>
            ) : null}
            <div className="chip-group" role="radiogroup" aria-label={t.stickers.categories}>
              {STICKER_CATEGORIES.map((id) => (
                <button
                  key={id}
                  type="button"
                  role="radio"
                  aria-checked={category === id}
                  className={`chip${category === id ? " is-active" : ""}`}
                  onClick={() => setCategory(id)}
                >
                  {t.options.stickerCategories[id]}
                </button>
              ))}
            </div>
            <div className="sticker-palette">{STICKER_CATEGORY_TYPES[category].map((type) => tile(type))}</div>
          </>
        )}
        <div className="sticker-variants">
          {selected && selectedDecor ? (
            <>
              <span id={variantsLabelId} className="hint">
                {t.stickers.variants(t.options.stickers[selectedDecor])}
              </span>
              <div className="chip-group" role="radiogroup" aria-labelledby={variantsLabelId}>
                {STICKER_VARIANTS[selectedDecor].map((variant: StickerVariant) => {
                  const active = stickerVariant(selectedDecor, selected.variant).id === variant.id;
                  return (
                    <button
                      key={variant.id}
                      type="button"
                      role="radio"
                      aria-checked={active}
                      className={`chip sticker-variant${active ? " is-active" : ""}`}
                      onClick={() => {
                        updateSticker(selected.id, { variant: variant.id });
                        rememberVariant(selectedDecor, variant.id);
                      }}
                    >
                      <span className="sticker-variant-swatch" style={swatchStyle(variant)} />
                      {(t.options.stickerVariants[selectedDecor] as Record<string, string>)[variant.id]}
                    </button>
                  );
                })}
              </div>
            </>
          ) : (
            <p className="hint">{t.stickers.variantsHint}</p>
          )}
        </div>
      </fieldset>

      <fieldset className="field">
        <legend>{t.stickers.library}</legend>
        <div className="doodle-palette">
          {DOODLE_THEMES.map((theme) => (
            <button
              key={theme}
              type="button"
              className="doodle-option"
              onClick={() => addSticker("custom-doodle", { variant: theme })}
              title={t.stickers.addTitle(t.options.doodleThemes[theme])}
              aria-label={t.stickers.addLabel(t.options.doodleThemes[theme])}
            >
              <DoodleArt spec={builtinDoodle(theme)} seed={3} naturalness={0.4} />
            </button>
          ))}
        </div>
      </fieldset>

      {doodleEnabled ? (
        <fieldset className="field">
          <legend>{t.stickers.ai}</legend>
          <p className="hint">{t.stickers.aiHint}</p>
          <div className="field-row">
            <input
              type="text"
              value={concept}
              maxLength={80}
              placeholder={note?.doodlePrompt || t.stickers.aiPlaceholder}
              onChange={(e) => setConcept(e.target.value)}
              aria-label={t.stickers.aiConcept}
            />
            <button type="button" className="btn btn-small" disabled={aiState.status === "loading"} onClick={() => void requestDoodle()}>
              {aiState.status === "loading" ? t.stickers.aiDrawing : t.stickers.aiGenerate}
            </button>
          </div>
          {aiState.status === "error" ? <p className="hint is-error">{aiState.error ? errorMessage(t, aiState.error) : t.stickers.aiFailed}</p> : null}
          {aiState.spec ? (
            <div className="ai-doodle-preview">
              <DoodleArt spec={aiState.spec} seed={settings.seed} naturalness={settings.naturalness} />
              <div className="field-row">
                <button type="button" className="btn btn-small btn-secondary" onClick={() => setAiDoodle(aiState.spec!)}>
                  {t.stickers.setMain}
                </button>
                <button type="button" className="btn btn-small btn-secondary" onClick={() => addSticker("custom-doodle", { doodle: aiState.spec })}>
                  {t.stickers.addAsSticker}
                </button>
              </div>
            </div>
          ) : null}
        </fieldset>
      ) : null}

      <fieldset className="field">
        <legend>{t.stickers.current}</legend>
        {selected ? (
          <div className="sticker-inspector">
            <p className="hint">{t.stickers.selected(t.options.stickers[selected.type])}</p>
            <label className="field range-field">
              <span>
                {t.stickers.rotation}<output>{Math.round(selected.rotation)}°</output>
              </span>
              <input
                type="range"
                min={-180}
                max={180}
                value={selected.rotation}
                onChange={(e) => updateSticker(selected.id, { rotation: Number(e.target.value) })}
              />
            </label>
            <label className="field range-field">
              <span>
                {t.stickers.scale}<output>{Math.round(selected.scale * 100)}%</output>
              </span>
              <input
                type="range"
                min={0.3}
                max={3}
                step={0.05}
                value={selected.scale}
                onChange={(e) => updateSticker(selected.id, { scale: Number(e.target.value) })}
              />
            </label>
            <div className="button-row">
              <button
                type="button"
                className="btn btn-small btn-secondary"
                aria-pressed={selected.flip === true}
                onClick={() => updateSticker(selected.id, { flip: selected.flip ? undefined : true })}
              >
                {t.stickers.flip}
              </button>
              <button type="button" className="btn btn-small btn-secondary" onClick={() => moveLayer(selected.id, "top")}>
                {t.stickers.top}
              </button>
              <button type="button" className="btn btn-small btn-secondary" onClick={() => moveLayer(selected.id, "up")}>
                {t.stickers.up}
              </button>
              <button type="button" className="btn btn-small btn-secondary" onClick={() => moveLayer(selected.id, "down")}>
                {t.stickers.down}
              </button>
              <button type="button" className="btn btn-small btn-secondary" onClick={() => moveLayer(selected.id, "bottom")}>
                {t.stickers.bottom}
              </button>
              <button type="button" className="btn btn-small btn-danger" onClick={() => removeSticker(selected.id)}>
                {t.stickers.remove}
              </button>
            </div>
          </div>
        ) : (
          <p className="hint">{stickers.length > 0 ? t.stickers.selectHint : t.stickers.emptyHint}</p>
        )}
        {stickers.length > 0 ? (
          <button type="button" className="btn btn-link" onClick={clearStickers}>
            {t.stickers.clearAll(stickers.length)}
          </button>
        ) : null}
      </fieldset>
    </div>
  );
}
