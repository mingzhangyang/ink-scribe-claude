import { useState } from "react";
import type { DoodleSpec } from "../../shared/doodle.ts";
import { DOODLE_THEMES } from "../../shared/themes.ts";
import { ApiRequestError, generateDoodle } from "../api.ts";
import { builtinDoodle } from "../doodles/library.ts";
import { errorMessage, useT } from "../i18n/index.ts";
import { useNoteStore, type RequestError } from "../state/store.ts";
import { STICKER_VARIANTS, type StickerType } from "../stickers/types.ts";
import { DoodleArt } from "./note/DoodleArt.tsx";

const DECOR_TYPES = ["tape", "sticky-note", "paperclip", "star", "coffee-stain"] as const satisfies readonly Exclude<StickerType, "custom-doodle">[];

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
  const t = useT();

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
      <fieldset className="field">
        <legend>{t.stickers.decor}</legend>
        <div className="sticker-palette">
          {DECOR_TYPES.flatMap((type) =>
            STICKER_VARIANTS[type].map((variant) => (
              <button
                key={`${type}-${variant.id}`}
                type="button"
                className={`sticker-option sticker-option-${type}`}
                onClick={() => addSticker(type, { variant: variant.id })}
                title={`${t.options.stickers[type]} · ${t.options.stickerVariants[type][variant.id]}`}
              >
                <span className="sticker-option-swatch" style={{ background: variant.color === "ink" ? "transparent" : variant.color }} />
                <span>
                  {t.options.stickers[type]}
                  <small>{t.options.stickerVariants[type][variant.id]}</small>
                </span>
              </button>
            )),
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
