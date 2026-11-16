import { BLOCK_REGISTRY, type BlockType } from "@notes/schema";
import {
  BookMarked,
  Brain,
  CheckSquare,
  Heading2,
  Image,
  List,
  ListOrdered,
  MapPin,
  Minus,
  Pill,
  Quote,
  Sparkle,
  Table,
  TableProperties,
  Type,
} from "lucide-react";
import { type ReactNode, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { INSERTABLE_TYPES } from "../model/gestures";
import { cx, Sheet } from "../ui/primitives";

const META: Partial<Record<BlockType, { icon: ReactNode; hint: string; words: string }>> = {
  paragraph: { icon: <Type />, hint: "Plain text", words: "text p" },
  heading: { icon: <Heading2 />, hint: "Section title", words: "h title section" },
  bulleted_list: { icon: <List />, hint: "Points", words: "bullet ul" },
  numbered_list: { icon: <ListOrdered />, hint: "Steps in order", words: "ol steps" },
  checklist: { icon: <CheckSquare />, hint: "Things to do", words: "todo task check" },
  callout: {
    icon: <BookMarked />,
    hint: "Tip, warning, definition…",
    words: "note tip warning definition exam",
  },
  quote: { icon: <Quote />, hint: "A quoted passage", words: "blockquote" },
  divider: { icon: <Minus />, hint: "Section break", words: "hr line rule" },
  table: { icon: <Table />, hint: "Rows and columns", words: "grid" },
  drug_card: { icon: <Pill />, hint: "Class, uses, doses…", words: "drug medicine card" },
  comparison_table: {
    icon: <TableProperties />,
    hint: "Drugs side by side",
    words: "compare versus",
  },
  mnemonic: { icon: <Sparkle />, hint: "Memory aid", words: "memory acronym" },
  mind_map: { icon: <Brain />, hint: "Tree of ideas", words: "map tree" },
  image: { icon: <Image />, hint: "A page from your uploads", words: "picture photo page" },
  labelled_image: { icon: <MapPin />, hint: "Image with labels", words: "hotspot diagram label" },
};

export function filterTypes(query: string): BlockType[] {
  const q = query.trim().toLowerCase();
  if (!q) return INSERTABLE_TYPES;
  return INSERTABLE_TYPES.filter((type) => {
    const label = BLOCK_REGISTRY[type].label.toLowerCase();
    return label.includes(q) || type.includes(q) || (META[type]?.words ?? "").includes(q);
  });
}

export interface InsertMenuState {
  blockId: string | null;
  replace: boolean;
  anchor: DOMRect | null;
  query: string;
  source: "slash" | "plus";
}

/**
 * The "/" menu and the "+" menu: every block type she can add. Typing
 * filters; arrows and Enter choose (from the editor for "/", from the search
 * field for "+"). On a phone "+" opens as a sheet.
 */
export function InsertMenu({
  state,
  onChoose,
  onClose,
  keyHandler,
  sheet,
}: {
  state: InsertMenuState;
  onChoose: (type: BlockType) => void;
  onClose: () => void;
  keyHandler: { current: ((key: string) => boolean) | null };
  sheet: boolean;
}) {
  const [search, setSearch] = useState("");
  const query = state.source === "slash" ? state.query : search;
  const items = useMemo(() => filterTypes(query), [query]);
  const [index, setIndex] = useState(0);
  const panel = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{
    top: number;
    left: number;
    maxHeight: number;
    width?: number;
  } | null>(null);

  // biome-ignore lint/correctness/useExhaustiveDependencies: reset on a new query
  useEffect(() => setIndex(0), [query]);

  const handle = (key: string): boolean => {
    if (key === "ArrowDown") setIndex((i) => (items.length ? (i + 1) % items.length : 0));
    else if (key === "ArrowUp")
      setIndex((i) => (items.length ? (i - 1 + items.length) % items.length : 0));
    else if (key === "Enter") {
      const type = items[index];
      if (type) onChoose(type);
      else onClose();
    } else if (key === "Escape") onClose();
    else return false;
    return true;
  };

  useEffect(() => {
    keyHandler.current = handle;
    return () => {
      if (keyHandler.current === handle) keyHandler.current = null;
    };
  });

  useLayoutEffect(() => {
    if (sheet) return;
    const anchor =
      state.anchor ??
      document.querySelector(`[data-block-id="${state.blockId}"]`)?.getBoundingClientRect() ??
      null;
    if (!anchor) return;
    const vv = window.visualViewport;
    const vh = vv?.height ?? window.innerHeight;
    const width = Math.min(300, window.innerWidth - 24);
    if (window.innerWidth < 768 && state.source === "slash") {
      // On a phone the line being typed must stay in view: the menu docks above the format bar
      // (and the keyboard), short, and the line scrolls into the space left above it.
      const maxHeight = Math.min(232, Math.round(vh * 0.34));
      const dockTop = (vv?.offsetTop ?? 0) + vh - 64 - maxHeight;
      setPos({ top: dockTop, left: 12, maxHeight, width: window.innerWidth - 24 });
      requestAnimationFrame(() => {
        const block = document.querySelector(`[data-block-id="${state.blockId}"]`);
        if (!block) return;
        const delta = block.getBoundingClientRect().bottom - (dockTop - 16);
        if (delta <= 0) return;
        let scroller: HTMLElement | null = block.parentElement;
        while (scroller && !/(auto|scroll)/.test(getComputedStyle(scroller).overflowY)) {
          scroller = scroller.parentElement;
        }
        (scroller ?? document.scrollingElement)?.scrollBy({ top: delta, behavior: "instant" });
      });
      return;
    }
    const below = vh - anchor.bottom - 12;
    const above = anchor.top - 12;
    const placeBelow = below >= 260 || below >= above;
    const maxHeight = Math.max(160, Math.min(360, placeBelow ? below : above));
    const left = Math.max(12, Math.min(anchor.left, window.innerWidth - width - 12));
    const top = placeBelow ? anchor.bottom + 6 : anchor.top - 6 - maxHeight;
    setPos({ top, left, maxHeight });
  }, [state.anchor, state.blockId, state.source, sheet]);

  useEffect(() => {
    panel.current?.querySelector(`[data-index="${index}"]`)?.scrollIntoView({ block: "nearest" });
  }, [index]);

  // Close on a press outside.
  useEffect(() => {
    if (sheet) return;
    const onDown = (event: PointerEvent) => {
      if (!panel.current?.contains(event.target as Node)) onClose();
    };
    window.addEventListener("pointerdown", onDown, true);
    return () => window.removeEventListener("pointerdown", onDown, true);
  }, [onClose, sheet]);

  const list = (
    <div role="listbox" aria-label="Block types" className="flex flex-col gap-0.5 p-1.5">
      {items.length === 0 && (
        <p className="px-3 py-2 text-[13.5px] text-text-muted">No block called “{query}”</p>
      )}
      {items.map((type, i) => (
        <div
          key={type}
          role="option"
          aria-selected={i === index}
          data-index={i}
          tabIndex={-1}
          data-testid={`insert-${type}`}
          onMouseDown={(e) => e.preventDefault()}
          onMouseEnter={() => setIndex(i)}
          onClick={() => onChoose(type)}
          onKeyDown={() => {}}
          className={cx(
            "flex min-h-11 cursor-pointer items-center gap-3 rounded-xl px-2.5 py-1.5",
            i === index ? "bg-surface-muted" : "",
          )}
        >
          <span
            aria-hidden
            className="flex size-8 shrink-0 items-center justify-center rounded-lg border border-border bg-surface text-text-muted [&_svg]:size-4"
          >
            {META[type]?.icon}
          </span>
          <span className="min-w-0">
            <span className="block text-[14px] font-medium">{BLOCK_REGISTRY[type].label}</span>
            <span className="block truncate text-[12.5px] text-text-muted">{META[type]?.hint}</span>
          </span>
        </div>
      ))}
    </div>
  );

  const searchField =
    state.source === "plus" ? (
      <div className="border-b border-border p-2">
        <input
          // biome-ignore lint/a11y/noAutofocus: the menu was opened to type into
          autoFocus={!sheet}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          onKeyDown={(e) => {
            if (handle(e.key)) e.preventDefault();
          }}
          aria-label="Find a block type"
          placeholder="Find a block…"
          className="w-full rounded-lg bg-surface-muted px-3 py-2 text-[14px] outline-none placeholder:text-text-muted"
        />
      </div>
    ) : null;

  if (sheet) {
    return (
      <Sheet
        open
        onOpenChange={(open) => !open && onClose()}
        title="Add a block"
        side="bottom"
        testId="insert-menu"
      >
        {searchField}
        {list}
      </Sheet>
    );
  }
  if (!pos) return null;
  return createPortal(
    <div
      ref={panel}
      data-testid="insert-menu"
      className="doc-portal doc-root doc-anim-pop fixed z-50 flex w-[min(300px,calc(100vw-24px))] flex-col overflow-hidden rounded-2xl border border-border bg-surface text-text shadow-[var(--doc-pop-shadow)]"
      style={{
        top: pos.top,
        left: pos.left,
        maxHeight: pos.maxHeight,
        ...(pos.width ? { width: pos.width } : {}),
      }}
    >
      {searchField}
      <div className="min-h-0 overflow-y-auto">{list}</div>
    </div>,
    document.body,
  );
}
