import type { ColorToken } from "@notes/schema";
import { type CSSProperties, useEffect, useState, useSyncExternalStore } from "react";

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

/** CSS variables for one colour token, read by the .doc-tone classes. */
export function toneVars(token: ColorToken | undefined): CSSProperties {
  const t = token ?? "gray";
  return {
    "--t-fg": `var(--doc-${t}-fg)`,
    "--t-bg": `var(--doc-${t}-bg)`,
    "--t-border": `var(--doc-${t}-border)`,
    "--t-hl": `var(--doc-${t}-hl)`,
    "--t-solid": `var(--doc-${t}-solid)`,
  } as CSSProperties;
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
