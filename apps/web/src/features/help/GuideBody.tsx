import { Info, Lightbulb, Wrench } from "lucide-react";
import { Fragment, type ReactNode } from "react";
import { cn } from "../../lib/cn";
import {
  type GuideBlock,
  type GuideSection,
  INTRO,
  SECTIONS,
  SHOWCASE,
  SHOWCASE_LEAD,
  SHOWCASE_TITLE,
} from "./content";

export const SHOWCASE_ID = "what-makes-this-different";

/** The ids and titles in reading order, for the contents list. */
export const CONTENTS: { id: string; title: string }[] = [
  { id: SHOWCASE_ID, title: SHOWCASE_TITLE },
  ...SECTIONS.map((s) => ({ id: s.id, title: s.title })),
];

/** **bold** and `keys` inside a string. */
export function Inline({ text }: { text: string }) {
  const parts = text.split(/(\*\*[^*]+\*\*|`[^`]+`)/g);
  return (
    <>
      {parts.map((part, i) => {
        const key = `${i}-${part}`;
        if (part.startsWith("**")) return <strong key={key}>{part.slice(2, -2)}</strong>;
        if (part.startsWith("`")) {
          return (
            <kbd
              key={key}
              className="guide-kbd whitespace-nowrap rounded-inline border border-border-strong bg-bg px-1.5 py-0.5 font-mono text-[0.85em]"
            >
              {part.slice(1, -1)}
            </kbd>
          );
        }
        return <Fragment key={key}>{part}</Fragment>;
      })}
    </>
  );
}

const NOTE = {
  tip: { icon: <Lightbulb size={18} />, hue: "teal", label: "Tip" },
  limit: { icon: <Info size={18} />, hue: "yellow", label: "Good to know" },
  stub: { icon: <Wrench size={18} />, hue: "purple", label: "Coming" },
} as const;

const blockKey = (block: GuideBlock): string =>
  block.kind === "list"
    ? `list-${block.items[0]}`
    : block.kind === "table"
      ? `table-${block.head.join("-")}-${block.rows[0]?.[0]}`
      : `${block.kind}-${block.text}`;

function Block({ block }: { block: GuideBlock }): ReactNode {
  switch (block.kind) {
    case "p":
      return (
        <p>
          <Inline text={block.text} />
        </p>
      );
    case "h3":
      return <h3 className="guide-h3 mt-4 font-display text-title font-semibold">{block.text}</h3>;
    case "list": {
      const Tag = block.ordered ? "ol" : "ul";
      return (
        <Tag className={cn("grid gap-2 pl-6", block.ordered ? "list-decimal" : "list-disc")}>
          {block.items.map((item) => (
            <li key={item} className="pl-1">
              <Inline text={item} />
            </li>
          ))}
        </Tag>
      );
    }
    case "table":
      return (
        <div className="guide-table-wrap overflow-x-auto rounded-card border border-border">
          <table className="w-full border-collapse text-left text-ui">
            <thead className="bg-surface-muted">
              <tr>
                {block.head.map((h) => (
                  <th key={h} scope="col" className="px-3 py-2 font-semibold">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {block.rows.map((row) => (
                <tr key={row.join("|")} className="border-t border-border align-top">
                  {row.map((cell, i) => (
                    <td
                      key={block.head[i] ?? cell}
                      className={cn("px-3 py-2", i === 0 && "font-medium")}
                    >
                      <Inline text={cell} />
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );
    case "note": {
      const note = NOTE[block.tone];
      return (
        <aside
          data-hue={note.hue}
          data-guide-note={block.tone}
          className="guide-note flex items-start gap-3 rounded-card border border-tone-border bg-tone-soft px-4 py-3 text-ui"
        >
          <span aria-hidden className="mt-0.5 shrink-0 text-tone-text">
            {note.icon}
          </span>
          <div className="min-w-0">
            <p className="font-semibold">{block.title ?? note.label}</p>
            <p className="mt-0.5">
              <Inline text={block.text} />
            </p>
          </div>
        </aside>
      );
    }
  }
}

function Section({ section, index }: { section: GuideSection; index: number }) {
  return (
    <section
      id={section.id}
      aria-labelledby={`${section.id}-title`}
      className="guide-section scroll-mt-4"
    >
      <h2
        id={`${section.id}-title`}
        className="guide-h2 font-display text-heading font-semibold md:text-display"
      >
        <span className="mr-2 text-text-muted">{index + 1}.</span>
        {section.title}
      </h2>
      {section.lead ? (
        <p className="guide-lead mt-1 text-body text-text-muted">{section.lead}</p>
      ) : null}
      <div className="prose-reading mt-4 grid gap-4">
        {section.blocks.map((block) => (
          <Block key={blockKey(block)} block={block} />
        ))}
      </div>
    </section>
  );
}

function Showcase() {
  return (
    <section
      id={SHOWCASE_ID}
      aria-labelledby={`${SHOWCASE_ID}-title`}
      className="guide-section scroll-mt-4"
    >
      <h2
        id={`${SHOWCASE_ID}-title`}
        className="guide-h2 font-display text-heading font-semibold md:text-display"
      >
        {SHOWCASE_TITLE}
      </h2>
      <p className="guide-lead mt-1 text-body text-text-muted">{SHOWCASE_LEAD}</p>
      <ul className="guide-showcase mt-4 grid gap-3 md:grid-cols-2">
        {SHOWCASE.map((item) => (
          <li
            key={item.title}
            className="guide-card rounded-card border border-accent-border bg-accent-soft p-4"
          >
            <h3 className="font-display text-title font-semibold">{item.title}</h3>
            <p className="mt-1.5 text-ui">{item.what}</p>
            <p className="mt-2 text-ui text-text-muted">
              <span className="font-semibold text-text">Why it matters: </span>
              {item.why}
            </p>
          </li>
        ))}
      </ul>
    </section>
  );
}

/** Intro text, the showcase band and every section. Shared by the in-app page and the PDF page. */
export function GuideBody() {
  return (
    <div className="grid gap-10">
      <div className="prose-reading grid gap-3">
        {INTRO.map((p) => (
          <p key={p}>{p}</p>
        ))}
      </div>
      <Showcase />
      {SECTIONS.map((section, i) => (
        <Section key={section.id} section={section} index={i} />
      ))}
    </div>
  );
}
