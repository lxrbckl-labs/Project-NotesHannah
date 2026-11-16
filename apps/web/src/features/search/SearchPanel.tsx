import { Search } from "lucide-react";
import { type KeyboardEvent, useEffect, useRef, useState } from "react";
import { Link } from "react-router";
import { inputClass } from "../../components/ui/field";
import { ErrorState, LoadingList } from "../../components/ui/states";
import { cn } from "../../lib/cn";
import { NodeIcon } from "../library/NodeIcon";
import { nodeTitle } from "../library/NodeRow";
import { useSearch } from "../library/queries";

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
  const list = useRef<HTMLUListElement>(null);

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
          <ul ref={list} onKeyDown={onListKey} className="grid gap-1.5" aria-label="Results">
            {query.data.map(({ node, snippet }) => (
              <li key={node.id}>
                <Link
                  to={`/library/${node.id}`}
                  onClick={onPick}
                  className="flex min-h-14 items-center gap-3 rounded-2xl border border-transparent px-2.5 py-2 hover:border-border hover:bg-surface-muted focus-visible:bg-surface-muted"
                >
                  <span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-accent-soft text-accent">
                    <NodeIcon kind={node.kind} section={node.section} size={18} />
                  </span>
                  <span className="min-w-0">
                    <span className="block truncate font-medium">{nodeTitle(node)}</span>
                    <span className="block truncate text-sm text-text-muted">{snippet}</span>
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
