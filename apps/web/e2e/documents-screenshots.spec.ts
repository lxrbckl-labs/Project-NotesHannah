import { expect, type Page, test } from "@playwright/test";

/**
 * Screenshots of the documents feature's main states, in both themes, for
 * review. Writes apps/web/screenshots-out/documents/<project>-<state>-<theme>.png.
 * Run with DOC_SHOTS=1 (skipped otherwise, to keep the e2e run quick).
 */

test.skip(!process.env.DOC_SHOTS, "set DOC_SHOTS=1 to capture screenshots");
// Full-page captures of the whole guide are slow on a busy machine.
test.setTimeout(120_000);

const THEMES = ["light", "dark"] as const;
const DIR = "screenshots-out/documents";

async function open(page: Page, theme: string, extra = "") {
  await page.emulateMedia({ colorScheme: theme as "light" | "dark", reducedMotion: "reduce" });
  await page.goto(`/documents-demo.html?latency=0&theme=${theme}${extra}`);
  await expect(page.getByRole("heading", { name: "Beta blockers", level: 1 })).toBeVisible();
  await page.waitForTimeout(400);
}

async function snap(page: Page, name: string, theme: string, full = false) {
  await page.waitForTimeout(350);
  await page.screenshot({
    path: `${DIR}/${test.info().project.name}-${name}-${theme}.png`,
    fullPage: full,
  });
}

async function scrollTo(page: Page, selector: string) {
  await page
    .locator(selector)
    .first()
    .evaluate((el) => el.scrollIntoView({ block: "start" }));
  await page.getByTestId("doc-scroller").evaluate((el) => el.scrollBy(0, -72));
}

const computer = () => test.info().project.name === "computer";

for (const theme of THEMES) {
  test(`guide top to bottom (${theme})`, async ({ page }) => {
    await open(page, theme, "&full=1&mode=read");
    await snap(page, "guide", theme, true);
  });

  test(`citation panel (${theme})`, async ({ page }) => {
    await open(page, theme, "&mode=read");
    await page.locator('[data-type="paragraph"]').first().getByTestId("cite-chip").nth(2).click();
    await expect(page.getByTestId("quote-highlight")).toBeVisible();
    await snap(page, "citation", theme);
  });

  test(`editing with the toolbar (${theme})`, async ({ page }) => {
    await open(page, theme, "&mode=edit");
    const para = page.locator('[data-type="paragraph"]').first();
    await para.getByTestId("field-main").click({ position: { x: 30, y: 12 } });
    const editor = para.getByTestId("editor-main");
    await expect(editor).toBeFocused();
    await editor.evaluate((el) => {
      const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
      for (let node = walker.nextNode(); node; node = walker.nextNode()) {
        const at = node.textContent?.indexOf("sit mainly in the heart") ?? -1;
        if (at >= 0) {
          const range = document.createRange();
          range.setStart(node, at);
          range.setEnd(node, at + "sit mainly in the heart".length);
          window.getSelection()?.removeAllRanges();
          window.getSelection()?.addRange(range);
          return;
        }
      }
    });
    // The bubble on a computer, the keyboard dock on a phone; a tablet has the ribbon only.
    if (test.info().project.name === "tablet")
      await expect(page.getByTestId("format-ribbon")).toHaveAttribute("data-live", "true");
    else await expect(page.getByTestId("format-toolbar")).toBeVisible();
    await snap(page, "editing", theme);
  });

  test(`slash menu (${theme})`, async ({ page }) => {
    await open(page, theme, "&mode=edit");
    const para = page.locator('[data-type="paragraph"]').first();
    await para.getByTestId("field-main").click();
    await expect(para.getByTestId("editor-main")).toBeFocused();
    await page.keyboard.press(process.platform === "darwin" ? "Meta+ArrowDown" : "Control+End");
    await page.keyboard.press("Enter");
    await page.keyboard.type("/");
    await expect(page.getByTestId("insert-menu")).toBeVisible();
    await snap(page, "slash-menu", theme);
  });

  test(`drug card (${theme})`, async ({ page }) => {
    await open(page, theme, "&mode=read");
    await scrollTo(page, '[data-type="drug_card"]');
    await snap(page, "drug-card", theme);
  });

  test(`comparison table (${theme})`, async ({ page }) => {
    await open(page, theme, "&mode=read");
    await scrollTo(page, '[data-type="comparison_table"]');
    await snap(page, "comparison", theme);
  });

  test(`mind map (${theme})`, async ({ page }) => {
    await open(page, theme, "&mode=read");
    await scrollTo(page, '[data-type="mind_map"]');
    await snap(page, "mind-map", theme);
  });

  test(`outline (${theme})`, async ({ page }) => {
    await open(page, theme, "&mode=read");
    if (!computer()) await page.getByTestId("outline-button").click();
    await expect(page.getByTestId("outline").first()).toBeVisible();
    await snap(page, "outline", theme);
  });

  test(`history (${theme})`, async ({ page }) => {
    await open(page, theme, "&mode=read");
    await page.getByTestId("history-button").click();
    const history = page.getByTestId("history");
    await history.getByRole("button", { name: /Revision 2/ }).click();
    await expect(history.getByTestId("revision-preview")).toContainText("Beta blockers");
    await snap(page, "history", theme);
  });
}
