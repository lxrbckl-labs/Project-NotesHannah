import { practice, type SearchHit } from "@notes/schema";
import {
  BookMarked,
  CircleHelp,
  FileText,
  Globe,
  Lightbulb,
  MessageSquareText,
  Search,
  TextQuote,
} from "lucide-react";
import { type KeyboardEvent, useEffect, useRef, useState } from "react";
import { Link } from "react-router";
import { inputClass } from "../../components/ui/field";
import { ErrorState, LoadingList } from "../../components/ui/states";
import { cn } from "../../lib/cn";
import { CONCEPT_TYPE_HUE } from "../../lib/roles";
import { useCourseHue } from "../library/courseHue";
import { NodeIcon } from "../library/NodeIcon";
import { nodeTitle } from "../library/NodeRow";
import { useSearch } from "../library/queries";
import { nodeHref } from "../library/rules";
import { ExternalLink } from "../references/ExternalLink";
import { PHARMGUIDES, pharmGuidesSearch } from "../references/registry";

// One group per kind: a kind listed twice would show its hits twice, under the same React key.
const GROUPS: Array<{ kind: SearchHit["kind"]; title: string }> = [
  { kind: "node", title: "In your library" },
  { kind: "concept", title: "Drugs and concepts" },
  { kind: "reference", title: "Your saved references" },
  { kind: "block", title: "In your study material" },
  { kind: "margin_note", title: "In your side notes" },
  { kind: "question", title: "In your practice questions" },
  { kind: "page", title: "In your transcripts" },
];

function hitKey(hit: SearchHit): string {
  switch (hit.kind) {
    case "node":
      return hit.node.id;
    case "page":
      return hit.pageId;
    case "block":
      return hit.blockId;
    case "question":
      return hit.questionId;
    case "concept":
      return hit.conceptId;
    case "reference":
      return hit.referenceId;
    case "margin_note":
      return hit.noteId;
  }
}

/** Where a hit opens: a library item, a page of a source file (with the match marked), a block of a document. */
export function hitHref(hit: Exclude<SearchHit, { kind: "reference" }>, q: string): string {
  if (hit.kind === "node") return nodeHref(hit.node);
  if (hit.kind === "page") {
    return `/files/${hit.fileId}?page=${hit.pageId}&quote=${encodeURIComponent(q)}`;
  }
  if (hit.kind === "block") return `/doc/${hit.nodeId}?block=${hit.blockId}`;
  // A side note opens its document with the Notes panel on that note.
  if (hit.kind === "margin_note")
    return `/doc/${hit.nodeId}?block=${hit.blockId}&note=${hit.noteId}`;
  if (hit.kind === "question") {
    return `/question/${hit.questionId}`;
  }
  return `/concepts/${hit.conceptId}`;
}

function HitLink({
  hit,
  q,
  onPick,
}: {
  hit: SearchHit;
  q: string;
  onPick: (() => void) | undefined;
}) {
  if (hit.kind === "reference") return <ReferenceHit hit={hit} onPick={onPick} />;
  return <AppHitLink hit={hit} q={q} onPick={onPick} />;
}

const rowClass =
  "flex min-h-14 items-center gap-3 rounded-card border border-transparent px-2.5 py-2 hover:border-border hover:bg-surface-muted focus-visible:bg-surface-muted";

/** A saved reference opens its page outside the app, in a new tab. */
function ReferenceHit({
  hit,
  onPick,
}: {
  hit: Extract<SearchHit, { kind: "reference" }>;
  onPick: (() => void) | undefined;
}) {
  return (
    <ExternalLink href={hit.url} icon={false} onClick={onPick} data-hue="teal" className={rowClass}>
      <span className="flex size-9 shrink-0 items-center justify-center rounded-control bg-tone-soft text-tone-text">
        <BookMarked size={18} aria-hidden />
      </span>
      <span className="min-w-0">
        <span className="block truncate font-medium">{hit.title}</span>
        <span className="block truncate text-ui text-text-muted">{hit.snippet}</span>
      </span>
    </ExternalLink>
  );
}

/** Below every result list: the same words on PharmGuides, in a new tab. */
function OutsideSearch({ q, onPick }: { q: string; onPick: (() => void) | undefined }) {
  return (
    <ExternalLink
      href={pharmGuidesSearch(q)}
      onClick={onPick}
      data-testid="search-pharmguides"
      className="mt-3 flex min-h-11 items-center gap-2.5 rounded-card border border-border bg-surface px-3 py-2 text-ui hover:bg-surface-muted"
    >
      <Globe size={16} aria-hidden className="shrink-0 text-text-muted" />
      <span className="min-w-0 flex-1 truncate">
        Search {PHARMGUIDES.name} for “{q}”
      </span>
    </ExternalLink>
  );
}

