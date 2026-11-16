import { expect, type Page } from "@playwright/test";

export const DEMO = "/concepts-demo.html";

export interface Setup {
  /** Open a concept page by seed key ("metoprolol", "acei" ...). */
  concept?: string;
  tab?: "browse" | "find" | "compare" | "drill";
  theme?: "light" | "dark";
  seed?: number;
  slow?: number;
  fail?: boolean;
  empty?: boolean;
}

export async function openDemo(page: Page, o: Setup = {}) {
  const q = new URLSearchParams({ bar: "0" });
  if (o.concept) q.set("concept", o.concept);
  if (o.tab) q.set("tab", o.tab);
  if (o.theme) q.set("theme", o.theme);
  if (o.seed !== undefined) q.set("seed", String(o.seed));
  if (o.slow) q.set("slow", String(o.slow));
  if (o.fail) q.set("fail", "1");
  if (o.empty) q.set("empty", "1");
  await page.goto(`${DEMO}?${q}`);
  await expect(page.getByTestId(o.concept ? "concept-view" : "concepts-index")).toBeVisible();
}

export const opened = (page: Page) =>
  page.evaluate(() => window.__concepts.opened as Array<{ kind: string; detail: unknown }>);

/** The page never scrolls sideways (the comparison table scrolls inside its own region). */
export async function expectNoSideScroll(page: Page) {
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow).toBeLessThanOrEqual(1);
}

export async function pick(page: Page, label: string | RegExp, option: RegExp | string) {
  await page.getByRole("combobox", { name: label }).click();
  await page.getByTestId("picker-option").filter({ hasText: option }).first().click();
}
