import { expect, type Page, test } from "@playwright/test";
import { signIn } from "./helpers";

const DEFAULT = ["Library", "Practice", "Calendar", "Search", "Inbox", "Settings"];
const SETTINGS_FIRST = ["Settings", "Library", "Practice", "Calendar", "Search", "Inbox"];

/** The real bar along the bottom, left to right. */
const realBar = async (page: Page) =>
  (await page.getByTestId("tab-bar").getByRole("link").allInnerTexts()).map(
    (t) => t.trim().split("\n").pop() ?? "",
  );

/** The replica in the Settings card, left to right (by the slot each icon sits in). */
async function replica(page: Page) {
  const items = await page.getByTestId("tab-replica-item").evaluateAll((els) =>
    els.map((el) => ({
      label: (el.textContent ?? "").trim(),
      index: Number(el.getAttribute("data-index")),
    })),
  );
  return items.sort((a, b) => a.index - b.index).map((i) => i.label);
}

const item = (page: Page, label: string) =>
  page.getByTestId("tab-replica-item").filter({ hasText: label });

/** Press on an icon, drag it to a slot of the replica, and let go. Mouse here; the card uses pointer events. */
async function dragTo(page: Page, label: string, slot: number) {
  // The card can sit below the fold on a phone; the mouse only reaches what is on screen.
  await item(page, label).scrollIntoViewIfNeeded();
  // The other icons glide into place after a change; measure once they have stopped.
  let box = await item(page, label).boundingBox();
  for (let i = 0; i < 20; i++) {
    await page.waitForTimeout(60);
    const next = await item(page, label).boundingBox();
    const still = next && box && next.x === box.x && next.y === box.y;
    box = next;
    if (still) break;
  }
  const bar = await page.getByRole("list", { name: "Tab bar order" }).boundingBox();
  if (!box || !bar) throw new Error("the replica is not on screen");
  const slotWidth = bar.width / 5;
  const from = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
  const toX = bar.x + slotWidth * slot + slotWidth / 2;
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(from.x + Math.sign(toX - from.x) * 10, from.y, { steps: 3 });
  await page.mouse.move(toX, from.y, { steps: 12 });
  await page.mouse.up();
}

async function openSettings(page: Page) {
  await page.getByTestId("tab-bar").getByRole("link", { name: "Settings" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Settings" })).toBeVisible();
  // The page slides in; wait for it to stop before measuring anything on it.
  await expect(page.locator("html")).not.toHaveClass(/tab-sliding/);
  // Cards above it can push the tab bar card below the fold; mouse and touch only reach what is on screen.
  await page.getByTestId("tab-bar-card").scrollIntoViewIfNeeded();
}

const save = (page: Page) => page.getByRole("button", { name: "Save", exact: true });
const cancel = (page: Page) => page.getByRole("button", { name: "Cancel", exact: true });
const slideDirection = (page: Page) => page.evaluate(() => document.documentElement.dataset.tabDir);

test.beforeEach(async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "phone", "the tab bar is the phone layout");
  await signIn(page);
  await openSettings(page);
});

test("dragging an icon changes only the draft; Save puts the real bar in that order", async ({
  page,
}) => {
  await expect(page.getByTestId("tab-bar-card")).toBeVisible();
  expect(await replica(page)).toEqual(DEFAULT);
  await expect(save(page)).toBeDisabled();
  await expect(cancel(page)).toBeDisabled();

  await dragTo(page, "Settings", 0);
  await expect.poll(() => replica(page)).toEqual(SETTINGS_FIRST);
  // Nothing has been saved: the real bar keeps its order.
  expect(await realBar(page)).toEqual(DEFAULT);
  await expect(save(page)).toBeEnabled();

  // Cancel restores the saved order in the replica.
  await cancel(page).click();
  await expect.poll(() => replica(page)).toEqual(DEFAULT);
  await expect(save(page)).toBeDisabled();
  expect(await realBar(page)).toEqual(DEFAULT);

  await dragTo(page, "Settings", 0);
  await expect.poll(() => replica(page)).toEqual(SETTINGS_FIRST);
  await save(page).click();
  await expect(page.getByText("Tab bar saved.")).toBeVisible();
  await expect.poll(() => realBar(page)).toEqual(SETTINGS_FIRST);
  await expect(save(page)).toBeDisabled();

  // The saved order is also kept in this browser (one entry per account), so the bar can draw in her order on
  // the first frame after a reload, before the server answers.
  const mirrored = await page.evaluate(() =>
    Object.entries(localStorage)
      .filter(([key]) => key.startsWith("notes-tab-order:"))
      .map(([, value]) => JSON.parse(value) as string[]),
  );
  expect(mirrored).toEqual([["settings", "library", "practice", "calendar", "search", "inbox"]]);

  // It persists: the bar comes back in her order after a reload.
  await page.reload();
  await expect(page.getByRole("heading", { level: 1, name: "Settings" })).toBeVisible();
  await expect.poll(() => realBar(page)).toEqual(SETTINGS_FIRST);
  expect(await replica(page)).toEqual(SETTINGS_FIRST);
});

