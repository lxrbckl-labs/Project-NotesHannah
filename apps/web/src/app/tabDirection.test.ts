import { resolveTabOrder } from "@notes/schema";
import { expect, test } from "vitest";
import { tabDirection, tabIndex } from "./tabDirection";
import { moveTab, sameOrder, slotAt, TAB_DEFS, tabPaths } from "./tabs";

const TABS = ["/library", "/practice", "/search", "/inbox", "/settings"];

test("a tab to the right slides forward, one to the left slides back", () => {
  expect(tabDirection(TABS, "/library", "/settings")).toBe("forward");
  expect(tabDirection(TABS, "/settings", "/practice")).toBe("back");
  expect(tabDirection(TABS, "/search", "/inbox")).toBe("forward");
  expect(tabDirection(TABS, "/inbox", "/search")).toBe("back");
});

test("the same tab does not slide, even from a screen inside it", () => {
  expect(tabDirection(TABS, "/practice", "/practice")).toBe("none");
  expect(tabDirection(TABS, "/library/nod_1", "/library")).toBe("none");
});

test("a screen under no tab counts as the library", () => {
  expect(tabIndex(TABS, "/doc/nod_1")).toBe(-1);
  expect(tabDirection(TABS, "/doc/nod_1", "/inbox")).toBe("forward");
  expect(tabDirection(TABS, "/help", "/library")).toBe("none");
});

test("the direction follows her order: Settings moved to the far left", () => {
  const mine = tabPaths(["settings", "library", "practice", "search", "inbox"]);
  expect(mine[0]).toBe("/settings");
  // Settings is now left of everything, so reaching it from anywhere slides back...
  expect(tabDirection(mine, "/inbox", "/settings")).toBe("back");
  expect(tabDirection(mine, "/library", "/settings")).toBe("back");
  // ...and leaving it slides forward, which in the default order was "back".
  expect(tabDirection(mine, "/settings", "/library")).toBe("forward");
  expect(tabDirection(TABS, "/settings", "/library")).toBe("back");
  // The inbox is now the last tab; the library is second.
  expect(tabDirection(mine, "/library", "/inbox")).toBe("forward");
});

test("a screen under no tab counts as the library wherever she has put it", () => {
  const mine = tabPaths(["settings", "library", "practice", "search", "inbox"]);
  expect(tabDirection(mine, "/help", "/settings")).toBe("back");
  expect(tabDirection(mine, "/help", "/practice")).toBe("forward");
  const libraryLast = tabPaths(["practice", "search", "inbox", "settings", "library"]);
  expect(tabDirection(libraryLast, "/doc/nod_1", "/practice")).toBe("back");
});

test("moveTab puts one tab at a place and keeps the others in order", () => {
  const order = resolveTabOrder(null);
  expect(moveTab(order, "settings", 0)).toEqual([
    "settings",
    "library",
    "practice",
    "search",
    "inbox",
  ]);
  expect(moveTab(order, "library", 2)).toEqual([
    "practice",
    "search",
    "library",
    "inbox",
    "settings",
  ]);
  expect(moveTab(order, "inbox", 99)).toEqual(moveTab(order, "inbox", 4));
  expect(moveTab(order, "inbox", -3)[0]).toBe("inbox");
  expect(moveTab(order, "library", 0)).toEqual(order);
});

test("slotAt names the slot a dragged tab is over", () => {
  // Five slots 78px wide; a tab that began in slot 1.
  expect(slotAt(1, 0, 78, 5)).toBe(1);
  expect(slotAt(1, 30, 78, 5)).toBe(1);
  expect(slotAt(1, 40, 78, 5)).toBe(2);
  expect(slotAt(1, -120, 78, 5)).toBe(0);
  expect(slotAt(1, 900, 78, 5)).toBe(4);
  expect(slotAt(1, -900, 78, 5)).toBe(0);
  expect(slotAt(2, 10, 0, 5)).toBe(2);
});

test("every tab has a path and a label, and sameOrder compares lists", () => {
  for (const def of Object.values(TAB_DEFS)) {
    expect(def.to.startsWith("/")).toBe(true);
    expect(def.label.length).toBeGreaterThan(0);
  }
  expect(sameOrder(["a", "b"], ["a", "b"])).toBe(true);
  expect(sameOrder(["a", "b"], ["b", "a"])).toBe(false);
  expect(sameOrder(["a"], ["a", "b"])).toBe(false);
});
