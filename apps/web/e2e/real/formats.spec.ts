import { expect, type Page, test } from "@playwright/test";
import { converterOnline, fixture, signInReal } from "./real";

/**
 * The coursework formats through the real server and the real converter container: a WebP photo, a
 * multi-page TIFF, an animated GIF and a Word handout are uploaded from the picker, converted, and opened
 * in the source viewer. (SVG is refused; that is covered with the other refusals in journeys.spec.ts.)
 */
async function uploadAndOpen(page: Page, name: string) {
  const row = page.getByTestId("file-row").filter({ hasText: name }).first();
  await expect(row).toHaveAttribute("data-status", "converted", { timeout: 120_000 });
  await row.getByRole("link", { name }).click();
  await expect(page.getByTestId("source-viewer")).toBeVisible();
  await expect(page.getByRole("heading", { level: 1, name })).toBeVisible();
}

test("a WebP, a multi-page TIFF, an animated GIF and a Word handout upload, convert and open in the viewer", async ({
  page,
}) => {
  await signInReal(page);
  expect(await converterOnline(page), "this test needs the real converter container").toBe(true);
  await page.getByRole("link", { name: "Inbox", exact: true }).click();
  const chooser = page.waitForEvent("filechooser");
  await page.getByRole("button", { name: "Upload files" }).first().click();
  await (await chooser).setFiles([
    fixture("figure.webp"),
    fixture("scan-3pages.tiff"),
    fixture("animated.gif"),
    fixture("handout.docx"),
  ]);
  const items = page.getByTestId("upload-item");
  await expect(items).toHaveCount(4);
  for (const name of ["figure.webp", "scan-3pages.tiff", "animated.gif", "handout.docx"]) {
    await expect(items.filter({ hasText: name })).toHaveAttribute("data-status", "done");
  }

  // One image: one page, no strip of one thumbnail and no pager, the image fits its pane.
  await uploadAndOpen(page, "figure.webp");
  await expect(page.getByTestId("file-details")).toContainText("Original: WebP image");
  await expect(page.getByRole("navigation", { name: "Pages" })).toHaveCount(0);
  await expect(page.getByTestId("page-position")).toHaveCount(0);
  const pageImage = page.getByRole("img", { name: "Page 1" });
  await expect(pageImage).toBeVisible();
  await expect
    .poll(() => pageImage.evaluate((el: HTMLImageElement) => el.complete && el.naturalWidth > 0))
    .toBe(true);
  const box = await pageImage.boundingBox();
  const viewport = page.viewportSize();
  expect(box && viewport && box.x >= 0 && box.x + box.width <= viewport.width + 1).toBe(true);
  await expect(page.getByRole("link", { name: /Download original/ })).toHaveAttribute(
    "href",
    /\/original\?download=true$/,
  );

  // A TIFF with three pages is three pages.
  await page.goBack();
  await uploadAndOpen(page, "scan-3pages.tiff");
  await expect(page.getByTestId("file-details")).toContainText("Original: TIFF image");
  await expect(page.getByTestId("thumb")).toHaveCount(3);
  await expect(page.getByTestId("page-position")).toHaveText("Page 1 of 3");

  // An animation keeps its first frame and the details say so.
  await page.goBack();
  await uploadAndOpen(page, "animated.gif");
  await expect(page.getByTestId("file-details")).toContainText("only the first frame");
  await expect(page.getByRole("navigation", { name: "Pages" })).toHaveCount(0);

  // A Word handout becomes pages like a deck, with its text.
  await page.goBack();
  await uploadAndOpen(page, "handout.docx");
  await expect(page.getByTestId("file-details")).toContainText("Original: Word document");
  await expect(page.getByTestId("thumb")).toHaveCount(2);
  const imageOfPage = page.getByRole("img", { name: "Page 1" });
  await expect
    .poll(() => imageOfPage.evaluate((el: HTMLImageElement) => el.complete && el.naturalWidth > 0))
    .toBe(true);
  // (on a phone the text sits in the other pane, so only its presence is checked)
  await expect(page.getByText("Anticoagulants: study handout").first()).toBeAttached();
});
