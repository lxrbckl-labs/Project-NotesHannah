import { Download, Keyboard } from "lucide-react";
import { buttonClass } from "../../components/ui/button";
import {
  GUIDE_BYLINE,
  GUIDE_HEADING,
  GUIDE_PDF_NAME,
  GUIDE_PDF_PATH,
  GUIDE_SUBTITLE,
  GUIDE_TITLE,
  INTRO,
  QUICK_REFERENCE_ID,
  QUICK_REFERENCE_LEAD,
  QUICK_REFERENCE_TITLE,
  SHOWCASE,
  SHOWCASE_LEAD,
  SHOWCASE_TITLE,
} from "./content";
import { Blocks } from "./GuideBlocks";
import { GuideFigure } from "./GuideFigure";
import { AppMark, QuickReferenceCard, ShowcaseCard } from "./GuideParts";
import { GuideTocNarrow, GuideTocWide } from "./GuideToc";
import {
  ANCHORS,
  OUTLINE,
  type OutlinePart,
  type OutlineSection,
  pad,
  SHOWCASE_ID,
} from "./outline";
import { useActiveSection } from "./useActiveSection";
import "./guide.css";

export { GuidePrintPage } from "./GuidePrint";

/** The download link. A plain link to a static file, so it works without scripts. */
export function DownloadPdf({ className }: { className?: string }) {
  return (
    <a
      href={GUIDE_PDF_PATH}
      download={GUIDE_PDF_NAME}
      className={buttonClass({ variant: "primary", className })}
    >
      <Download size={16} aria-hidden />
      Download PDF
    </a>
  );
}

function Hero() {
  return (
    <header className="dot-grid relative mb-6 overflow-hidden rounded-panel border border-border bg-surface px-5 py-6 shadow-card md:px-8 md:py-8">
      <div className="flex items-center gap-2.5">
        <AppMark className="size-9" />
        <span className="font-display text-body font-semibold">Notes</span>
        <span className="text-label text-text-muted">· {GUIDE_TITLE}</span>
      </div>
      <h1 className="mt-5 font-display text-heading leading-tight font-semibold md:text-[2.5rem] md:leading-[1.1]">
        {GUIDE_HEADING}
      </h1>
      <p className="mt-2 max-w-prose text-body text-text-muted">{GUIDE_SUBTITLE}</p>
      <p className="mt-1 text-ui font-medium text-accent">{GUIDE_BYLINE}</p>
      <div className="guide-noprint mt-5 flex flex-wrap gap-2">
        <DownloadPdf />
        <a href={`#${QUICK_REFERENCE_ID}`} className={buttonClass({ variant: "secondary" })}>
          <Keyboard size={16} aria-hidden />
          Quick reference
        </a>
      </div>
    </header>
  );
}

function Showcase() {
  return (
    <section
      id={SHOWCASE_ID}
      aria-labelledby={`${SHOWCASE_ID}-title`}
      className="guide-section scroll-mt-20 xl:scroll-mt-6"
    >
      <p className="text-caption font-semibold tracking-wide text-accent uppercase">
        Before you begin
      </p>
      <h2
        id={`${SHOWCASE_ID}-title`}
        className="guide-h2 mt-1 font-display text-heading font-semibold md:text-display"
      >
        {SHOWCASE_TITLE}
      </h2>
      <p className="guide-lead mt-2 max-w-prose text-body text-text-muted">{SHOWCASE_LEAD}</p>
      <ul className="guide-showcase mt-6 grid gap-3 sm:grid-cols-2 md:gap-4">
        {SHOWCASE.map((item, i) => (
          <ShowcaseCard key={item.title} item={item} index={i} featured={i === 0} />
        ))}
      </ul>
    </section>
  );
}

