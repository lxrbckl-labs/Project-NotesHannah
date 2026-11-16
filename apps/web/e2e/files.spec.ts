import { expect, test } from "@playwright/test";
import { allFiles, type Layout, openLectures, signIn } from "./helpers";

const layoutOf = (testInfo: { project: { name: string } }) => testInfo.project.name as Layout;
const pdf = (name: string) => ({
  name,
  mimeType: "application/pdf",
  buffer: Buffer.from("%PDF-1.4\n%mock\n"),
});

test.describe("uploads and the inbox", () => {
  test.beforeEach(async ({ page }) => signIn(page));

  test("uploads from the inbox with progress, then the file converts and shows in the list", async ({
    page,
  }) => {
    await page.getByRole("link", { name: "Inbox", exact: true }).click();
    await expect(page.getByRole("heading", { level: 1, name: "Inbox" })).toBeVisible();
    await expect(page.getByTestId("file-row").first()).toBeVisible();
    const before = await page.getByTestId("file-row").count();

    const chooser = page.waitForEvent("filechooser");
    await page.getByRole("button", { name: "Upload files" }).first().click();
    await (await chooser).setFiles([pdf("Beta blockers notes.pdf"), pdf("Diuretics notes.pdf")]);

    const tray = page.getByTestId("upload-tray");
    await expect(tray).toBeVisible();
    await expect(tray.getByTestId("upload-item")).toHaveCount(2);
    await expect(tray.getByTestId("upload-item").first()).toHaveAttribute(
      "data-status",
      /uploading|done/,
    );
    await expect(tray.getByTestId("upload-item").first()).toHaveAttribute("data-status", "done");
    await expect(page.getByTestId("file-row")).toHaveCount(before + 2);
    const row = page.getByTestId("file-row").filter({ hasText: "Beta blockers notes.pdf" });
    await expect(row).toHaveAttribute("data-status", "converting");
    await expect(row).toContainText("Turning the file into page images");
    // the inbox polls: it moves to "Ready" by itself
    await expect(row).toHaveAttribute("data-status", "converted", { timeout: 15_000 });
    await expect(row).toContainText("Waiting for an agent to transcribe");
  });

  test("an unsupported file is refused with a clear message", async ({ page }) => {
    await page.getByRole("link", { name: "Inbox", exact: true }).click();
    const chooser = page.waitForEvent("filechooser");
    await page.getByRole("button", { name: "Upload files" }).first().click();
    await (await chooser).setFiles([
      { name: "report.docx", mimeType: "application/zip", buffer: Buffer.from("PK") },
    ]);
    const item = page.getByTestId("upload-item");
    await expect(item).toHaveAttribute("data-status", "error");
    await expect(item.getByRole("alert")).toContainText("not a file type the app can read");
    await expect(item.getByRole("alert")).toContainText("PDF, PowerPoint");
  });

  test("uploads straight into a lecture, and uploads keep going while she navigates", async ({
    page,
  }) => {
    await openLectures(page);
    await page.getByRole("link", { name: /09 · Diuretics/ }).click();
    const chooser = page.waitForEvent("filechooser");
    await page.getByRole("button", { name: "Upload files" }).click();
    await (await chooser).setFiles([pdf("Diuretics handout.pdf")]);
    await page.getByRole("link", { name: "Settings", exact: true }).click();
    await expect(page.getByRole("heading", { level: 1, name: "Settings" })).toBeVisible();
    await expect(page.getByTestId("upload-item")).toHaveAttribute("data-status", "done");
  });

  test("retries a failed file and says what went wrong", async ({ page }) => {
    await page.getByRole("link", { name: "Inbox", exact: true }).click();
    const row = page.getByTestId("file-row").filter({ hasText: "Locked notes.pdf" });
    await expect(row).toContainText("password protected");
    await row.getByRole("button", { name: "Retry Locked notes.pdf" }).click();
    await expect(row).not.toHaveAttribute("data-status", "failed");
  });

  test("files an inbox file under a lecture with the sheet", async ({ page }) => {
    await page.getByRole("link", { name: "Inbox", exact: true }).click();
    const row = page.getByTestId("file-row").filter({ hasText: "Whiteboard photo.jpeg" });
    await row.getByRole("button", { name: /File Whiteboard photo.jpeg under/ }).click();
    const sheet = page.getByRole("dialog");
    await sheet.getByRole("button", { name: "Expand Fall 2026" }).click();
    await sheet.getByRole("button", { name: "Expand Pharmacology II" }).click();
    await sheet.getByRole("button", { name: "Expand Lectures" }).click();
    await sheet.getByRole("button", { name: "Autonomic overview", exact: true }).click();
    await sheet.getByRole("button", { name: "File here" }).click();
    await expect(
      page.getByText('Filed "Whiteboard photo.jpeg" under Autonomic overview'),
    ).toBeVisible();
    await expect(
      page.getByTestId("file-row").filter({ hasText: "Whiteboard photo.jpeg" }),
    ).toHaveCount(0);
  });

  test("the inbox count in the tree follows uploads", async ({ page }) => {
    const count = allFiles(page).getByTestId("inbox-count");
    await expect(count).toHaveText("3");
    await page.getByRole("link", { name: "Inbox", exact: true }).click();
    const row = page.getByTestId("file-row").filter({ hasText: "Whiteboard photo.jpeg" });
    await row.getByRole("button", { name: "Actions for Whiteboard photo.jpeg" }).click();
    await page.getByRole("menuitem", { name: "Move to trash" }).click();
    await page.getByRole("link", { name: "Library", exact: true }).click();
    await expect(allFiles(page).getByTestId("inbox-count")).toHaveText("2");
  });

  test("trashed files come back from the trash page", async ({ page }, testInfo) => {
    await page.getByRole("link", { name: "Inbox", exact: true }).click();
    const row = page.getByTestId("file-row").filter({ hasText: "Whiteboard photo.jpeg" });
    await row.getByRole("button", { name: "Actions for Whiteboard photo.jpeg" }).click();
    await page.getByRole("menuitem", { name: "Move to trash" }).click();
    if (layoutOf(testInfo) === "phone") {
      await page.getByRole("link", { name: "Settings", exact: true }).click();
      await page.getByRole("link", { name: "Trash" }).click();
    } else {
      await page.getByTestId("sidebar").getByRole("link", { name: "Trash" }).click();
    }
    await page.getByRole("button", { name: "Restore Whiteboard photo.jpeg" }).click();
    await expect(page.getByTestId("trash-file-row")).toHaveCount(0);
    await page.getByRole("link", { name: "Inbox", exact: true }).click();
    await expect(
      page.getByTestId("file-row").filter({ hasText: "Whiteboard photo.jpeg" }),
    ).toBeVisible();
  });
});

