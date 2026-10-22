import { useState } from "react";
import type { DoodleSpec } from "../../shared/doodle.ts";
import { DOODLE_THEME_LABELS, DOODLE_THEMES } from "../../shared/themes.ts";
import { ApiRequestError, generateDoodle } from "../api.ts";
import { builtinDoodle } from "../doodles/library.ts";
import { useNoteStore } from "../state/store.ts";
import { STICKER_LABELS, STICKER_VARIANTS, type StickerType } from "../stickers/types.ts";
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

  const [concept, setConcept] = useState("");
  const [aiState, setAiState] = useState<{ status: "idle" | "loading" | "error"; message?: string; spec?: DoodleSpec }>({ status: "idle" });

  async function requestDoodle() {
    const prompt = (concept || note?.doodlePrompt || note?.title || "").trim();
    if (!prompt) return;
    setAiState({ status: "loading" });
    try {
      const result = await generateDoodle(prompt.slice(0, 80));
      setAiState({ status: "idle", spec: result.doodle });
    } catch (error) {
      setAiState({ status: "error", message: error instanceof ApiRequestError ? error.detail.message : "生成失败，请稍后重试。" });
    }
  }

  return (
    <div className="panel-body">
      <fieldset className="field">
        <legend>装饰贴纸</legend>
        <div className="sticker-palette">
          {DECOR_TYPES.flatMap((type) =>
            STICKER_VARIANTS[type].map((variant) => (
              <button
                key={`${type}-${variant.id}`}
                type="button"
                className={`sticker-option sticker-option-${type}`}
                onClick={() => addSticker(type, { variant: variant.id })}
                title={`${STICKER_LABELS[type]} · ${variant.label}`}
              >
                <span className="sticker-option-swatch" style={{ background: variant.color === "ink" ? "transparent" : variant.color }} />
                <span>
                  {STICKER_LABELS[type]}
                  <small>{variant.label}</small>
                </span>
              </button>
            )),
          )}
        </div>
      </fieldset>

      <fieldset className="field">
        <legend>手绘插图库</legend>
        <div className="doodle-palette">
          {DOODLE_THEMES.map((theme) => (
            <button
              key={theme}
              type="button"
              className="doodle-option"
              onClick={() => addSticker("custom-doodle", { variant: theme })}
              title={`添加「${DOODLE_THEME_LABELS[theme]}」`}
              aria-label={`添加插图：${DOODLE_THEME_LABELS[theme]}`}
            >
              <DoodleArt spec={builtinDoodle(theme)} seed={3} naturalness={0.4} />
            </button>
          ))}
        </div>
      </fieldset>

      {doodleEnabled ? (
        <fieldset className="field">
          <legend>AI 插图</legend>
          <p className="hint">AI 只返回受限的线条图元，经过校验后由本地生成器绘制。</p>
          <div className="field-row">
            <input
              type="text"
              value={concept}
              maxLength={80}
              placeholder={note?.doodlePrompt || "描述想要的小插图"}
              onChange={(e) => setConcept(e.target.value)}
              aria-label="插图主题"
            />
            <button type="button" className="btn btn-small" disabled={aiState.status === "loading"} onClick={() => void requestDoodle()}>
              {aiState.status === "loading" ? "绘制中…" : "生成"}
            </button>
          </div>
          {aiState.status === "error" ? <p className="hint is-error">{aiState.message}</p> : null}
          {aiState.spec ? (
            <div className="ai-doodle-preview">
              <DoodleArt spec={aiState.spec} seed={settings.seed} naturalness={settings.naturalness} />
              <div className="field-row">
                <button type="button" className="btn btn-small btn-secondary" onClick={() => setAiDoodle(aiState.spec!)}>
                  设为主插图
                </button>
                <button type="button" className="btn btn-small btn-secondary" onClick={() => addSticker("custom-doodle", { doodle: aiState.spec })}>
                  添加为贴纸
                </button>
              </div>
            </div>
          ) : null}
        </fieldset>
      ) : null}

      <fieldset className="field">
        <legend>当前贴纸</legend>
        {selected ? (
          <div className="sticker-inspector">
            <p className="hint">
              已选中：{STICKER_LABELS[selected.type]}。拖动移动，拖动圆点旋转/缩放，方向键微调，Delete 删除。
            </p>
            <label className="field range-field">
              <span>
                旋转<output>{Math.round(selected.rotation)}°</output>
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
                缩放<output>{Math.round(selected.scale * 100)}%</output>
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
                置顶
              </button>
              <button type="button" className="btn btn-small btn-secondary" onClick={() => moveLayer(selected.id, "up")}>
                上移
              </button>
              <button type="button" className="btn btn-small btn-secondary" onClick={() => moveLayer(selected.id, "down")}>
                下移
              </button>
              <button type="button" className="btn btn-small btn-secondary" onClick={() => moveLayer(selected.id, "bottom")}>
                置底
              </button>
              <button type="button" className="btn btn-small btn-danger" onClick={() => removeSticker(selected.id)}>
                删除
              </button>
            </div>
          </div>
        ) : (
          <p className="hint">{stickers.length > 0 ? "点击画布上的贴纸进行编辑。" : "还没有贴纸，从上方添加一个吧。"}</p>
        )}
        {stickers.length > 0 ? (
          <button type="button" className="btn btn-link" onClick={clearStickers}>
            清空全部贴纸（{stickers.length}）
          </button>
        ) : null}
      </fieldset>
    </div>
  );
}
