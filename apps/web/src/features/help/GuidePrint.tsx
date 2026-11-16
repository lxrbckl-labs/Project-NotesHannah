import { useLayoutEffect } from "react";
import { Link } from "react-router";
import {
  GUIDE_BYLINE,
  GUIDE_HEADING,
  GUIDE_SUBTITLE,
  INTRO,
  QUICK_REFERENCE_ID,
  QUICK_REFERENCE_LEAD,
  QUICK_REFERENCE_TITLE,
  SHOWCASE,
  SHOWCASE_LEAD,
  SHOWCASE_TITLE,
} from "./content";
import { Blocks } from "./GuideBlocks";
import { PrintFigure } from "./GuideFigure";
import { AppMark, QuickReferenceCard, ShowcaseCard } from "./GuideParts";
import { OUTLINE, type OutlinePart, type OutlineSection, pad, SHOWCASE_ID } from "./outline";
import "./guide.css";
import "./guide-print.css";

/**
 * The guide as a printed booklet, at `/help/print`: no sign-in, no app shell, no API calls. The PDF
 * script (tools/guide-pdf.mjs) prints this page. Each section is a CSS named page (`gp-s3` and so
 * on), so the running header can name the part and section; the cover and the part pages have no
 * margins, so they print to the edge. Contents page numbers are filled in by the script: it prints
 * once, reads which page each heading landed on, writes the numbers into the `data-page-of` spans
 * and prints again.
 */

/** A string for CSS `content`. */
const cssString = (text: string) => `"${text.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;

const HEAD = `font-family: system-ui, -apple-system, "Segoe UI", sans-serif; font-size: 7.5pt; color: #75736a; letter-spacing: 0.02em;`;
const FOOT = `font-family: system-ui, -apple-system, "Segoe UI", sans-serif; font-size: 8pt; color: #75736a;`;

function marginBoxes(left: string, right: string) {
  return `
    margin: 0.9in 0.85in 0.85in;
    @top-left { content: ${cssString(left)}; ${HEAD} vertical-align: bottom; padding-bottom: 16pt; }
    @top-right { content: ${cssString(right)}; ${HEAD} vertical-align: bottom; padding-bottom: 16pt; }
    @bottom-left { content: ${cssString(GUIDE_HEADING)}; ${FOOT} vertical-align: top; padding-top: 16pt; }
    @bottom-right { content: counter(page); ${FOOT} font-weight: 600; color: #2f6f5e; vertical-align: top; padding-top: 16pt; }`;
}

/** The running heads: one named page per section, plus the showcase and the quick reference. */
export const PAGE_RULES = [
  `@page gp-showcase { ${marginBoxes("Before you begin", SHOWCASE_TITLE)} }`,
  `@page gp-qr { ${marginBoxes("Keep this", QUICK_REFERENCE_TITLE)} }`,
  ...OUTLINE.flatMap(({ part, sections }) =>
    sections.map(
      ({ section, number }) =>
        `@page gp-s${number} { ${marginBoxes(`${part.label} · ${part.title}`, `${number}  ${section.title}`)} }\n.gp #${section.id} { page: gp-s${number}; }`,
    ),
  ),
].join("\n");

/** The month and year this copy was printed. */
export function edition(date = new Date()) {
  return date.toLocaleString("en-US", { month: "long", year: "numeric" });
}

/** A page number for the contents, written in by the PDF script. Empty in the browser. */
function PageOf({ id }: { id: string }) {
  return <span className="gp-pageno" data-page-of={id} />;
}

function Cover() {
  return (
    <section className="gp-cover" aria-label="Cover">
      <div className="gp-cover-dots" aria-hidden />
      <div className="gp-cover-top">
        <AppMark className="gp-cover-mark" size={22} />
        <span className="gp-cover-name">Notes</span>
      </div>
      <div className="gp-cover-main">
        <p className="gp-cover-kicker">The guide</p>
        <h1 className="gp-cover-title">{GUIDE_HEADING}</h1>
        <p className="gp-cover-sub">{GUIDE_SUBTITLE}</p>
        <p className="gp-cover-by">{GUIDE_BYLINE}</p>
      </div>
      <p className="gp-cover-edition">
        <span>Edition</span> {edition()}
      </p>
    </section>
  );
}

function ContentsLine({
  id,
  number,
  title,
  strong,
}: {
  id: string;
  number?: string | undefined;
  title: string;
  strong?: boolean;
}) {
  return (
    <li className={strong ? "gp-toc-line gp-toc-strong" : "gp-toc-line"}>
      <a href={`#${id}`}>
        <span className="gp-toc-num">{number ?? ""}</span>
        <span className="gp-toc-title">{title}</span>
        <span className="gp-toc-dots" aria-hidden />
        <PageOf id={id} />
      </a>
    </li>
  );
}

