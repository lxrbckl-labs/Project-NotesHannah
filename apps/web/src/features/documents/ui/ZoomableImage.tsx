import type { NormalizedBox } from "@notes/schema";
import { Maximize, Minus, Plus } from "lucide-react";
import { type PointerEvent, type ReactNode, useCallback, useEffect, useRef, useState } from "react";
import { IconButton } from "../../../components/ui/button";

interface View {
  scale: number;
  x: number;
  y: number;
}

const MIN = 1;
const MAX = 5;
const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

/**
 * A page image she can zoom and pan: pinch or Ctrl/⌘-scroll, drag, double
 * tap, and buttons. The cited region is outlined in the same layer, so it
 * stays on the right words at any zoom.
 */
export function ZoomableImage({
  src,
  width,
  height,
  alt,
  region,
  focusRegion,
  overlay,
  testId,
}: {
  src: string;
  width: number;
  height: number;
  alt: string;
  region?: NormalizedBox | undefined;
  /** Start zoomed onto the region. */
  focusRegion?: boolean;
  overlay?: ReactNode;
  testId?: string;
}) {
  const frame = useRef<HTMLDivElement>(null);
  const [view, setView] = useState<View>({ scale: 1, x: 0, y: 0 });
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const gesture = useRef<{
    dist: number;
    scale: number;
    mid: { x: number; y: number };
    view: View;
  } | null>(null);
  const lastTap = useRef(0);

  const bound = useCallback((next: View): View => {
    const el = frame.current;
    if (!el) return next;
    const w = el.clientWidth;
    const h = el.clientHeight;
    const scale = clamp(next.scale, MIN, MAX);
    const minX = w - w * scale;
    const minY = h - h * scale;
    return { scale, x: clamp(next.x, minX, 0), y: clamp(next.y, minY, 0) };
  }, []);

  const zoomAt = useCallback(
    (factor: number, cx?: number, cy?: number) => {
      setView((v) => {
        const el = frame.current;
        const px = cx ?? (el ? el.clientWidth / 2 : 0);
        const py = cy ?? (el ? el.clientHeight / 2 : 0);
        const scale = clamp(v.scale * factor, MIN, MAX);
        const ratio = scale / v.scale;
        return bound({ scale, x: px - (px - v.x) * ratio, y: py - (py - v.y) * ratio });
      });
    },
    [bound],
  );

  // Start on the region when asked (only once per image + region).
  // biome-ignore lint/correctness/useExhaustiveDependencies: reset when the page or region changes
  useEffect(() => {
    const el = frame.current;
    if (!el || !region || !focusRegion) {
      setView({ scale: 1, x: 0, y: 0 });
      return;
    }
    const w = el.clientWidth;
    const h = el.clientHeight;
    const scale = clamp(Math.min(1 / (region.width + 0.1), 2.2), 1, MAX);
    const cx = (region.x + region.width / 2) * w;
    const cy = (region.y + region.height / 2) * h;
    setView(bound({ scale, x: w / 2 - cx * scale, y: h / 2 - cy * scale }));
  }, [src, region?.x, region?.y, region?.width, region?.height, focusRegion]);

  useEffect(() => {
    const el = frame.current;
    if (!el) return;
    const onWheel = (event: WheelEvent) => {
      if (!event.ctrlKey && !event.metaKey) return;
      event.preventDefault();
      const rect = el.getBoundingClientRect();
      zoomAt(Math.exp(-event.deltaY * 0.01), event.clientX - rect.left, event.clientY - rect.top);
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [zoomAt]);

  const onPointerDown = (event: PointerEvent) => {
    const el = frame.current;
    if (!el) return;
    el.setPointerCapture(event.pointerId);
    pointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
    const rect = el.getBoundingClientRect();
    if (pointers.current.size === 2) {
      const [a, b] = [...pointers.current.values()] as [
        { x: number; y: number },
        { x: number; y: number },
      ];
      gesture.current = {
        dist: Math.hypot(a.x - b.x, a.y - b.y),
        scale: view.scale,
        mid: { x: (a.x + b.x) / 2 - rect.left, y: (a.y + b.y) / 2 - rect.top },
        view,
      };
    } else {
      const now = Date.now();
      if (now - lastTap.current < 300) {
        if (view.scale > 1.05) setView({ scale: 1, x: 0, y: 0 });
        else zoomAt(2.2, event.clientX - rect.left, event.clientY - rect.top);
      }
      lastTap.current = now;
      gesture.current = {
        dist: 0,
        scale: view.scale,
        mid: { x: event.clientX, y: event.clientY },
        view,
      };
    }
  };

  const onPointerMove = (event: PointerEvent) => {
    if (!pointers.current.has(event.pointerId)) return;
    pointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
    const g = gesture.current;
    if (!g) return;
    if (pointers.current.size >= 2 && g.dist > 0) {
      const [a, b] = [...pointers.current.values()] as [
        { x: number; y: number },
        { x: number; y: number },
      ];
      const scale = clamp((g.scale * Math.hypot(a.x - b.x, a.y - b.y)) / g.dist, MIN, MAX);
      const ratio = scale / g.view.scale;
      setView(
        bound({
          scale,
          x: g.mid.x - (g.mid.x - g.view.x) * ratio,
          y: g.mid.y - (g.mid.y - g.view.y) * ratio,
        }),
      );
    } else if (pointers.current.size === 1 && g.dist === 0 && view.scale > 1) {
      setView(
        bound({
          ...g.view,
          x: g.view.x + event.clientX - g.mid.x,
          y: g.view.y + event.clientY - g.mid.y,
        }),
      );
    }
  };

  const onPointerUp = (event: PointerEvent) => {
    pointers.current.delete(event.pointerId);
    if (pointers.current.size === 0) gesture.current = null;
  };

  return (
    <div className="relative">
      <div
        ref={frame}
        data-testid={testId}
        className="relative w-full touch-pan-y overflow-hidden rounded-control border border-border bg-hue-gray-soft select-none"
        style={{
          aspectRatio: `${width} / ${height}`,
          touchAction: view.scale > 1 ? "none" : "pan-y",
        }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
      >
        <div
          className="absolute inset-0 origin-top-left transition-transform duration-75"
          style={{ transform: `translate(${view.x}px, ${view.y}px) scale(${view.scale})` }}
        >
          <img src={src} alt={alt} draggable={false} className="block size-full" />
          {region && (
            <div
              data-testid="citation-region"
              aria-hidden
              className="absolute rounded-inline border-2 border-hue-orange-solid bg-hue-yellow-solid/15 shadow-[0_0_0_4px_color-mix(in_srgb,var(--color-surface)_50%,transparent)]"
              style={{
                left: `${region.x * 100}%`,
                top: `${region.y * 100}%`,
                width: `${region.width * 100}%`,
                height: `${region.height * 100}%`,
              }}
            />
          )}
          {overlay}
        </div>
      </div>
      <div className="absolute right-2 bottom-2 flex gap-1 rounded-card border border-border bg-(--color-chrome) p-0.5 shadow-card backdrop-blur">
        <IconButton
          label="Zoom out"
          size="sm"
          onClick={() => zoomAt(1 / 1.4)}
          disabled={view.scale <= MIN}
        >
          <Minus className="size-4" />
        </IconButton>
        <IconButton label="Reset zoom" size="sm" onClick={() => setView({ scale: 1, x: 0, y: 0 })}>
          <Maximize className="size-4" />
        </IconButton>
        <IconButton
          label="Zoom in"
          size="sm"
          onClick={() => zoomAt(1.4)}
          disabled={view.scale >= MAX}
        >
          <Plus className="size-4" />
        </IconButton>
      </div>
    </div>
  );
}
