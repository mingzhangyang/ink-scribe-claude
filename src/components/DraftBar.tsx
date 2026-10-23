import { enableDraft, forgetDraft, restoreLatestDraft, retryDraft, useDraftStatus } from "../drafts/controller.ts";
import { useT } from "../i18n/index.ts";

export function DraftBar() {
  const { status } = useDraftStatus();
  const t = useT().draft;
  return (
    <section className="draft-bar" aria-label={t.label}>
      <span role="status" data-draft-status={status}>{t[status]}</span>
      <div className="button-row">
        {status === "error" ? <button className="btn btn-small" onClick={() => void retryDraft()}>{t.retry}</button> : null}
        {status === "conflict" ? <button className="btn btn-small" onClick={() => { if (window.confirm(t.restoreConfirm)) void restoreLatestDraft(); }}>{t.restore}</button> : null}
        {status === "disabled" ? <button className="btn btn-small" onClick={() => void enableDraft()}>{t.enable}</button> : (
          <button className="btn btn-small btn-secondary" disabled={status === "saving"} onClick={() => { if (window.confirm(t.forgetConfirm)) void forgetDraft(); }}>{t.forget}</button>
        )}
      </div>
    </section>
  );
}
