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

/**
 * Show the whole map. A phone opens on one frame; a tablet or computer opens on its first frame too
 * when the whole map would be drawn too small to read (the demo's map is, at both sizes).
 */
export async function wholeMap(page: Page, info: TestInfo) {
  if (isPhone(info)) await page.getByRole("button", { name: "Whole map" }).first().click();
  else await page.getByRole("button", { name: /Whole map/ }).click();
  await page.waitForTimeout(500);
}

/** Fail early, with a reason, when a gesture would start or end outside the window. */
export function expectOnScreen(page: Page, point: Pt, what: string) {
  const size = page.viewportSize() as { width: number; height: number };
  expect(
    point.x >= 0 && point.y >= 0 && point.x <= size.width && point.y <= size.height,
    `${what} at ${Math.round(point.x)},${Math.round(point.y)} is outside the ${size.width}x${size.height} window`,
  ).toBe(true);
}

/**
 * Watch every drawn frame for cards whose boxes intersect (in canvas units), from before the page
 * loads. A layout that is right only after a later pass still shows its overlap for a frame or more,
 * which is what she sees, so the check runs per frame rather than once at the end.
 */
export async function watchOverlaps(page: Page) {
  await page.addInitScript(() => {
    const seen: string[] = [];
    (window as unknown as { __overlaps: string[] }).__overlaps = seen;
    const tick = () => {
      // A map kept out of sight (opacity 0 while it is laid out) is not drawn.
      const map = document.querySelector(".react-flow__viewport");
      const drawn = !!map && getComputedStyle(map).opacity !== "0";
      const boxes = [...document.querySelectorAll<HTMLElement>(".react-flow__node-card")]
        .filter(() => drawn)
        .filter((el) => getComputedStyle(el).visibility !== "hidden")
        .map((el) => {
          const m = new DOMMatrixReadOnly(getComputedStyle(el).transform);
          return {
            text: (el.textContent ?? "").slice(0, 24),
            x: m.e,
            y: m.f,
            w: el.offsetWidth,
            h: el.offsetHeight,
          };
        });
      for (let i = 0; i < boxes.length; i++)
        for (let j = i + 1; j < boxes.length; j++) {
          const a = boxes[i] as (typeof boxes)[number];
          const b = boxes[j] as (typeof boxes)[number];
          const ox = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
          const oy = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
          if (ox > 1 && oy > 1) {
            const line = `"${a.text}" and "${b.text}" overlap by ${Math.round(ox)}x${Math.round(oy)}`;
            if (!seen.includes(line) && seen.length < 50) seen.push(line);
          }
        }
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
}

export async function overlapsSeen(page: Page): Promise<string[]> {
  return page.evaluate(() => (window as unknown as { __overlaps: string[] }).__overlaps);
}

/**
 * Card text drawn larger than the demo's own renderer draws it, as the app's study-guide renderer
 * does (17 px reading text): the size estimate is then too small, as it was on her canvas.
 */
export async function largerCardText(page: Page) {
  await page.addInitScript(() => {
    const style = document.createElement("style");
    style.textContent =
      ".nc-card-body p, .nc-card-body li { font-size: 19px !important; line-height: 32px !important; }";
    document.addEventListener("DOMContentLoaded", () => document.head.append(style));
  });
}

/** Insert a paragraph into the demo document after the block whose text starts with `after`. */
export async function insertParagraph(page: Page, after: string, text: string) {
  await page.evaluate(
    ({ after, text }) => {
      const demo = (
        window as unknown as {
          __canvasDemo: {
            store: {
              current(id: string): {
                blocks: Array<{ id: string; type: string; content: unknown }>;
              };
              setBlocks(id: string, blocks: unknown[]): void;
            };
            documentId: string;
          };
        }
      ).__canvasDemo;
      const plain = (value: unknown): string =>
        typeof value === "string"
          ? value
          : Array.isArray(value)
            ? value.map((r) => (r as { text?: string }).text ?? "").join("")
            : "";
      const blocks = demo.store.current(demo.documentId).blocks;
      const index = blocks.findIndex(
        (b) =>
          b.type === "paragraph" && plain((b.content as { text?: unknown }).text).startsWith(after),
      );
      if (index < 0) throw new Error(`no paragraph starting "${after}"`);
      const source = blocks[index] as { content: { text: unknown } };
      const alphabet = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
      let id = "blk_01J";
      for (let i = 0; i < 23; i++) id += alphabet[Math.floor(Math.random() * 32)];
      const block = {
        ...source,
        id,
        citations: [],
        content: {
          ...source.content,
          text: typeof source.content.text === "string" ? text : [{ text }],
        },
      };
      demo.store.setBlocks(demo.documentId, [
        ...blocks.slice(0, index + 1),
        block,
        ...blocks.slice(index + 1),
      ]);
    },
    { after, text },
  );
}

/** Every pair of card boxes (canvas units) that intersect now. */
export async function cardOverlaps(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const boxes = [...document.querySelectorAll<HTMLElement>(".react-flow__node-card")].map(
      (el) => {
        const m = new DOMMatrixReadOnly(getComputedStyle(el).transform);
        return {
          text: (el.textContent ?? "").slice(0, 24),
          x: m.e,
          y: m.f,
          w: el.offsetWidth,
          h: el.offsetHeight,
        };
      },
    );
    const out: string[] = [];
    for (let i = 0; i < boxes.length; i++)
      for (let j = i + 1; j < boxes.length; j++) {
        const a = boxes[i] as (typeof boxes)[number];
        const b = boxes[j] as (typeof boxes)[number];
        const ox = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
        const oy = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
        if (ox > 1 && oy > 1) out.push(`"${a.text}" and "${b.text}"`);
      }
    return out;
  });
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
