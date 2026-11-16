import { useCallback, useEffect, useRef, useState } from "react";

/** Subscribes to a media query. */
export function useMedia(query: string, initial = false): boolean {
  const [matches, setMatches] = useState(() =>
    typeof window !== "undefined" && window.matchMedia ? window.matchMedia(query).matches : initial,
  );
  useEffect(() => {
    if (!window.matchMedia) return;
    const mq = window.matchMedia(query);
    const on = () => setMatches(mq.matches);
    on();
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, [query]);
  return matches;
}

export const useFinePointer = () => useMedia("(pointer: fine)");
export const useReducedMotion = () => useMedia("(prefers-reduced-motion: reduce)");

/**
 * Sets `--pr-vh` on an element to the visible height (shrinks when the on-screen keyboard opens),
 * so a full-height layout keeps its footer and the focused field above the keyboard.
 */
export function useVisibleHeight(ref: React.RefObject<HTMLElement | null>) {
  useEffect(() => {
    const vv = window.visualViewport;
    const el = ref.current;
    if (!vv || !el) return;
    const update = () => {
      el.style.setProperty("--pr-vh", `${vv.height}px`);
      el.style.setProperty("--pr-vt", `${vv.offsetTop}px`);
    };
    update();
    vv.addEventListener("resize", update);
    vv.addEventListener("scroll", update);
    return () => {
      vv.removeEventListener("resize", update);
      vv.removeEventListener("scroll", update);
    };
  }, [ref]);
}

/** Scrolls a focused field into the middle of the scroll area so the keyboard does not cover it. */
export function keepVisibleOnFocus(e: React.FocusEvent<HTMLElement>) {
  const el = e.currentTarget;
  window.setTimeout(() => el.scrollIntoView?.({ block: "center", behavior: "smooth" }), 250);
}

/** Active time on a question: stops while paused, restarts when `key` changes. */
export function useActiveTimer(key: string, paused: boolean) {
  const acc = useRef(0);
  const since = useRef<number | null>(null);
  const lastKey = useRef(key);
  if (lastKey.current !== key) {
    lastKey.current = key;
    acc.current = 0;
    since.current = null;
  }
  // biome-ignore lint/correctness/useExhaustiveDependencies: `key` restarts the clock for a new question
  useEffect(() => {
    if (paused) {
      if (since.current !== null) {
        acc.current += performance.now() - since.current;
        since.current = null;
      }
    } else if (since.current === null) {
      since.current = performance.now();
    }
  }, [paused, key]);
  return useCallback(() => {
    const running = since.current === null ? 0 : performance.now() - since.current;
    return Math.round(acc.current + running);
  }, []);
}

/** Loads something async and exposes reload. */
export function useAsync<T>(load: () => Promise<T>, deps: readonly unknown[]) {
  const [state, setState] = useState<{
    data: T | null;
    error: string | null;
    loading: boolean;
  }>({ data: null, error: null, loading: true });
  const run = useCallback(() => {
    let live = true;
    setState((s) => ({ ...s, loading: true, error: null }));
    load().then(
      (data) => live && setState({ data, error: null, loading: false }),
      (e: unknown) =>
        live &&
        setState({ data: null, error: e instanceof Error ? e.message : String(e), loading: false }),
    );
    return () => {
      live = false;
    };
    // biome-ignore lint/correctness/useExhaustiveDependencies: deps are supplied by the caller
  }, deps);
  useEffect(() => run(), [run]);
  return { ...state, reload: run };
}
