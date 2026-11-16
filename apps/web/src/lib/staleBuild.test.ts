import { expect, test, vi } from "vitest";
import { installStaleBuildReload, shouldReload } from "./staleBuild";

function setup(start = 1_000_000) {
  const target = new EventTarget();
  const store = new Map<string, string>();
  const storage = {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, v),
  };
  const reload = vi.fn();
  let time = start;
  installStaleBuildReload(target as unknown as Window, storage, reload, () => time);
  const fire = () => {
    const event = new Event("vite:preloadError", { cancelable: true });
    target.dispatchEvent(event);
    return event;
  };
  return { fire, reload, advance: (ms: number) => (time += ms) };
}

test("a failed script load reloads the page once and swallows the error", () => {
  const t = setup();
  const event = t.fire();
  expect(t.reload).toHaveBeenCalledTimes(1);
  expect(event.defaultPrevented).toBe(true);
});

test("a second failure straight after does not reload again", () => {
  const t = setup();
  t.fire();
  const second = t.fire();
  expect(t.reload).toHaveBeenCalledTimes(1);
  // Left unhandled so the real error shows instead of a reload loop.
  expect(second.defaultPrevented).toBe(false);
  t.advance(61_000);
  t.fire();
  expect(t.reload).toHaveBeenCalledTimes(2);
});

test("shouldReload", () => {
  expect(shouldReload(null, 5)).toBe(true);
  expect(shouldReload("1000", 2000)).toBe(false);
  expect(shouldReload("1000", 70_000)).toBe(true);
});
