import {
  ArrowDown,
  ArrowLeftToLine,
  ArrowRightToLine,
  ArrowUp,
  ChevronDown,
  GripVertical,
  X,
} from "lucide-react";
import { DropdownMenu } from "radix-ui";
import {
  createContext,
  Fragment,
  type ReactNode,
  use,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import { SideSlide } from "../../../../app/SideSlide";
import { IconButton } from "../../../../components/ui/button";
import {
  menuContentClass,
  menuItemClass,
  menuSeparatorClass,
} from "../../../../components/ui/menu";
import { Tooltip } from "../../../../components/ui/tooltip";
import { cn } from "../../../../lib/cn";
import {
  closePanel,
  DEFAULT_PANEL_SHARE,
  MIN_PANEL_HEIGHT,
  movePanel,
  movePanelBy,
  type PanelId,
  resetPanelSizes,
  SIDEBAR_WIDTH,
  type Side,
  setPanelSizes,
  setWidth,
  toggleFolded,
} from "./layout";
import type { DockApi } from "./useDock";

/** How a panel is shown: beside the page, or floating over it (an iPad held upright, a narrow window). */
export type PanelPlace = "docked" | "overlay";

export interface PanelDef {
  title: string;
  icon: ReactNode;
  /** Small extra in the header (a count). */
  badge?: ReactNode;
  /** A button or two at the header's end (the Notes panel's +). */
  actions?: ReactNode;
  render: (place: PanelPlace) => ReactNode;
}

/** A little longer than the fold in styles.css (.dock-panel). */
const FOLD_MS = 240;

const SIDE_NAME: Record<Side, string> = { left: "left", right: "right" };

interface DragState {
  id: PanelId;
  x: number;
  y: number;
  target: { side: Side; index: number } | null;
}

interface DockCtx {
  dock: DockApi;
  panels: Record<PanelId, PanelDef>;
  beginDrag: (id: PanelId, event: React.PointerEvent) => boolean;
  justDragged: () => boolean;
  dragging: PanelId | null;
}
const Ctx = createContext<DockCtx | null>(null);
const useDockCtx = () => {
  const v = use(Ctx);
  if (!v) throw new Error("outside Dock");
  return v;
};

/**
 * The document page's two sidebars around the page column (P5). Panels are dragged by their grip
 * (mouse, touch or pen: pointer events) between and within the sidebars; the grip's menu does the
 * same from the keyboard. A sidebar that does not fit beside the page opens over it instead.
 */
export function Dock({
  dock,
  panels,
  suppress = [],
  children,
}: {
  dock: DockApi;
  panels: Record<PanelId, PanelDef>;
  /** Sidebars kept out of the way for now (the source panel is open in their place). */
  suppress?: readonly Side[];
  children: ReactNode;
}) {
  const row = useRef<HTMLDivElement>(null);
  const [drag, setDrag] = useState<DragState | null>(null);
  const lastDragEnd = useRef(0);
  const { setAvailable } = dock;

  useEffect(() => {
    const el = row.current;
    if (!el) return;
    setAvailable(el.getBoundingClientRect().width);
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(([entry]) => setAvailable(entry?.contentRect.width ?? 0));
    observer.observe(el);
    return () => observer.disconnect();
  }, [setAvailable]);

  const targetAt = useCallback((x: number, y: number): DragState["target"] => {
    const box = row.current;
    if (!box) return null;
    const rect = box.getBoundingClientRect();
    let side: Side = x < rect.left + rect.width / 2 ? "left" : "right";
    for (const aside of box.querySelectorAll<HTMLElement>("[data-dock-side]")) {
      const r = aside.getBoundingClientRect();
      if (x >= r.left && x <= r.right) side = aside.dataset.dockSide as Side;
    }
    const frames = [
      ...box.querySelectorAll<HTMLElement>(`[data-dock-side="${side}"] [data-panel-id]`),
    ];
    let index = frames.length;
    for (const [i, frame] of frames.entries()) {
      const r = frame.getBoundingClientRect();
      // Only the header counts for "above": a tall panel would otherwise swallow the drop.
      if (y < r.top + Math.min(r.height / 2, 60)) {
        index = i;
        break;
      }
    }
    return { side, index };
  }, []);

  const beginDrag = useCallback(
    (id: PanelId, event: React.PointerEvent) => {
      if (event.button !== 0) return false;
      const startX = event.clientX;
      const startY = event.clientY;
      let active = false;
      let target: DragState["target"] = null;
      const move = (e: PointerEvent) => {
        if (!active) {
          if (Math.hypot(e.clientX - startX, e.clientY - startY) < 6) return;
          active = true;
          document.body.style.userSelect = "none";
        }
        e.preventDefault();
        target = targetAt(e.clientX, e.clientY);
        setDrag({ id, x: e.clientX, y: e.clientY, target });
      };
      const finish = () => {
        window.removeEventListener("pointermove", move);
        window.removeEventListener("pointerup", up);
        window.removeEventListener("pointercancel", cancel);
        document.body.style.userSelect = "";
        setDrag(null);
      };
      const up = () => {
        finish();
        if (!active || !target) return;
        lastDragEnd.current = Date.now();
        const { side, index } = target;
        dock.commit(movePanel(dock.state, id, side, index), side);
      };
      const cancel = () => finish();
      window.addEventListener("pointermove", move, { passive: false });
      window.addEventListener("pointerup", up);
      window.addEventListener("pointercancel", cancel);
      return true;
    },
    [dock, targetAt],
  );

  const shown = (side: Side) => !suppress.includes(side) && dock.showing(side);
  const place = (side: Side): PanelPlace | null =>
    shown(side) ? (dock.modes[side] === "docked" ? "docked" : "overlay") : null;
  const left = place("left");
  const right = place("right");

  return (
    <Ctx.Provider
      value={{
        dock,
        panels,
        beginDrag,
        justDragged: () => Date.now() - lastDragEnd.current < 250,
        dragging: drag?.id ?? null,
      }}
    >
      {/* overflow-x-clip: a sidebar sliding in starts a little outside the row, and must not widen the page. */}
      <div
        ref={row}
        className="relative flex min-h-0 min-w-0 flex-1 overflow-x-clip"
        data-testid="dock"
      >
        {/* Docked sidebars slide open and closed while the page makes room (app/SideSlide). */}
        <SideSlide open={left === "docked"} side="left">
          <Sidebar side="left" place="docked" />
        </SideSlide>
        <div className="relative flex min-w-0 flex-1 flex-col">{children}</div>
        <SideSlide open={right === "docked"} side="right">
          <Sidebar side="right" place="docked" />
        </SideSlide>
        {left === "overlay" && <Sidebar side="left" place="overlay" />}
        {right === "overlay" && <Sidebar side="right" place="overlay" />}
        {drag && <DropZones drag={drag} shown={shown} row={row} />}
      </div>
      {drag?.target &&
        createPortal(
          <div
            aria-hidden
            className="pointer-events-none fixed z-(--z-tooltip) flex items-center gap-2 rounded-card border border-border-strong bg-surface px-3 py-2 text-ui font-medium shadow-pop"
            style={{ left: drag.x + 12, top: drag.y + 8 }}
            data-testid="panel-ghost"
          >
            <span className="text-text-muted [&_svg]:size-4">{panels[drag.id].icon}</span>
            {panels[drag.id].title}
          </div>,
          document.body,
        )}
    </Ctx.Provider>
  );
}

/** While a panel is dragged: where it will land. A sidebar not on screen gets a strip to drop on. */
function DropZones({
  drag,
  shown,
  row,
}: {
  drag: DragState;
  shown: (side: Side) => boolean;
  row: { current: HTMLDivElement | null };
}) {
  const box = row.current?.getBoundingClientRect();
  const target = drag.target;
  let line: { left: number; width: number; top: number } | null = null;
  if (box && target && shown(target.side)) {
    const aside = row.current?.querySelector<HTMLElement>(`[data-dock-side="${target.side}"]`);
    const frames = aside ? [...aside.querySelectorAll<HTMLElement>("[data-panel-id]")] : [];
    if (aside) {
      const a = aside.getBoundingClientRect();
      const at = frames[target.index]?.getBoundingClientRect().top;
      const end = frames[frames.length - 1]?.getBoundingClientRect().bottom ?? a.top + 8;
      line = { left: a.left - box.left + 8, width: a.width - 16, top: (at ?? end) - box.top };
    }
  }
  return (
    <>
      {(["left", "right"] as const)
        .filter((side) => !shown(side))
        .map((side) => (
          <div
            key={side}
            data-testid={`drop-${side}`}
            data-dock-side={side}
            data-over={target?.side === side ? "true" : undefined}
            className={cn(
              "pointer-events-none absolute inset-y-3 z-(--z-dock) flex w-24 items-center justify-center rounded-card border-2 border-dashed border-border-strong bg-surface text-center text-label font-medium text-text-muted",
              side === "left" ? "left-3" : "right-3",
              target?.side === side && "border-accent bg-accent-soft text-accent",
            )}
          >
            {side === "left" ? "Left sidebar" : "Right sidebar"}
          </div>
        ))}
      {line && (
        <div
          aria-hidden
          data-testid="panel-drop-line"
          className="pointer-events-none absolute z-(--z-dock) h-1 rounded-pill bg-selection shadow-[0_0_0_3px_var(--hue-blue-soft)]"
          style={{ left: line.left, width: line.width, top: line.top - 2 }}
        />
      )}
    </>
  );
}

function Sidebar({ side, place }: { side: Side; place: PanelPlace }) {
  const { dock } = useDockCtx();
  const state = dock.state[side];
  const width = state.width;
  return (
    <aside
      aria-label={side === "left" ? "Left sidebar" : "Right sidebar"}
      data-testid={`sidebar-${side}`}
      data-dock-side={side}
      data-place={place}
      className={cn(
        "flex shrink-0 flex-col bg-surface",
        side === "left" ? "border-r border-border" : "border-l border-border",
        place === "docked" && "relative",
        place === "overlay" &&
          "absolute inset-y-0 z-(--z-dock) max-w-[calc(100%-2.5rem)] shadow-pop",
        place === "overlay" &&
          (side === "left" ? "dock-over-left left-0" : "dock-over-right right-0"),
      )}
      style={{ width }}
    >
      {state.panels.map((id, i) => (
        <Fragment key={id}>
          {i > 0 && <PanelSplit side={side} index={i} />}
          <PanelFrame id={id} side={side} index={i} place={place} />
        </Fragment>
      ))}
      {place === "docked" && <SidebarResize side={side} width={width} />}
    </aside>
  );
}

function PanelFrame({
  id,
  side,
  index,
  place,
}: {
  id: PanelId;
  side: Side;
  index: number;
  place: PanelPlace;
}) {
  const { dock, panels, beginDrag, justDragged, dragging } = useDockCtx();
  const def = panels[id];
  const folded = dock.state.folded.includes(id);
  const count = dock.state[side].panels.length;
  const [menu, setMenu] = useState(false);
  // The body stays for the length of the fold, so the panel is seen closing; then it is removed.
  const [body, setBody] = useState(!folded);
  useEffect(() => {
    if (!folded) {
      setBody(true);
      return;
    }
    const still =
      typeof window.matchMedia === "function" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const gone = setTimeout(() => setBody(false), still ? 0 : FOLD_MS);
    return () => clearTimeout(gone);
  }, [folded]);
  const other: Side = side === "left" ? "right" : "left";
  const titleId = `dock-panel-${id}`;

  const moveTo = (to: Side) =>
    dock.commit(movePanel(dock.state, id, to, dock.state[to].panels.length), to);

  return (
    <section
      data-testid={`panel-${id}`}
      data-panel-id={id}
      aria-labelledby={titleId}
      // Side notes line up with the page, so in a shared sidebar they get the larger share.
      // Folded, its share of the height eases to nothing and only the header is left (styles.css, .dock-panel).
      style={{ flexGrow: folded ? 0 : (dock.state.sizes?.[id] ?? DEFAULT_PANEL_SHARE[id]) }}
      className={cn(
        "dock-panel flex basis-0 flex-col overflow-hidden",
        // Folded, the panel is exactly its header: 44px, plus the line above it when it is not the first.
        folded ? (index > 0 ? "min-h-[2.8125rem]" : "min-h-11") : "min-h-24",
        index > 0 && "border-t border-border",
        dragging === id && "opacity-50",
      )}
    >
      {/* Like the app's own sidebar: the fold arrow first, then the name with its + beside it, and the
          grip that moves the panel at the far right. */}
      <header
        className={cn(
          "flex min-h-11 shrink-0 items-center gap-0.5 px-1",
          // Folded, the header has no line under it: the next panel's top line is the divider. Two lines a
          // pixel apart read as a gap.
          !folded && "border-b border-border",
        )}
      >
        <button
          type="button"
          id={titleId}
          aria-expanded={!folded}
          onClick={() => dock.update((s) => toggleFolded(s, id))}
          className="flex min-h-11 min-w-0 items-center gap-2 rounded-control px-1.5 text-left text-caption font-semibold uppercase tracking-[0.08em] text-text-muted hover:text-text xl:min-h-9"
        >
          <ChevronDown
            aria-hidden
            className={cn(
              "size-4 shrink-0 transition-transform duration-(--duration-fast)",
              folded && "-rotate-90",
            )}
          />
          <span className="shrink-0 [&_svg]:size-4">{def.icon}</span>
          <span className="truncate">{def.title}</span>
          {def.badge}
        </button>
        {def.actions}
        <span className="min-w-0 flex-1" />
        <DropdownMenu.Root modal={false} open={menu} onOpenChange={setMenu}>
          <Tooltip content={`Move the ${def.title} panel: drag, or open for choices`}>
            <DropdownMenu.Trigger asChild>
              <button
                type="button"
                aria-label={`Move the ${def.title} panel: drag, or open for choices`}
                data-testid={`panel-grip-${id}`}
                className="flex size-11 shrink-0 cursor-grab touch-none items-center justify-center rounded-control text-text-muted hover:bg-surface-muted hover:text-text active:cursor-grabbing xl:h-9 xl:w-7"
                onPointerDown={(e) => {
                  // A press may become a drag: keep the menu shut until it turns out to be a click.
                  if (beginDrag(id, e)) e.preventDefault();
                }}
                onClick={() => {
                  if (!justDragged()) setMenu(true);
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    setMenu(true);
                  }
                }}
              >
                <GripVertical className="size-4" />
              </button>
            </DropdownMenu.Trigger>
          </Tooltip>
          <DropdownMenu.Portal>
            <DropdownMenu.Content
              align="end"
              sideOffset={6}
              collisionPadding={12}
              aria-label={`${def.title} panel`}
              className={menuContentClass}
            >
              <DropdownMenu.Item
                className={menuItemClass()}
                onSelect={() => moveTo(other)}
                data-testid={`panel-move-${other}`}
              >
                <span className="flex size-5 items-center justify-center text-text-muted [&_svg]:size-4">
                  {other === "left" ? <ArrowLeftToLine /> : <ArrowRightToLine />}
                </span>
                Move to the {SIDE_NAME[other]} sidebar
              </DropdownMenu.Item>
              <DropdownMenu.Item
                className={menuItemClass()}
                disabled={index === 0}
                onSelect={() => dock.update((s) => movePanelBy(s, id, -1))}
              >
                <span className="flex size-5 items-center justify-center text-text-muted [&_svg]:size-4">
                  <ArrowUp />
                </span>
                Move up
              </DropdownMenu.Item>
              <DropdownMenu.Item
                className={menuItemClass()}
                disabled={index === count - 1}
                onSelect={() => dock.update((s) => movePanelBy(s, id, 1))}
              >
                <span className="flex size-5 items-center justify-center text-text-muted [&_svg]:size-4">
                  <ArrowDown />
                </span>
                Move down
              </DropdownMenu.Item>
              <DropdownMenu.Separator className={menuSeparatorClass} />
              <DropdownMenu.Item
                className={menuItemClass()}
                data-testid={`panel-close-${id}`}
                onSelect={() => dock.commit(closePanel(dock.state, id))}
              >
                <span className="flex size-5 items-center justify-center text-text-muted [&_svg]:size-4">
                  <X />
                </span>
                Close panel
              </DropdownMenu.Item>
            </DropdownMenu.Content>
          </DropdownMenu.Portal>
        </DropdownMenu.Root>
        {place === "overlay" && index === 0 && (
          <IconButton
            variant="bare"
            label="Close sidebar"
            size="sm"
            onClick={() => dock.setPeek(null)}
            data-testid="sidebar-overlay-close"
          >
            <X className="size-4" />
          </IconButton>
        )}
      </header>
      {body && (
        <div
          className="relative flex min-h-0 flex-1 flex-col"
          data-testid={`panel-body-${id}`}
          inert={folded}
        >
          {def.render(place)}
        </div>
      )}
    </section>
  );
}

