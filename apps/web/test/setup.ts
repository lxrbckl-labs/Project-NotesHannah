import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { afterEach, beforeEach, vi } from "vitest";

/** matchMedia for jsdom: understands min-width, max-width, hover and pointer against innerWidth. */
function matches(query: string): boolean {
  const width = window.innerWidth;
  return query.split(/\s+and\s+/).every((part) => {
    const text = part.replace(/[()]/g, "").trim();
    const min = text.match(/^min-width:\s*(\d+)px$/);
    if (min) return width >= Number(min[1]);
    const max = text.match(/^max-width:\s*(\d+)px$/);
    if (max) return width <= Number(max[1]);
    if (text === "hover: hover" || text === "pointer: fine") return true;
    if (text.startsWith("prefers-")) return false;
    return false;
  });
}

beforeEach(() => {
  window.innerWidth = 1440;
  window.matchMedia = ((query: string) => ({
    matches: matches(query),
    media: query,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
    dispatchEvent: () => false,
    onchange: null,
  })) as typeof window.matchMedia;
});

// Radix and jsdom: pieces jsdom lacks.
class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
vi.stubGlobal("ResizeObserver", ResizeObserverStub);
Element.prototype.scrollIntoView = () => {};
Element.prototype.hasPointerCapture = () => false;
Element.prototype.setPointerCapture = () => {};
Element.prototype.releasePointerCapture = () => {};

afterEach(() => {
  cleanup();
  localStorage.clear();
  sessionStorage.clear();
  delete document.documentElement.dataset.theme;
  vi.unstubAllGlobals();
  vi.stubGlobal("ResizeObserver", ResizeObserverStub);
});