function Contents() {
  return (
    <section className="gp-front" aria-labelledby="gp-contents-title">
      <p className="gp-kicker">Welcome</p>
      <div className="gp-intro">
        {INTRO.map((p) => (
          <p key={p}>{p}</p>
        ))}
      </div>
      <h2 id="gp-contents-title" className="gp-front-title">
        Contents
      </h2>
      <nav aria-label="Contents" className="gp-toc">
        <ol>
          <ContentsLine id={SHOWCASE_ID} title={SHOWCASE_TITLE} strong />
        </ol>
        {OUTLINE.map(({ part, sections }) => (
          <div key={part.id} className="gp-toc-part">
            <p className="gp-toc-partlabel">
              <a href={`#${part.id}`}>
                {part.label} · <strong>{part.title}</strong>
              </a>
            </p>
            <ol>
              {sections.map(({ section, number }) => (
                <ContentsLine
                  key={section.id}
                  id={section.id}
                  number={String(number)}
                  title={section.title}
                />
              ))}
            </ol>
          </div>
        ))}
        <ol>
          <ContentsLine id={QUICK_REFERENCE_ID} title={QUICK_REFERENCE_TITLE} strong />
        </ol>
      </nav>
    </section>
  );
}

function ShowcasePages() {
  const first = SHOWCASE.slice(0, 5);
  const rest = SHOWCASE.slice(5);
  return (
    <section id={SHOWCASE_ID} className="gp-showcase" aria-labelledby={`${SHOWCASE_ID}-title`}>
      <div className="gp-showcase-page">
        <p className="gp-kicker">Before you begin</p>
        <h2 id={`${SHOWCASE_ID}-title`} className="gp-title">
          {SHOWCASE_TITLE}
        </h2>
        <p className="gp-lead">{SHOWCASE_LEAD}</p>
        <ul className="gp-cards">
          {first.map((item, i) => (
            <ShowcaseCard key={item.title} item={item} index={i} featured={i === 0} />
          ))}
        </ul>
      </div>
      <div className="gp-showcase-page">
        <ul className="gp-cards">
          {rest.map((item, i) => (
            <ShowcaseCard key={item.title} item={item} index={i + 5} />
          ))}
        </ul>
      </div>
    </section>
  );
}

function PartPage({ part, number, sections }: OutlinePart) {
  return (
    <section id={part.id} className="gp-part" aria-labelledby={`${part.id}-title`}>
      <div className="gp-part-dots" aria-hidden />
      <p className="gp-part-num" aria-hidden>
        {number}
      </p>
      <div className="gp-part-main">
        <p className="gp-kicker">{part.label}</p>
        <h2 id={`${part.id}-title`} className="gp-part-title">
          {part.title}
        </h2>
        <p className="gp-part-lead">{part.lead}</p>
        <ol className="gp-part-list">
          {sections.map(({ section, number: n }) => (
            <li key={section.id}>
              <a href={`#${section.id}`}>
                <span className="gp-part-list-num">{pad(n)}</span>
                <span className="gp-toc-title">{section.title}</span>
                <span className="gp-toc-dots" aria-hidden />
                <PageOf id={section.id} />
              </a>
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}

function SectionPages({ section, number, part }: OutlineSection) {
  return (
    <section id={section.id} className="gp-section" aria-labelledby={`${section.id}-title`}>
      <header className="gp-opener">
        <p className="gp-opener-num" aria-hidden>
          {pad(number)}
        </p>
        <div>
          <p className="gp-kicker">
            {part.label} · {part.title}
          </p>
          <h2 id={`${section.id}-title`} className="gp-opener-title">
            {section.title}
          </h2>
          <p className="gp-opener-lead">{section.lead}</p>
        </div>
      </header>
      <div className="gp-body">
        <Blocks blocks={section.blocks} figure={(id) => <PrintFigure id={id} />} />
      </div>
    </section>
  );
}

function QuickReferencePage() {
  return (
    <section
      id={QUICK_REFERENCE_ID}
      className="gp-quickref"
      aria-labelledby={`${QUICK_REFERENCE_ID}-title`}
    >
      <div className="gp-qr-head">
        <AppMark className="gp-qr-mark" size={16} />
        <div>
          <p className="gp-kicker">Keep this</p>
          <h2 id={`${QUICK_REFERENCE_ID}-title`} className="gp-title">
            {QUICK_REFERENCE_TITLE}
          </h2>
        </div>
      </div>
      <p className="gp-lead">{QUICK_REFERENCE_LEAD}</p>
      <QuickReferenceCard />
    </section>
  );
}

/** The whole guide as a booklet. */
/**
 * The running-head rules are built from the section titles, so they cannot live in the CSS file. The
 * server's content policy refuses a <style> element, so they are added as a stylesheet object instead,
 * which the policy allows, and taken away again when the page is left.
 */
function usePageRules() {
  useLayoutEffect(() => {
    if (typeof CSSStyleSheet === "undefined" || !("replaceSync" in CSSStyleSheet.prototype)) return;
    const sheet = new CSSStyleSheet();
    sheet.replaceSync(PAGE_RULES);
    document.adoptedStyleSheets = [...document.adoptedStyleSheets, sheet];
    return () => {
      document.adoptedStyleSheets = document.adoptedStyleSheets.filter((s) => s !== sheet);
    };
  }, []);
}

export function GuidePrintPage() {
  usePageRules();
  return (
    <div className="guide-doc gp">
      <Cover />
      <Contents />
      <ShowcasePages />
      {OUTLINE.map((part) => (
        <div key={part.part.id} className="gp-part-group">
          <PartPage {...part} />
          {part.sections.map((s) => (
            <SectionPages key={s.section.id} {...s} />
          ))}
        </div>
      ))}
      <QuickReferencePage />
      <p className="gp-screen-only">
        <Link to="/help">Open this guide in the app</Link>
      </p>
    </div>
  );
}