/**
 * The line between two panels stacked in a sidebar: drag it up or down to give one more height and
 * the other less (arrow keys do the same; double-click goes back to the usual split). It sits above
 * panel `index` and works on that panel and the nearest open panel above it; with either folded
 * there is nothing to share, so it does nothing.
 */
function PanelSplit({ side, index }: { side: Side; index: number }) {
  const { dock } = useDockCtx();
  const panels = dock.state[side].panels;
  const below = panels[index] as PanelId;
  const open = (id: PanelId) => !dock.state.folded.includes(id);
  const above = panels.slice(0, index).reverse().find(open);
  if (!above || !open(below)) return null;

  /** The open panels' heights now, as the shares to start from. */
  const measure = (root: HTMLElement): Partial<Record<PanelId, number>> => {
    const out: Partial<Record<PanelId, number>> = {};
    for (const el of root.querySelectorAll<HTMLElement>("[data-panel-id]")) {
      const id = el.dataset.panelId as PanelId;
      if (open(id)) out[id] = el.getBoundingClientRect().height;
    }
    return out;
  };
  const move = (start: Partial<Record<PanelId, number>>, dy: number) => {
    const a = start[above] ?? 0;
    const b = start[below] ?? 0;
    const total = a + b;
    if (total < MIN_PANEL_HEIGHT * 2) return;
    const nextA = Math.max(MIN_PANEL_HEIGHT, Math.min(total - MIN_PANEL_HEIGHT, a + dy));
    dock.update((s) => setPanelSizes(s, { ...start, [above]: nextA, [below]: total - nextA }));
  };

  return (
    // biome-ignore lint/a11y/useSemanticElements: a focusable splitter is the ARIA pattern for this
    <div
      role="separator"
      aria-orientation="horizontal"
      aria-label="Resize the panels above and below"
      aria-valuenow={Math.round(dock.state.sizes?.[above] ?? 0)}
      tabIndex={0}
      data-testid={`panel-split-${below}`}
      className="group relative z-(--z-raised) h-0 shrink-0 cursor-row-resize touch-none outline-none"
      onDoubleClick={() => dock.update((s) => resetPanelSizes(s, side))}
      onKeyDown={(e) => {
        if (e.key !== "ArrowUp" && e.key !== "ArrowDown") return;
        e.preventDefault();
        const root = e.currentTarget.parentElement;
        if (root) move(measure(root), e.key === "ArrowUp" ? -16 : 16);
      }}
      onPointerDown={(e) => {
        if (e.button !== 0) return;
        const root = e.currentTarget.parentElement;
        if (!root) return;
        e.preventDefault();
        const startY = e.clientY;
        const start = measure(root);
        const onMove = (ev: PointerEvent) => move(start, ev.clientY - startY);
        const up = () => {
          window.removeEventListener("pointermove", onMove);
          window.removeEventListener("pointerup", up);
          window.removeEventListener("pointercancel", up);
          document.body.style.userSelect = "";
          document.body.style.cursor = "";
          document.body.classList.remove("dock-resizing");
        };
        document.body.style.userSelect = "none";
        document.body.style.cursor = "row-resize";
        // The fold animation would make the panels trail behind the pointer.
        document.body.classList.add("dock-resizing");
        window.addEventListener("pointermove", onMove);
        window.addEventListener("pointerup", up);
        window.addEventListener("pointercancel", up);
      }}
    >
      {/* A 12px strip to grab, centered on the line between the panels, with the line lighting up. */}
      <span className="absolute inset-x-0 -top-1.5 flex h-3 items-center">
        <span className="h-0.5 w-full bg-transparent transition-colors group-hover:bg-accent group-focus-visible:bg-accent" />
      </span>
    </div>
  );
}

