import { expect, test } from "@playwright/test";

const expected = {
  phone: { tabBar: true, sidebar: false, rightPanel: false },
  tablet: { tabBar: false, sidebar: true, rightPanel: false },
  computer: { tabBar: false, sidebar: true, rightPanel: true },
} as const;

test("shows the right layout for the device size", async ({ page }, testInfo) => {
  const want = expected[testInfo.project.name as keyof typeof expected];
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Notes" })).toBeVisible();
  for (const [id, visible] of [
    ["tab-bar", want.tabBar],
    ["sidebar", want.sidebar],
    ["right-panel", want.rightPanel],
  ] as const) {
    const el = page.getByTestId(id);
    if (visible) await expect(el).toBeVisible();
    else await expect(el).toBeHidden();
  }
});
