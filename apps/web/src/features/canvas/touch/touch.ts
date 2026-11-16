import type { ReactFlowInstance, Viewport } from "@xyflow/react";
import { type RefObject, useCallback, useEffect, useRef } from "react";

/** Width of the screen-edge strips where iOS starts its back/forward swipe. */
export const EDGE_GUARD_PX = 24;

/**
 * iPad and iPhone Safari guards for a full-screen canvas:
 * - a touch that starts in the left or right edge strip has its default
 *   prevented, so Safari's back/forward swipe never fires from the canvas
 *   (the touch still pans the canvas);
 * - Safari's own pinch (gesturestart/gesturechange) is cancelled, so a
 *   pinch zooms the canvas and never the page;
 * - overscroll bounce and pull-to-refresh are switched off while mounted.
 */
export function useTouchGuards(ref: RefObject<HTMLElement | null>) {
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const onTouchStart = (e: TouchEvent) => {
      const t = e.touches[0];
      if (!t) return;
      if (t.clientX < EDGE_GUARD_PX || t.clientX > window.innerWidth - EDGE_GUARD_PX) {
        // Do not block text fields and buttons in the chrome.
        const target = e.target as HTMLElement | null;
        if (target?.closest("button, input, textarea, select, a")) return;
        e.preventDefault();
      }
    };
    const stopGesture = (e: Event) => e.preventDefault();
    el.addEventListener("touchstart", onTouchStart, { passive: false });
    el.addEventListener("gesturestart", stopGesture, { passive: false });
    el.addEventListener("gesturechange", stopGesture, { passive: false });
    const html = document.documentElement;
    const before = html.style.overscrollBehavior;
    html.style.overscrollBehavior = "none";
    return () => {
      el.removeEventListener("touchstart", onTouchStart);
      el.removeEventListener("gesturestart", stopGesture);
      el.removeEventListener("gesturechange", stopGesture);
      html.style.overscrollBehavior = before;
    };
  }, [ref]);
}

/**
 * Momentum after a one-finger pan: the canvas glides on and slows down,
 * like a native scroll view. Off when reduced motion is requested.
 */
export function useMomentum(flow: RefObject<ReactFlowInstance | null>, disabled: boolean) {
  const samples = useRef<Array<{ t: number; x: number; y: number }>>([]);
  const touching = useRef(false);
  const frame = useRef<number | null>(null);

  const stop = useCallback(() => {
    if (frame.current !== null) cancelAnimationFrame(frame.current);
    frame.current = null;
  }, []);

  const onMoveStart = useCallback(
    (event: MouseEvent | TouchEvent | null, viewport: Viewport) => {
      if (!event) return; // our own glide (setViewport) or a programmatic move
      stop();
      touching.current = !!event && "touches" in event && event.touches.length === 1;
      samples.current = [{ t: performance.now(), x: viewport.x, y: viewport.y }];
    },
    [stop],
  );

  const onMove = useCallback((event: MouseEvent | TouchEvent | null, viewport: Viewport) => {
    if (!touching.current) return;
    if (event && "touches" in event && event.touches.length > 1) {
      touching.current = false; // a pinch, not a pan
      return;
    }
    const now = performance.now();
    samples.current.push({ t: now, x: viewport.x, y: viewport.y });
    while (samples.current.length > 2 && now - (samples.current[0]?.t ?? now) > 100)
      samples.current.shift();
  }, []);

  const onMoveEnd = useCallback(
    (_event: MouseEvent | TouchEvent | null, viewport: Viewport) => {
      if (!touching.current || disabled) return;
      touching.current = false;
      const first = samples.current[0];
      const last = samples.current[samples.current.length - 1];
      if (!first || !last || last.t - first.t < 8) return;
      if (performance.now() - last.t > 60) return; // finger rested before lifting
      let vx = (last.x - first.x) / (last.t - first.t);
      let vy = (last.y - first.y) / (last.t - first.t);
      if (Math.hypot(vx, vy) < 0.25) return;
      let x = viewport.x;
      let y = viewport.y;
      let prev = performance.now();
      const step = () => {
        const now = performance.now();
        const dt = Math.min(32, now - prev);
        prev = now;
        x += vx * dt;
        y += vy * dt;
        const decay = 0.94 ** (dt / 16);
        vx *= decay;
        vy *= decay;
        flow.current?.setViewport({ x, y, zoom: viewport.zoom });
        if (Math.hypot(vx, vy) > 0.02) frame.current = requestAnimationFrame(step);
        else frame.current = null;
      };
      frame.current = requestAnimationFrame(step);
    },
    [disabled, flow],
  );

  useEffect(() => stop, [stop]);
  return { onMoveStart, onMove, onMoveEnd, stop };
}
