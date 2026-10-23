import { useT } from "../../i18n/index.ts";
import type { NoteFitState } from "./useNoteFit.ts";

export function NoteFitStatus({ fit }: { fit: NoteFitState | null }) {
  const t = useT();
  const status = fit?.status ?? "pending";
  const message = status === "pending" ? t.workspace.fitPending
    : status === "overflow" ? t.workspace.fitOverflow
      : status === "font-error" ? t.workspace.fitFontError
        : fit?.expanded ? t.workspace.fitExpanded : null;
  if (!message) return null;
  return (
    <div className={`note-fit-status alert ${status === "overflow" || status === "font-error" ? "alert-warn" : ""}`} data-fit-status={status} role="status">
      <span>{message}</span>
      {status === "font-error" && fit ? <button type="button" className="btn btn-small btn-secondary" onClick={fit.retry}>{t.workspace.retry}</button> : null}
    </div>
  );
}
