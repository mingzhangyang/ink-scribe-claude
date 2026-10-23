import { useEffect } from "react";
import { LEGAL_CONTENT, type LegalPageId } from "../../shared/legal.ts";
import { linkProps } from "../router.ts";
import { usePreferences } from "../state/preferences.ts";
import "../styles/legal.css";

function legalLinkProps(href: string) {
  // These internal links retain an in-progress editor session when navigating.
  return href.startsWith("/") && !href.startsWith("/api/") ? linkProps(href) : { href };
}

export function LegalPage({ page }: { page: LegalPageId }) {
  const locale = usePreferences((state) => state.locale);
  const content = LEGAL_CONTENT[locale][page];

  useEffect(() => {
    document.title = content.documentTitle;
  }, [content.documentTitle]);

  useEffect(() => {
    // Section IDs are identical across languages. Locale changes must leave an
    // open preferences menu in place, so only restore anchors when arriving.
    const section = window.location.hash.slice(1);
    if (LEGAL_CONTENT.zh[page].sections.some((item) => item.id === section)) {
      document.getElementById(section)?.scrollIntoView();
    }
  }, [page]);

  return (
    <main className="legal-page" data-legal-page={page}>
      <header className="legal-hero">
        <p className="legal-updated">{content.updatedLabel} <time dateTime={content.updatedDate}>{content.updatedDate}</time></p>
        <h1>{content.title}</h1>
        <p className="legal-lead">{content.description}</p>
      </header>

      <nav className="legal-toc" aria-label={content.tocLabel}>
        <h2>{content.tocLabel}</h2>
        <ol>
          {content.sections.map((section) => <li key={section.id}><a href={`#${section.id}`}>{section.title}</a></li>)}
        </ol>
      </nav>

      <div className="legal-body">
        {content.sections.map((section, index) => (
          <section id={section.id} className="legal-section" key={section.id} aria-labelledby={`legal-${page}-${section.id}`}>
            <h2 id={`legal-${page}-${section.id}`}><span className="legal-section-number" aria-hidden="true">{String(index + 1).padStart(2, "0")}</span>{section.title}</h2>
            {section.paragraphs.map((paragraph) => <p key={paragraph}>{paragraph}</p>)}
            {section.items ? <ul>{section.items.map((item) => <li key={item}>{item}</li>)}</ul> : null}
            {section.links ? <div className="legal-links">{section.links.map((link) => <a key={link.href} {...legalLinkProps(link.href)}>{link.label}<span aria-hidden="true"> ↗</span></a>)}</div> : null}
          </section>
        ))}
      </div>

      <nav className="legal-related" aria-label={content.relatedTitle}>
        <h2>{content.relatedTitle}</h2>
        <div>{content.relatedLinks.map((link) => <a key={link.href} {...legalLinkProps(link.href)}>{link.label}<span aria-hidden="true"> →</span></a>)}</div>
      </nav>
    </main>
  );
}
