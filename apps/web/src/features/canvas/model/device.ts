import { useEffect, useState } from "react";

/** Phone below 768px, computer from 1280px, tablet between (as the app shell). */
export type DeviceClass = "phone" | "tablet" | "computer";

function read(): { device: DeviceClass; coarse: boolean; reducedMotion: boolean; dark: boolean } {
  if (typeof window === "undefined" || !window.matchMedia)
    return { device: "computer", coarse: false, reducedMotion: false, dark: false };
  const width = window.innerWidth;
  const device: DeviceClass = width < 768 ? "phone" : width < 1280 ? "tablet" : "computer";
  const coarse = window.matchMedia("(pointer: coarse)").matches;
  const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const forced = document.documentElement.dataset.theme;
  const dark = forced
    ? forced === "dark"
    : window.matchMedia("(prefers-color-scheme: dark)").matches;
  return { device, coarse, reducedMotion, dark };
}

/** Device class, pointer kind, reduced motion and the effective theme; updates live. */
export function useDevice() {
  const [state, setState] = useState(read);
  useEffect(() => {
    const update = () =>
      setState((prev) => {
        const next = read();
        return JSON.stringify(prev) === JSON.stringify(next) ? prev : next;
      });
    window.addEventListener("resize", update);
    const queries = [
      "(pointer: coarse)",
      "(prefers-reduced-motion: reduce)",
      "(prefers-color-scheme: dark)",
    ].map((q) => window.matchMedia?.(q));
    for (const q of queries) q?.addEventListener?.("change", update);
    const observer = new MutationObserver(update);
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["data-theme"],
    });
    return () => {
      window.removeEventListener("resize", update);
      for (const q of queries) q?.removeEventListener?.("change", update);
      observer.disconnect();
    };
  }, []);
  return state;
}
