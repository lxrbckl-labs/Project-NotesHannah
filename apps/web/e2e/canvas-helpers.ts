import { expect, type Locator, type Page, type TestInfo } from "@playwright/test";

/** Helpers for the canvas specs, run against the standalone demo (canvas-demo.html). */

export const isTouch = (info: TestInfo) => info.project.name !== "computer";
export const isPhone = (info: TestInfo) => info.project.name === "phone";

export async function openDemo(page: Page, query = "") {
  await page.goto(`/canvas-demo.html?reset=1${query}`);
  await expect(page.getByTestId("canvas-view")).toHaveAttribute("data-ready", "true", {
    timeout: 20_000,
  });
  // Let the measured re-layout settle.
  await page.waitForTimeout(900);
}

/** Reload without resetting what was saved. */
export async function reloadDemo(page: Page) {
  await page.goto("/canvas-demo.html");
  await expect(page.getByTestId("canvas-view")).toHaveAttribute("data-ready", "true", {
    timeout: 20_000,
  });
  await page.waitForTimeout(600);
}

export function card(page: Page, text: string): Locator {
  return page.locator(".react-flow__node-card", { hasText: text }).first();
}

export async function viewport(page: Page) {
  return page.locator(".react-flow__viewport").evaluate((el) => {
    const m = new DOMMatrixReadOnly(getComputedStyle(el).transform);
    return { x: m.e, y: m.f, zoom: m.a };
  });
}

/** A node's position in canvas units. */
export async function flowPosition(locator: Locator) {
  return locator.evaluate((el) => {
    const m = new DOMMatrixReadOnly(getComputedStyle(el).transform);
    return { x: Math.round(m.e), y: Math.round(m.f) };
  });
}

export async function center(locator: Locator) {
  const box = await locator.boundingBox();
  if (!box) throw new Error("not visible");
  return { x: box.x + box.width / 2, y: box.y + box.height / 2, box };
}

/** A point on the empty canvas (no card, frame title or chrome under it, nor `clearance` px to each side). */
export async function emptyPoint(page: Page, clearance = 0) {
  const point = await page.evaluate((clear) => {
    const w = innerWidth;
    const h = innerHeight;
    const pane = (x: number, y: number) =>
      document.elementFromPoint(x, y)?.classList.contains("react-flow__pane") ?? false;
    for (let y = h * 0.25; y < h * 0.8; y += 23) {
      for (let x = w * 0.15; x < w * 0.85; x += 29) {
        if (pane(x, y) && pane(x - clear, y) && pane(x + clear, y)) return { x, y };
      }
    }
    return null;
  }, clearance);
  if (!point) throw new Error("no empty canvas point");
  return point;
}

type Pt = { x: number; y: number };

/** A real touch drag (one finger), through the Chrome DevTools protocol. */
export async function touchDrag(page: Page, from: Pt, to: Pt, steps = 12) {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("Input.dispatchTouchEvent", {
    type: "touchStart",
    touchPoints: [{ ...from, id: 1 }],
  });
  for (let i = 1; i <= steps; i++) {
    const x = from.x + ((to.x - from.x) * i) / steps;
    const y = from.y + ((to.y - from.y) * i) / steps;
    await cdp.send("Input.dispatchTouchEvent", {
      type: "touchMove",
      touchPoints: [{ x, y, id: 1 }],
    });
    await page.waitForTimeout(16);
  }
  await page.waitForTimeout(120); // rest before lifting: no momentum
  await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  await cdp.detach();
}

/** A two-finger pinch around a point; scale > 1 zooms in. */
export async function pinch(page: Page, at: Pt, scale: number, steps = 10) {
  const cdp = await page.context().newCDPSession(page);
  const start = 50;
  const end = start * scale;
  const points = (d: number) => [
    { x: at.x - d, y: at.y, id: 1 },
    { x: at.x + d, y: at.y, id: 2 },
  ];
  await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: points(start) });
  for (let i = 1; i <= steps; i++) {
    await cdp.send("Input.dispatchTouchEvent", {
      type: "touchMove",
      touchPoints: points(start + ((end - start) * i) / steps),
    });
    await page.waitForTimeout(16);
  }
  await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  await cdp.detach();
}

/** Drag a card: with the mouse on a computer, a finger on touch devices. */
export async function dragBy(page: Page, info: TestInfo, target: Locator, dx: number, dy: number) {
  const { x, y } = await center(target);
  await dragTo(page, info, { x, y }, { x: x + dx, y: y + dy });
}

export async function dragTo(page: Page, info: TestInfo, from: Pt, to: Pt) {
  if (isTouch(info)) {
    await touchDrag(page, from, to, 16);
    return;
  }
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  for (let i = 1; i <= 12; i++)
    await page.mouse.move(from.x + ((to.x - from.x) * i) / 12, from.y + ((to.y - from.y) * i) / 12);
  await page.mouse.up();
}

export async function tap(page: Page, info: TestInfo, locator: Locator) {
  if (isTouch(info)) {
    const { x, y } = await center(locator);
    await page.touchscreen.tap(x, y);
  } else await locator.click();
}

/** On a phone the canvas opens on one frame; show the whole map first. */
export async function wholeMap(page: Page, info: TestInfo) {
  if (!isPhone(info)) return;
  await page.getByRole("button", { name: "Whole map" }).first().click();
  await page.waitForTimeout(500);
}

export async function demoCanvas(page: Page) {
  return page.evaluate(() => {
    const demo = (
      window as unknown as {
        __canvasDemo: { store: { current(id: string): unknown }; documentId: string };
      }
    ).__canvasDemo;
    return demo.store.current(demo.documentId) as {
      canvas: {
        cards: Array<{ id: string; position: unknown }>;
        frames: Array<{ id: string; title: string; members: string[] }>;
        connectors: Array<{ label?: string }>;
      };
    };
  });
}
