import { expect, type Page, test } from "@playwright/test";
import { signIn } from "./helpers";

/**
 * Captures the main screens at the project's size in light and dark into screenshots/.
 * Run on its own with `pnpm exec playwright test screenshots`.
 */

async function shot(page: Page, folder: string, name: string) {
  // The app scrolls inside <main>, so grow the viewport to the content to get a full page.
  const base = page.viewportSize();
  if (!base) throw new Error("no viewport");
  await page.waitForTimeout(250);
  const extra = await page.evaluate(() => {
    const main = document.getElementById("main") ?? document.documentElement;
    return Math.max(0, main.scrollHeight - main.clientHeight);
  });
  const height = Math.min(base.height + extra, 2600);
  await page.setViewportSize({ width: base.width, height });
  await page.waitForTimeout(150);
  await page.screenshot({ path: `screenshots/${folder}/${name}.png` });
  await page.setViewportSize(base);
}

for (const theme of ["light", "dark"] as const) {
  test(`screenshots in ${theme}`, async ({ page }, testInfo) => {
    const folder = `${testInfo.project.name}-${theme}`;
    await page.addInitScript((value) => localStorage.setItem("notes-theme", value), theme);
    await page.goto("/login");
    await expect(page.getByRole("heading", { name: "Welcome back" })).toBeVisible();
    await shot(page, folder, "01-login");

    await signIn(page);
    await shot(page, folder, "02-library-home");

    // the whole library as a tree: terms and courses open (two levels), then everything
    const tree = page.getByRole("tree", { name: "All files" });
    await tree.getByRole("button", { name: "Expand Pharmacology II" }).click();
    await tree.getByRole("button", { name: "Expand Pharmacotherapy I" }).click();
    await expect(tree.getByRole("treeitem", { name: "Study guides" }).first()).toBeVisible();
    await shot(page, folder, "03-tree-two-levels");
    await page.getByRole("button", { name: "Expand all" }).click();
    await expect(tree.getByRole("treeitem", { name: "Slide transcript" })).toBeVisible();
    await shot(page, folder, "04-tree-expanded-all");
    await tree.getByRole("treeitem", { name: "Slide transcript" }).click();
    await expect(page.getByRole("heading", { level: 1, name: "Slide transcript" })).toBeVisible();
    await shot(page, folder, "05-document-page");
    await page.goBack();
    await expect(tree.getByRole("treeitem", { name: "Slide transcript" })).toBeVisible();
    await page.waitForTimeout(500);
    await shot(page, folder, "06-tree-after-back");
    await page.getByRole("button", { name: "Collapse all" }).click();

    await page
      .getByRole("tree", { name: "All files" })
      .getByRole("treeitem", { name: "Fall 2026", exact: true })
      .click();
    await expect(page.getByRole("heading", { name: "Fall 2026", level: 1 })).toBeVisible();
    await shot(page, folder, "07-term");

    await page
      .getByRole("list", { name: "Courses" })
      .getByRole("link", { name: "Pharmacology II" })
      .click();
    await expect(page.getByRole("heading", { name: "Pharmacology II", level: 1 })).toBeVisible();
    await shot(page, folder, "08-course-home");

    await page
      .getByRole("main")
      .getByRole("link", { name: /^Lectures/ })
      .click();
    await expect(page.getByRole("heading", { name: "Lectures", level: 1 })).toBeVisible();
    await expect(page.getByText("07 · Beta blockers · Oct 14").first()).toBeVisible();
    await shot(page, folder, "09-section-list");

    await page.getByRole("button", { name: "Actions for Cholinergic agents" }).click();
    await page.getByRole("menuitem", { name: "Move to…" }).click();
    await expect(page.getByRole("dialog")).toBeVisible();
    await page
      .getByRole("dialog")
      .getByRole("button", { name: "Expand Pharmacotherapy I" })
      .click();
    await page
      .getByRole("dialog")
      .locator(".overflow-y-auto")
      .evaluate((el) => {
        el.scrollTop = 0;
      });
    await shot(page, folder, "10-move-sheet");
    await page.keyboard.press("Escape");

    await page.getByRole("button", { name: "Actions for Diuretics" }).click();
    await page.getByRole("menuitem", { name: "Move to trash" }).click();
    await expect(page.getByText('Moved "Diuretics" to the trash')).toBeVisible();
    await page.goto("/trash");
    await expect(page.getByRole("heading", { name: "Trash" })).toBeVisible();
    await expect(page.getByTestId("trash-row")).toHaveCount(1);
    await shot(page, folder, "11-trash");

    await page.goto("/settings");
    await expect(page.getByRole("heading", { name: "Settings" })).toBeVisible();
    await expect(page.getByTestId("key-row")).toHaveCount(2);
    await shot(page, folder, "12-settings");

    await page.getByRole("button", { name: "New key" }).click();
    await page.getByLabel("Name", { exact: true }).fill("Study helper");
    await page.getByRole("button", { name: "Create key" }).click();
    await expect(page.getByTestId("api-secret")).toBeVisible();
    await shot(page, folder, "13-api-key-dialog");
  });

  test(`file screens in ${theme}`, async ({ page }, testInfo) => {
    const folder = `${testInfo.project.name}-${theme}`;
    const layout = testInfo.project.name;
    await page.addInitScript((value) => localStorage.setItem("notes-theme", value), theme);
    await signIn(page);

    // inbox, with a fresh upload in the tray
    await page.getByRole("link", { name: "Inbox", exact: true }).click();
    await expect(page.getByTestId("file-row").first()).toBeVisible();
    const chooser = page.waitForEvent("filechooser");
    await page.getByRole("button", { name: "Upload files" }).first().click();
    await (await chooser).setFiles({
      name: "Diuretics handout.pdf",
      mimeType: "application/pdf",
      buffer: Buffer.from("%PDF-1.4"),
    });
    await expect(page.getByTestId("upload-item")).toHaveAttribute("data-status", "done");
    await shot(page, folder, "14-inbox-with-upload");

    // file under... sheet
    await page
      .getByTestId("file-row")
      .filter({ hasText: "Whiteboard photo.jpeg" })
      .getByRole("button", { name: /File Whiteboard photo.jpeg under/ })
      .click();
    const sheet = page.getByRole("dialog");
    await sheet.getByRole("button", { name: "Expand Fall 2026" }).click();
    await sheet.getByRole("button", { name: "Expand Pharmacology II" }).click();
    await sheet.getByRole("button", { name: "Expand Lectures" }).click();
    await sheet.locator(".overflow-y-auto").evaluate((el) => {
      el.scrollTop = 0;
    });
    await shot(page, folder, "15-file-under-sheet");
    await page.keyboard.press("Escape");

    // the source viewer
    await page.getByRole("link", { name: "Library", exact: true }).click();
    await page.getByRole("button", { name: "Expand all" }).click();
    await page
      .getByRole("tree", { name: "All files" })
      .getByTestId("tree-file")
      .filter({ hasText: "Lecture 07 slides.pptx" })
      .click();
    await expect(page.getByTestId("page-position")).toBeVisible();
    await expect(page.getByTestId("thumb").first()).toBeVisible();
    await page.waitForTimeout(400);
    await shot(page, folder, "16-source-viewer");
    if (layout === "phone") {
      await page.getByRole("tab", { name: "Transcript" }).click();
      await page.waitForTimeout(700);
    }
    await page.getByRole("button", { name: /History/ }).click();
    await expect(page.getByTestId("revision")).toHaveCount(2);
    await page.waitForTimeout(300);
    await shot(page, folder, "17-source-transcript-history");

    // search: names, study material and transcripts together
    if (layout === "computer") await page.keyboard.press("Control+k");
    else if (layout === "tablet") await page.getByRole("button", { name: /Quick find/ }).click();
    else await page.getByTestId("tab-bar").getByRole("link", { name: "Search" }).click();
    await page.getByRole("searchbox", { name: "Search your library" }).fill("beta");
    await expect(page.getByTestId("results-page")).toBeVisible();
    await shot(page, folder, "18-search-results");
    if (layout !== "phone") await page.keyboard.press("Escape");

    // activity
    await page.goto("/activity");
    await expect(page.getByTestId("activity-entry").first()).toBeVisible();
    await shot(page, folder, "19-activity");

    // trash with a file in it
    await page.goto("/inbox");
    await page
      .getByTestId("file-row")
      .filter({ hasText: "Whiteboard photo.jpeg" })
      .getByRole("button", { name: "Actions for Whiteboard photo.jpeg" })
      .click();
    await page.getByRole("menuitem", { name: "Move to trash" }).click();
    await expect(page.getByText(/to the trash/)).toBeVisible();
    await page.goto("/trash");
    await expect(page.getByTestId("trash-file-row")).toHaveCount(1);
    await shot(page, folder, "20-trash-with-file");

    // a feature that is not built yet
    await page.goto("/requests");
    await expect(page.getByText("Coming soon")).toBeVisible();
    await shot(page, folder, "21-coming-soon");
  });
}
