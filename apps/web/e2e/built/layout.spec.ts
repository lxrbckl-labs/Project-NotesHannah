import { expect, type Page, test } from "@playwright/test";
import { ids, signInBuilt } from "./built";

/**
 * Two rows that used to fall off the screen, checked at the widths she actually uses (a small phone,
 * a phone, a tablet standing up, a tablet lying down) whatever project is running: the tab row on the
 * Practice screen, and the actions row in a document's header. They live in this suite because
 * the mock has no practice or document data.
 */

const WIDTHS = [
  { width: 320, height: 700 },
  { width: 375, height: 812 },
  { width: 390, height: 844 },
  { width: 834, height: 1194 },
  { width: 1024, height: 768 },
];
const TABS = ["start", "cards", "notebook", "weak", "exams"];

const pageOverflow = (page: Page) =>
  page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);

test.describe("practice tabs", () => {
  for (const size of WIDTHS) {
    test(`every tab can be reached at ${size.width} wide, with a cue when the row scrolls`, async ({
      page,
    }) => {
      await page.setViewportSize(size);
      await signInBuilt(page);
      await page.goto("/practice");
      const row = page.locator('[data-scroll-cue]:has([data-testid="nav-start"])');
      await expect(row).toBeVisible();
      expect(await pageOverflow(page), "the page itself scrolls sideways").toBeLessThanOrEqual(0);

      const scrolls = await row.evaluate((el) => el.scrollWidth > el.clientWidth + 1);
      if (scrolls) {
        // the cut edge says there is more, and the first tab is where it should be
        await expect(row).toHaveAttribute("data-more-end", "true");
        await expect(row).toHaveAttribute("data-more-start", "false");
      } else {
        await expect(row).toHaveAttribute("data-more-end", "false");
      }
      // scroll to the far end: the last tab is then wholly on screen, and so is every other tab
      // when the row does not scroll
      await row.evaluate((el) => {
        el.scrollLeft = el.scrollWidth;
      });
      const last = await page.getByTestId("nav-exams").boundingBox();
      expect(last, "Exams tab").not.toBeNull();
      expect((last?.x ?? 0) + (last?.width ?? 0)).toBeLessThanOrEqual(size.width);
      if (scrolls) await expect(row).toHaveAttribute("data-more-start", "true");
      for (const view of TABS) {
        const box = await page.getByTestId(`nav-${view}`).boundingBox();
        // every width here is a touch layout (the compact 32px height starts at 1280)
        expect(box?.height ?? 0).toBeGreaterThanOrEqual(44);
      }
      expect(await pageOverflow(page)).toBeLessThanOrEqual(0);
    });
  }

  test("the chosen tab is scrolled into view when the screen opens on it", async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 700 });
    await signInBuilt(page);
    await page.goto("/exams");
    await expect(page.getByTestId("nav-exams")).toHaveAttribute("aria-current", "page");
    await expect
      .poll(async () => {
        const box = await page.getByTestId("nav-exams").boundingBox();
        return (box?.x ?? -1) >= 0 && (box?.x ?? 0) + (box?.width ?? 0) <= 320;
      })
      .toBe(true);
    expect(await pageOverflow(page)).toBeLessThanOrEqual(0);
  });
});

test.describe("document header actions", () => {
  // 834 and 1024 are a tablet with the sidebar open, where the header is as tight as on a phone
  for (const width of [375, 390, 834, 1024]) {
    test(`the actions stay on one line at ${width} wide, each at least 44px`, async ({ page }) => {
      await page.setViewportSize({ width, height: 844 });
      await signInBuilt(page);
      await page.goto(`/doc/${ids().docNodeId}`);
      const header = page.getByTestId("doc-screen").locator("header").first();
      await expect(header).toBeVisible();
      const actions = [
        header.getByRole("tab", { name: "Page" }),
        header.getByRole("tab", { name: "Canvas" }),
        header.getByRole("link", { name: "Sources" }),
        header.getByTestId("ask-button"),
        header.getByRole("button", { name: "Practice this" }),
      ];
      const boxes = [];
      for (const action of actions) {
        await expect(action).toBeVisible();
        const box = await action.boundingBox();
        expect(box).not.toBeNull();
        boxes.push(box as NonNullable<typeof box>);
      }
      // one line: every action sits at the same height as the first, none wrapped below it
      const top = boxes[0]?.y ?? 0;
      for (const box of boxes) {
        expect(Math.abs(box.y - top), "an action wrapped onto a second row").toBeLessThanOrEqual(8);
        expect(box.height).toBeGreaterThanOrEqual(44);
        expect(box.x + box.width).toBeLessThanOrEqual(width);
      }
      // the less important actions are icons: their names stay for a screen reader
      await expect(header.getByRole("button", { name: "Practice this" })).toBeVisible();
      expect((boxes[4]?.width ?? 0) >= 44).toBe(true);
      expect(await pageOverflow(page)).toBeLessThanOrEqual(0);
    });
  }
});

