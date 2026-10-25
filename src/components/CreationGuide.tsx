import { useEffect, useState } from "react";
import { hasCreatedSuccessfully } from "../analytics/creation.ts";
import { useT } from "../i18n/index.ts";
import { useNoteStore } from "../state/store.ts";
import type { NoteFitState } from "./note/useNoteFit.ts";

/** Guidance follows real request/layout state and disappears after the first useful result. */
export function CreationGuide({ fit, onCompose, onExport }: {
  fit: NoteFitState | null;
  onCompose: () => void;
  onExport: () => void;
}) {
  const t = useT().creation;
  const source = useNoteStore((s) => s.source);
  const status = useNoteStore((s) => s.status);
  const [finished, setFinished] = useState(hasCreatedSuccessfully);
  useEffect(() => {
    const update = () => setFinished(hasCreatedSuccessfully());
    window.addEventListener("creation-success", update);
    window.addEventListener("storage", update);
    return () => {
      window.removeEventListener("creation-success", update);
      window.removeEventListener("storage", update);
    };
  }, []);
  if (finished || source === "shared") return null;
  const generated = source === "ai" || source === "local";
  const ready = generated && status === "idle" && fit?.status === "ready";
  const message = status === "loading" ? t.generating
    : status === "error" ? t.failed
    : generated && fit?.status === "pending" ? t.layout
    : generated && !ready ? t.layoutBlocked
    : ready ? t.ready : t.intro;
  return (
    <section className="creation-guide" aria-label={t.label}>
      <p role="status">{message}</p>
      {!generated && status !== "loading" ? <button type="button" className="btn btn-small btn-primary" onClick={onCompose}>{t.start}</button> : null}
      {ready ? <button type="button" className="btn btn-small btn-primary" onClick={onExport}>{t.export}</button> : null}
      <p className="hint">{ready ? t.localStorage : t.sample}</p>
    </section>
  );
}
