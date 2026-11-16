import { expect, test } from "@playwright/test";
import { type Layout, signIn } from "./helpers";

const layoutOf = (testInfo: { project: { name: string } }) => testInfo.project.name as Layout;

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
  await expect(page.getByRole("heading", { level: 1, name: "Guide" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Download PDF" })).toHaveAttribute(
    "href",
    "/guide/notes-guide.pdf",
  );

  // No sideways scrolling at any size.
  const overflow = await page.evaluate(() => {
    const main = document.getElementById("main");
    return main ? main.scrollWidth - main.clientWidth : 0;
  });
  expect(overflow).toBeLessThanOrEqual(1);

  // The contents list jumps to a section.
  if (layoutOf(testInfo) === "computer") {
    await page
      .getByRole("navigation", { name: "On this page, side list" })
      .getByRole("link", { name: "Exams" })
      .click();
  } else {
    await page.getByText("On this page", { exact: true }).first().click();
    await page
      .getByRole("navigation", { name: "On this page", exact: true })
      .getByRole("link", { name: "Exams" })
      .click();
  }
  await expect(page).toHaveURL(/#exams$/);
  await expect(page.getByRole("heading", { level: 2, name: /Exams/ })).toBeInViewport();
});

test("the PDF is served as a file", async ({ page }) => {
  const response = await page.request.get("/guide/notes-guide.pdf");
  expect(response.ok()).toBe(true);
  expect(response.headers()["content-type"]).toContain("pdf");
  expect((await response.body()).subarray(0, 4).toString()).toBe("%PDF");
});

test("the print page needs no sign-in, and printing hides the app around the guide", async ({
  page,
}) => {
  await page.goto("/help/print");
  await expect(page.getByRole("heading", { level: 1, name: "Your guide to Notes" })).toBeVisible();
  await expect(page.getByTestId("sidebar")).toHaveCount(0);

  await signIn(page);
  await page.goto("/help");
  await expect(page.getByRole("heading", { level: 1, name: "Guide" })).toBeVisible();
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
