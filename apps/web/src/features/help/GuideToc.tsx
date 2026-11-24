import { ChevronDown, ListTree } from "lucide-react";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { cn } from "../../lib/cn";
import { QUICK_REFERENCE_ID, QUICK_REFERENCE_TITLE, SHOWCASE_TITLE } from "./content";
import { ANCHORS, OUTLINE, SHOWCASE_ID } from "./outline";

function Item({
  id,
  title,
  number,
  active,
  onPick,
}: {
  id: string;
  title: string;
  number?: number | undefined;
  active: boolean;
  onPick?: (() => void) | undefined;
}) {
  return (
    <li>
      <a
        href={`#${id}`}
        onClick={onPick}
        aria-current={active ? "location" : undefined}
        className={cn(
          // The highlight behind the current item is one marker that slides (see List), not a fill here.
          "relative flex min-h-11 items-baseline gap-2 rounded-control py-2.5 pr-2 pl-3 text-ui leading-snug transition-colors duration-(--duration-base) xl:min-h-0 xl:py-1.5",
          active
            ? "font-medium text-accent"
            : "text-text-muted hover:bg-surface-muted hover:text-text",
        )}
      >
        {number ? (
          <span className="w-5 shrink-0 text-right font-display text-label tabular-nums opacity-80">
            {number}
          </span>
        ) : null}
        <span className="min-w-0">{title}</span>
      </a>
    </li>
  );
}

/** The contents grouped by part, with the current section marked. */
function List({ active, onPick }: { active?: string | undefined; onPick?: () => void }) {
  const box = useRef<HTMLDivElement>(null);
  const marker = useRef<HTMLSpanElement>(null);

  // One highlight for the whole list: it slides and resizes to sit behind the current item, and
  // the list scrolls itself (never the page) to keep that item in view.
  // biome-ignore lint/correctness/useExhaustiveDependencies: re-measure when the current item changes
  useLayoutEffect(() => {
    const list = box.current;
    const mark = marker.current;
    if (!list || !mark) return;
    const place = () => {
      const item = list.querySelector<HTMLElement>('a[aria-current="location"]');
      if (!item) {
        mark.style.opacity = "0";
        return;
      }
      const top = item.getBoundingClientRect().top - list.getBoundingClientRect().top;
      mark.style.opacity = "1";
      mark.style.transform = `translateY(${top}px)`;
      mark.style.height = `${item.offsetHeight}px`;
      const scroller = list.closest("nav");
      if (scroller && scroller.scrollHeight > scroller.clientHeight) {
        const frame = scroller.getBoundingClientRect();
        const row = item.getBoundingClientRect();
        const margin = 48;
        const delta =
          row.top < frame.top + margin
            ? row.top - frame.top - margin
            : row.bottom > frame.bottom - margin
              ? row.bottom - frame.bottom + margin
              : 0;
        if (delta) scroller.scrollBy?.({ top: delta, behavior: "smooth" });
      }
    };
    place();
    const watch = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(place);
    watch?.observe(list);
    return () => watch?.disconnect();
  }, [active]);

  return (
    <div ref={box} className="relative grid gap-3">
      <span
        ref={marker}
        aria-hidden
        data-testid="guide-toc-marker"
        className="guide-toc-marker pointer-events-none absolute inset-x-0 top-0 rounded-control bg-accent-soft opacity-0"
      >
        <span className="absolute inset-y-1.5 left-0 w-0.5 rounded-pill bg-accent" />
      </span>
      <ul className="grid gap-0.5">
        <Item
          id={SHOWCASE_ID}
          title={SHOWCASE_TITLE}
          active={active === SHOWCASE_ID}
          onPick={onPick}
        />
      </ul>
      {OUTLINE.map(({ part, sections }) => (
        <div key={part.id}>
          <p className="mb-1 px-3 text-caption font-semibold tracking-wide text-text-muted uppercase">
            {part.label} · {part.title}
          </p>
          <ol className="grid gap-0.5">
            {sections.map(({ section, number }) => (
              <Item
                key={section.id}
                id={section.id}
                title={section.title}
                number={number}
                active={active === section.id}
                onPick={onPick}
              />
            ))}
          </ol>
        </div>
      ))}
      <ul className="grid gap-0.5">
        <Item
          id={QUICK_REFERENCE_ID}
          title={QUICK_REFERENCE_TITLE}
          active={active === QUICK_REFERENCE_ID}
          onPick={onPick}
        />
      </ul>
    </div>
  );
}

/** Beside the guide on a computer: sticky, grouped by part, following the reader. */
export function GuideTocWide({ active }: { active?: string | undefined }) {
  return (
    <nav
      aria-label="On this page, side list"
      className="guide-toc-wide sticky top-6 hidden max-h-[calc(100dvh-3rem)] self-start overflow-y-auto rounded-card border border-border bg-surface p-3 shadow-card xl:block"
    >
      <h2 className="mb-3 px-3 pt-1 font-sans text-caption font-semibold tracking-wide text-text-muted uppercase">
        On this page
      </h2>
      <List active={active} />
    </nav>
  );
}

/**
 * Above the guide on a phone or tablet: a slim bar that stays at the top while reading, showing the
 * current section. Tapping it opens the whole list.
 */
export function GuideTocNarrow({ active }: { active?: string | undefined }) {
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  const current = ANCHORS.find((a) => a.id === active) ?? ANCHORS[0];

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    const onPointer = (event: PointerEvent) => {
      if (box.current && !box.current.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("keydown", onKey);
    document.addEventListener("pointerdown", onPointer);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("pointerdown", onPointer);
    };
  }, [open]);

  return (
    <div
      ref={box}
      className="guide-toc-narrow sticky top-0 z-(--z-sticky) -mx-4 mb-6 bg-linear-to-b from-bg from-60% to-transparent px-4 pt-2 pb-3 md:-mx-8 md:px-8 xl:hidden"
    >
      <div className="rounded-card border border-border bg-(--color-chrome) shadow-card backdrop-blur">
        <button
          type="button"
          aria-expanded={open}
          aria-controls="guide-toc-panel"
          onClick={() => setOpen((v) => !v)}
          className="flex min-h-11 w-full items-center gap-2.5 px-3 text-left"
        >
          <ListTree size={18} aria-hidden className="shrink-0 text-accent" />
          <span className="shrink-0 text-label font-medium text-text-muted">On this page</span>
          {/* Keyed by section, so each new title slides in as the reader moves on. */}
          <span
            key={current?.id}
            className="guide-current-in min-w-0 flex-1 truncate text-ui font-medium"
            data-testid="guide-current"
          >
            {current?.number ? `${current.number}. ` : ""}
            {current?.title}
          </span>
          <ChevronDown
            size={18}
            aria-hidden
            className={cn(
              "shrink-0 text-text-muted transition-transform duration-(--duration-fast)",
              open && "rotate-180",
            )}
          />
        </button>
        {open ? (
          <nav
            id="guide-toc-panel"
            aria-label="On this page"
            className="max-h-[min(70dvh,32rem)] overflow-y-auto border-t border-border px-1 py-2"
          >
            <List active={active} onPick={() => setOpen(false)} />
          </nav>
        ) : null}
      </div>
    </div>
  );
}
