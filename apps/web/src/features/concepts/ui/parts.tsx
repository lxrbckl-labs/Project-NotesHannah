import type { Citation, CitationStatus, ConceptSummary, ConceptType, Inline } from "@notes/schema";
import { CONCEPT_TYPE_INFO, citationKey } from "@notes/schema";
import { Search, X } from "lucide-react";
import { Fragment, type ReactNode, useEffect, useId, useState } from "react";
import { Badge } from "../../../components/ui/badge";
import { IconButton } from "../../../components/ui/button";
import { Card as SharedCard } from "../../../components/ui/card";
import { inputClass } from "../../../components/ui/field";
import { cn } from "../../../lib/cn";
import { CONCEPT_TYPE_HUE } from "../../../lib/roles";
import { useConcepts } from "./context";
import { useDebounced } from "./hooks";

/** The concept's type in its hue; the words always say it, the colour only helps. */
export function TypeBadge({ type, className }: { type: ConceptType; className?: string }) {
  return (
    <Badge hue={CONCEPT_TYPE_HUE[type]} className={cn("shrink-0", className)}>
      {CONCEPT_TYPE_INFO[type].label}
    </Badge>
  );
}

/** A source chip (K2): tapping opens the cited page with the quote highlighted. */
export function CiteChip({
  citation,
  number,
  status = "available",
}: {
  citation: Citation;
  number?: number;
  status?: CitationStatus;
}) {
  const { openSource } = useConcepts();
  const deleted = status === "source_deleted";
  const text = citation.label ?? (number ? `Source ${number}` : "Source");
  return (
    <button
      type="button"
      data-testid="cite-chip"
      data-status={status}
      disabled={deleted}
      title={deleted ? "This source was deleted" : citation.quote}
      aria-label={`${text}${status === "source_trashed" ? " (source is in the trash)" : ""}${deleted ? " (source deleted)" : ""}: ${citation.quote}`}
      onClick={(event) => {
        event.stopPropagation();
        openSource({ fileId: citation.fileId, pageId: citation.pageId, quote: citation.quote });
      }}
      className={cn(
        "hit-area inline-flex max-w-full items-center truncate rounded-pill border px-2 py-px align-baseline text-caption font-medium transition-colors duration-(--duration-instant)",
        deleted
          ? "border-border bg-surface-muted text-text-muted line-through"
          : "border-transparent bg-accent-soft text-accent hover:border-accent",
        status === "source_trashed" && "border-dashed border-border-strong",
      )}
    >
      {text}
    </button>
  );
}

export function CiteList({
  citations,
  statuses,
}: {
  citations: Citation[];
  statuses?: Map<string, CitationStatus>;
}) {
  if (citations.length === 0) return null;
  return (
    <span className="inline-flex flex-wrap items-center gap-1.5">
      {citations.map((c, i) => (
        <CiteChip
          key={citationKey(c)}
          citation={c}
          number={i + 1}
          status={statuses?.get(citationKey(c))}
        />
      ))}
    </span>
  );
}

/** A concept name that opens its page. */
export function ConceptLink({
  id,
  children,
  className,
}: {
  id: string;
  children: ReactNode;
  className?: string;
}) {
  const { openConcept } = useConcepts();
  return (
    <a
      href={`/concepts/${id}`}
      onClick={(event) => {
        if (event.metaKey || event.ctrlKey || event.shiftKey || event.button !== 0) return;
        event.preventDefault();
        openConcept(id);
      }}
      className={cn(
        "font-medium text-text underline decoration-border-strong underline-offset-4 hover:decoration-accent",
        className,
      )}
    >
      {children}
    </a>
  );
}

/** Summary rich text: marks, source chips and mentions that link to their concept. */
export function RichSummary({
  text,
  citations,
  statuses,
}: {
  text: Inline[];
  citations: Citation[];
  statuses?: Map<string, CitationStatus>;
}) {
  return (
    <p className="text-body leading-relaxed text-text">
      {text.map((item, i) => {
        const key = i;
        if ("cite" in item) {
          const c = citations[item.cite - 1];
          return c ? (
            <Fragment key={key}>
              {" "}
              <CiteChip citation={c} number={item.cite} status={statuses?.get(citationKey(c))} />
            </Fragment>
          ) : null;
        }
        if ("concept" in item)
          return (
            <ConceptLink key={key} id={item.concept}>
              {item.text}
            </ConceptLink>
          );
        let node: ReactNode = item.text;
        if (item.bold) node = <strong>{node}</strong>;
        if (item.italic) node = <em>{node}</em>;
        return <Fragment key={key}>{node}</Fragment>;
      })}
    </p>
  );
}

