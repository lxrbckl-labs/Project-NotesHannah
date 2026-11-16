import { expect, test } from "@playwright/test";
import { signIn } from "./helpers";

const expected = {
  phone: { tabBar: true, sidebar: false, rightPanel: false },
  tablet: { tabBar: false, sidebar: true, rightPanel: false },
  computer: { tabBar: false, sidebar: true, rightPanel: true },
} as const;

test("shows the right layout for the device size", async ({ page }, testInfo) => {
  const want = expected[testInfo.project.name as keyof typeof expected];
  await signIn(page);
  for (const [id, visible] of [
    ["tab-bar", want.tabBar],
    ["sidebar", want.sidebar],
    ["right-panel", want.rightPanel],
  ] as const) {
    const el = page.getByTestId(id);
    if (visible) await expect(el).toBeVisible();
    else await expect(el).toHaveCount(0);
  }
  // nothing scrolls sideways at any size
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow).toBeLessThanOrEqual(0);
});

test("tablet and computer can collapse the sidebar; touch targets are at least 44px on touch layouts", async ({
  page,
}, testInfo) => {
  await signIn(page);
  if (testInfo.project.name === "phone") {
    for (const tab of await page.getByTestId("tab-bar").getByRole("link").all()) {
      const box = await tab.boundingBox();
      expect(box?.height ?? 0).toBeGreaterThanOrEqual(44);
    }
    return;
  }
  if (testInfo.project.name === "tablet") {
    const box = await page
      .getByTestId("sidebar")
      .getByRole("link", { name: "Library" })
      .boundingBox();
    expect(box?.height ?? 0).toBeGreaterThanOrEqual(44);
  }
  await page.getByRole("button", { name: "Hide sidebar" }).click();
  await expect(page.getByTestId("sidebar")).toHaveCount(0);
  await page.getByRole("button", { name: "Show sidebar" }).click();
  await expect(page.getByTestId("sidebar")).toBeVisible();
});

test("tablet works in landscape too", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "tablet", "landscape is a tablet case");
  await page.setViewportSize({ width: 1194, height: 834 });
  await signIn(page);
  await expect(page.getByTestId("sidebar")).toBeVisible();
  await expect(page.getByTestId("tab-bar")).toHaveCount(0);
  await page
    .getByRole("tree", { name: "All files" })
    .getByRole("treeitem", { name: "Fall 2026", exact: true })
    .click();
  await expect(page.getByRole("heading", { level: 1, name: "Fall 2026" })).toBeVisible();
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow).toBeLessThanOrEqual(0);
});
