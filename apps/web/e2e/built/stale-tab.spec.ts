import { readdirSync } from "node:fs";
import { join } from "node:path";
import { expect, type Page, test } from "@playwright/test";
import { distDir, signInBuilt, watch } from "./built";

/**
 * The tab left open across a redeploy. The page is running the old build; she opens a screen it has not loaded
 * yet; the file it asks for is gone from the server, which answers 404. The app must load the new build by
 * reloading itself (once a minute at most) instead of showing an error screen or looping.
 */

const trashChunk = readdirSync(join(distDir, "assets")).find((f) => /^TrashPage-.*\.js$/.test(f));

/** Move to a screen inside the app, the way a link does (no page load). */
async function goInApp(page: Page, path: string) {
  await page.evaluate((to) => {
    window.history.pushState({}, "", to);
    window.dispatchEvent(new PopStateEvent("popstate"));
  }, path);
}

const gone = (route: {
  fulfill: (o: { status: number; contentType: string; body: string }) => Promise<void>;
}) => route.fulfill({ status: 404, contentType: "text/plain", body: "Not found" });

/** Count full page loads from now on (a reload is one). */
function countLoads(page: Page) {
  let loads = 0;
  page.on("load", () => {
    loads += 1;
  });
  return () => loads;
}

test.beforeAll(() => {
  expect(trashChunk, "the build has a TrashPage chunk").toBeTruthy();
});

test("a script that has vanished after a rebuild: the app reloads itself once and lands on the screen", async ({
  page,
}) => {
  const seen = watch(page);
  await signInBuilt(page);
  await page.goto("/library");
  await expect(page.getByRole("heading", { level: 1, name: /Hello, / })).toBeVisible();

  // The next lazily loaded script (the Trash screen) is not there, once; after the reload the new build has it.
  let refused = 0;
  await page.route(`**/assets/${trashChunk}`, (route) => {
    if (refused++ === 0) return gone(route);
    return route.continue();
  });
  const loads = countLoads(page);

  await goInApp(page, "/trash");
  await expect.poll(loads).toBe(1);
  await expect(page).toHaveURL(/\/trash$/);
  await expect(page.getByRole("heading", { level: 1, name: "Trash" })).toBeVisible();
  await expect(page.getByText("Something did not load")).toHaveCount(0);
  expect(refused).toBeGreaterThanOrEqual(1);
  // The 404 itself is the point of the test: it is the only problem allowed to show up.
  expect(seen.problems.filter((p) => !p.includes(`${trashChunk}`) && !p.includes("404"))).toEqual(
    [],
  );
});

test("a second failure right after does not reload again", async ({ page }) => {
  await signInBuilt(page);
  await page.goto("/library");
  await expect(page.getByRole("heading", { level: 1, name: /Hello, / })).toBeVisible();

  // The file is gone for good (a deploy really broke it): the first failure reloads, the second must not.
  let refused = 0;
  await page.route(`**/assets/${trashChunk}`, (route) => {
    refused += 1;
    return gone(route);
  });
  const loads = countLoads(page);

  await goInApp(page, "/trash");
  await expect.poll(loads).toBe(1);
  // Give a loop time to show itself: one reload in the last minute is all it may do.
  await page.waitForTimeout(4_000);
  expect(loads()).toBe(1);
  expect(refused).toBeGreaterThanOrEqual(2);
  const stamp = await page.evaluate(() => sessionStorage.getItem("notes-stale-reload"));
  expect(Number(stamp)).toBeGreaterThan(Date.now() - 60_000);
});