/**
 * Search-as-you-type picker for one concept. Shows suggestions of the wanted types before she
 * types, so she can pick without knowing a name.
 */
export function ConceptPicker({
  label,
  types,
  onPick,
  placeholder,
  exclude = [],
}: {
  label: string;
  types?: ConceptType[];
  onPick: (concept: ConceptSummary) => void;
  placeholder?: string;
  exclude?: string[];
}) {
  const { store } = useConcepts();
  const [q, setQ] = useState("");
  const [items, setItems] = useState<ConceptSummary[] | null>(null);
  const [open, setOpen] = useState(false);
  const debounced = useDebounced(q, 150);
  const listId = useId();
  const typeKey = (types ?? []).join(",");
  // biome-ignore lint/correctness/useExhaustiveDependencies: typeKey stands for types
  useEffect(() => {
    if (!open) return;
    let live = true;
    const run = async () => {
      const wanted = types && types.length > 0 ? types : [undefined];
      const lists = await Promise.all(
        wanted.map((type) =>
          debounced.trim()
            ? store.search(debounced.trim(), { type, limit: 12 })
            : store.list({ type, limit: 12 }).then((r) => r.items),
        ),
      );
      if (live) setItems(lists.flat());
    };
    run().catch(() => live && setItems([]));
    return () => {
      live = false;
    };
  }, [debounced, open, store, typeKey]);

  const shown = (items ?? []).filter((c) => !exclude.includes(c.id)).slice(0, 12);
  return (
    <div className="relative">
      <label className="mb-1.5 block text-ui font-medium" htmlFor={`${listId}-in`}>
        {label}
      </label>
      <div className="relative">
        <Search
          size={16}
          className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-text-muted"
        />
        <input
          id={`${listId}-in`}
          role="combobox"
          aria-expanded={open}
          aria-controls={listId}
          aria-autocomplete="list"
          className={cn(inputClass, "pl-10")}
          value={q}
          placeholder={placeholder ?? "Type a name"}
          autoComplete="off"
          onFocus={() => setOpen(true)}
          onChange={(e) => {
            setQ(e.target.value);
            setOpen(true);
          }}
          onKeyDown={(e) => {
            if (e.key === "Escape") setOpen(false);
          }}
        />
      </div>
      {open ? (
        <ul
          id={listId}
          aria-label={`${label} suggestions`}
          className="absolute inset-x-0 z-(--z-sticky) mt-1.5 max-h-72 overflow-y-auto rounded-card border border-border bg-surface p-1.5 shadow-pop"
        >
          {items === null ? (
            <li className="px-3 py-2 text-ui text-text-muted">Looking…</li>
          ) : shown.length === 0 ? (
            <li className="px-3 py-2 text-ui text-text-muted">Nothing matches that.</li>
          ) : (
            shown.map((c) => (
              <li key={c.id}>
                <button
                  type="button"
                  data-testid="picker-option"
                  className="flex min-h-11 w-full items-center justify-between gap-2 rounded-control px-3 text-left text-ui hover:bg-surface-muted"
                  onClick={() => {
                    onPick(c);
                    setQ("");
                    setOpen(false);
                  }}
                >
                  <span className="truncate font-medium">{c.name}</span>
                  <TypeBadge type={c.type} />
                </button>
              </li>
            ))
          )}
          <li className="sr-only">
            <button type="button" onClick={() => setOpen(false)}>
              Close suggestions
            </button>
          </li>
        </ul>
      ) : null}
    </div>
  );
}

/** A removable chip (a chosen drug). The shared Chip is a button, so this stays local. */
export function Chip({
  children,
  onRemove,
  removeLabel,
}: {
  children: ReactNode;
  onRemove?: () => void;
  removeLabel?: string;
}) {
  return (
    <span className="inline-flex min-h-9 items-center gap-1 rounded-pill border border-border bg-surface-muted pl-3 pr-1 text-label font-medium">
      {children}
      {onRemove ? (
        <IconButton
          size="sm"
          label={removeLabel ?? "Remove"}
          onClick={onRemove}
          className="rounded-pill"
        >
          <X size={14} />
        </IconButton>
      ) : (
        <span className="pr-2" />
      )}
    </span>
  );
}

export function Card({ className, children }: { className?: string; children: ReactNode }) {
  return (
    <SharedCard as="section" className={className}>
      {children}
    </SharedCard>
  );
}