function AppHitLink({
  hit,
  q,
  onPick,
}: {
  hit: Exclude<SearchHit, { kind: "reference" }>;
  q: string;
  onPick: (() => void) | undefined;
}) {
  const courseColour = useCourseHue(hit.kind === "node" ? hit.node : undefined);
  const hue =
    hit.kind === "node"
      ? courseColour
      : hit.kind === "concept"
        ? CONCEPT_TYPE_HUE[hit.conceptType]
        : null;
  const title =
    hit.kind === "node"
      ? nodeTitle(hit.node)
      : hit.kind === "page"
        ? `${hit.fileName}, page ${hit.pageIndex}`
        : hit.kind === "block"
          ? hit.documentTitle
          : hit.kind === "margin_note"
            ? `Side note · ${hit.documentTitle}`
            : hit.kind === "question"
              ? "Practice question"
              : hit.name;
  return (
    <Link
      to={hitHref(hit, q)}
      onClick={onPick}
      data-hue={hue ?? (hit.kind === "node" ? "gray" : "accent")}
      className={rowClass}
    >
      <span className="flex size-9 shrink-0 items-center justify-center rounded-control bg-tone-soft text-tone-text">
        {hit.kind === "node" ? (
          <NodeIcon kind={hit.node.kind} section={hit.node.section} size={18} />
        ) : hit.kind === "page" ? (
          <FileText size={18} aria-hidden />
        ) : hit.kind === "block" ? (
          <TextQuote size={18} aria-hidden />
        ) : hit.kind === "margin_note" ? (
          <MessageSquareText size={18} aria-hidden />
        ) : hit.kind === "question" ? (
          <CircleHelp size={18} aria-hidden />
        ) : (
          <Lightbulb size={18} aria-hidden />
        )}
      </span>
      <span className="min-w-0">
        <span className="block truncate font-medium">{title}</span>
        <span className="block truncate text-ui text-text-muted">
          {hit.kind === "question" ? practice.blanksAsGaps(hit.snippet) : hit.snippet}
        </span>
      </span>
    </Link>
  );
}

function useDebounced<T>(value: T, ms: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const id = setTimeout(() => setDebounced(value), ms);
    return () => clearTimeout(id);
  }, [value, ms]);
  return debounced;
}

/** A search field and its results: the node-name search used by the Search tab and quick-find. */
export function SearchPanel({
  onPick,
  autoFocus,
  initialQuery = "",
  onQueryChange,
}: {
  onPick?: () => void;
  autoFocus?: boolean;
  initialQuery?: string;
  onQueryChange?: (q: string) => void;
}) {
  const [q, setQ] = useState(initialQuery);
  const debounced = useDebounced(q.trim(), 200);
  const query = useSearch(debounced);
  const list = useRef<HTMLDivElement>(null);

  function onKeyDown(event: KeyboardEvent) {
    const links = list.current?.querySelectorAll<HTMLAnchorElement>("a");
    if (event.key === "ArrowDown") {
      event.preventDefault();
      links?.[0]?.focus();
    } else if (event.key === "Enter" && links?.[0]) {
      links[0].click();
    }
  }

  function onListKey(event: KeyboardEvent) {
    const links = Array.from(list.current?.querySelectorAll<HTMLAnchorElement>("a") ?? []);
    const index = links.indexOf(document.activeElement as HTMLAnchorElement);
    if (event.key === "ArrowDown") {
      event.preventDefault();
      links[Math.min(index + 1, links.length - 1)]?.focus();
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      if (index <= 0)
        (event.currentTarget.parentElement?.querySelector("input") as HTMLElement | null)?.focus();
      else links[index - 1]?.focus();
    }
  }

  return (
    <div>
      <div className="relative">
        <Search
          size={18}
          aria-hidden
          className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-text-muted"
        />
        <input
          type="search"
          aria-label="Search your library"
          // biome-ignore lint/a11y/noAutofocus: the dialog exists to type a search
          autoFocus={autoFocus}
          placeholder="Search courses, lectures, folders"
          value={q}
          onChange={(e) => {
            setQ(e.target.value);
            onQueryChange?.(e.target.value);
          }}
          onKeyDown={onKeyDown}
          enterKeyHint="search"
          className={cn(inputClass, "pl-10")}
        />
      </div>

      <div className="mt-4" aria-live="polite">
        {debounced === "" ? (
          <p className="px-1 text-ui text-text-muted">
            Type to search the names of everything in your library.
          </p>
        ) : query.isPending ? (
          <LoadingList rows={3} label="Searching" />
        ) : query.isError ? (
          <ErrorState error={query.error} onRetry={() => query.refetch()} />
        ) : query.data.length === 0 ? (
          // biome-ignore lint/a11y/noStaticElementInteractions: arrow keys move between the result links
          <div ref={list} onKeyDown={onListKey}>
            <p className="px-1 text-ui text-text-muted">Nothing matches “{debounced}”.</p>
            <OutsideSearch q={debounced} onPick={onPick} />
          </div>
        ) : (
          // biome-ignore lint/a11y/noStaticElementInteractions: arrow keys move between the result links
          <div ref={list} onKeyDown={onListKey} className="grid gap-4">
            {GROUPS.map(({ kind, title }) => {
              const hits = query.data.filter((h) => h.kind === kind);
              if (hits.length === 0) return null;
              return (
                <section key={kind} aria-label={title} data-testid={`results-${kind}`}>
                  <h3 className="mb-1.5 px-1 font-sans text-caption font-semibold uppercase tracking-wide text-text-muted">
                    {title}
                  </h3>
                  <ul className="grid gap-1.5" aria-label={title}>
                    {hits.map((hit) => (
                      <li key={hitKey(hit)}>
                        <HitLink hit={hit} q={debounced} onPick={onPick} />
                      </li>
                    ))}
                  </ul>
                </section>
              );
            })}
            <OutsideSearch q={debounced} onPick={onPick} />
          </div>
        )}
      </div>
    </div>
  );
}
