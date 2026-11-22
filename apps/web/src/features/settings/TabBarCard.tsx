import { DEFAULT_TAB_ORDER, type TabId } from "@notes/schema";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { type KeyboardEvent, type PointerEvent, useId, useRef, useState } from "react";
import { moveTab, sameOrder, slotAt, TAB_DEFS } from "../../app/tabs";
import { Badge } from "../../components/ui/badge";
import { Button } from "../../components/ui/button";
import { Card, CardTitle } from "../../components/ui/card";
import { useToast } from "../../components/ui/toast";
import { cn } from "../../lib/cn";
import { useSaveTabOrder, useTabOrder } from "../preferences/usePreferences";

/** A press that moves less than this is a tap (it only picks the icon), not a drag. */
const DRAG_START_PX = 4;

interface Drag {
  id: TabId;
  pointerId: number;
  startX: number;
  startIndex: number;
  /** The order when the drag began, so a canceled drag puts everything back. */
  startOrder: readonly TabId[];
  /** Pixels moved, already kept inside the bar. */
  dx: number;
  moved: boolean;
}

/**
 * Settings, "Tab bar": a copy of the phone's bottom bar whose icons she drags into the order she wants.
 * What she arranges is a draft; the real bar keeps the saved order until she presses Save. Leaving the page
 * drops the draft (it lives only in this component).
 */
