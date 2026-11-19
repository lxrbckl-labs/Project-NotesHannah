import { expect, test } from "@playwright/test";
import { signInBuilt, watch } from "./built";

/**
 * The phone's tab bar order against the real server and the production build: it is saved on the server
 * (not just in the page), survives a reload and a sign-out and sign-in, and the draft only applies on Save.
 * That each account has its own order is covered by the server tests (apps/server/test/preferences.test.ts);
 * this suite has one account.
 */
test.beforeEach(({ browserName: _b }, info) => {
  test.skip(info.project.name !== "built-phone", "the tab bar is the phone layout");
});

const bar = (page: import("@playwright/test").Page) =>
  page.getByTestId("tab-bar").getByRole("link");
const labels = async (page: import("@playwright/test").Page) =>
  (await bar(page).allInnerTexts()).map((t) => t.trim().split("\n").pop());

test("the order is saved on the server and follows her across reload and sign-in", async ({
  page,
}) => {
  const seen = watch(page);
  await signInBuilt(page);
  await page.getByTestId("tab-bar").getByRole("link", { name: "Settings" }).click();
  await expect(page.getByTestId("tab-bar-card")).toBeVisible();
  await expect(page.locator("html")).not.toHaveClass(/tab-sliding/);
  const settingsFirst = ["Settings", "Library", "Practice", "Calendar", "Search", "Inbox"];

  // Pick Settings and move it to the far left with the keyboard; the real bar waits for Save.
  const picked = page.getByTestId("tab-replica-item").filter({ hasText: "Settings" });
  await picked.focus();
  await page.keyboard.press("Home");
  expect(await labels(page)).toEqual([
    "Library",
    "Practice",
    "Calendar",
    "Search",
    "Inbox",
    "Settings",
  ]);
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect.poll(() => labels(page)).toEqual(settingsFirst);

  const server = await page.request.get("/api/me/preferences");
  expect((await server.json()).preferences.tabOrder).toEqual(
    settingsFirst.map((l) => l.toLowerCase()),
  );

  await page.reload();
  await expect.poll(() => labels(page)).toEqual(settingsFirst);

  // Sign out and in again: the order comes from the server, not from anything left in the page.
  await page.evaluate(() => localStorage.clear());
  await page.request.post("/api/auth/logout", { headers: { Origin: new URL(page.url()).origin } });
  await signInBuilt(page);
  await expect.poll(() => labels(page)).toEqual(settingsFirst);

  // Put the usual order back so the other built tests see the default bar.
  await page.getByTestId("tab-bar").getByRole("link", { name: "Settings" }).click();
  await expect(page.locator("html")).not.toHaveClass(/tab-sliding/);
  await page.getByRole("button", { name: "Reset to default" }).click();
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect
    .poll(() => labels(page))
    .toEqual(["Library", "Practice", "Calendar", "Search", "Inbox", "Settings"]);
  seen.assertClean("the tab bar card");
});
