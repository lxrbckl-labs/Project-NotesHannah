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
