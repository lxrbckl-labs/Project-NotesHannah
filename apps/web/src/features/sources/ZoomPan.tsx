import { ChevronLeft, ChevronRight, Expand, Minimize, Minus, Plus } from "lucide-react";
import { type PointerEvent, type ReactNode, useCallback, useEffect, useRef, useState } from "react";
import { IconButton } from "../../components/ui/button";
import { useHotkey } from "../hotkeys";

const MIN = 1;
const MAX = 6;

/**
 * A picture you can zoom and pan: wheel or buttons to zoom, drag to pan, pinch on touch,
 * double-click or double-tap to jump in and out. Children are drawn inside the transform, so
 * overlays (a highlighted region) move with the page.
 */
/** Moving between pages from inside full screen: where she is, and the way to each side (absent at an end). */
export interface ZoomPaging {
  position: string;
  onPrevious?: (() => void) | undefined;
  onNext?: (() => void) | undefined;
}

export function ZoomPan({
  children,
  label,
  paging,
}: {
  children: ReactNode;
  label: string;
  /** In full screen, an arrow at each side and the page's position: the pager under the picture is covered there. */
  paging?: ZoomPaging | undefined;
}) {
  const box = useRef<HTMLDivElement>(null);
  const [view, setView] = useState({ scale: 1, x: 0, y: 0 });
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const last = useRef<{ x: number; y: number; dist: number } | null>(null);
  // Full screen: the viewer fills the whole window, over the page, until she leaves it. It is our own
  // layout rather than the browser's full-screen mode, so it works the same in Safari and on an iPad
  // or phone, where the browser's mode is missing or partial.
  const [full, setFull] = useState(false);
  useEffect(() => {
    if (!full) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        setFull(false);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [full]);
  // Its keys (features/hotkeys/registry.ts, "Source file"). Escape, above, stays its own.
  useHotkey("source.zoomIn", () => zoomTo(view.scale * 1.4));
  useHotkey("source.zoomOut", () => zoomTo(view.scale / 1.4));
  useHotkey("source.fullScreen", () => setFull((v) => !v));
  // Entering or leaving changes the picture's size: start again from the whole page.
  // biome-ignore lint/correctness/useExhaustiveDependencies: reset when the mode changes
  useEffect(() => setView({ scale: 1, x: 0, y: 0 }), [full]);

  const clamp = useCallback((scale: number, x: number, y: number) => {
    const el = box.current;
    const s = Math.min(MAX, Math.max(MIN, scale));
    if (!el) return { scale: s, x, y };
    const w = el.clientWidth;
    const h = el.clientHeight;
    const maxX = (w * (s - 1)) / 2;
    const maxY = (h * (s - 1)) / 2;
    return {
      scale: s,
      x: Math.min(maxX, Math.max(-maxX, x)),
      y: Math.min(maxY, Math.max(-maxY, y)),
    };
  }, []);

  const zoomTo = useCallback(
    (next: number, around?: { x: number; y: number }) => {
      setView((v) => {
        const el = box.current;
        if (!el || !around) return clamp(next, v.x, v.y);
        const rect = el.getBoundingClientRect();
        const cx = around.x - rect.left - rect.width / 2;
        const cy = around.y - rect.top - rect.height / 2;
        const ratio = Math.min(MAX, Math.max(MIN, next)) / v.scale;
        return clamp(next, cx - (cx - v.x) * ratio, cy - (cy - v.y) * ratio);
      });
    },
    [clamp],
  );

  // Wheel needs a non-passive listener to stop the page scrolling under the picture.
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      zoomTo(view.scale * (event.deltaY < 0 ? 1.15 : 1 / 1.15), {
        x: event.clientX,
        y: event.clientY,
      });
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [view.scale, zoomTo]);

  function onPointerDown(event: PointerEvent<HTMLDivElement>) {
    event.currentTarget.setPointerCapture(event.pointerId);
    pointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
    last.current = null;
  }

  function onPointerMove(event: PointerEvent<HTMLDivElement>) {
    const map = pointers.current;
    if (!map.has(event.pointerId)) return;
    map.set(event.pointerId, { x: event.clientX, y: event.clientY });
    const pts = [...map.values()];
    if (pts.length === 2) {
      const [a, b] = pts as [{ x: number; y: number }, { x: number; y: number }];
      const dist = Math.hypot(a.x - b.x, a.y - b.y);
      const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
      if (last.current?.dist) zoomTo(view.scale * (dist / last.current.dist), mid);
      last.current = { ...mid, dist };
    } else if (pts.length === 1 && view.scale > 1) {
      const p = pts[0] as { x: number; y: number };
      if (last.current) {
        const dx = p.x - last.current.x;
        const dy = p.y - last.current.y;
        setView((v) => clamp(v.scale, v.x + dx, v.y + dy));
      }
      last.current = { x: p.x, y: p.y, dist: 0 };
    }
  }

  function onPointerUp(event: PointerEvent<HTMLDivElement>) {
    pointers.current.delete(event.pointerId);
    last.current = null;
  }

  return (
    <div
      data-testid="zoom-pan"
      data-full={full || undefined}
      className={
        full
          ? "zoom-full fixed inset-0 z-(--z-modal) flex flex-col bg-bg p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-[max(0.75rem,env(safe-area-inset-top))]"
          : "relative"
      }
    >
      {/* biome-ignore lint/a11y/useSemanticElements: an image viewport, not a form group */}
      <div
        ref={box}
        role="group"
        aria-label={label}
        data-testid="zoom-area"
        data-scale={view.scale.toFixed(2)}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onDoubleClick={(event) =>
          view.scale > 1
            ? setView({ scale: 1, x: 0, y: 0 })
            : zoomTo(2.5, { x: event.clientX, y: event.clientY })
        }
        className={`relative flex min-h-40 touch-none select-none items-center justify-center overflow-hidden rounded-card border border-border bg-surface-muted${full ? " min-h-0 flex-1" : ""}`}
        style={{ cursor: view.scale > 1 ? "grab" : "zoom-in" }}
      >
        <div
          className="relative max-h-full max-w-full"
          style={{
            transform: `translate(${view.x}px, ${view.y}px) scale(${view.scale})`,
            transformOrigin: "center",
          }}
        >
          {children}
        </div>
      </div>
      {full && paging ? (
        <>
          {/* An arrow at each side, so it is plain there are more pages (the arrow keys do the same). */}
          <IconButton
            aria-label="Previous page"
            hotkey="source.prevPage"
            tooltip="right"
            data-testid="zoom-previous"
            disabled={!paging.onPrevious}
            onClick={() => paging.onPrevious?.()}
            className="absolute left-6 top-1/2 size-12! -translate-y-1/2 rounded-pill! border border-border bg-(--color-chrome) shadow-card backdrop-blur"
          >
            <ChevronLeft size={24} />
          </IconButton>
          <IconButton
            aria-label="Next page"
            hotkey="source.nextPage"
            tooltip="left"
            data-testid="zoom-next"
            disabled={!paging.onNext}
            onClick={() => paging.onNext?.()}
            className="absolute right-6 top-1/2 size-12! -translate-y-1/2 rounded-pill! border border-border bg-(--color-chrome) shadow-card backdrop-blur"
          >
            <ChevronRight size={24} />
          </IconButton>
          <p
            aria-live="polite"
            data-testid="zoom-position"
            className="absolute bottom-[max(1.5rem,env(safe-area-inset-bottom))] left-1/2 -translate-x-1/2 rounded-card border border-border bg-(--color-chrome) px-3 py-1.5 text-label text-text-muted tabular-nums shadow-card backdrop-blur"
          >
            {paging.position}
          </p>
        </>
      ) : null}
      <div
        className={`absolute right-3 flex items-center gap-1 rounded-card border border-border bg-(--color-chrome) p-1 shadow-card backdrop-blur ${full ? "bottom-[max(1.5rem,env(safe-area-inset-bottom))] right-6" : "bottom-3"}`}
      >
        <IconButton
          aria-label="Zoom out"
          hotkey="source.zoomOut"
          onClick={() => zoomTo(view.scale / 1.4)}
          disabled={view.scale <= MIN}
        >
          <Minus size={18} />
        </IconButton>
        <span
          className="min-w-10 text-center text-xs tabular-nums text-text-muted"
          aria-live="polite"
        >
          {Math.round(view.scale * 100)}%
        </span>
        <IconButton
          aria-label="Zoom in"
          hotkey="source.zoomIn"
          onClick={() => zoomTo(view.scale * 1.4)}
          disabled={view.scale >= MAX}
        >
          <Plus size={18} />
        </IconButton>
        <IconButton
          aria-label={full ? "Leave full screen" : "Full screen"}
          hotkey="source.fullScreen"
          data-testid="zoom-full"
          pressed={full}
          onClick={() => setFull((v) => !v)}
        >
          {full ? <Minimize size={18} /> : <Expand size={18} />}
        </IconButton>
      </div>
    </div>
  );
}
