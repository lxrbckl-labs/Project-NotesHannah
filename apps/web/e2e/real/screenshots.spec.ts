import { expect, type Page, test } from "@playwright/test";
import { TOUR_DIR } from "../shots";
import { converterOnline, signInReal } from "./real";

/**
 * The integrated tour: the main screens on the real server (seeded library), at three sizes in both
 * themes. These are the curated screenshots: `SHOTS=curated` writes them into `screenshots/`
 * (JPEG, committed); otherwise they go to the git-ignored `screenshots-out/integrated/`.
 */
async function shot(page: Page, folder: string, name: string) {
  await page.waitForTimeout(500);
  await page.screenshot({ path: `${TOUR_DIR}/${folder}/${name}.jpg`, type: "jpeg", quality: 72 });
}

for (const theme of ["light", "dark"] as const) {
  test(`integrated tour in ${theme}`, async ({ page }, info) => {
    test.setTimeout(240_000);
    const folder = `${info.project.name.replace("real-", "")}-${theme}`;
    await page.addInitScript((value) => localStorage.setItem("notes-theme", value), theme);
    await signInReal(page);
    test.skip(
      !(await converterOnline(page)),
      "Docker is not running: the seeded study guide and questions are not there.",
    );
    await expect(page.getByTestId("upcoming-exams")).toBeVisible();
    await shot(page, folder, "01-library-home");

    await page.getByRole("button", { name: "Expand all" }).click();
    await page.getByTestId("tree-item").filter({ hasText: "Autonomic overview" }).first().click();
    await expect(page.getByTestId("doc-screen")).toBeVisible();
    await expect(page.locator('[data-testid="block"]').first()).toBeVisible();
    await shot(page, folder, "02-document");

    await page.getByTestId("ask-button").first().click();
    await expect(page.getByTestId("composer-target")).toBeVisible();
    await shot(page, folder, "03-ask-dialog");
    await page.keyboard.press("Escape");

    await page
      .locator('[data-testid="block"][data-type="paragraph"]')
      .first()
      .getByTestId("cite-chip")
      .first()
      .click();
    await expect(page.getByTestId("citation-panel")).toBeVisible();
    await expect
      .poll(() =>
        page
          .getByTestId("citation-panel")
          .locator("img")
          .first()
          .evaluate((el: HTMLImageElement) => el.naturalWidth),
      )
      .toBeGreaterThan(100);
    await shot(page, folder, "04-citation-source");
    await page.keyboard.press("Escape");

    await page.getByRole("tab", { name: "Canvas" }).click();
    await expect(page.locator(".react-flow__node").first()).toBeVisible({ timeout: 30_000 });
    await shot(page, folder, "05-canvas");

    await page.goto("/practice");
    await expect(page.getByTestId("start")).toBeVisible();
    await shot(page, folder, "06-practice-start");

    await page.getByRole("radio", { name: /Autonomic overview/ }).check();
    await page.getByTestId("start-session").click();
    await expect(page.getByTestId("player")).toBeVisible();
    await shot(page, folder, "07-practice-question");

    for (let i = 0; i < 6; i++) {
      const player = page.getByTestId("player");
      const type = (await player.getAttribute("data-qtype")) as string;
      if (type === "calculation") {
        await player.getByTestId("calc-value").fill("350000");
        await player.getByTestId("calc-unit").fill("mg");
        await page.getByTestId("submit").click();
        await expect(page.getByTestId("calc-feedback")).toContainText(/1000 times/);
        await shot(page, folder, "08-practice-feedback");
      } else if (type === "multiple_choice") {
        await player.locator("label").first().click();
        await page.getByTestId("submit").click();
      } else if (type === "fill_blank") {
        await player.getByTestId("blank-1").fill("beta-1");
        await page.getByTestId("submit").click();
      } else {
        await player.getByRole("button", { name: "Show answer" }).click();
        await player.getByTestId("rate-good").click();
      }
      await expect(page.getByTestId("feedback")).toBeVisible();
      await page.getByTestId("next").click();
      await expect(page.getByTestId("feedback")).toBeHidden();
      await expect(page.getByTestId("player").or(page.getByTestId("results"))).toBeVisible();
      if (await page.getByTestId("results").isVisible()) break;
    }
    await shot(page, folder, "09-practice-results");
    await page.getByTestId("done").click();
    await page.getByTestId("nav-notebook").click();
    await expect(page.getByTestId("notebook-row").first()).toBeVisible();
    await shot(page, folder, "10-notebook");

    await page.goto("/exams");
    await expect(page.getByTestId("exam-card").first()).toBeVisible();
    await shot(page, folder, "11-exam-planner");
    await page.getByTestId("add-exam").click();
    await page.getByTestId("exam-choose").click();
    await expect(
      page
        .getByRole("dialog")
        .last()
        .getByRole("button", { name: /Autonomic overview/ }),
    ).toBeVisible();
    await shot(page, folder, "12-exam-picker");
    await page.keyboard.press("Escape");

    await page.goto("/requests");
    await expect(page.getByRole("heading", { level: 1, name: "Requests" })).toBeVisible();
    await expect(page.getByTestId("request-card").first()).toBeVisible();
    await shot(page, folder, "13-requests");

    await page.goto("/concepts");
    await expect(page.getByTestId("concept-row").first()).toBeVisible();
    await shot(page, folder, "14-concepts");
    await page.getByRole("link", { name: "metoprolol", exact: true }).first().click();
    await expect(page.getByTestId("concept-name")).toBeVisible();
    await expect(page.getByTestId("relation-item").first()).toBeVisible();
    await shot(page, folder, "15-concept-page");

    await page.goto("/search?q=beta");
    await expect(page.getByRole("link", { name: /beta/i }).first()).toBeVisible();
    await shot(page, folder, "16-search");
  });
}
