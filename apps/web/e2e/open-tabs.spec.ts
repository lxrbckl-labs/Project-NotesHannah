import { expect, test } from "@playwright/test";
import { signIn } from "./helpers";

/** Open tabs (features/tabs): several pages side by side on a tablet and a computer; none on a phone. */

const strip = (page: import("@playwright/test").Page) => page.getByTestId("tab-strip");
const openTabs = (page: import("@playwright/test").Page) => page.getByTestId("open-tab");

test("a phone has no tabs", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "phone");
  await signIn(page);
  await expect(page.getByRole("button", { name: "New tab" })).toHaveCount(0);
  await expect(strip(page)).toHaveCount(0);
});

test("with tabs open the search shrinks to its icon, and the tabs scroll sideways in the bar", async ({
  page,
}, testInfo) => {
  test.skip(testInfo.project.name === "phone");
  await signIn(page);
  const bar = page.getByTestId("app-bar");
  // One tab: the search is a wide field with its name on it.
  const wide = await bar.getByRole("button", { name: /Quick find/ }).boundingBox();
  expect(wide?.width ?? 0).toBeGreaterThan(200);
  const newTab = bar.getByRole("button", { name: "New tab" });
  for (let i = 0; i < 9; i++) await newTab.click();
  await expect(openTabs(page)).toHaveCount(10);
  const icon = await bar.getByRole("button", { name: /Quick find/ }).boundingBox();
  expect(icon?.width ?? 999).toBeLessThanOrEqual(44);
  // More tabs than fit: the strip scrolls, the bar keeps its height and the page does not scroll sideways.
  const sizes = await strip(page).evaluate((el) => [el.scrollWidth, el.clientWidth]);
  expect(sizes[0]).toBeGreaterThan(sizes[1] as number);
  await expect(openTabs(page).nth(9)).toBeInViewport();
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow).toBeLessThanOrEqual(0);
  // The search still opens from its icon.
  await bar.getByRole("button", { name: /Quick find/ }).click();
  await expect(page.getByRole("dialog")).toBeVisible();
});

test("the header runs the whole width, with both sidebars under it", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name === "phone");
  await signIn(page);
  const header = await page.locator("header").first().boundingBox();
  expect(header?.x).toBe(0);
  expect(header?.width).toBe(page.viewportSize()?.width);
  const sidebar = await page.getByTestId("sidebar").boundingBox();
  expect(sidebar?.y).toBe(header?.height);
  if (testInfo.project.name === "computer") {
    const panel = await page.getByTestId("right-panel").boundingBox();
    expect(panel?.y).toBe(header?.height);
    await page.getByRole("button", { name: "Hide details panel" }).click();
    await expect(page.getByTestId("right-panel")).toHaveCount(0);
    await page.getByRole("button", { name: "Show details panel" }).click();
    await expect(page.getByTestId("right-panel")).toBeVisible();
  }
});

test("Option T opens a tab and Option W closes it", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "computer");
  await signIn(page);
  await page.keyboard.press("Alt+t");
  await expect(openTabs(page)).toHaveCount(2);
  await page.keyboard.press("Alt+[");
  await expect(openTabs(page).nth(0)).toHaveAttribute("data-current", "true");
  await page.keyboard.press("Alt+w");
  await expect(strip(page)).toHaveCount(0);
});

test("opens a second tab, keeps each tab's page, and closes back to one", async ({
  page,
}, testInfo) => {
  test.skip(testInfo.project.name === "phone");
  await signIn(page);
  await expect(strip(page)).toHaveCount(0);
  await page.getByRole("button", { name: "New tab" }).click();
  await expect(openTabs(page)).toHaveCount(2);
  await expect(openTabs(page).nth(1)).toHaveAttribute("data-current", "true");

  // The new tab goes somewhere else; the first one stays on the library.
  await page.getByTestId("sidebar").getByRole("link", { name: "Calendar" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Calendar" })).toBeVisible();
  await expect(openTabs(page).nth(1)).toContainText("Calendar");
  await expect(openTabs(page).nth(0)).toContainText("Library");

  await openTabs(page).nth(0).getByRole("button", { name: "Library", exact: true }).click();
  await expect(page).toHaveURL(/\/library$/);
  await expect(page.getByRole("heading", { level: 1, name: "Library" })).toBeVisible();
  await openTabs(page).nth(1).getByRole("button", { name: "Calendar", exact: true }).click();
  await expect(page).toHaveURL(/\/calendar/);

  // Closing the tab on screen shows the one that is left, and the strip goes away.
  await page.getByRole("button", { name: "Close tab: Calendar" }).click();
  await expect(strip(page)).toHaveCount(0);
  await expect(page).toHaveURL(/\/library$/);
});

test("the tabs are still there after a reload", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name === "phone");
  await signIn(page);
  await page.getByRole("button", { name: "New tab" }).click();
  await page.getByTestId("sidebar").getByRole("link", { name: "Inbox" }).click();
  await expect(openTabs(page).nth(1)).toContainText("Inbox");
  await page.reload();
  await expect(openTabs(page)).toHaveCount(2);
  await expect(openTabs(page).nth(1)).toHaveAttribute("data-current", "true");
  await expect(page).toHaveURL(/\/inbox/);
});

test("Command or Control and a click opens a link in a tab behind the page", async ({
  page,
}, testInfo) => {
  test.skip(testInfo.project.name !== "computer");
  await signIn(page);
  await page
    .getByTestId("sidebar")
    .getByRole("link", { name: "Calendar" })
    .click({ modifiers: ["ControlOrMeta"] });
  await expect(openTabs(page)).toHaveCount(2);
  // Still on the library; the calendar waits in the second tab.
  await expect(page).toHaveURL(/\/library$/);
  await expect(openTabs(page).nth(0)).toHaveAttribute("data-current", "true");
  await openTabs(page).nth(1).getByRole("button").first().click();
  await expect(page.getByRole("heading", { level: 1, name: "Calendar" })).toBeVisible();
});

test("the pill button goes to the home page chosen in Settings", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name === "phone");
  await signIn(page);
  await expect(page.getByTestId("home-button")).toHaveAccessibleName("Home: Library");
  await page.getByTestId("sidebar").getByRole("link", { name: "Settings", exact: true }).click();
  await page.getByRole("radio", { name: "Calendar" }).click();
  await expect(page.getByRole("radio", { name: "Calendar" })).toHaveAttribute(
    "aria-checked",
    "true",
  );
  await page.getByTestId("home-button").click();
  await expect(page).toHaveURL(/\/calendar/);
  await expect(page.getByRole("heading", { level: 1, name: "Calendar" })).toBeVisible();
});
