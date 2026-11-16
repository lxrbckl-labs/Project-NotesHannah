import { expect, type Page } from "@playwright/test";

export const DEMO = "/requests-demo.html";

export interface Setup {
  view?: "requests" | "asks";
  theme?: "light" | "dark";
  slow?: number;
  fail?: boolean;
  empty?: boolean;
}

export async function openDemo(page: Page, o: Setup = {}) {
  const q = new URLSearchParams({ bar: "0", fresh: "1" });
  if (o.view) q.set("view", o.view);
  if (o.theme) q.set("theme", o.theme);
  if (o.slow) q.set("slow", String(o.slow));
  if (o.fail) q.set("fail", "1");
  if (o.empty) q.set("empty", "1");
  await page.goto(`${DEMO}?${q}`);
  if (o.view === "asks") await expect(page.getByTestId("ask-button").first()).toBeVisible();
  else await expect(page.getByTestId("requests")).toBeVisible();
}

export const opened = (page: Page) =>
  page.evaluate(() => window.__requests.opened as Array<{ kind: string; detail: unknown }>);

/** The page never scrolls sideways. */
export async function expectNoSideScroll(page: Page) {
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow).toBeLessThanOrEqual(1);
}

/** Every button and link that can be tapped is at least 44px high on touch layouts. */
export async function smallTargets(page: Page, min = 44): Promise<string[]> {
  return page.evaluate((limit) => {
    const bad: string[] = [];
    for (const el of document.querySelectorAll<HTMLElement>("button, a[href], input, textarea")) {
      const box = el.getBoundingClientRect();
      if (box.width === 0 || box.height === 0) continue;
      if (box.height < limit - 0.5)
        bad.push(
          `${el.tagName} ${(el.textContent ?? el.getAttribute("aria-label") ?? "").trim().slice(0, 30)} ${Math.round(box.height)}px`,
        );
    }
    return bad;
  }, min);
}
