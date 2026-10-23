import { useId } from "react";
import { create } from "zustand";
import { useT } from "../i18n/index.ts";
import { Sheet } from "./Sheet.tsx";

type Request = { message: string; confirm: string; danger: boolean; resolve: (confirmed: boolean) => void };
// The request stays after closing so the dialog keeps its text during the closing animation.
const useConfirm = create<{ open: boolean; request: Request | null }>(() => ({ open: false, request: null }));

function settle(confirmed: boolean) {
  const { open, request } = useConfirm.getState();
  if (!open || !request) return;
  useConfirm.setState({ open: false });
  request.resolve(confirmed);
}

/**
 * Asks before a destructive or replacing action, inside the page. window.confirm() returns false without showing
 * anything when the browser suppresses dialogs (embedded webviews, sandboxed frames, "prevent this page from creating
 * additional dialogs", browser automation), which turned those buttons into silent no-ops.
 */
export function confirmAction(message: string, confirm: string, { danger = false } = {}): Promise<boolean> {
  settle(false);
  return new Promise((resolve) => useConfirm.setState({ open: true, request: { message, confirm, danger, resolve } }));
}

export function ConfirmDialog() {
  const t = useT();
  const { open, request } = useConfirm();
  const id = useId();
  return (
    <Sheet open={open} onClose={() => settle(false)} labelledBy={id} className="confirm-sheet">
      <div className="sheet-body">
        <p id={id}>{request?.message}</p>
      </div>
      <div className="sheet-foot">
        <div className="sheet-actions">
          {/* Destructive actions start on Cancel, so Enter alone does not confirm them. */}
          <button type="button" className="btn btn-secondary" data-autofocus={request?.danger ? "" : undefined} onClick={() => settle(false)}>
            {t.app.cancel}
          </button>
          <button type="button" className={`btn ${request?.danger ? "btn-danger" : "btn-primary"}`} data-autofocus={request?.danger ? undefined : ""}
            onClick={() => settle(true)}>
            {request?.confirm}
          </button>
        </div>
      </div>
    </Sheet>
  );
}
