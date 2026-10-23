import { useEffect, useState } from "react";
import { useT } from "../../i18n/index.ts";
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
  const [dismissed, setDismissed] = useState(false);
  // 关闭后在页面重新变回固定尺寸之前不再提示；调字号等引起的重新适配不会让它反复出现
  const fitsFixedPage = status === "ready" && !fit?.expanded;
  useEffect(() => {
    if (fitsFixedPage) setDismissed(false);
  }, [fitsFixedPage]);

  const message = status === "pending" ? t.workspace.fitPending
    : expanded && !dismissed ? t.workspace.fitExpanded : null;
  if (!message) return null;
  return (
    <div className={`fit-notice${fixed ? " is-fixed" : ""}`} data-fit-status={status} role="status">
      <span>{message}</span>
      {expanded ? (
        <button type="button" className="icon-btn" onClick={() => setDismissed(true)} aria-label={t.workspace.dismiss}>
          ×
        </button>
      ) : null}
    </div>
  );
}
