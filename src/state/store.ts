import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import type { ApiErrorBody, ResponseMeta } from "../../shared/api.ts";
import type { NoteDocument } from "../../shared/document.ts";
import type { DoodleSpec } from "../../shared/doodle.ts";
import type { NoteStructure } from "../../shared/note.ts";
import type { Detail, Language, Template } from "../../shared/options.ts";
import type { LibraryLink } from "../library/storage.ts";
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
  source: "ai" | "local" | "sample" | "shared" | null;
  status: "idle" | "loading" | "error";
  error: RequestError | null;
  settings: Settings;
  stickers: StickerItem[];
  selectedStickerId: string | null;
  aiDoodle: DoodleSpec | null;
  /** 每次生成或载入一条新笔记时递增，用于丢弃针对旧笔记的异步结果（如 AI 插图）。 */
  noteSerial: number;
  /** 每次换成另一份文档（恢复草稿、打开笔记库条目、载入已发布笔记）时递增；重新生成笔记不算。 */
  documentSerial: number;
  /** 当前编辑内容对应的本机笔记库条目；为空时“保存到笔记库”会新建一条。 */
  libraryLink: LibraryLink | null;
  /** 生成当前笔记时提交的原文。原文在生成期间和之后仍可编辑，所以判断笔记来自哪段原文时不能用 input.text。 */
  generatedFrom: string;

  setLibraryLink: (link: LibraryLink | null) => void;
  /** 整体替换编辑内容（恢复草稿、打开笔记库条目），并清除请求状态。 */
  loadDocument: (document: NoteDocument, link: LibraryLink | null) => void;
  setInput: (patch: Partial<InputState>) => void;
  setSettings: (patch: Partial<Settings>) => void;
  resetSettings: () => void;
  startLoading: () => void;
  /** `from` 是生成时提交的原文，默认为当前原文。 */
  setResult: (note: NoteStructure, meta: ResponseMeta | null, source: "ai" | "local" | "sample", from?: string) => void;
  /** 把已发布的笔记（含外观与贴纸）载入编辑器。 */
  loadShared: (input: { note: NoteStructure; settings: Settings; stickers: StickerItem[]; doodle: DoodleSpec | null }) => void;
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
      noteSerial: 0,
      documentSerial: 0,
      libraryLink: null,
      generatedFrom: "",

      setLibraryLink: (link) => set({ libraryLink: link }),
      loadDocument: (document, link) =>
        set((s) => ({ ...document, libraryLink: link, generatedFrom: document.generatedFrom ?? document.input.text, meta: null, status: "idle", error: null,
          selectedStickerId: null, noteSerial: s.noteSerial + 1, documentSerial: s.documentSerial + 1 })),
      setInput: (patch) => set((s) => ({ input: { ...s.input, ...patch } })),
      setSettings: (patch) => set((s) => ({ settings: { ...s.settings, ...patch } })),
      resetSettings: () => set({ settings: DEFAULT_SETTINGS }),
      startLoading: () => set({ status: "loading", error: null }),
      setResult: (note, meta, source, from) =>
        set((s) => ({
          note,
          meta,
          source,
          generatedFrom: from ?? s.input.text,
          status: "idle",
          error: null,
          aiDoodle: null,
          noteSerial: s.noteSerial + 1,
          selectedStickerId: null,
          settings: { ...s.settings, seed: Math.floor(Math.random() * 100_000) },
        })),
      loadShared: ({ note, settings, stickers, doodle }) =>
        set((s) => ({
          note,
          settings,
          stickers,
          aiDoodle: doodle,
          noteSerial: s.noteSerial + 1,
          documentSerial: s.documentSerial + 1,
          meta: null,
          source: "shared",
          // 已发布的笔记不是由当前原文生成的
          generatedFrom: "",
          libraryLink: null,
          status: "idle",
          error: null,
          selectedStickerId: null,
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
      // 外观偏好单独保存；完整文档由 drafts/controller 通过 IndexedDB 事务保存。
      partialize: (state) => ({ settings: state.settings }),
      merge: (persisted, current) => ({
        ...current,
        settings: sanitizeSettings((persisted as { settings?: unknown } | undefined)?.settings),
      }),
    },
  ),
);

/** 当前编辑内容中需要保存的部分（不含请求状态与选中状态）。 */
export function currentDocument(): NoteDocument {
  const { input, note, settings, stickers, aiDoodle, source, generatedFrom } = useNoteStore.getState();
  return { input, note, settings, stickers, aiDoodle, source, generatedFrom };
}
