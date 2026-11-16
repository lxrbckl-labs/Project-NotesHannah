import { expect, type Page, test } from "@playwright/test";
import { card, isPhone, isTouch, openDemo, tap } from "./canvas-helpers";

/**
 * Screenshots of the canvas's main states, at every size, in both themes,
 * into apps/web/screenshots-out/canvas/. Run on demand:
 *   CANVAS_SCREENSHOTS=1 pnpm exec playwright test e2e/canvas-screens.spec.ts
 */
test.skip(!process.env.CANVAS_SCREENSHOTS, "set CANVAS_SCREENSHOTS=1 to capture");

const DIR = "screenshots-out/canvas";

for (const theme of ["light", "dark"] as const) {
  test(`main states in ${theme}`, async ({ page }, info) => {
    test.setTimeout(90_000);
    await page.emulateMedia({ colorScheme: theme, reducedMotion: "reduce" });
    const shot = async (name: string, target: Page | ReturnType<Page["locator"]> = page) => {
      await page.waitForTimeout(350);
      await target.screenshot({ path: `${DIR}/${info.project.name}-${theme}-${name}.png` });
    };

    await openDemo(page);
    if (isPhone(info)) {
      await shot("1-phone-focused-view");
      await page.getByRole("button", { name: "Whole map" }).first().click();
    }
    await page.waitForTimeout(400);
    await shot("2-whole-map");
    await shot("7-toolbar", page.getByTestId("canvas-toolbar"));

    // A frame zoomed: jump to it from the frame list.
    await page.getByRole("button", { name: "Frames", exact: true }).click();
    await expect(page.getByTestId("frame-panel")).toBeVisible();
    await shot("4-frame-list");
    await page
      .getByTestId("frame-panel")
      .locator(".nc-frame-jump", { hasText: "Selective" })
      .click();
    if (!isPhone(info)) await page.getByRole("button", { name: "Close frames" }).click();
    await page.waitForTimeout(500);
    await shot("3-frame-zoomed");

    // A card selected, with its toolbar.
    if (!isPhone(info)) {
      await page.getByRole("button", { name: /Whole map/ }).click();
      await page.waitForTimeout(400);
    } else {
      await page.getByRole("button", { name: "Whole map" }).first().click();
    }
    await tap(page, info, card(page, "Blocking β1 receptors"));
    await shot("8-card-selected");

    // Connect mode, source chosen.
    await page.keyboard.press("Escape");
    await page.getByRole("button", { name: /Connect cards/ }).click();
    await tap(page, info, card(page, "β1 vs β2"));
    await shot("5-connect-mode");
    await tap(page, info, card(page, "Bradycardia and heart block"));
    await expect(page.getByTestId("connector-editor")).toBeVisible();
    if (!isTouch(info))
      await page.getByRole("textbox", { name: "Connector label" }).fill("watch the pulse");
    await shot("9-connector-editor");
    await page.getByRole("button", { name: "Close" }).click();

    // Step-through.
    if (isPhone(info)) await page.getByRole("button", { name: "One frame at a time" }).click();
    else await page.getByRole("button", { name: "Step through frames" }).click();
    await page.getByRole("button", { name: "Next frame" }).click();
    await page.getByRole("button", { name: "Next frame" }).click();
    await page.waitForTimeout(500);
    await shot("6-step-through");
  });
}