function PartHeader({ part, number }: OutlinePart) {
  return (
    <div
      id={part.id}
      className="guide-part dot-grid scroll-mt-20 rounded-panel border border-accent-border bg-accent-soft px-5 py-6 md:px-8 xl:scroll-mt-6"
    >
      <p className="flex items-center gap-2 text-caption font-semibold tracking-wide text-accent uppercase">
        <span
          aria-hidden
          className="flex size-6 items-center justify-center rounded-full bg-accent font-display text-label text-accent-contrast"
        >
          {number}
        </span>
        {part.label}
      </p>
      <h2 className="mt-2 font-display text-heading font-semibold md:text-display">{part.title}</h2>
      <p className="mt-1 max-w-prose text-body text-text-muted">{part.lead}</p>
    </div>
  );
}

function Section({ section, number, part }: OutlineSection) {
  return (
    <section
      id={section.id}
      aria-labelledby={`${section.id}-title`}
      className="guide-section scroll-mt-20 xl:scroll-mt-6"
    >
      <header className="mb-6 border-b border-border pb-5">
        <div className="flex items-start gap-4 md:gap-5">
          <span
            aria-hidden
            className="guide-num font-display text-[2.5rem] leading-none font-semibold text-accent tabular-nums md:text-[3.25rem]"
          >
            {pad(number)}
          </span>
          <div className="min-w-0 pt-0.5">
            <p className="text-caption font-semibold tracking-wide text-text-muted uppercase">
              {part.label} · {part.title}
            </p>
            <h2
              id={`${section.id}-title`}
              className="guide-h2 mt-0.5 font-display text-title leading-snug font-semibold md:text-heading"
            >
              {section.title}
            </h2>
          </div>
        </div>
        <p className="guide-lead mt-3 max-w-prose text-body text-text-muted">{section.lead}</p>
      </header>
      <div className="gb-body flex max-w-[68ch] flex-col gap-4 text-body leading-relaxed md:text-reading md:leading-[1.7]">
        <Blocks blocks={section.blocks} figure={(id) => <GuideFigure id={id} />} />
      </div>
    </section>
  );
}

function QuickReference() {
  return (
    <section
      id={QUICK_REFERENCE_ID}
      aria-labelledby={`${QUICK_REFERENCE_ID}-title`}
      className="guide-section scroll-mt-20 xl:scroll-mt-6"
    >
      <p className="text-caption font-semibold tracking-wide text-accent uppercase">Keep this</p>
      <h2
        id={`${QUICK_REFERENCE_ID}-title`}
        className="guide-h2 mt-1 font-display text-heading font-semibold md:text-display"
      >
        {QUICK_REFERENCE_TITLE}
      </h2>
      <p className="guide-lead mt-2 mb-6 max-w-prose text-body text-text-muted">
        {QUICK_REFERENCE_LEAD}
      </p>
      <QuickReferenceCard />
    </section>
  );
}

const anchorIds = ANCHORS.map((a) => a.id);

/** The guide inside the app: a header, the contents beside or above, and the parts in order. */
export function GuidePage() {
  const active = useActiveSection(anchorIds);
  return (
    <div className="guide-doc guide-app mx-auto w-full max-w-6xl px-4 pt-4 pb-16 md:px-8 md:pt-8">
      <Hero />
      <GuideTocNarrow active={active} />
      <div className="xl:grid xl:grid-cols-[15rem_minmax(0,1fr)] xl:gap-12">
        <GuideTocWide active={active} />
        <article className="grid min-w-0 max-w-3xl gap-14">
          <div className="grid max-w-prose gap-3 text-body leading-relaxed md:text-reading">
            {INTRO.map((p) => (
              <p key={p}>{p}</p>
            ))}
          </div>
          <Showcase />
          {OUTLINE.map((part) => (
            <div key={part.part.id} className="grid gap-14">
              <PartHeader {...part} />
              {part.sections.map((s) => (
                <Section key={s.section.id} {...s} />
              ))}
            </div>
          ))}
          <QuickReference />
        </article>
      </div>
    </div>
  );
}
