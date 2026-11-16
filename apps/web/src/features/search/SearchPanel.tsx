import type { SearchHit } from "@notes/schema";
import { FileText, HelpCircle, Pill, Search, TextQuote } from "lucide-react";
import { type KeyboardEvent, useEffect, useRef, useState } from "react";
import { Link } from "react-router";
import { inputClass } from "../../components/ui/field";
import { ErrorState, LoadingList } from "../../components/ui/states";
import { cn } from "../../lib/cn";
import { NodeIcon } from "../library/NodeIcon";
import { nodeTitle } from "../library/NodeRow";
import { useSearch } from "../library/queries";
import { nodeHref } from "../library/rules";

const GROUPS: Array<{ kind: SearchHit["kind"]; title: string }> = [
  { kind: "node", title: "In your library" },
  { kind: "concept", title: "Concepts" },
  { kind: "block", title: "In your study material" },
  { kind: "question", title: "Practice questions" },
  { kind: "page", title: "In your transcripts" },
  { kind: "question", title: "In your practice questions" },
  { kind: "concept", title: "Drugs and concepts" },
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
  }
}

/** Where a hit opens: a library item, a page of a source file (with the match marked), a block of a document. */
export function hitHref(hit: SearchHit, q: string): string {
  if (hit.kind === "node") return nodeHref(hit.node);
  if (hit.kind === "page") {
    return `/files/${hit.fileId}?page=${hit.pageId}&quote=${encodeURIComponent(q)}`;
  }
  if (hit.kind === "block") return `/doc/${hit.nodeId}?block=${hit.blockId}`;
  if (hit.kind === "question") {
    return hit.nodeId ? `/library/${hit.nodeId}?question=${hit.questionId}` : "/practice";
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
  const title =
    hit.kind === "node"
      ? nodeTitle(hit.node)
      : hit.kind === "page"
        ? `${hit.fileName}, page ${hit.pageIndex}`
        : hit.kind === "block"
          ? hit.documentTitle
          : hit.kind === "question"
            ? "Practice question"
            : hit.name;
  return (
    <Link
      to={hitHref(hit, q)}
      onClick={onPick}
      className="flex min-h-14 items-center gap-3 rounded-2xl border border-transparent px-2.5 py-2 hover:border-border hover:bg-surface-muted focus-visible:bg-surface-muted"
    >
      <span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-accent-soft text-accent">
        {hit.kind === "node" ? (
          <NodeIcon kind={hit.node.kind} section={hit.node.section} size={18} />
        ) : hit.kind === "page" ? (
          <FileText size={18} aria-hidden />
        ) : hit.kind === "block" ? (
          <TextQuote size={18} aria-hidden />
        ) : hit.kind === "question" ? (
          <HelpCircle size={18} aria-hidden />
        ) : (
          <Pill size={18} aria-hidden />
        )}
      </span>
      <span className="min-w-0">
        <span className="block truncate font-medium">{title}</span>
        <span className="block truncate text-sm text-text-muted">{hit.snippet}</span>
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
          <p className="px-1 text-sm text-text-muted">
            Type to search the names of everything in your library.
          </p>
        ) : query.isPending ? (
          <LoadingList rows={3} label="Searching" />
        ) : query.isError ? (
          <ErrorState error={query.error} onRetry={() => query.refetch()} />
        ) : query.data.length === 0 ? (
          <p className="px-1 text-sm text-text-muted">Nothing matches “{debounced}”.</p>
        ) : (
          // biome-ignore lint/a11y/noStaticElementInteractions: arrow keys move between the result links
          <div ref={list} onKeyDown={onListKey} className="grid gap-4">
            {GROUPS.map(({ kind, title }) => {
              const hits = query.data.filter((h) => h.kind === kind);
              if (hits.length === 0) return null;
              return (
                <section key={kind} aria-label={title} data-testid={`results-${kind}`}>
                  <h3 className="mb-1.5 px-1 font-sans text-xs font-semibold uppercase tracking-wide text-text-muted">
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
          </div>
        )}
      </div>
    </div>
  );
}
