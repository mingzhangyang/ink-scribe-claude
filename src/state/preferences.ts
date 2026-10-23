import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import { isDecorStickerType, STICKER_CATEGORIES, STICKER_VARIANTS, type DecorStickerType, type StickerCategory } from "../stickers/types.ts";

/** 界面偏好：外观主题、界面语言、已关闭的提示与贴纸面板的选择。与笔记外观（settings）分开保存，切换语言不会改变笔记本身。 */

export const LOCALES = ["zh", "en"] as const;
export type Locale = (typeof LOCALES)[number];

export const THEMES = ["system", "light", "dark"] as const;
export type ThemePreference = (typeof THEMES)[number];

/** 本地存储键；public/theme-init.js 在页面脚本加载前读取同一个键，避免首屏闪烁。 */
export const PREFERENCES_KEY = "ink-scribe:prefs";

/** 首次访问时按浏览器首选语言选择界面语言：中文浏览器用中文，其余用英文。 */
export function detectLocale(): Locale {
  const preferred = (typeof navigator === "undefined" ? "" : (navigator.languages?.[0] ?? navigator.language ?? "")).toLowerCase();
  return preferred === "" || preferred.startsWith("zh") ? "zh" : "en";
}

type State = {
  locale: Locale;
  theme: ThemePreference;
  /** 用户关闭了“已延长页面”提示后不再显示 */
  longPageNoticeDismissed: boolean;
  /** 贴纸面板上次查看的分类 */
  stickerCategory: StickerCategory;
  /** 每种装饰贴纸上次选用的颜色或款式，新添加的同类贴纸沿用它 */
  stickerVariants: Partial<Record<DecorStickerType, string>>;
  setLocale: (locale: Locale) => void;
  setTheme: (theme: ThemePreference) => void;
  dismissLongPageNotice: () => void;
  setStickerCategory: (category: StickerCategory) => void;
  rememberStickerVariant: (type: DecorStickerType, variant: string) => void;
};

/** 只保留仍然存在的贴纸类型与变体，旧版本或手动改过的存储不会让面板选中无效的款式。 */
function knownStickerVariants(value: unknown): Partial<Record<DecorStickerType, string>> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return Object.fromEntries(
    Object.entries(value).filter(([type, id]) => isDecorStickerType(type) && STICKER_VARIANTS[type].some((v) => v.id === id)),
  );
}

export const usePreferences = create<State>()(
  persist(
    (set) => ({
      locale: detectLocale(),
      theme: "system",
      longPageNoticeDismissed: false,
      stickerCategory: STICKER_CATEGORIES[0],
      stickerVariants: {},
      setLocale: (locale) => set({ locale }),
      setTheme: (theme) => set({ theme }),
      dismissLongPageNotice: () => set({ longPageNoticeDismissed: true }),
      setStickerCategory: (stickerCategory) => set({ stickerCategory }),
      rememberStickerVariant: (type, variant) => set((s) => ({ stickerVariants: { ...s.stickerVariants, [type]: variant } })),
    }),
    {
      name: PREFERENCES_KEY,
      storage: createJSONStorage(() => localStorage),
      partialize: (state) => ({
        locale: state.locale,
        theme: state.theme,
        longPageNoticeDismissed: state.longPageNoticeDismissed,
        stickerCategory: state.stickerCategory,
        stickerVariants: state.stickerVariants,
      }),
      merge: (persisted, current) => {
        const p = (persisted ?? {}) as Partial<
          Record<"locale" | "theme" | "longPageNoticeDismissed" | "stickerCategory" | "stickerVariants", unknown>
        >;
        return {
          ...current,
          locale: (LOCALES as readonly unknown[]).includes(p.locale) ? (p.locale as Locale) : current.locale,
          theme: (THEMES as readonly unknown[]).includes(p.theme) ? (p.theme as ThemePreference) : current.theme,
          longPageNoticeDismissed: p.longPageNoticeDismissed === true,
          stickerCategory: (STICKER_CATEGORIES as readonly unknown[]).includes(p.stickerCategory)
            ? (p.stickerCategory as StickerCategory)
            : current.stickerCategory,
          stickerVariants: knownStickerVariants(p.stickerVariants),
        };
      },
    },
  ),
);

export function resolveTheme(theme: ThemePreference): "light" | "dark" {
  if (theme !== "system") return theme;
  return typeof matchMedia === "function" && matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark";
}
