import { useCallback, useState } from "react";
import { cn } from "../lib/cn";

/** How narrow and how wide she can drag a sidebar of the app. */
export const SIDE_WIDTH = { min: 208, max: 440 } as const;
const clamp = (w: number) => Math.round(Math.max(SIDE_WIDTH.min, Math.min(SIDE_WIDTH.max, w)));

/** A sidebar's width, remembered in this browser under `key`. */
export function useSideWidth(key: string, initial: number) {
  const [width, setWidthState] = useState(() => {
    try {
      const saved = Number(localStorage.getItem(key));
      return Number.isFinite(saved) && saved > 0 ? clamp(saved) : initial;
    } catch {
      return initial;
    }
  });
  const setWidth = useCallback(
    (next: number) => {
      const w = clamp(next);
      setWidthState(w);
      try {
        localStorage.setItem(key, String(w));
      } catch {
        // Not remembered, but nothing breaks.
      }
    },
    [key],
  );
  return [width, setWidth] as const;
}

/**
 * The inner edge of a sidebar: press and drag it to make the sidebar wider or narrower (mouse, touch
 * or pen), use the arrow keys when it has focus, or double-click to go back to the usual width.
 */
export function SideResize({
  side,
  width,
  initial,
  onWidth,
  label,
}: {
  side: "left" | "right";
  width: number;
  initial: number;
  onWidth: (width: number) => void;
  label: string;
}) {
  // A left sidebar grows as the pointer moves right; a right one as it moves left.
  const sign = side === "left" ? 1 : -1;
  const [dragging, setDragging] = useState(false);
  return (
    // biome-ignore lint/a11y/useSemanticElements: a focusable splitter is the ARIA pattern for this
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label={label}
      aria-valuenow={width}
      aria-valuemin={SIDE_WIDTH.min}
      aria-valuemax={SIDE_WIDTH.max}
      tabIndex={0}
      data-testid={`side-resize-${side}`}
      className={cn(
        "group absolute top-0 bottom-0 z-(--z-raised) flex w-4 cursor-col-resize touch-none justify-center outline-none print:hidden",
        side === "left" ? "-right-2" : "-left-2",
      )}
      onDoubleClick={() => onWidth(initial)}
      onKeyDown={(e) => {
        if (e.key === "ArrowLeft") onWidth(width - 16 * sign);
        if (e.key === "ArrowRight") onWidth(width + 16 * sign);
        if (e.key === "Home") onWidth(initial);
      }}
      onPointerDown={(e) => {
        if (e.button !== 0) return;
        e.preventDefault();
        const startX = e.clientX;
        const move = (ev: PointerEvent) => onWidth(width + (ev.clientX - startX) * sign);
        const up = () => {
          window.removeEventListener("pointermove", move);
          window.removeEventListener("pointerup", up);
          window.removeEventListener("pointercancel", up);
          document.body.style.userSelect = "";
          document.body.style.cursor = "";
          setDragging(false);
        };
        document.body.style.userSelect = "none";
        document.body.style.cursor = "col-resize";
        setDragging(true);
        window.addEventListener("pointermove", move);
        window.addEventListener("pointerup", up);
        window.addEventListener("pointercancel", up);
      }}
    >
      <span
        className={cn(
          "h-full w-0.5 transition-colors duration-(--duration-fast) group-hover:bg-accent group-focus-visible:bg-accent",
          dragging ? "bg-accent" : "bg-transparent",
        )}
      />
    </div>
  );
}
