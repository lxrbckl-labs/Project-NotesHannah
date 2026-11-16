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
        header.getByRole("button", { name: "Practise this" }),
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
      await expect(header.getByRole("button", { name: "Practise this" })).toBeVisible();
      expect((boxes[4]?.width ?? 0) >= 44).toBe(true);
      expect(await pageOverflow(page)).toBeLessThanOrEqual(0);
    });
  }
});
