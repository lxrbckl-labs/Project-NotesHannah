import { expect, type Page } from "@playwright/test";

export const USERNAME = "hannah";
export const PASSWORD = "study-notes-2026";

export type Layout = "phone" | "tablet" | "computer";

export async function signIn(page: Page) {
  await page.goto("/login");
  await page.getByLabel("Username").fill(USERNAME);
  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Library" })).toBeVisible();
}

/** The full-page tree on the library home. */
export const allFiles = (page: Page) => page.getByRole("tree", { name: "All files" });

/** Library home to a course's Lectures list, through the tree (works at every size). */
export async function openLectures(page: Page, course = "Pharmacology II") {
  const tree = allFiles(page);
  await expect(tree.getByRole("treeitem", { name: course, exact: true })).toBeVisible();
  const expand = tree.getByRole("button", { name: `Expand ${course}` });
  if (await expand.count()) await expand.click();
  const courseItem = tree
    .locator("li")
    .filter({ has: page.getByRole("treeitem", { name: course, exact: true }) })
    .last();
  await courseItem.getByRole("treeitem", { name: "Lectures", exact: true }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Lectures" })).toBeVisible();
}

export async function openSettings(page: Page) {
  await page.getByRole("link", { name: "Settings", exact: true }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Settings" })).toBeVisible();
}

export async function openTrash(page: Page, layout: Layout) {
  if (layout === "phone") {
    await page.getByRole("link", { name: "Settings", exact: true }).click();
    await page.getByRole("link", { name: "Trash" }).click();
  } else {
    await page.getByTestId("sidebar").getByRole("link", { name: "Trash" }).click();
  }
  await expect(page.getByRole("heading", { level: 1, name: "Trash" })).toBeVisible();
}

export async function rowMenu(page: Page, itemName: string, action: string | RegExp) {
  await page.getByRole("button", { name: `Actions for ${itemName}` }).click();
  await page.getByRole("menuitem", { name: action }).click();
}

export const rowTitles = (page: Page) =>
  page
    .getByRole("list", { name: "Contents" })
    .getByTestId("node-row")
    .locator("a span.truncate.font-medium");

/** Wait until the mock server has stored a change (it saves its state to sessionStorage). */
export async function savedByServer(page: Page, text: string) {
  await page.waitForFunction(
    (needle) => sessionStorage.getItem("notes-mock-state")?.includes(needle) ?? false,
    text,
  );
}