test.describe("source viewer", () => {
  test.beforeEach(async ({ page }) => signIn(page));

  async function openSlides(page: import("@playwright/test").Page) {
    await page.getByRole("button", { name: "Expand all" }).click();
    await allFiles(page)
      .getByTestId("tree-file")
      .filter({ hasText: "Lecture 07 slides.pptx" })
      .click();
    await expect(
      page.getByRole("heading", { level: 1, name: "Lecture 07 slides.pptx" }),
    ).toBeVisible();
  }

  test("shows the page and its transcript, flags, native text, and moves between pages", async ({
    page,
  }, testInfo) => {
    await openSlides(page);
    await expect(page.getByTestId("thumb")).toHaveCount(34);
    await expect(page.getByTestId("page-position")).toContainText("Page 1 of 34");
    if (layoutOf(testInfo) === "phone") {
      // the phone swipes between the page and the transcript; the tabs do the same
      await expect(page.getByRole("tab", { name: "Page" })).toHaveAttribute(
        "aria-selected",
        "true",
      );
      await page.getByRole("tab", { name: "Transcript" }).click();
      await expect(page.getByRole("tab", { name: "Transcript" })).toHaveAttribute(
        "aria-selected",
        "true",
      );
    }
    const text = page.getByTestId("transcript-text");
    await expect(text).toContainText("Metoprolol");
    await expect(text.locator("mark[data-flag=dose]")).toHaveText(/50 mg/);
    await expect(page.getByTestId("flag-note").first()).toBeVisible();
    await expect(page.getByText("Text from the file")).toBeVisible();
    await page.getByRole("button", { name: "Next page" }).click();
    await expect(page.getByTestId("page-position")).toContainText("Page 2 of 34");
    await page.getByTestId("thumb").nth(4).click();
    await expect(page.getByTestId("page-position")).toContainText("Page 5 of 34");
  });

  test("zooms the page image", async ({ page }, testInfo) => {
    await openSlides(page);
    if (layoutOf(testInfo) === "phone") await page.getByRole("tab", { name: "Page" }).click();
    const zoom = page.getByTestId("zoom-area");
    await expect(zoom).toHaveAttribute("data-scale", "1.00");
    await page.getByRole("button", { name: "Zoom in" }).click();
    await expect(zoom).not.toHaveAttribute("data-scale", "1.00");
    await page.getByRole("button", { name: "Fit page" }).click();
    await expect(zoom).toHaveAttribute("data-scale", "1.00");
    await zoom.dblclick();
    await expect(zoom).toHaveAttribute("data-scale", "2.50");
  });

  test("marks a transcript reviewed and restores an older revision", async ({ page }, testInfo) => {
    await openSlides(page);
    if (layoutOf(testInfo) === "phone") await page.getByRole("tab", { name: "Transcript" }).click();
    await expect(page.getByText("Unverified", { exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Mark as reviewed" }).click();
    await expect(page.getByText("Reviewed", { exact: true })).toBeVisible();
    await page.getByRole("button", { name: /History/ }).click();
    await expect(page.getByTestId("revision")).toHaveCount(2);
    await page.getByRole("button", { name: "Restore revision 1" }).click();
    await expect(page.getByTestId("revision")).toHaveCount(3);
    await expect(page.getByTestId("transcript-text")).toContainText("5O mg");
  });

  test("a deep link opens the page with the quote marked", async ({ page }, testInfo) => {
    await openSlides(page);
    const url = new URL(page.url());
    const fileId = url.pathname.split("/").pop();
    const pageId = await page.evaluate(async (id) => {
      const res = await fetch(`/api/files/${id}/pages`);
      return ((await res.json()) as { items: Array<{ id: string }> }).items[1]?.id;
    }, fileId);
    await page.goto(`/files/${fileId}?page=${pageId}&quote=${encodeURIComponent("PO BID")}`);
    await expect(page.getByTestId("page-position")).toContainText("Page 2 of 34");
    if (layoutOf(testInfo) === "phone")
      await expect(page.getByRole("tab", { name: "Transcript" })).toHaveAttribute(
        "aria-selected",
        "true",
      );
    await expect(page.locator("mark[data-quote=true]")).toHaveText("PO BID");
  });

  test("says nothing is transcribed yet, and a failed file explains itself", async ({ page }) => {
    await page.getByRole("button", { name: "Expand all" }).click();
    await allFiles(page)
      .getByTestId("tree-file")
      .filter({ hasText: "Lecture 08 handwritten notes.pdf" })
      .click();
    await expect(page.getByText("Nothing transcribed yet")).toBeVisible();
    await page.goBack();
    await allFiles(page).getByTestId("tree-inbox").click();
    await page.getByRole("link", { name: "Locked notes.pdf" }).click();
    await expect(page.getByText("This file could not be converted")).toBeVisible();
    await expect(page.getByRole("button", { name: "Retry conversion" })).toBeVisible();
  });
});

test.describe("file leaves in the tree", () => {
  test.beforeEach(async ({ page }) => signIn(page));

  test("moves a filed file to another lecture and back to the inbox with the menu", async ({
    page,
  }) => {
    await page.getByRole("button", { name: "Expand all" }).click();
    const tree = allFiles(page);
    const leaf = () => tree.getByTestId("tree-file").filter({ hasText: "Lecture 03 slides.pptx" });
    await leaf().click({ button: "right" });
    await page.getByRole("menuitem", { name: "File under…" }).click();
    const sheet = page.getByRole("dialog");
    await sheet
      .getByRole("button", { name: "Expand Fall 2026" })
      .click()
      .catch(() => {});
    await sheet.getByRole("button", { name: "Expand Pharmacotherapy I" }).click();
    await sheet.getByRole("button", { name: "Expand Lectures" }).last().click();
    await sheet.getByRole("button", { name: "Hypertension guidelines", exact: true }).click();
    await sheet.getByRole("button", { name: "File here" }).click();
    await expect(
      page.getByText(/Filed "Lecture 03 slides.pptx" under Hypertension guidelines/),
    ).toBeVisible();

    await leaf().click({ button: "right" });
    await page.getByRole("menuitem", { name: "Back to inbox" }).click();
    await expect(page.getByText('Moved "Lecture 03 slides.pptx" back to the inbox')).toBeVisible();
    await expect(tree.getByTestId("inbox-count")).toHaveText("4");
  });

  test("renames and trashes a file leaf", async ({ page }) => {
    await page.getByRole("button", { name: "Expand all" }).click();
    const tree = allFiles(page);
    const leaf = tree
      .getByTestId("tree-file")
      .filter({ hasText: "Lecture 02 notes" })
      .or(tree.getByTestId("tree-file").filter({ hasText: "Lecture 02 handwritten" }))
      .first();
    await leaf.click({ button: "right" });
    await page.getByRole("menuitem", { name: "Rename" }).click();
    const input = page.getByRole("textbox", { name: /Rename Lecture 02/ });
    await input.fill("Cholinergic board.pdf");
    await input.press("Enter");
    await expect(
      tree.getByTestId("tree-file").filter({ hasText: "Cholinergic board.pdf" }),
    ).toBeVisible();
    await tree
      .getByTestId("tree-file")
      .filter({ hasText: "Cholinergic board.pdf" })
      .click({ button: "right" });
    await page.getByRole("menuitem", { name: "Move to trash" }).click();
    await expect(
      tree.getByTestId("tree-file").filter({ hasText: "Cholinergic board.pdf" }),
    ).toHaveCount(0);
  });

  test("drags a file leaf onto another lecture, and drops computer files onto a lecture to upload", async ({
    page,
  }, testInfo) => {
    test.skip(layoutOf(testInfo) !== "computer", "drag and drop is for the computer layout");
    // a drag cannot scroll the page: make the window tall enough to hold the whole expanded tree
    await page.setViewportSize({ width: 1440, height: 3600 });
    await page.getByRole("button", { name: "Expand all" }).click();
    const tree = allFiles(page);
    const leaf = tree.getByTestId("tree-file").filter({ hasText: "Lecture 04 slides.pptx" });
    const target = tree.getByRole("treeitem", { name: /Hypertension guidelines/ });
    await leaf.dragTo(target);
    await expect(
      page.getByText(/Filed "Lecture 04 slides.pptx" under Hypertension guidelines/),
    ).toBeVisible();

    // files dropped from the desktop
    const dt = await page.evaluateHandle(() => {
      const data = new DataTransfer();
      data.items.add(new File(["%PDF-1.4"], "Dropped handout.pdf", { type: "application/pdf" }));
      return data;
    });
    await target.dispatchEvent("dragenter", { dataTransfer: dt });
    await target.dispatchEvent("dragover", { dataTransfer: dt });
    await target.dispatchEvent("drop", { dataTransfer: dt });
    await expect(page.getByTestId("upload-item")).toContainText("Dropped handout.pdf");
    await expect(page.getByTestId("upload-item")).toContainText("Hypertension guidelines");
    await expect(page.getByTestId("upload-item")).toHaveAttribute("data-status", "done");
  });
});

test.describe("search, activity and mount points", () => {
  test.beforeEach(async ({ page }) => signIn(page));

  test("search finds names, study material and transcripts, and a transcript hit opens the viewer with the match marked", async ({
    page,
  }, testInfo) => {
    const layout = layoutOf(testInfo);
    if (layout === "computer") await page.keyboard.press("Control+k");
    else if (layout === "tablet") await page.getByRole("button", { name: /Quick find/ }).click();
    else await page.getByTestId("tab-bar").getByRole("link", { name: "Search" }).click();
    await page.getByRole("searchbox", { name: "Search your library" }).fill("metoprolol");
    await expect(page.getByTestId("results-page")).toBeVisible();
    await page.getByRole("searchbox", { name: "Search your library" }).fill("beta");
    await expect(page.getByTestId("results-node")).toBeVisible();
    await expect(page.getByTestId("results-block")).toBeVisible();
    await expect(page.getByTestId("results-page")).toBeVisible();
    await page.getByTestId("results-page").getByRole("link").first().click();
    await expect(page.getByTestId("page-position")).toBeVisible();
    await expect(page.getByTestId("source-viewer")).toBeVisible();
  });

  test("the activity screen lists what agents did, linked to the objects", async ({
    page,
  }, testInfo) => {
    if (layoutOf(testInfo) === "phone") {
      await page.getByRole("link", { name: "Settings", exact: true }).click();
      await page.getByRole("link", { name: "Activity" }).click();
    } else {
      await page.getByTestId("sidebar").getByRole("link", { name: "Activity" }).click();
    }
    await expect(page.getByRole("heading", { level: 1, name: "Activity" })).toBeVisible();
    const first = page.getByTestId("activity-entry").first();
    await expect(first).toContainText("Filed Lecture 07 slides.pptx");
    await first.getByRole("link", { name: "Beta blockers" }).click();
    await expect(
      page.getByRole("heading", { level: 1, name: "07 · Beta blockers · Oct 14" }),
    ).toBeVisible();
  });

  test("feature mount points show coming soon until their modules exist", async ({ page }) => {
    for (const [path, title] of [
      ["/practice", "Practice"],
      ["/exams", "Exams"],
      ["/requests", "Requests"],
    ] as const) {
      await page.goto(path);
      await expect(page.getByRole("heading", { level: 1, name: title })).toBeVisible();
      await expect(page.getByText("Coming soon")).toBeVisible();
    }
  });
});
