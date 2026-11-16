import { expect, type Page, test } from "@playwright/test";
import { type Layout, signIn } from "./helpers";

const layoutOf = (testInfo: { project: { name: string } }) => testInfo.project.name as Layout;

const sideways = (page: Page) =>
  page.evaluate(() => {
    const main = document.getElementById("main");
    return main ? main.scrollWidth - main.clientWidth : 0;
  });

test("the guide opens from the sidebar, or from Settings on a phone", async ({
  page,
}, testInfo) => {
  await signIn(page);
  if (layoutOf(testInfo) === "phone") {
    await page.getByTestId("tab-bar").getByRole("link", { name: "Settings" }).click();
    await page.getByRole("link", { name: "Guide", exact: true }).click();
  } else {
    await page.getByTestId("sidebar").getByRole("link", { name: "Guide", exact: true }).click();
  }
  await expect(page).toHaveURL(/\/help$/);
  await expect(page.getByRole("heading", { level: 1, name: "Your guide to Notes" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Download PDF" })).toHaveAttribute(
    "href",
    "/guide/notes-guide.pdf",
  );
  await expect(
    page.getByRole("heading", { level: 2, name: "Your material", exact: true }),
  ).toBeAttached();

  // No sideways scrolling at any size, in either theme.
  expect(await sideways(page)).toBeLessThanOrEqual(1);

  // The contents list jumps to a section, and the current section follows.
  if (layoutOf(testInfo) === "computer") {
    const side = page.getByRole("navigation", { name: "On this page, side list" });
    await side.getByRole("link", { name: /Exams/ }).click();
    await expect(page).toHaveURL(/#exams$/);
    await expect(
      page.getByRole("heading", { level: 2, name: "Exams", exact: true }),
    ).toBeInViewport();
    await expect(side.locator('[aria-current="location"]')).toHaveText(/Exams/);
  } else {
    await page.getByRole("button", { name: /On this page/ }).click();
    await page
      .getByRole("navigation", { name: "On this page", exact: true })
      .getByRole("link", { name: /Exams/ })
      .click();
    await expect(page).toHaveURL(/#exams$/);
    await expect(
      page.getByRole("heading", { level: 2, name: "Exams", exact: true }),
    ).toBeInViewport();
    await expect(page.getByTestId("guide-current")).toHaveText(/Exams/);
  }
});

test("the guide works in dark too, with no sideways scroll", async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem("notes-theme", "dark"));
  await signIn(page);
  await page.goto("/help");
  await expect(page.getByRole("heading", { level: 1, name: "Your guide to Notes" })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.dataset.theme)).toBe("dark");
  expect(await sideways(page)).toBeLessThanOrEqual(1);
});

test("a figure loads and opens larger", async ({ page }) => {
  await signIn(page);
  await page.goto("/help#reading-a-lecture");
  const figure = page.locator('[data-figure="lecture-page"]');
  await figure.scrollIntoViewIfNeeded();
  await expect
    .poll(() => figure.locator("img").evaluate((img: HTMLImageElement) => img.naturalWidth))
    .toBeGreaterThan(500);
  await expect(figure).toContainText("Figure 2");
  await figure.getByRole("button", { name: "Enlarge Figure 2" }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByTestId("guide-figure-zoom")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
});

test("the PDF and the figures are served as files", async ({ page }) => {
  const response = await page.request.get("/guide/notes-guide.pdf");
  expect(response.ok()).toBe(true);
  expect(response.headers()["content-type"]).toContain("pdf");
  expect((await response.body()).subarray(0, 4).toString()).toBe("%PDF");
  const figure = await page.request.get("/guide/figures/library-home.webp");
  expect(figure.ok()).toBe(true);
  expect(figure.headers()["content-type"]).toContain("image/webp");
});

test("the print page needs no sign-in, and printing hides the app around the guide", async ({
  page,
}) => {
  await page.goto("/help/print");
  await expect(page.getByRole("heading", { level: 1, name: "Your guide to Notes" })).toBeVisible();
  await expect(page.getByTestId("sidebar")).toHaveCount(0);
  await expect(page.getByRole("navigation", { name: "Contents" })).toBeVisible();

  await signIn(page);
  await page.goto("/help");
  await expect(page.getByRole("heading", { level: 1, name: "Your guide to Notes" })).toBeVisible();
  await expect(
    page.getByRole("heading", { level: 2, name: /What makes this different/ }),
  ).toBeVisible();
  await page.emulateMedia({ media: "print", colorScheme: "dark" });
  await expect(page.getByTestId("sidebar")).toBeHidden();
  await expect(page.getByRole("link", { name: "Download PDF" })).toBeHidden();
  const colours = await page.evaluate(() => ({
    bg: getComputedStyle(document.body).backgroundColor,
    text: getComputedStyle(document.getElementById("what-makes-this-different-title") as Element)
      .color,
  }));
  expect(colours.bg).toBe("rgb(255, 255, 255)");
  expect(colours.text).toBe("rgb(0, 0, 0)");
});
