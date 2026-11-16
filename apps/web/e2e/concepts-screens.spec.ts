import { mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { expect, type Page, test } from "@playwright/test";
import { openDemo, pick } from "./concepts-helpers";

/** Screenshots of every main state: screenshots/concepts/<size>-<theme>/<state>.png (not assertions). */
const ROOT = resolve(import.meta.dirname, "../screenshots/concepts");

for (const theme of ["light", "dark"] as const) {
  test.describe(theme, () => {
    test.beforeEach(async ({ page }) => {
      await page.emulateMedia({ colorScheme: theme });
    });

    const shoot = async (page: Page, name: string, projectName: string, full = true) => {
      const dir = resolve(ROOT, `${projectName}-${theme}`);
      mkdirSync(dir, { recursive: true });
      await page.waitForTimeout(250);
      await page.screenshot({ path: resolve(dir, `${name}.png`), fullPage: full });
    };

    test("index and concept pages", async ({ page }, info) => {
      const n = info.project.name;
      await openDemo(page, { theme });
      await expect(page.getByTestId("concept-row").first()).toBeVisible();
      await shoot(page, "index-browse", n);
      await page.getByTestId("concept-search").fill("lopress");
      await expect(page.getByTestId("concept-row")).toHaveCount(1);
      await shoot(page, "index-search", n);

      for (const [key, name] of [
        ["metoprolol", "concept-drug"],
        ["acei", "concept-class"],
        ["lisinopril", "concept-general-knowledge"],
      ] as const) {
        await openDemo(page, { theme, concept: key });
        await expect(
          page.getByTestId("graph").or(page.getByTestId("neighbour-list")),
        ).toBeVisible();
        await shoot(page, name, n);
      }

      // the neighbourhood as a graph, two steps
      await openDemo(page, { theme, concept: "bb" });
      if (n === "phone") await page.getByRole("button", { name: "Graph" }).click();
      await page.getByRole("button", { name: "Two steps" }).click();
      await expect(page.getByTestId("graph-node").nth(8)).toBeVisible();
      await page.getByTestId("graph").scrollIntoViewIfNeeded();
      await page.waitForTimeout(400);
      await shoot(page, "concept-graph-two-steps", n);
      await page.getByTestId("graph").screenshot({
        path: resolve(ROOT, `${n}-${theme}`, "graph-only.png"),
      });
    });

    test("loading, error, empty", async ({ page }, info) => {
      const n = info.project.name;
      await openDemo(page, { theme, concept: "bb", slow: 4000 }).catch(() => undefined);
      await page.goto(`/concepts-demo.html?bar=0&theme=${theme}&concept=bb&slow=6000`);
      await expect(page.getByRole("status", { name: "Loading concept" })).toBeVisible();
      await shoot(page, "concept-loading", n, false);
      await page.goto(`/concepts-demo.html?bar=0&theme=${theme}&concept=bb&fail=1`);
      await expect(page.getByRole("alert")).toBeVisible();
      await shoot(page, "concept-error", n, false);
      await openDemo(page, { theme, empty: true });
      await expect(page.getByText("No concepts yet")).toBeVisible();
      await shoot(page, "index-empty", n, false);
    });

    test("questions, comparison and drill", async ({ page }, info) => {
      const n = info.project.name;
      await openDemo(page, { theme, tab: "find" });
      await shoot(page, "find-start", n);
      await page.getByTestId("question-causes").click();
      await pick(page, /Everything that causes/, "Bradycardia");
      await expect(page.getByTestId("finder-result").first()).toBeVisible();
      await shoot(page, "find-results", n);

      await openDemo(page, { theme, tab: "compare" });
      await shoot(page, "compare-start", n);
      await pick(page, "Add a whole class", "Beta blockers");
      await pick(page, "Add a drug", "Lisinopril");
      await page.getByLabel("Interactions").check();
      await page.getByRole("button", { name: /Build table/ }).click();
      await expect(page.getByTestId("comparison")).toBeVisible();
      await shoot(page, "compare-table", n);

      await openDemo(page, { theme, tab: "drill", seed: 4 });
      await shoot(page, "drill-menu", n);
      await page.getByTestId("start-round").click();
      const partners = await page.evaluate(async () => {
        const pairs = await (
          window.__concepts.store as {
            brandGeneric(): Promise<Array<{ brand: string; generic: string }>>;
          }
        ).brandGeneric();
        return Object.fromEntries(pairs.map((p) => [p.brand, p.generic]));
      });
      const prompts = page.getByTestId("drill-prompt");
      const answers = page.getByTestId("drill-answer");
      const text = async (i: number) => (await prompts.nth(i).textContent()) ?? "";
      await prompts.nth(0).click();
      await answers.filter({ hasText: new RegExp(`^${partners[await text(0)]}$`) }).click();
      await prompts.nth(1).click();
      await answers
        .filter({ hasNotText: partners[await text(1)] ?? "" })
        .first()
        .click();
      await shoot(page, "drill-board-wrong", n);
      await page.waitForTimeout(800);
      await prompts.nth(2).click();
      await shoot(page, "drill-board-selected", n);
      await prompts.nth(2).click();
      for (let i = 1; i < 6; i++) {
        await prompts.nth(i).click();
        await answers.filter({ hasText: new RegExp(`^${partners[await text(i)]}$`) }).click();
      }
      await expect(page.getByTestId("drill-results")).toBeVisible();
      await shoot(page, "drill-results", n);
    });
  });
}