test("the page slides the way the shown order says, with Settings at the far left", async ({
  page,
}) => {
  await dragTo(page, "Settings", 0);
  await save(page).click();
  await expect.poll(() => realBar(page)).toEqual(SETTINGS_FIRST);

  const bar = page.getByTestId("tab-bar");
  // Settings is the leftmost tab, so going to Library (to its right) slides forward...
  await bar.getByRole("link", { name: "Library" }).click();
  await expect(page).toHaveURL(/\/library$/);
  expect(await slideDirection(page)).toBe("forward");
  // ...and tapping Settings (to its left) slides back. In the default order this was the other way round.
  await bar.getByRole("link", { name: "Settings" }).click();
  await expect(page).toHaveURL(/\/settings$/);
  expect(await slideDirection(page)).toBe("back");
  await bar.getByRole("link", { name: "Inbox" }).click();
  await expect(page).toHaveURL(/\/inbox$/);
  expect(await slideDirection(page)).toBe("forward");
});

test("buttons and arrow keys move the picked icon; Reset sets a draft that still needs Save", async ({
  page,
}) => {
  await expect(page.getByRole("button", { name: "Move left", exact: true })).toBeDisabled();
  await item(page, "Library").click();
  await expect(page.getByRole("button", { name: "Move Library right" })).toBeEnabled();
  await expect(page.getByRole("button", { name: "Move Library left" })).toBeDisabled();
  await page.getByRole("button", { name: "Move Library right" }).click();
  await page.getByRole("button", { name: "Move Library right" }).click();
  expect(await replica(page)).toEqual([
    "Practice",
    "Calendar",
    "Library",
    "Search",
    "Inbox",
    "Settings",
  ]);
  expect(await realBar(page)).toEqual(DEFAULT);

  // Arrow keys on the focused icon, announced for screen readers.
  await item(page, "Settings").focus();
  await page.keyboard.press("ArrowLeft");
  await page.keyboard.press("ArrowLeft");
  expect(await replica(page)).toEqual([
    "Practice",
    "Calendar",
    "Library",
    "Settings",
    "Search",
    "Inbox",
  ]);
  await expect(
    page.locator("[aria-live]").filter({ hasText: "Settings moved to position 4" }),
  ).toBeAttached();
  await page.keyboard.press("Home");
  expect((await replica(page))[0]).toBe("Settings");
  await expect(item(page, "Settings")).toBeFocused();

  await save(page).click();
  await expect
    .poll(() => realBar(page))
    .toEqual(["Settings", "Practice", "Calendar", "Library", "Search", "Inbox"]);

  // Reset changes the draft only.
  await page.getByRole("button", { name: "Reset", exact: true }).click();
  expect(await replica(page)).toEqual(DEFAULT);
  expect(await realBar(page)).toEqual([
    "Settings",
    "Practice",
    "Calendar",
    "Library",
    "Search",
    "Inbox",
  ]);
  await expect(save(page)).toBeEnabled();
  await save(page).click();
  await expect.poll(() => realBar(page)).toEqual(DEFAULT);
  await expect(page.getByRole("button", { name: "Reset", exact: true })).toBeDisabled();
});

test("leaving Settings drops an unsaved draft", async ({ page }) => {
  await dragTo(page, "Inbox", 0);
  await expect
    .poll(() => replica(page))
    .toEqual(["Inbox", "Library", "Practice", "Calendar", "Search", "Settings"]);
  await page.getByTestId("tab-bar").getByRole("link", { name: "Library" }).click();
  await expect(page).toHaveURL(/\/library$/);
  await openSettings(page);
  expect(await replica(page)).toEqual(DEFAULT);
  expect(await realBar(page)).toEqual(DEFAULT);
});

test("a drag does not scroll the page, and the card fits the screen", async ({ page }) => {
  const main = page.locator("#main");
  const before = await main.evaluate((el) => el.scrollTop);
  await dragTo(page, "Library", 3);
  expect(await main.evaluate((el) => el.scrollTop)).toBe(before);
  const sideways = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(sideways).toBeLessThanOrEqual(0);
  for (const button of await page.getByTestId("tab-bar-card").getByRole("button").all()) {
    const box = await button.boundingBox();
    expect(box?.height ?? 0).toBeGreaterThanOrEqual(44);
  }
  expect(
    await page.evaluate(
      () =>
        getComputedStyle(document.querySelector('[data-testid="tab-replica-item"]') as Element)
          .touchAction,
    ),
  ).toBe("none");
});

test("a finger can drag an icon too", async ({ page }) => {
  const box = await item(page, "Inbox").boundingBox();
  const bar = await page.getByRole("list", { name: "Tab bar order" }).boundingBox();
  if (!box || !bar) throw new Error("the replica is not on screen");
  const y = box.y + box.height / 2;
  const startX = box.x + box.width / 2;
  const endX = bar.x + bar.width / 10;
  const cdp = await page.context().newCDPSession(page);
  const touch = (type: "touchStart" | "touchMove" | "touchEnd", x: number) =>
    cdp.send("Input.dispatchTouchEvent", {
      type,
      touchPoints: type === "touchEnd" ? [] : [{ x, y }],
    });
  await touch("touchStart", startX);
  for (let i = 1; i <= 12; i++) await touch("touchMove", startX + ((endX - startX) * i) / 12);
  await touch("touchEnd", endX);
  await expect
    .poll(() => replica(page))
    .toEqual(["Inbox", "Library", "Practice", "Calendar", "Search", "Settings"]);
  expect(await realBar(page)).toEqual(DEFAULT);
});
