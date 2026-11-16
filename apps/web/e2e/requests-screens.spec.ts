import { mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { expect, type Page, test } from "@playwright/test";
import { openDemo } from "./requests-helpers";

/** Screenshots of every main state: screenshots/requests/<size>-<theme>/<state>.png (not assertions). */
const ROOT = resolve(import.meta.dirname, "../screenshots/requests");

for (const theme of ["light", "dark"] as const) {
  test.describe(theme, () => {
    test.beforeEach(async ({ page }) => {
      await page.emulateMedia({ colorScheme: theme });
    });

    const shoot = async (page: Page, name: string, projectName: string, full = true) => {
      const dir = resolve(ROOT, `${projectName}-${theme}`);
      mkdirSync(dir, { recursive: true });
      await page.waitForTimeout(250);
      await page.screenshot({ path: resolve(dir, `${name}.png`), fullPage: full });
    };

    test("the list and its filters", async ({ page }, info) => {
      const n = info.project.name;
      await openDemo(page, { theme });
      await expect(page.getByTestId("request-card").first()).toBeVisible();
      await shoot(page, "list-all", n);
      await page.getByTestId("filter-done").click();
      await expect(page.getByTestId("request-card")).toHaveCount(6);
      await shoot(page, "list-done", n);
      await page.getByTestId("filter-declined").click();
      await expect(page.getByTestId("request-card")).toHaveCount(1);
      await shoot(page, "list-needs-change", n);
      await page.getByTestId("filter-all").click();
      await page.getByTestId("history-toggle").click();
      await page.getByTestId("history").scrollIntoViewIfNeeded();
      await shoot(page, "history-open", n, false);
      await shoot(page, "unread-and-new-answers", n);
    });

    test("the composer, for each kind of target", async ({ page }, info) => {
      const n = info.project.name;
      await openDemo(page, { theme });
      await page.getByTestId("new-request").click();
      await expect(page.getByRole("dialog")).toBeVisible();
      await shoot(page, "composer-library", n, false);
      await page.getByTestId("kind-make_questions").click();
      await page.getByTestId("example").nth(1).click();
      await shoot(page, "composer-filled", n, false);
      await page.getByRole("button", { name: "Leave request" }).click();
      await expect(page.getByTestId("composer-done")).toBeVisible();
      await shoot(page, "composer-done", n, false);

      await openDemo(page, { theme, view: "asks" });
      await shoot(page, "ask-buttons", n);
      await page.getByTestId("ask-button").nth(3).click();
      await expect(page.getByRole("dialog")).toBeVisible();
      await shoot(page, "composer-block", n, false);
    });

    test("edit, reopen and cancel", async ({ page }, info) => {
      const n = info.project.name;
      await openDemo(page, { theme });
      await page.getByTestId("request-card").first().getByTestId("edit").click();
      await expect(page.getByTestId("save-edit")).toBeVisible();
      await shoot(page, "edit", n, false);
      await page.keyboard.press("Escape");
      await page.getByTestId("request-card").first().getByTestId("cancel").click();
      await expect(page.getByRole("button", { name: "Cancel request" })).toBeVisible();
      await shoot(page, "cancel-confirm", n, false);
      await page.keyboard.press("Escape");
      await page.getByTestId("filter-done").click();
      await page.getByTestId("request-card").first().getByTestId("reopen").click();
      await expect(page.getByTestId("confirm-reopen")).toBeVisible();
      await shoot(page, "reopen", n, false);
    });

    test("empty, loading and error", async ({ page }, info) => {
      const n = info.project.name;
      await openDemo(page, { theme, empty: true });
      await expect(page.getByText("No requests yet")).toBeVisible();
      await shoot(page, "empty", n);
      await page.goto(`/requests-demo.html?bar=0&theme=${theme}&slow=3000`);
      await expect(page.getByRole("status", { name: "Loading your requests" })).toBeVisible();
      await shoot(page, "loading", n, false);
      await openDemo(page, { theme, fail: true }).catch(() => undefined);
      await expect(page.getByRole("alert")).toBeVisible();
      await shoot(page, "error", n);
    });
  });
}
