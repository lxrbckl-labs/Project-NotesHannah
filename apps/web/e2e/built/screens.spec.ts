import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { expect, type Page, test } from "@playwright/test";
import { type Ids, ids, signInBuilt, watch } from "./built";

/**
 * Every routed screen, in the built app: it renders, and nothing breaks while it loads (no uncaught error,
 * no script or stylesheet that failed to load, no console error). A screen is a lazily loaded file in the
 * build, so this is also the check that each of those files is served and runs.
 */

type Screen = {
  /** The router's path pattern this covers, as written in `src/app/routes.tsx`. */
  pattern: string;
  /** The address to open. */
  at: (i: Ids) => string;
  /** What shows when it has loaded. */
  ready: (page: Page) => ReturnType<Page["locator"]>;
};

/** Let late requests finish. The canvas keeps an event stream open, so "idle" may never come: do not wait for it. */
const settle = (page: Page) =>
  page.waitForLoadState("networkidle", { timeout: 2_000 }).catch(() => {});

const h1 = (name: string | RegExp) => (page: Page) =>
  page.getByRole("heading", { level: 1, name }).first();
const anyH1 = (page: Page) => page.getByRole("heading", { level: 1 }).first();

// The signed-in screens, each loaded on first use. Add a row here when a route is added to the router:
// the test below fails until you do.
const screens: Screen[] = [
  { pattern: "library", at: () => "/library", ready: h1(/Hello, /) },
  { pattern: "library/:nodeId", at: (i) => `/library/${i.courseId}`, ready: h1("Pharmacology II") },
  {
    pattern: "library/:nodeId",
    at: (i) => `/library/${i.lectureId}`,
    ready: h1(/Autonomic overview/),
  },
  {
    pattern: "files/:fileId",
    at: (i) => `/files/${i.fileId}`,
    ready: h1("Lecture 01 slides.pptx"),
  },
  { pattern: "search", at: () => "/search", ready: h1("Search") },
  { pattern: "inbox", at: () => "/inbox", ready: h1("Inbox") },
  { pattern: "trash", at: () => "/trash", ready: h1("Trash") },
  { pattern: "settings", at: () => "/settings", ready: h1("Settings") },
  // The guide is being redesigned: only its stable parts are asserted here.
  { pattern: "help", at: () => "/help", ready: anyH1 },
  { pattern: "activity", at: () => "/activity", ready: h1("Activity") },
  { pattern: "design/bits", at: () => "/design/bits", ready: h1("React Bits") },
  { pattern: "design", at: () => "/design", ready: h1("Design reference") },
  {
    pattern: "doc/:nodeId",
    at: (i) => `/doc/${i.docNodeId}`,
    ready: (p) => p.getByTestId("doc-screen"),
  },
  {
    pattern: "doc/:nodeId/canvas",
    at: (i) => `/doc/${i.docNodeId}/canvas`,
    ready: (p) => p.getByTestId("canvas-view"),
  },
  { pattern: "practice", at: () => "/practice", ready: h1("Practice") },
  // The other Practice views: each has its own charts and lists.
  { pattern: "practice", at: () => "/practice?view=cards", ready: anyH1 },
  { pattern: "practice", at: () => "/practice?view=notebook", ready: anyH1 },
  { pattern: "practice", at: () => "/practice?view=weak", ready: anyH1 },
  {
    pattern: "practice/session/:id",
    at: (i) => `/practice/session/${i.sessionId}`,
    ready: (p) => p.getByText(/Question 1 of 2/),
  },
  { pattern: "exams", at: () => "/exams", ready: h1("Exams") },
  { pattern: "references", at: () => "/references", ready: h1("References") },
  {
    // sends her on to the question's own screen
    pattern: "question/:questionId",
    at: (i) => `/question/${i.questionId}`,
    ready: (p) => p.getByRole("main"),
  },
  { pattern: "requests", at: () => "/requests", ready: h1("Requests") },
  { pattern: "concepts", at: () => "/concepts", ready: h1("Concepts") },
  { pattern: "concepts/:id", at: (i) => `/concepts/${i.conceptId}`, ready: h1("metoprolol") },
  {
    pattern: "*",
    at: () => "/this/is/not/a/page",
    ready: (p) => p.getByText("This page does not exist"),
  },
];
// The routes that sit outside the sign-in gate are visited without signing in, below.
const openScreens: { pattern: string; at: string; ready: Screen["ready"] }[] = [
  { pattern: "/login", at: "/login", ready: (p) => p.getByRole("button", { name: "Sign in" }) },
  { pattern: "/help/print", at: "/help/print", ready: anyH1 },
];