test.describe("practice start bar", () => {
  for (const size of [
    { width: 375, height: 812 },
    { width: 390, height: 844 },
  ]) {
    test(`the Start bar rests on the tab bar at ${size.width} wide`, async ({ page }) => {
      await page.setViewportSize(size);
      await signInBuilt(page);
      await page.goto("/practice");
      const start = page.getByTestId("start-session");
      await expect(start).toBeVisible();
      // Scrolled a little, as she would be when choosing what to practise: no strip of page may show
      // between the bar and the tab bar, and the bar must not sit behind it either.
      const gap = await page.evaluate(() => {
        const main = document.querySelector("main");
        // The sticky strip that holds the start bar ("How many" and Start in one bar).
        const bar = document.querySelector('[data-testid="start-bar"]')?.parentElement;
        const tabs = document.querySelector('[data-testid="tab-bar"]');
        if (!main || !bar || !tabs) return null;
        if (main.scrollHeight - main.clientHeight < 200) return 0; // too short to scroll: nothing to check
        main.scrollTop = 120;
        return Math.round(tabs.getBoundingClientRect().top - bar.getBoundingClientRect().bottom);
      });
      expect(gap).not.toBeNull();
      expect(Math.abs(gap ?? 99)).toBeLessThanOrEqual(1);
    });
  }
});

test.describe("canvas on a phone", () => {
  const phone = { width: 390, height: 844 };

  test("a canvas with cards finishes opening", async ({ page }) => {
    await page.setViewportSize(phone);
    await signInBuilt(page);
    await page.goto(`/doc/${ids().docNodeId}/canvas`);
    await expect(page.getByTestId("canvas-view")).toHaveAttribute("data-ready", "true", {
      timeout: 15_000,
    });
    await expect(page.getByText("Opening the canvas…")).toHaveCount(0);
  });

  test("a document with nothing in it opens an empty canvas instead of waiting forever", async ({
    page,
  }) => {
    await page.setViewportSize(phone);
    await signInBuilt(page);
    const created = await page.request.post("/api/nodes", {
      headers: { Origin: new URL(page.url()).origin, "Content-Type": "application/json" },
      data: { parentId: ids().lectureId, kind: "document", name: `Empty ${Date.now()}` },
    });
    expect(created.status()).toBeLessThan(300);
    const { node } = (await created.json()) as { node: { id: string } };
    await page.goto(`/doc/${node.id}/canvas`);
    await expect(page.getByTestId("canvas-view")).toBeVisible();
    await expect(page.getByText("Opening the canvas…")).toHaveCount(0, { timeout: 10_000 });
  });

  test("the canvas toolbar rests on the tab bar", async ({ page }) => {
    await page.setViewportSize(phone);
    await signInBuilt(page);
    await page.goto(`/doc/${ids().docNodeId}/canvas`);
    const toolbar = page.getByTestId("canvas-toolbar");
    await expect(toolbar).toBeVisible();
    const gap = await page.evaluate(() => {
      const view = document.querySelector('[data-testid="canvas-view"]');
      const tabs = document.querySelector('[data-testid="tab-bar"]');
      if (!view || !tabs) return null;
      // The canvas pane must end where the tab bar begins: no strip of page between them.
      return Math.round(tabs.getBoundingClientRect().top - view.getBoundingClientRect().bottom);
    });
    expect(gap).not.toBeNull();
    expect(Math.abs(gap ?? 99)).toBeLessThanOrEqual(1);
  });
});

test.describe("the app is never taller than the window", () => {
  test("a long library tree scrolls inside the sidebar instead of pushing the app up", async ({
    page,
  }) => {
    // A short, wide window: the computer layout with little height to spare.
    await page.setViewportSize({ width: 1400, height: 560 });
    await signInBuilt(page);
    const sidebar = page.getByTestId("sidebar");
    await expect(sidebar).toBeVisible();
    // Open every branch of the tree, as she does after a while of moving around.
    for (let round = 0; round < 6; round++) {
      const closed = await sidebar.getByRole("button", { name: /^Expand / }).all();
      if (closed.length === 0) break;
      for (const button of closed) await button.click().catch(() => {});
    }
    // Then something low in the tree asks to be brought into view.
    await sidebar.getByRole("link").last().focus();
    const measured = await page.evaluate(() => {
      const app = document.querySelector<HTMLElement>("div.h-dvh");
      const side = document.querySelector<HTMLElement>('[data-testid="sidebar"]');
      return {
        holds: app?.scrollHeight ?? -1,
        shows: app?.clientHeight ?? -1,
        scrolled: app?.scrollTop ?? -1,
        sidebar: Math.round(side?.getBoundingClientRect().height ?? -1),
        window: window.innerHeight,
        windowScrolled: window.scrollY,
      };
    });
    expect(measured.holds, "the app holds more than it shows").toBeLessThanOrEqual(measured.shows);
    expect(measured.scrolled, "the app was scrolled off its own top").toBe(0);
    expect(measured.sidebar, "the sidebar is taller than the window").toBeLessThanOrEqual(
      measured.window,
    );
    expect(measured.windowScrolled).toBe(0);
  });
});
