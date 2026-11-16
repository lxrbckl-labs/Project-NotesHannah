import { useSyncExternalStore } from "react";

/** Subscribe to a CSS media query. */
export function useMediaQuery(query: string): boolean {
  return useSyncExternalStore(
    (notify) => {
      const list = window.matchMedia(query);
      list.addEventListener("change", notify);
      return () => list.removeEventListener("change", notify);
    },
    () => window.matchMedia(query).matches,
    () => false,
  );
}

/** Phone < 768px, tablet 768 to 1279px, computer from 1280px (same breakpoints as the CSS). */
export function useLayout(): "phone" | "tablet" | "computer" {
  const md = useMediaQuery("(min-width: 768px)");
  const xl = useMediaQuery("(min-width: 1280px)");
  return xl ? "computer" : md ? "tablet" : "phone";
}

/** A mouse or trackpad that can hover: the layouts where drag and drop is offered. */
export function useFinePointer(): boolean {
  return useMediaQuery("(hover: hover) and (pointer: fine)");
}
