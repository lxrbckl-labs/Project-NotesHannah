import { expect, test } from "vitest";
import { tabDirection, tabIndex } from "./tabDirection";

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
