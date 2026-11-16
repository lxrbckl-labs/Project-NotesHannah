import {
  BadgeCheck,
  Blocks as BlocksIcon,
  CalendarClock,
  GraduationCap,
  History,
  Info,
  Lightbulb,
  Lock,
  MessageSquarePlus,
  Network,
  PenLine,
  ShieldCheck,
  Workflow,
} from "lucide-react";
import { Fragment, type ReactNode } from "react";
import { cn } from "../../lib/cn";
import type { Tone } from "../../lib/hues";
import type { FigureId, GuideBlock, GuideTable } from "./content";

/**
 * The building blocks of the guide, shared by the page in the app and the print booklet. The page's
 * look is in the Tailwind classes; the booklet restyles the same markup through the gb-* class names
 * in guide-print.css (unlayered CSS there wins over Tailwind's utilities).
 */

/** **bold** and `keys` inside a string. */
export function Inline({ text }: { text: string }) {
  const parts = text.split(/(\*\*[^*]+\*\*|`[^`]+`)/g);
  return (
    <>
      {parts.map((part, i) => {
        const key = `${i}-${part}`;
        if (part.startsWith("**")) return <strong key={key}>{part.slice(2, -2)}</strong>;
        if (part.startsWith("`")) return <Kbd key={key}>{part.slice(1, -1)}</Kbd>;
        return <Fragment key={key}>{part}</Fragment>;
      })}
    </>
  );
}

/** A key, drawn as a key: a raised cap with a firmer bottom edge. */
export function Kbd({ children }: { children: ReactNode }) {
  return (
    <kbd className="gb-kbd guide-kbd mx-px inline-block whitespace-pre rounded-inline border border-border-strong border-b-2 bg-surface px-1.5 py-px align-baseline font-mono text-[0.82em] leading-snug text-text shadow-[inset_0_-1px_0_var(--color-surface-muted)]">
      {children}
    </kbd>
  );
}

const NOTE = {
  tip: { icon: Lightbulb, hue: "teal", label: "Tip" },
  limit: { icon: Info, hue: "yellow", label: "Good to know" },
} as const;

export function Note({
  tone,
  title,
  text,
}: {
  tone: "tip" | "limit";
  title?: string | undefined;
  text: string;
}) {
  const note = NOTE[tone];
  const Icon = note.icon;
  return (
    <aside
      data-hue={note.hue}
      data-guide-note={tone}
      className="gb-note guide-note flex items-start gap-3 rounded-card border border-tone-border border-l-4 border-l-tone-solid bg-tone-soft py-3 pr-4 pl-3.5 text-ui"
    >
      <span
        aria-hidden
        className="gb-note-icon mt-px flex size-7 shrink-0 items-center justify-center rounded-full bg-surface text-tone-text"
      >
        <Icon size={16} />
      </span>
      <div className="min-w-0">
        <p className="gb-note-title font-semibold text-tone-text">{title ?? note.label}</p>
        <p className="mt-0.5 text-text">
          <Inline text={text} />
        </p>
      </div>
    </aside>
  );
}

export function Table({ table, className }: { table: GuideTable; className?: string }) {
  return (
    <div
      className={cn(
        "gb-table guide-table-wrap overflow-x-auto rounded-card border border-border bg-surface",
        className,
      )}
      data-rows={table.rows.length}
      data-keys={table.keys ? "true" : undefined}
    >
      <table className="w-full border-collapse text-left text-ui">
        <thead className="bg-accent-soft text-accent">
          <tr>
            {table.head.map((h) => (
              <th key={h} scope="col" className="px-3 py-2 text-label font-semibold">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {table.rows.map((row) => (
            <tr
              key={row.join("|")}
              className="border-t border-border align-top even:bg-surface-muted/50"
            >
              {row.map((cell, i) => (
                <td
                  key={table.head[i] ?? cell}
                  className={cn("px-3 py-2", i === 0 && "font-medium whitespace-normal")}
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
}

function List({ items, ordered }: { items: string[]; ordered?: boolean | undefined }) {
  if (ordered) {
    return (
      <ol className="gb-steps grid gap-3">
        {items.map((item, i) => (
          <li key={item} className="flex gap-3">
            <span
              aria-hidden
              className="gb-step-num mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-full bg-accent font-display text-label font-semibold text-accent-contrast"
            >
              {i + 1}
            </span>
            <span className="min-w-0">
              <Inline text={item} />
            </span>
          </li>
        ))}
      </ol>
    );
  }
  return (
    <ul className="gb-list grid gap-2">
      {items.map((item) => (
        <li key={item} className="relative pl-5">
          <span
            aria-hidden
            className="gb-bullet absolute top-[0.7em] left-1 size-1.5 rounded-full bg-accent"
          />
          <Inline text={item} />
        </li>
      ))}
    </ul>
  );
}

const blockKey = (block: GuideBlock): string =>
  block.kind === "list"
    ? `list-${block.items[0]}`
    : block.kind === "table"
      ? `table-${block.head.join("-")}-${block.rows[0]?.[0]}`
      : block.kind === "figure"
        ? `figure-${block.id}`
        : `${block.kind}-${block.text}`;

/** The blocks of one section. Figures are drawn by the caller, which knows where it is shown. */
export function Blocks({
  blocks,
  figure,
}: {
  blocks: GuideBlock[];
  figure: (id: FigureId) => ReactNode;
}) {
  return (
    <>
      {blocks.map((block) => (
        <Fragment key={blockKey(block)}>{renderBlock(block, figure)}</Fragment>
      ))}
    </>
  );
}

function renderBlock(block: GuideBlock, figure: (id: FigureId) => ReactNode): ReactNode {
  switch (block.kind) {
    case "p":
      return (
        <p className="gb-p">
          <Inline text={block.text} />
        </p>
      );
    case "h3":
      return (
        <h3 className="gb-h3 guide-h3 mt-4 font-display text-title font-semibold">{block.text}</h3>
      );
    case "list":
      return <List items={block.items} ordered={block.ordered} />;
    case "table":
      return <Table table={block} />;
    case "note":
      return <Note tone={block.tone} title={block.title} text={block.text} />;
    case "figure":
      return figure(block.id);
  }
}

/** An icon and a calm colour for each showcase card, in the order of SHOWCASE. */
export const SHOWCASE_LOOK: { icon: typeof Lock; hue: Tone }[] = [
  { icon: BadgeCheck, hue: "green" },
  { icon: PenLine, hue: "blue" },
  { icon: BlocksIcon, hue: "purple" },
  { icon: Workflow, hue: "teal" },
  { icon: Network, hue: "pink" },
  { icon: GraduationCap, hue: "orange" },
  { icon: CalendarClock, hue: "red" },
  { icon: MessageSquarePlus, hue: "blue" },
  { icon: ShieldCheck, hue: "green" },
  { icon: History, hue: "brown" },
  { icon: Lock, hue: "gray" },
];
