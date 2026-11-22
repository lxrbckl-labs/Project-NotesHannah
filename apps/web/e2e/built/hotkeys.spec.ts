import { expect, test } from "@playwright/test";
import { signInBuilt, watch } from "./built";

/**
 * App-wide keyboard shortcuts (2026-11-22), against the real server and the production build: the
 * "go to" pairs, the "?" overlay, keys never firing while she types, the badges, and the Settings
 * switch that hides the badges while the keys keep working.
 */

test.use({ viewport: { width: 1440, height: 900 } });

test("pairs go places, '?' lists every shortcut, and typing never triggers a key", async ({
  page,
}) => {
  const seen = watch(page);
  await signInBuilt(page);
  await page.goto("/library");
  await expect(page.getByTestId("sidebar")).toBeVisible();

  // G then C opens the calendar; G then L comes back.
  await page.keyboard.press("g");
  await page.keyboard.press("c");
  await expect(page).toHaveURL(/\/calendar$/);
  await page.keyboard.press("g");
  await page.keyboard.press("l");
  await expect(page).toHaveURL(/\/library$/);

  // "?" opens the overlay; Escape closes it.
  await page.keyboard.press("?");
  const overlay = page.getByTestId("shortcuts-dialog");
  await expect(overlay).toBeVisible();
  await expect(overlay.getByRole("region", { name: "Go to" })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(overlay).toHaveCount(0);

  // While typing in quick find, "g" and "c" are letters, not a trip to the calendar.
  await page.keyboard.press("/");
  const find = page.getByRole("dialog");
  await expect(find).toBeVisible();
  await page.keyboard.type("gc");
  await expect(page).toHaveURL(/\/library$/);
  await page.keyboard.press("Escape");

  // The sidebar's links carry their keys, without changing their names.
  const library = page.getByTestId("sidebar").getByRole("link", { name: "Library", exact: true });
  await expect(library).toHaveAttribute("aria-keyshortcuts", "G L");
  await expect(library.locator("[data-hotkey='go.library']")).toHaveText("G then L");
  seen.assertClean("hotkeys");
});

test("Settings hides the badges; the keys still work; turning it back on restores them", async ({
  page,
}) => {
  const seen = watch(page);
  await signInBuilt(page);
  await page.goto("/settings");
  const badge = page.locator("[data-hotkey='go.library']");
  await expect(badge).toBeVisible();

  const toggle = page.getByRole("switch", { name: "Show keyboard shortcut badges" });
  await expect(toggle).toBeChecked();
  await toggle.click();
  await expect(toggle).not.toBeChecked();
  await expect(badge).toHaveCount(0);
  let prefs = await (await page.request.get("/api/me/preferences")).json();
  expect(prefs.preferences.shortcutBadges).toBe(false);

  // The keys work without their badges.
  await page.keyboard.press("g");
  await page.keyboard.press("c");
  await expect(page).toHaveURL(/\/calendar$/);

  await page.goto("/settings");
  await page.getByRole("switch", { name: "Show keyboard shortcut badges" }).click();
  await expect(page.locator("[data-hotkey='go.library']")).toBeVisible();
  prefs = await (await page.request.get("/api/me/preferences")).json();
  expect(prefs.preferences.shortcutBadges).toBe(true);
  seen.assertClean("shortcut badges setting");
});
