import { ChevronDown } from "lucide-react";
import { CONTENTS } from "./GuideBody";

function List() {
  return (
    <ol className="grid gap-0.5 text-ui">
      {CONTENTS.map((item) => (
        <li key={item.id}>
          <a
            href={`#${item.id}`}
            className="flex min-h-11 items-center rounded-control px-2 text-text-muted hover:bg-surface-muted hover:text-text xl:min-h-8"
          >
            {item.title}
          </a>
        </li>
      ))}
    </ol>
  );
}

/** Sticky at the side on wide screens; a collapsible list at the top on narrow ones. */
export function GuideToc() {
  return (
    <>
      <details className="guide-toc-narrow mb-8 rounded-card border border-border bg-surface px-4 py-1 xl:hidden">
        <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between font-medium">
          On this page
          <ChevronDown size={18} aria-hidden />
        </summary>
        <nav aria-label="On this page" className="pb-2">
          <List />
        </nav>
      </details>
      <nav
        aria-label="On this page, side list"
        className="guide-toc-wide sticky top-6 hidden max-h-[calc(100dvh-3rem)] self-start overflow-y-auto xl:block"
      >
        <h2 className="mb-2 px-2 font-sans text-caption font-semibold uppercase tracking-wide text-text-muted">
          On this page
        </h2>
        <List />
      </nav>
    </>
  );
}
