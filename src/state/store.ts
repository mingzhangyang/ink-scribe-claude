import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import type { ApiErrorBody, ResponseMeta } from "../../shared/api.ts";
import type { DoodleSpec } from "../../shared/doodle.ts";
import type { NoteStructure } from "../../shared/note.ts";
import type { Detail, Language, Template } from "../../shared/options.ts";
import { newStickerId, type StickerItem, type StickerType } from "../stickers/types.ts";
import { DEFAULT_SETTINGS, sanitizeSettings, type Settings } from "./settings.ts";

export { DEFAULT_SETTINGS, type Settings };

export type InputState = {
  text: string;
  template: Template;
  language: Language;
  detail: Detail;
};

export type RequestError = ApiErrorBody["error"] | { code: "NETWORK_ERROR" | "CLIENT_TIMEOUT"; message: string; requestId?: string };

type State = {
  input: InputState;
  note: NoteStructure | null;
  meta: ResponseMeta | null;
  source: "ai" | "local" | "sample" | null;
  status: "idle" | "loading" | "error";
  error: RequestError | null;
  settings: Settings;
  stickers: StickerItem[];
  selectedStickerId: string | null;
  aiDoodle: DoodleSpec | null;

  setInput: (patch: Partial<InputState>) => void;
  setSettings: (patch: Partial<Settings>) => void;
  resetSettings: () => void;
  startLoading: () => void;
  setResult: (note: NoteStructure, meta: ResponseMeta | null, source: "ai" | "local" | "sample") => void;
  setError: (error: RequestError) => void;
  clearError: () => void;
  updateNote: (updater: (note: NoteStructure) => NoteStructure) => void;
  setAiDoodle: (spec: DoodleSpec | null) => void;

  addSticker: (type: StickerType, options?: { variant?: string; doodle?: DoodleSpec; x?: number; y?: number }) => void;
  updateSticker: (id: string, patch: Partial<StickerItem>) => void;
  removeSticker: (id: string) => void;
  selectSticker: (id: string | null) => void;
  moveStickerLayer: (id: string, direction: "up" | "down" | "top" | "bottom") => void;
  clearStickers: () => void;
};

export const useNoteStore = create<State>()(
  persist(
    (set) => ({
      input: { text: "", template: "general", language: "auto", detail: "standard" },
      note: null,
      meta: null,
      source: null,
      status: "idle",
      error: null,
      settings: DEFAULT_SETTINGS,
      stickers: [],
      selectedStickerId: null,
      aiDoodle: null,

      setInput: (patch) => set((s) => ({ input: { ...s.input, ...patch } })),
      setSettings: (patch) => set((s) => ({ settings: { ...s.settings, ...patch } })),
      resetSettings: () => set({ settings: DEFAULT_SETTINGS }),
      startLoading: () => set({ status: "loading", error: null }),
      setResult: (note, meta, source) =>
        set((s) => ({
          note,
          meta,
          source,
          status: "idle",
          error: null,
          aiDoodle: null,
          selectedStickerId: null,
          settings: { ...s.settings, seed: Math.floor(Math.random() * 100_000) },
        })),
      setError: (error) => set({ status: "error", error }),
      clearError: () => set({ status: "idle", error: null }),
      updateNote: (updater) => set((s) => (s.note ? { note: updater(s.note) } : {})),
      setAiDoodle: (spec) =>
        set((s) => ({ aiDoodle: spec, settings: { ...s.settings, doodleMode: spec ? "ai" : s.settings.doodleMode } })),

      addSticker: (type, options = {}) =>
        set((s) => {
          const sticker: StickerItem = {
            id: newStickerId(),
            type,
            x: options.x ?? 420 + Math.round((Math.random() - 0.5) * 160),
            y: options.y ?? 420 + Math.round((Math.random() - 0.5) * 160),
            rotation: Math.round((Math.random() - 0.5) * 20),
            scale: 1,
            ...(options.variant ? { variant: options.variant } : {}),
            ...(options.doodle ? { doodle: options.doodle } : {}),
          };
          return { stickers: [...s.stickers, sticker], selectedStickerId: sticker.id };
        }),
      updateSticker: (id, patch) =>
        set((s) => ({ stickers: s.stickers.map((st) => (st.id === id ? { ...st, ...patch } : st)) })),
      removeSticker: (id) =>
        set((s) => ({
          stickers: s.stickers.filter((st) => st.id !== id),
          selectedStickerId: s.selectedStickerId === id ? null : s.selectedStickerId,
        })),
      selectSticker: (id) => set({ selectedStickerId: id }),
      moveStickerLayer: (id, direction) =>
        set((s) => {
          const index = s.stickers.findIndex((st) => st.id === id);
          if (index < 0) return {};
          const list = [...s.stickers];
          const [item] = list.splice(index, 1);
          const target =
            direction === "top"
              ? list.length
              : direction === "bottom"
                ? 0
                : direction === "up"
                  ? Math.min(list.length, index + 1)
                  : Math.max(0, index - 1);
          list.splice(target, 0, item);
          return { stickers: list };
        }),
      clearStickers: () => set({ stickers: [], selectedStickerId: null }),
    }),
    {
      name: "ink-scribe:v1",
      storage: createJSONStorage(() => localStorage),
      // 只在本机保存外观偏好；粘贴的原文与生成的笔记不落盘
      partialize: (state) => ({ settings: state.settings }),
      merge: (persisted, current) => ({
        ...current,
        settings: sanitizeSettings((persisted as { settings?: unknown } | undefined)?.settings),
      }),
    },
  ),
);
