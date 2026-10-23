import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";

/** 界面偏好：外观主题、界面语言与已关闭的提示。与笔记外观（settings）分开保存，切换语言不会改变笔记本身。 */

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
  setLocale: (locale: Locale) => void;
  setTheme: (theme: ThemePreference) => void;
  dismissLongPageNotice: () => void;
};

export const usePreferences = create<State>()(
  persist(
    (set) => ({
      locale: detectLocale(),
      theme: "system",
      longPageNoticeDismissed: false,
      setLocale: (locale) => set({ locale }),
      setTheme: (theme) => set({ theme }),
      dismissLongPageNotice: () => set({ longPageNoticeDismissed: true }),
    }),
    {
      name: PREFERENCES_KEY,
      storage: createJSONStorage(() => localStorage),
      partialize: (state) => ({ locale: state.locale, theme: state.theme, longPageNoticeDismissed: state.longPageNoticeDismissed }),
      merge: (persisted, current) => {
        const p = (persisted ?? {}) as Partial<Record<"locale" | "theme" | "longPageNoticeDismissed", unknown>>;
        return {
          ...current,
          locale: (LOCALES as readonly unknown[]).includes(p.locale) ? (p.locale as Locale) : current.locale,
          theme: (THEMES as readonly unknown[]).includes(p.theme) ? (p.theme as ThemePreference) : current.theme,
          longPageNoticeDismissed: p.longPageNoticeDismissed === true,
        };
      },
    },
  ),
);

export function resolveTheme(theme: ThemePreference): "light" | "dark" {
  if (theme !== "system") return theme;
  return typeof matchMedia === "function" && matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark";
}
