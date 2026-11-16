import { cx } from "../ui/primitives";

export interface OutlineItem {
  id: string;
  level: 1 | 2 | 3;
  text: string;
  /** Unverified blocks in this section. */
  unverified: number;
}

/** The document's headings as a navigable outline (D13), the current section highlighted. */
export function OutlinePanel({
  items,
  current,
  onJump,
}: {
  items: OutlineItem[];
  current: string | null;
  onJump: (id: string) => void;
}) {
  if (items.length === 0)
    return (
      <p className="px-5 py-4 text-sm text-text-muted">Add headings to see an outline here.</p>
    );
  return (
    <nav aria-label="Outline" data-testid="outline">
      <ol className="m-0 flex list-none flex-col gap-0.5 p-2">
        {items.map((item) => {
          const active = item.id === current;
          return (
            <li key={item.id}>
              <button
                type="button"
                aria-current={active ? "location" : undefined}
                onClick={() => onJump(item.id)}
                className={cx(
                  "group flex min-h-9 w-full items-center gap-2 rounded-xl py-1.5 pr-2 text-left text-[14px] leading-snug transition-colors pointer-coarse:min-h-11",
                  item.level === 1
                    ? "pl-2.5 font-semibold"
                    : item.level === 2
                      ? "pl-2.5"
                      : "pl-6 text-[13.5px]",
                  active
                    ? "bg-[var(--doc-blue-bg)] font-medium text-[var(--doc-blue-fg)]"
                    : "text-text-muted hover:bg-surface-muted hover:text-text",
                )}
              >
                <span
                  aria-hidden
                  className={cx(
                    "h-4 w-0.5 shrink-0 rounded-full transition-colors",
                    active ? "bg-[var(--doc-blue-solid)]" : "bg-transparent",
                  )}
                />
                <span className="min-w-0 flex-1 truncate">{item.text || "Untitled section"}</span>
                {item.unverified > 0 && (
                  <span
                    className="rounded-full bg-[var(--doc-yellow-bg)] px-1.5 text-[11px] font-semibold text-[var(--doc-yellow-fg)] tabular-nums"
                    title={`${item.unverified} to review`}
                  >
                    <span className="sr-only">, to review: </span>
                    {item.unverified}
                  </span>
                )}
              </button>
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
