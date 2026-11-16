import { BookOpen, Download, Printer } from "lucide-react";
import { Link } from "react-router";
import { buttonClass } from "../../components/ui/button";
import { PageHeader } from "../../components/ui/page-header";
import {
  GUIDE_BYLINE,
  GUIDE_HEADING,
  GUIDE_PDF_NAME,
  GUIDE_PDF_PATH,
  GUIDE_TITLE,
} from "./content";
import { CONTENTS, GuideBody } from "./GuideBody";
import { GuideToc } from "./GuideToc";
import "./guide.css";

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

/** The guide inside the app: a readable column with a contents list beside or above it. */
export function GuidePage() {
  return (
    <div className="guide-doc mx-auto w-full max-w-6xl px-4 pb-10 pt-4 md:px-8 md:pt-8">
      <PageHeader
        title={GUIDE_TITLE}
        description={`Your guide to Notes. ${GUIDE_BYLINE}`}
        icon={<BookOpen />}
        actions={
          <span className="guide-noprint contents">
            <DownloadPdf />
            <button
              type="button"
              onClick={() => window.print()}
              className={buttonClass({ variant: "secondary" })}
            >
              <Printer size={16} aria-hidden />
              Print
            </button>
          </span>
        }
      />
      <div className="xl:grid xl:grid-cols-[14rem_minmax(0,1fr)] xl:gap-10">
        <GuideToc />
        <article className="min-w-0 max-w-3xl">
          <GuideBody />
        </article>
      </div>
    </div>
  );
}

/**
 * The guide on its own, with no sign-in and no app around it. The PDF script opens this page
 * (`/help/print`). It holds no personal data: only the words in content.ts.
 */
export function GuidePrintPage() {
  return (
    <div className="guide-doc guide-print-page min-h-dvh bg-bg text-text">
      <div className="mx-auto max-w-3xl px-6 py-8">
        <header className="mb-8">
          <h1 className="font-display text-display font-semibold">{GUIDE_HEADING}</h1>
          <p className="mt-1 text-body text-text-muted">{GUIDE_BYLINE}</p>
        </header>
        <nav
          aria-label="Contents"
          className="guide-contents mb-10 rounded-card border border-border p-4"
        >
          <h2 className="mb-2 font-display text-title font-semibold">On this page</h2>
          <ol className="grid gap-1 text-ui">
            {CONTENTS.map((item) => (
              <li key={item.id}>
                <a href={`#${item.id}`}>{item.title}</a>
              </li>
            ))}
          </ol>
        </nav>
        <GuideBody />
        <p className="mt-10 text-caption text-text-muted print:hidden">
          <Link to="/help">Open this guide in the app</Link>
        </p>
      </div>
    </div>
  );
}
