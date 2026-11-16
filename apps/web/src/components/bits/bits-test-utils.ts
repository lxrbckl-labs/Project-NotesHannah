import { vi } from "vitest";

/** Make `(prefers-reduced-motion: reduce)` true or false, keeping the other queries from test/setup.ts. */
export function setReducedMotion(reduced: boolean) {
  const base = window.matchMedia;
  window.matchMedia = ((query: string) => {
    const result = base(query);
    if (query.includes("prefers-reduced-motion")) return { ...result, matches: reduced };
    return result;
  }) as typeof window.matchMedia;
}

/** Give jsdom a 2D canvas that accepts every drawing call, so canvas components can run. */
export function stubCanvas2d() {
  const make = () => {
    const state: Record<string | symbol, unknown> = {};
    return new Proxy(state, {
      get(target, key) {
        if (key in target) return target[key];
        if (key === "createLinearGradient" || key === "createRadialGradient") {
          return () => ({ addColorStop: () => {} });
        }
        return () => {};
      },
      set(target, key, value) {
        target[key] = value;
        return true;
      },
    });
  };
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockImplementation((() =>
    make()) as unknown as typeof HTMLCanvasElement.prototype.getContext);
}

/** The root element's custom property, set for one test (the cleanup in test/setup.ts does not reset it). */
export function setToken(name: string, value: string) {
  document.documentElement.style.setProperty(name, value);
}

export function clearTokens() {
  document.documentElement.removeAttribute("style");
}
