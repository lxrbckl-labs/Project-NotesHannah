import { expect, type Page, test } from "@playwright/test";
import { ids, signInBuilt, watch } from "./built";

/** The editor in the built app: Tiptap and its extensions are lazily loaded files, so this proves they work. */

const saved = (page: Page) =>
  expect(page.getByTestId("save-status")).toHaveAttribute("data-status", "saved");

test("she types a heading with the # shortcut, makes text bold from the ribbon, and it is there after a reload", async ({
  page,
}, info) => {
  const seen = watch(page);
  // One document, three screen sizes in turn: the words differ so nothing is mistaken for an earlier run.
  const size = info.project.name.replace("built-", "");
  const heading = `Big idea ${size}`;
  const bold = `Remember this ${size}`;

  await signInBuilt(page);
  await page.goto(`/doc/${ids().editNodeId}`);
  await expect(page.getByTestId("doc-screen")).toBeVisible();
  const toggle = page.getByTestId("mode-toggle");
  if ((await toggle.getAttribute("aria-pressed")) !== "true") await toggle.click();
  await expect(toggle).toHaveAttribute("aria-pressed", "true");

  // Open the paragraph, go to its end and start a new one.
  const first = page.locator('[data-testid="block"][data-type="paragraph"]').first();
  await first.getByTestId("field-main").click({ position: { x: 20, y: 10 } });
  await expect(first.getByTestId("editor-main")).toBeFocused();
  // (End scrolls the page rather than moving the caret on a Mac)
  await page.keyboard.press(process.platform === "darwin" ? "Meta+ArrowDown" : "Control+End");
  await page.keyboard.press("Enter");

  // "# " at the start of the new paragraph makes it a heading.
  await page.keyboard.type(`# ${heading}`);
  const headingBlock = page.locator('[data-testid="block"][data-type="heading"]', {
    hasText: heading,
  });
  await expect(headingBlock).toBeVisible();
  await page.keyboard.press("Enter");

  // A line of text, selected, then the ribbon's bold button (the dock above the keyboard on a phone).
  await page.keyboard.type(bold);
  await page.keyboard.press("Shift+Home");
  const bar =
    info.project.name === "built-phone"
      ? page.getByTestId("format-toolbar")
      : page.getByTestId("format-ribbon");
  await bar.getByRole("button", { name: "Bold", exact: true }).click();
  await expect(page.locator("strong", { hasText: bold })).toBeVisible();

  // Typing is committed after a short pause. The status says "saved" before the last change is sent, so ask the
  // server itself whether the bold text has arrived.
  await page.keyboard.press("Escape");
  await expect
    .poll(async () => {
      const response = await page.request.get(`/api/documents/${ids().editDocId}/content`);
      return JSON.stringify(await response.json());
    })
    .toContain(`"text":"${bold}","bold":true`);
  await saved(page);

  await page.reload();
  await expect(page.getByTestId("doc-screen")).toBeVisible();
  await expect(
    page.locator('[data-testid="block"][data-type="heading"]', { hasText: heading }),
  ).toBeVisible();
  await expect(page.locator("strong", { hasText: bold })).toBeVisible();
  seen.assertClean("the editor");
});
