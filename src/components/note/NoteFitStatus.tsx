import { useT } from "../../i18n/index.ts";
import { usePreferences } from "../../state/preferences.ts";
import type { NoteFitState } from "./useNoteFit.ts";

/** Problems that block export stay in the page flow, next to the actions that resolve them. */
export function NoteFitStatus({ fit }: { fit: NoteFitState | null }) {
  const t = useT();
  const status = fit?.status;
  if (status !== "overflow" && status !== "font-error") return null;
  return (
    <div className="note-fit-status alert alert-warn" data-fit-status={status} role="status">
      <span>{status === "overflow" ? t.workspace.fitOverflow : t.workspace.fitFontError}</span>
      {status === "font-error" ? <button type="button" className="btn btn-small btn-secondary" onClick={fit?.retry}>{t.workspace.retry}</button> : null}
    </div>
  );
}

/** Informational notices float over the bottom of the canvas so they never push the page down. */
export function NoteFitNotice({ fit, fixed = false }: { fit: NoteFitState | null; fixed?: boolean }) {
  const t = useT();
  const status = fit?.status ?? "pending";
  const expanded = status === "ready" && Boolean(fit?.expanded);
  // 关闭后记在界面偏好里，之后的笔记和刷新页面都不再提示
  const dismissed = usePreferences((s) => s.longPageNoticeDismissed);
  const dismiss = usePreferences((s) => s.dismissLongPageNotice);

  const message = status === "pending" ? t.workspace.fitPending
    : expanded && !dismissed ? t.workspace.fitExpanded : null;
  if (!message) return null;
  return (
    <div className={`fit-notice${fixed ? " is-fixed" : ""}`} data-fit-status={status} role="status">
      <span>{message}</span>
      {expanded ? (
        <button type="button" className="icon-btn" onClick={dismiss} aria-label={t.workspace.dismiss}>
          ×
        </button>
      ) : null}
    </div>
  );
}
