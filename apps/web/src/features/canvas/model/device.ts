import { useEffect, useState } from "react";

/** Phone below 768px, computer from 1280px, tablet between (as the app shell). */
export type DeviceClass = "phone" | "tablet" | "computer";

function read(): { device: DeviceClass; coarse: boolean; reducedMotion: boolean } {
  if (typeof window === "undefined" || !window.matchMedia)
    return { device: "computer", coarse: false, reducedMotion: false };
  const width = window.innerWidth;
  const device: DeviceClass = width < 768 ? "phone" : width < 1280 ? "tablet" : "computer";
  const coarse = window.matchMedia("(pointer: coarse)").matches;
  const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  return { device, coarse, reducedMotion };
}

/**
 * Device class, pointer kind and reduced motion; updates live. The theme is not read here: the
 * canvas's colours are the app's tokens, so it follows the app theme in CSS alone.
 */
export function useDevice() {
  const [state, setState] = useState(read);
  useEffect(() => {
    const update = () =>
      setState((prev) => {
        const next = read();
        return JSON.stringify(prev) === JSON.stringify(next) ? prev : next;
      });
    window.addEventListener("resize", update);
    const queries = ["(pointer: coarse)", "(prefers-reduced-motion: reduce)"].map((q) =>
      window.matchMedia?.(q),
    );
    for (const q of queries) q?.addEventListener?.("change", update);
    return () => {
      window.removeEventListener("resize", update);
      for (const q of queries) q?.removeEventListener?.("change", update);
    };
  }, []);
  return state;
}