export function TabBarCard() {
  const saved = useTabOrder();
  const save = useSaveTabOrder();
  const toast = useToast();
  const [draft, setDraft] = useState<readonly TabId[] | null>(null);
  const [selected, setSelected] = useState<TabId | null>(null);
  const [drag, setDragState] = useState<Drag | null>(null);
  // Pointer events can arrive several times before React has drawn again, so the handlers read the drag and
  // the order from these, which are updated at once; the state above is only for drawing.
  const dragRef = useRef<Drag | null>(null);
  const orderRef = useRef<readonly TabId[]>([]);
  const [announcement, setAnnouncement] = useState("");
  const barRef = useRef<HTMLUListElement>(null);
  const hintId = useId();

  const order = draft ?? saved;
  orderRef.current = order;
  const setDrag = (next: Drag | null) => {
    dragRef.current = next;
    setDragState(next);
  };
  const place = (next: readonly TabId[]) => {
    orderRef.current = next;
    setDraft(next);
  };
  const count = order.length;
  // Derived, not stored: once the saved order catches up with the draft (after Save), nothing is pending, and
  // if a save is refused the saved order rolls back and the draft is pending again, still hers.
  const dirty = draft !== null && !sameOrder(draft, saved);
  const isDefault = sameOrder(order, DEFAULT_TAB_ORDER);

  function announce(id: TabId, next: readonly TabId[]) {
    setAnnouncement(`${TAB_DEFS[id].label} moved to position ${next.indexOf(id) + 1} of ${count}.`);
  }

  function moveBy(id: TabId, delta: number) {
    const from = order.indexOf(id);
    const to = Math.max(0, Math.min(count - 1, from + delta));
    if (to === from) return;
    const next = moveTab(order, id, to);
    place(next);
    announce(id, next);
  }

  function onKeyDown(event: KeyboardEvent, id: TabId) {
    const from = order.indexOf(id);
    let to: number | null = null;
    if (event.key === "ArrowLeft") to = from - 1;
    else if (event.key === "ArrowRight") to = from + 1;
    else if (event.key === "Home") to = 0;
    else if (event.key === "End") to = count - 1;
    if (to === null) return;
    event.preventDefault();
    const target = Math.max(0, Math.min(count - 1, to));
    if (target === from) return;
    const next = moveTab(order, id, target);
    place(next);
    announce(id, next);
  }

  function onPointerDown(event: PointerEvent<HTMLButtonElement>, id: TabId) {
    setSelected(id);
    // Mouse: the main button only.
    if (event.pointerType === "mouse" && event.button !== 0) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    setDrag({
      id,
      pointerId: event.pointerId,
      startX: event.clientX,
      startIndex: orderRef.current.indexOf(id),
      startOrder: orderRef.current,
      dx: 0,
      moved: false,
    });
  }

  function onPointerMove(event: PointerEvent<HTMLButtonElement>) {
    const live = dragRef.current;
    if (!live || event.pointerId !== live.pointerId) return;
    const width = (barRef.current?.clientWidth ?? 0) / count;
    const raw = event.clientX - live.startX;
    // The icon stays inside the bar.
    const dx = Math.max(
      -live.startIndex * width,
      Math.min((count - 1 - live.startIndex) * width, raw),
    );
    const moved = live.moved || Math.abs(raw) > DRAG_START_PX;
    if (!moved) return;
    setDrag({ ...live, dx, moved });
    // The others slide out of the way as soon as the icon is over another slot.
    const slot = slotAt(live.startIndex, dx, width, count);
    if (slot !== orderRef.current.indexOf(live.id)) {
      const next = moveTab(live.startOrder, live.id, slot);
      place(next);
      announce(live.id, next);
    }
  }

  function endDrag(event: PointerEvent<HTMLButtonElement>, cancelled: boolean) {
    const live = dragRef.current;
    if (!live || event.pointerId !== live.pointerId) return;
    if (cancelled) place(live.startOrder);
    setDrag(null);
  }

  function onSave() {
    if (!draft) return;
    const sent = draft;
    // The default is stored as "nothing chosen", so a tab added to the app later lands where the default puts it.
    save.mutate(sameOrder(draft, DEFAULT_TAB_ORDER) ? null : draft, {
      onSuccess: () => {
        // Only drop the draft if she has not changed it again while the save was on its way.
        setDraft((current) => (current && sameOrder(current, sent) ? null : current));
        toast.success("Tab bar saved.");
      },
    });
  }

  const selectedIndex = selected ? order.indexOf(selected) : -1;

  return (
    <Card as="section" aria-labelledby="card-tab-bar" padding="lg" data-testid="tab-bar-card">
      <CardTitle
        id="card-tab-bar"
        title="Tab bar"
        description="Drag the icons into the order you want, then save. This is the bar along the bottom of your phone; on a tablet or a computer the sidebar stays as it is."
      />

      <div
        data-testid="tab-replica"
        className="max-w-md rounded-card border border-border bg-surface px-2"
      >
        <ul ref={barRef} aria-label="Tab bar order" className="relative h-14 select-none">
          {Object.keys(TAB_DEFS).map((key) => {
            const id = key as TabId;
            const { label, icon: Icon } = TAB_DEFS[id];
            const index = order.indexOf(id);
            const dragging = drag?.id === id && drag.moved;
            const picked = selected === id;
            return (
              <li
                key={id}
                className={cn(
                  "absolute inset-y-0 left-0",
                  // The dragged icon follows the finger with no delay; the rest glide to their new slots.
                  !dragging && "transition-transform duration-(--duration-base) ease-(--ease-calm)",
                  dragging && "z-(--z-raised)",
                )}
                style={{
                  width: `${100 / count}%`,
                  transform: dragging
                    ? `translateX(calc(${drag.startIndex * 100}% + ${drag.dx}px))`
                    : `translateX(${index * 100}%)`,
                }}
              >
                <button
                  type="button"
                  data-testid="tab-replica-item"
                  data-tab={id}
                  data-index={index}
                  aria-label={`${label}, position ${index + 1} of ${count}`}
                  aria-describedby={hintId}
                  // One tab stop for the whole row; the arrow keys do the rest.
                  tabIndex={picked || (selected === null && index === 0) ? 0 : -1}
                  onFocus={() => setSelected(id)}
                  onKeyDown={(event) => onKeyDown(event, id)}
                  onPointerDown={(event) => onPointerDown(event, id)}
                  onPointerMove={onPointerMove}
                  onPointerUp={(event) => endDrag(event, false)}
                  onPointerCancel={(event) => endDrag(event, true)}
                  // No page scroll, pull-to-refresh or back swipe starts from here: the finger is dragging an icon.
                  className={cn(
                    "flex size-full touch-none cursor-grab flex-col items-center justify-center gap-0.5 rounded-control text-caption font-medium outline-offset-[-2px]",
                    picked ? "bg-accent-soft text-accent" : "text-text-muted",
                    dragging &&
                      "cursor-grabbing border border-border-strong bg-surface shadow-raised",
                  )}
                >
                  <Icon size={22} aria-hidden />
                  {label}
                </button>
              </li>
            );
          })}
        </ul>
      </div>

      <p id={hintId} className="mt-2 text-ui text-text-muted">
        Drag to rearrange, then save.
      </p>
      <p aria-live="polite" className="sr-only">
        {announcement}
      </p>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <Button
          size="sm"
          disabled={selectedIndex <= 0}
          onClick={() => selected && moveBy(selected, -1)}
          aria-label={selected ? `Move ${TAB_DEFS[selected].label} left` : "Move left"}
        >
          <ChevronLeft size={16} aria-hidden /> Move left
        </Button>
        <Button
          size="sm"
          disabled={selectedIndex < 0 || selectedIndex >= count - 1}
          onClick={() => selected && moveBy(selected, 1)}
          aria-label={selected ? `Move ${TAB_DEFS[selected].label} right` : "Move right"}
        >
          Move right <ChevronRight size={16} aria-hidden />
        </Button>
        <span className="text-caption text-text-muted">
          {selected
            ? `${TAB_DEFS[selected].label} is picked. The arrow keys move it too.`
            : "Pick an icon to move it with these buttons or the arrow keys."}
        </span>
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-border pt-4">
        <Button variant="primary" disabled={!dirty || save.isPending} onClick={onSave}>
          Save
        </Button>
        <Button disabled={!dirty} onClick={() => setDraft(null)}>
          Cancel
        </Button>
        <Button disabled={isDefault} onClick={() => setDraft(DEFAULT_TAB_ORDER)}>
          Reset to default
        </Button>
        {dirty ? (
          <Badge tone="warning" dot>
            Unsaved changes
          </Badge>
        ) : null}
      </div>
    </Card>
  );
}
