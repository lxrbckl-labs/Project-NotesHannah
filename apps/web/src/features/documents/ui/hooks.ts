import { useEffect, useState, useSyncExternalStore } from "react";

/** Layouts: phone < 768, tablet 768–1279, computer ≥ 1280 (the shell's breakpoints). */
export type Layout = "phone" | "tablet" | "computer";

const subscribers = new Map<string, (callback: () => void) => () => void>();

function subscribeMedia(query: string) {
  let existing = subscribers.get(query);
  if (!existing) {
    existing = makeSubscriber(query);
    subscribers.set(query, existing);
  }
  return existing;
}

function makeSubscriber(query: string) {
  return (callback: () => void) => {
    if (typeof window === "undefined" || !window.matchMedia) return () => {};
    const list = window.matchMedia(query);
    list.addEventListener("change", callback);
    return () => list.removeEventListener("change", callback);
  };
}

export function useMediaQuery(query: string): boolean {
  return useSyncExternalStore(
    subscribeMedia(query),
    () =>
      typeof window !== "undefined" && window.matchMedia ? window.matchMedia(query).matches : false,
    () => false,
  );
}

export function useLayout(): Layout {
  const computer = useMediaQuery("(min-width: 1280px)");
  const tablet = useMediaQuery("(min-width: 768px)");
  return computer ? "computer" : tablet ? "tablet" : "phone";
}

/** True on touch-first devices (phone, iPad): touch UI instead of hover chrome. */
export function useIsTouch(): boolean {
  const coarse = useMediaQuery("(pointer: coarse)");
  const [points] = useState(() =>
    typeof navigator !== "undefined" ? navigator.maxTouchPoints : 0,
  );
  return coarse || points > 0;
}

export function useReducedMotion(): boolean {
  return useMediaQuery("(prefers-reduced-motion: reduce)");
}

/** Height the on-screen keyboard covers, from the visual viewport (0 when none). */
export function useKeyboardInset(): number {
  const [inset, setInset] = useState(0);
  useEffect(() => {
    const vv = window.visualViewport;
    if (!vv) return;
    const update = () => setInset(Math.max(0, window.innerHeight - vv.height - vv.offsetTop));
    update();
    vv.addEventListener("resize", update);
    vv.addEventListener("scroll", update);
    return () => {
      vv.removeEventListener("resize", update);
      vv.removeEventListener("scroll", update);
    };
  }, []);
  return inset;
}

/**
 * Whether a sideways scroller has more to show before and after what is in view, for the
 * soft edge shadows on wide tables. Follows scrolling and resizing.
 */
export function useScrollEdges(ref: { current: HTMLElement | null }): {
  start: boolean;
  end: boolean;
} {
  const [edges, setEdges] = useState({ start: false, end: false });
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const update = () => {
      const start = el.scrollLeft > 1;
      const end = el.scrollLeft + el.clientWidth < el.scrollWidth - 1;
      setEdges((e) => (e.start === start && e.end === end ? e : { start, end }));
    };
    update();
    el.addEventListener("scroll", update, { passive: true });
    const observer = typeof ResizeObserver !== "undefined" ? new ResizeObserver(update) : null;
    observer?.observe(el);
    const inner = el.firstElementChild;
    if (inner) observer?.observe(inner);
    return () => {
      el.removeEventListener("scroll", update);
      observer?.disconnect();
    };
  }, [ref]);
  return edges;
}

const time = new Intl.DateTimeFormat(undefined, {
  day: "numeric",
  month: "short",
  hour: "numeric",
  minute: "2-digit",
});

export function formatWhen(iso: string): string {
  const date = new Date(iso);
  const diff = Date.now() - date.getTime();
  if (diff < 60_000) return "just now";
  if (diff < 3_600_000) return `${Math.round(diff / 60_000)} min ago`;
  return time.format(date);
}
