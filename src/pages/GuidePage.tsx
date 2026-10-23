import { useEffect, useMemo, useState } from "react";
import { GUIDE_CONTENT, getGuideExamples, type GuideContent, type GuideItem } from "../../shared/guide.ts";
import { linkProps } from "../router.ts";
import { usePreferences } from "../state/preferences.ts";
import "../styles/guide.css";

function GuideSteps({ items }: { items: GuideItem[] }) {
  return (
    <ol className="guide-steps">
      {items.map((item, index) => (
        <li key={item.title}>
          <span className="guide-step-number" aria-hidden="true">{String(index + 1).padStart(2, "0")}</span>
          <div>
            <h3>{item.title}</h3>
            <p>{item.body}</p>
          </div>
        </li>
      ))}
    </ol>
  );
}

function CodeExample({ kind, title, description, code, copy }: {
  kind: "json" | "curl";
  title: string;
  description: string;
  code: string;
  copy: GuideContent["copy"];
}) {
  const [status, setStatus] = useState<"idle" | "success" | "failure">("idle");

  async function copyCode() {
    setStatus("idle");
    try {
      await navigator.clipboard.writeText(code);
      setStatus("success");
    } catch {
      setStatus("failure");
    }
  }

  return (
    <div className="guide-example">
      <div className="guide-example-heading">
        <h3 id={`guide-${kind}-title`}>{title}</h3>
        <button
          type="button"
          className="btn btn-small btn-secondary guide-copy"
          data-guide-copy={kind}
          aria-label={`${copy.label} ${title}`}
          onClick={() => void copyCode()}
        >
          {status === "success" ? copy.success : copy.label}
        </button>
      </div>
      <p>{description}</p>
      <pre className="guide-code" data-guide-code={kind} tabIndex={0} aria-labelledby={`guide-${kind}-title`}><code>{code}</code></pre>
      <p className={`guide-copy-status${status === "failure" ? " guide-copy-error" : ""}`} role="status" data-guide-copy-status={kind}>
        {status === "idle" ? "" : copy[status]}
      </p>
    </div>
  );
}

/** Human-readable instructions and copyable agent examples from the shared guide. */
export function GuidePage() {
  const locale = usePreferences((state) => state.locale);
  const content = GUIDE_CONTENT[locale];
  const examples = useMemo(() => getGuideExamples(window.location.origin, locale), [locale]);

  useEffect(() => {
    document.title = content.documentTitle;
  }, [content.documentTitle]);

  useEffect(() => {
    // The initial server-rendered guide is replaced by React. Restore its anchor.
    // Only do this on arrival: changing language must not scroll an open menu away.
    const section = window.location.hash.slice(1);
    if (["users", "agents", "faq"].includes(section)) {
      document.getElementById(section)?.scrollIntoView();
    }
  }, []);

  return (
    <main className="guide-page">
      <header className="guide-hero">
        <p className="guide-eyebrow">{content.eyebrow}</p>
        <h1>{content.title}</h1>
        <p className="guide-lead">{content.description}</p>
        <nav className="guide-toc" aria-label={content.tocLabel}>
          {content.toc.map((item) => <a key={item.id} href={`#${item.id}`}>{item.label}<span aria-hidden="true">↗</span></a>)}
        </nav>
      </header>

      <section id="users" className="guide-section" aria-labelledby="guide-users-title">
        <header className="guide-section-header">
          <span className="guide-section-number" aria-hidden="true">01</span>
          <div>
            <h2 id="guide-users-title">{content.users.title}</h2>
            <p>{content.users.description}</p>
          </div>
        </header>
        <GuideSteps items={content.users.steps} />
        <div className="guide-notes">
          {content.users.notes.map((item) => <div key={item.title}><h3>{item.title}</h3><p>{item.body}</p></div>)}
        </div>
        <a className="btn btn-primary guide-editor-link" {...linkProps(content.users.action.href)}>{content.users.action.label}<span aria-hidden="true">→</span></a>
      </section>

      <section id="agents" className="guide-section" aria-labelledby="guide-agents-title">
        <header className="guide-section-header">
          <span className="guide-section-number" aria-hidden="true">02</span>
          <div>
            <h2 id="guide-agents-title">{content.agents.title}</h2>
            <p>{content.agents.description}</p>
          </div>
        </header>
        <aside className="guide-callout">
          <h3>{content.agents.access.title}</h3>
          <p>{content.agents.access.body}</p>
        </aside>
        <GuideSteps items={content.agents.steps} />

        <h3 id="guide-fields-title" className="guide-subheading">{content.agents.fieldsTitle}</h3>
        <div className="guide-table-wrap" tabIndex={0} role="region" aria-labelledby="guide-fields-title">
          <table className="guide-table">
            <thead><tr>{content.agents.fieldHeaders.map((label) => <th key={label} scope="col">{label}</th>)}</tr></thead>
            <tbody>
              {content.agents.fields.map((field) => <tr key={field.field}><th scope="row"><code>{field.field}</code></th><td>{field.required}</td><td>{field.description}</td></tr>)}
            </tbody>
          </table>
        </div>

        <CodeExample key={`${locale}-json`} kind="json" title={content.agents.jsonTitle} description={content.agents.jsonDescription} code={examples.json} copy={content.copy} />
        <CodeExample key={`${locale}-curl`} kind="curl" title={content.agents.curlTitle} description={content.agents.curlDescription} code={examples.curl} copy={content.copy} />

        <h3 className="guide-subheading">{content.agents.rulesTitle}</h3>
        <dl className="guide-rules">
          {content.agents.rules.map((item) => <div key={item.title}><dt>{item.title}</dt><dd>{item.body}</dd></div>)}
        </dl>

        <h3 id="guide-status-title" className="guide-subheading">{content.agents.statusTitle}</h3>
        <div className="guide-table-wrap" tabIndex={0} role="region" aria-labelledby="guide-status-title">
          <table className="guide-table guide-status-table">
            <thead><tr>{content.agents.statusHeaders.map((label) => <th key={label} scope="col">{label}</th>)}</tr></thead>
            <tbody>{content.agents.statuses.map((status) => <tr key={status.code}><th scope="row"><code>{status.code}</code></th><td>{status.description}</td></tr>)}</tbody>
          </table>
        </div>

        <h3 className="guide-subheading">{content.agents.resourcesTitle}</h3>
        <div className="guide-resources">
          {content.agents.resources.map((resource) => (
            <a key={resource.href} href={resource.href}>
              <strong>{resource.label}<span aria-hidden="true">↗</span></strong>
              <span>{resource.description}</span>
              <code>{resource.href}</code>
            </a>
          ))}
        </div>
      </section>

      <section id="faq" className="guide-section" aria-labelledby="guide-faq-title">
        <header className="guide-section-header">
          <span className="guide-section-number" aria-hidden="true">03</span>
          <h2 id="guide-faq-title">{content.faq.title}</h2>
        </header>
        <dl className="guide-faq">
          {content.faq.items.map((item) => <div key={item.title}><dt>{item.title}</dt><dd>{item.body}</dd></div>)}
        </dl>
      </section>
    </main>
  );
}
