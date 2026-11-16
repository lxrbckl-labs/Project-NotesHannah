import { expect, test } from "@playwright/test";
import {
  card,
  center,
  demoCanvas,
  dragBy,
  dragTo,
  emptyPoint,
  flowPosition,
  isPhone,
  isTouch,
  openDemo,
  pinch,
  reloadDemo,
  tap,
  touchDrag,
  viewport,
  wholeMap,
} from "./canvas-helpers";

test.describe("canvas", () => {
  test("pans, zooms and fits", async ({ page }, info) => {
    await openDemo(page);
    await wholeMap(page, info);
    const before = await viewport(page);
    const at = await emptyPoint(page);
    if (isTouch(info)) await touchDrag(page, at, { x: at.x - 80, y: at.y - 60 });
    else {
      await page.mouse.move(at.x, at.y);
      await page.mouse.wheel(120, 90);
    }
    await page.waitForTimeout(300);
    const panned = await viewport(page);
    expect(Math.abs(panned.x - before.x) + Math.abs(panned.y - before.y)).toBeGreaterThan(40);
    expect(panned.zoom).toBeCloseTo(before.zoom, 3);

    if (isTouch(info)) {
      const spot = await emptyPoint(page, 110);
      await pinch(page, spot, 2);
    } else {
      await page.getByRole("button", { name: "Zoom in" }).click();
    }
    await page.waitForTimeout(400);
    const zoomed = await viewport(page);
    expect(zoomed.zoom).toBeGreaterThan(panned.zoom * 1.1);

    // Fit brings every card back on screen.
    if (isPhone(info)) await page.getByRole("button", { name: "One frame at a time" }).click();
    if (isPhone(info)) await page.getByRole("button", { name: "Whole map" }).first().click();
    else await page.getByRole("button", { name: /Whole map/ }).click();
    await page.waitForTimeout(600);
    const size = page.viewportSize() as { width: number; height: number };
    for (const node of await page.locator(".react-flow__node-card").all()) {
      const box = await node.boundingBox();
      expect(box).not.toBeNull();
      if (!box) continue;
      expect(box.x).toBeGreaterThan(-2);
      expect(box.x + box.width).toBeLessThan(size.width + 2);
    }
  });

  test("a dragged card stays pinned after reload", async ({ page }, info) => {
    await openDemo(page);
    const target = card(page, "Myocardial oxygen demand");
    const before = await flowPosition(target);
    await dragBy(page, info, target, 70, 50);
    await expect(target.locator("[data-pinned=true]")).toBeVisible();
    const moved = await flowPosition(target);
    expect(Math.abs(moved.x - before.x) + Math.abs(moved.y - before.y)).toBeGreaterThan(30);
    await page.waitForTimeout(700); // debounced save
    await reloadDemo(page);
    const after = card(page, "Myocardial oxygen demand");
    await expect(after.locator("[data-pinned=true]")).toBeVisible();
    expect(await flowPosition(after)).toEqual(moved);
  });

  test("auto-arrange leaves pinned cards alone", async ({ page }) => {
    await openDemo(page);
    const pinned = card(page, "Ask Dr Patel");
    await expect(pinned.locator("[data-pinned=true]")).toHaveCount(1);
    const before = await flowPosition(pinned);
    await page.getByRole("button", { name: "Auto-arrange" }).click();
    await expect(page.getByTestId("toast")).toContainText("stayed where they are");
    expect(await flowPosition(pinned)).toEqual(before);
  });

  test("connects two cards and labels the connector", async ({ page }, info) => {
    await openDemo(page);
    const from = card(page, "β1 vs β2");
    const to = card(page, "β1 receptor");
    const count = (await demoCanvas(page)).canvas.connectors.length;
    if (isTouch(info)) {
      await page.getByRole("button", { name: /Connect cards/ }).click();
      await expect(page.getByTestId("mode-hint")).toContainText("start from");
      await tap(page, info, from);
      await expect(page.getByTestId("mode-hint")).toContainText("connect to");
      await tap(page, info, to);
    } else {
      await from.hover();
      const handle = from.locator('.react-flow__handle[data-handleid="t"]');
      const a = await center(handle);
      const b = await center(to);
      await dragTo(page, info, a, b);
    }
    const editor = page.getByTestId("connector-editor");
    await expect(editor).toBeVisible();
    const input = editor.getByRole("textbox", { name: "Connector label" });
    await input.fill("β1 lives here");
    await editor.getByRole("button", { name: "treats" }).click();
    await input.press("Enter");
    await expect(
      page.getByTestId("connector-label").filter({ hasText: "β1 lives here" }),
    ).toBeVisible();
    const stored = (await demoCanvas(page)).canvas.connectors;
    expect(stored).toHaveLength(count + 1);
    expect(stored.some((c) => c.label === "β1 lives here")).toBe(true);
  });

  test("adds a note and a sticker", async ({ page }) => {
    await openDemo(page);
    await page.getByRole("button", { name: /Add note/ }).click();
    const editor = page.getByRole("textbox", { name: "Note text" });
    await expect(editor).toBeFocused();
    await editor.fill("Bisoprolol is β1 too");
    await editor.blur();
    await expect(card(page, "Bisoprolol is β1 too")).toBeVisible();
    await page.getByRole("button", { name: "Add sticker" }).click();
    await page.getByRole("button", { name: "Add Heart sticker" }).click();
    await expect(page.getByRole("img", { name: "Heart sticker" })).toBeVisible();
    const cards = (await demoCanvas(page)).canvas.cards;
    expect(cards.length).toBeGreaterThan(20);
  });

  test("moves a card into a frame by dragging", async ({ page }, info) => {
    await openDemo(page);
    await wholeMap(page, info);
    const intro = card(page, "compete with adrenaline");
    const frame = page.locator('[data-testid="canvas-frame"]', { hasText: "Counselling" });
    const counselling = (await demoCanvas(page)).canvas.frames.find(
      (f) => f.title === "Counselling",
    );
    const introId = await intro.getAttribute("data-id");
    expect(counselling?.members).not.toContain(introId);
    const a = await center(intro);
    const box = (await frame.boundingBox()) as {
      x: number;
      y: number;
      width: number;
      height: number;
    };
    // Drop on the lower part of the frame, inside its border.
    await dragTo(page, info, a, { x: box.x + box.width / 2, y: box.y + box.height - 20 });
    await expect(page.getByTestId("toast")).toContainText("Moved into “Counselling”");
    const after = (await demoCanvas(page)).canvas.frames.find((f) => f.title === "Counselling");
    expect(after?.members).toContain(introId);
  });

  test("steps through frames", async ({ page }, info) => {
    await openDemo(page);
    if (!isPhone(info)) await page.getByRole("button", { name: "Step through frames" }).click();
    const bar = page.getByTestId("step-bar");
    await expect(bar).toBeVisible();
    await expect(page.getByTestId("step-title")).toHaveText("Mechanism");
    await bar.getByRole("button", { name: "Next frame" }).click();
    await expect(page.getByTestId("step-title")).toHaveText("Selective vs non-selective");
    await expect(bar).toContainText("2 / 4");
    // Other frames are dimmed.
    await expect(page.locator('[data-testid="canvas-frame"].nc-dim')).toHaveCount(3);
    await bar.getByRole("button", { name: "Previous frame" }).click();
    await expect(page.getByTestId("step-title")).toHaveText("Mechanism");
  });

  test("opens a card with a double tap or double click", async ({ page }, info) => {
    await openDemo(page);
    const target = card(page, "Blocking β1 receptors");
    if (isTouch(info)) {
      const { x, y } = await center(target);
      await page.touchscreen.tap(x, y);
      await page.waitForTimeout(80);
      await page.touchscreen.tap(x, y);
    } else await target.dblclick();
    await expect(page.getByTestId("opened-block")).toBeVisible();
    await expect(page.getByTestId("opened-block")).toContainText("Blocking β1 receptors");
  });

  test("switches theme", async ({ page }) => {
    await openDemo(page);
    const canvasView = page.getByTestId("canvas-view");
    const light = await canvasView.evaluate((el) => getComputedStyle(el).backgroundColor);
    await page.getByTestId("theme-toggle").click();
    await expect(page.locator("html")).toHaveAttribute("data-theme", /dark|light/);
    const dark = await canvasView.evaluate((el) => getComputedStyle(el).backgroundColor);
    expect(dark).not.toBe(light);
  });

  test("guards the screen edges against the back swipe", async ({ page }, info) => {
    test.skip(!isTouch(info), "touch only");
    await openDemo(page);
    const prevented = await page.evaluate(() => {
      const el = document.querySelector(".nc-canvas") as HTMLElement;
      const touch = new Touch({ identifier: 1, target: el, clientX: 4, clientY: 300 });
      const event = new TouchEvent("touchstart", {
        touches: [touch],
        cancelable: true,
        bubbles: true,
      });
      el.dispatchEvent(event);
      return event.defaultPrevented;
    });
    expect(prevented).toBe(true);
  });
});
