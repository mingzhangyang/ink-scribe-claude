import { usePreferences, type Locale } from "../state/preferences.ts";
import type { RequestError } from "../state/store.ts";
import { en } from "./en.ts";
import { zh, type Messages } from "./zh.ts";

export type { Messages };

const MESSAGES: Record<Locale, Messages> = { zh, en };

/** 组件中使用：界面语言切换时自动重新渲染。 */
export function useT(): Messages {
  return MESSAGES[usePreferences((s) => s.locale)];
}

/** 组件之外（文件解析、导出工具等）使用：读取当前界面语言的文案。 */
export function getMessages(): Messages {
  return MESSAGES[usePreferences.getState().locale];
}

/**
 * 服务端与 API 客户端的错误信息是中文。中文界面直接显示原文（更具体，例如包含字数上限），
 * 其他语言按错误码换成对应译文，未知错误码时仍显示原文。
 */
export function errorMessage(t: Messages, error: Pick<RequestError, "code" | "message">): string {
  return t.errors[error.code] ?? error.message;
}