/** Drag the sidebar's inner edge to widen it; arrow keys do the same. */
function SidebarResize({ side, width }: { side: Side; width: number }) {
  const { dock } = useDockCtx();
  const sign = side === "left" ? 1 : -1;
  return (
    // biome-ignore lint/a11y/useSemanticElements: a focusable splitter is the ARIA pattern for this
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label={`Resize the ${side} sidebar`}
      aria-valuenow={width}
      aria-valuemin={SIDEBAR_WIDTH.min}
      aria-valuemax={SIDEBAR_WIDTH.max}
      tabIndex={0}
      data-testid={`sidebar-resize-${side}`}
      className={cn(
        "group absolute top-0 bottom-0 z-(--z-raised) flex w-4 cursor-col-resize touch-none justify-center",
        side === "left" ? "-right-2" : "-left-2",
      )}
      onKeyDown={(e) => {
        if (e.key === "ArrowLeft") dock.update((s) => setWidth(s, side, width - 16 * sign));
        if (e.key === "ArrowRight") dock.update((s) => setWidth(s, side, width + 16 * sign));
      }}
      onPointerDown={(e) => {
        const startX = e.clientX;
        const move = (ev: PointerEvent) =>
          dock.update((s) => setWidth(s, side, width + (ev.clientX - startX) * sign));
        const up = () => {
          window.removeEventListener("pointermove", move);
          window.removeEventListener("pointerup", up);
          document.body.style.userSelect = "";
        };
        document.body.style.userSelect = "none";
        window.addEventListener("pointermove", move);
        window.addEventListener("pointerup", up);
      }}
    >
      <span className="h-full w-0.5 bg-transparent transition-colors group-hover:bg-selection group-focus-visible:bg-selection" />
    </div>
  );
}