test("every route in the router has a screen in this list", () => {
  // The router's own source is the list of truth: a route added there without a row here fails this test.
  const source = readFileSync(resolve("src/app/routes.tsx"), "utf8");
  const routed = [...source.matchAll(/\bpath:\s*"([^"]+)"/g)].map((m) => m[1] as string);
  expect(routed.length).toBeGreaterThan(15);
  const covered = new Set([...screens.map((s) => s.pattern), ...openScreens.map((s) => s.pattern)]);
  const missing = routed.filter((path) => !covered.has(path));
  expect(missing, "routes with no screen in e2e/built/screens.spec.ts").toEqual([]);
});

for (const screen of openScreens) {
  test(`the ${screen.pattern} screen loads cleanly without signing in`, async ({ page }) => {
    const seen = watch(page);
    await page.goto(screen.at);
    await expect(screen.ready(page)).toBeVisible();
    await settle(page);
    seen.assertClean(screen.at);
  });
}

test.describe("signed in", () => {
  test("every screen loads cleanly", async ({ page }) => {
    // One sign-in, then every screen in turn in the one tab, as she moves around.
    test.setTimeout(180_000);
    const seen = watch(page);
    await signInBuilt(page);
    const i = ids();
    for (const screen of screens) {
      const address = screen.at(i);
      await test.step(address, async () => {
        await page.goto(address);
        await expect(screen.ready(page), address).toBeVisible();
        await settle(page);
        seen.assertClean(address);
        // The app fills the window and scrolls inside itself. If the window itself can scroll, something
        // has escaped the page area, and on a phone she can drag the whole app up past its edge.
        const spill = await page.evaluate(() => ({
          down: document.documentElement.scrollHeight - window.innerHeight,
          across: document.documentElement.scrollWidth - window.innerWidth,
        }));
        expect(spill.down, `${address}: the window scrolls down`).toBeLessThanOrEqual(1);
        expect(spill.across, `${address}: the window scrolls sideways`).toBeLessThanOrEqual(1);
      });
    }
  });

  test("a document opens to read and to edit", async ({ page }) => {
    const seen = watch(page);
    await signInBuilt(page);
    await page.goto(`/doc/${ids().docNodeId}`);
    const screen = page.getByTestId("doc-screen");
    await expect(screen).toBeVisible();
    await expect(page.getByText("Beta blockers reduce heart rate")).toBeVisible();
    // She starts in edit mode on a computer and in read mode on a touch screen: set each on purpose.
    const toggle = page.getByTestId("mode-toggle");
    const editing = (on: boolean) => page.locator(`[data-editing="${on}"]`);
    if ((await toggle.getAttribute("aria-pressed")) === "true") await toggle.click();
    await expect(toggle).toHaveAttribute("aria-pressed", "false");
    await expect(editing(false)).toBeVisible();
    await toggle.click();
    await expect(toggle).toHaveAttribute("aria-pressed", "true");
    await expect(editing(true)).toBeVisible();
    await expect(page.getByTestId("field-main").first()).toBeVisible();
    seen.assertClean("document edit mode");
  });

  test("the canvas shows the guide's cards and connector", async ({ page }) => {
    const seen = watch(page);
    await signInBuilt(page);
    await page.goto(`/doc/${ids().docNodeId}/canvas`);
    await expect(page.getByTestId("canvas-card")).toHaveCount(2);
    await expect(page.getByTestId("canvas-connector")).toHaveCount(1);
    seen.assertClean("canvas");
  });
});
