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
  type ReactNode,
  use,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import { IconButton } from "../../../../components/ui/button";
import {
  menuContentClass,
  menuItemClass,
  menuSeparatorClass,
} from "../../../../components/ui/menu";
import { cn } from "../../../../lib/cn";
import {
  closePanel,
  movePanel,
  movePanelBy,
  type PanelId,
  SIDEBAR_WIDTH,
  type Side,
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
      <div ref={row} className="relative flex min-h-0 min-w-0 flex-1" data-testid="dock">
        {left === "docked" && <Sidebar side="left" place="docked" />}
        <div className="relative flex min-w-0 flex-1 flex-col">{children}</div>
        {right === "docked" && <Sidebar side="right" place="docked" />}
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
          "anim-fade absolute inset-y-0 z-(--z-dock) max-w-[calc(100%-2.5rem)] shadow-pop",
        place === "overlay" && (side === "left" ? "left-0" : "right-0"),
      )}
      style={{ width }}
    >
      {state.panels.map((id, i) => (
        <PanelFrame key={id} id={id} side={side} index={i} place={place} />
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
      style={folded ? undefined : { flexGrow: id === "notes" ? 3 : 2 }}
      className={cn(
        "flex min-h-0 flex-col",
        folded ? "shrink-0" : "min-h-24 basis-0",
        index > 0 && "border-t border-border",
        dragging === id && "opacity-50",
      )}
    >
      <header className="flex min-h-11 shrink-0 items-center gap-0.5 border-b border-border px-1">
        <DropdownMenu.Root modal={false} open={menu} onOpenChange={setMenu}>
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
          <DropdownMenu.Portal>
            <DropdownMenu.Content
              align="start"
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
        <button
          type="button"
          id={titleId}
          aria-expanded={!folded}
          onClick={() => dock.update((s) => toggleFolded(s, id))}
          className="flex min-h-11 min-w-0 flex-1 items-center gap-2 rounded-control px-1.5 text-left text-caption font-semibold uppercase tracking-[0.08em] text-text-muted hover:text-text xl:min-h-9"
        >
          <span className="shrink-0 [&_svg]:size-4">{def.icon}</span>
          <span className="truncate">{def.title}</span>
          {def.badge}
          <ChevronDown
            aria-hidden
            className={cn(
              "ml-auto size-4 shrink-0 transition-transform duration-(--duration-fast)",
              folded && "-rotate-90",
            )}
          />
        </button>
        {def.actions}
        {place === "overlay" && index === 0 && (
          <IconButton
            label="Close sidebar"
            size="sm"
            onClick={() => dock.setPeek(null)}
            data-testid="sidebar-overlay-close"
          >
            <X className="size-4" />
          </IconButton>
        )}
      </header>
      {!folded && (
        <div className="relative flex min-h-0 flex-1 flex-col" data-testid={`panel-body-${id}`}>
          {def.render(place)}
        </div>
      )}
    </section>
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
