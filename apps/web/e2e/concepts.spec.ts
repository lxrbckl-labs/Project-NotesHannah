import { expect, test } from "@playwright/test";
import { expectNoSideScroll, openDemo, opened, pick } from "./concepts-helpers";

test.describe("concept page", () => {
  test("browse, open a concept, follow a relation and see it in the log", async ({ page }) => {
    await openDemo(page);
    await page.getByTestId("concept-search").fill("lopress");
    await expect(page.getByTestId("concept-row")).toHaveCount(1);
    await page.getByRole("link", { name: "Metoprolol", exact: true }).click();
    await expect(page.getByTestId("concept-name")).toHaveText("Metoprolol");
    await expect(page.getByTestId("brand-name")).toHaveText("Lopressor");
    await expectNoSideScroll(page);

    await page
      .getByTestId("relations")
      .getByRole("link", { name: "Cardioselective beta blockers" })
      .click();
    await expect(page.getByTestId("concept-name")).toHaveText("Cardioselective beta blockers");
    expect((await opened(page)).filter((o) => o.kind === "concept")).toHaveLength(2);
    await page.getByRole("button", { name: "All concepts" }).click();
    await expect(page.getByTestId("concepts-index")).toBeVisible();
  });

  test("a citation chip reports the source it opens", async ({ page }) => {
    await openDemo(page, { concept: "acei" });
    const row = page.getByTestId("relation-item").filter({ hasText: "Dry cough" });
    await row.getByTestId("cite-chip").click();
    await expect(page.getByTestId("source-opened")).toContainText("Dry cough affects");
    const log = await opened(page);
    expect(log.at(-1)).toMatchObject({
      kind: "source",
      detail: { quote: expect.stringContaining("bradykinin") },
    });
  });

  test("mark reviewed, and appears-in links open the right place", async ({ page }) => {
    await openDemo(page, { concept: "cough" });
    await expect(page.getByText("Unverified")).toBeVisible();
    await page.getByRole("button", { name: /Mark reviewed/ }).click();
    await expect(page.getByText("Reviewed by you")).toBeVisible();
    await page.getByTestId("mention").first().click();
    await page.getByTestId("question-link").first().click();
    const kinds = (await opened(page)).map((o) => o.kind);
    expect(kinds).toEqual(expect.arrayContaining(["document", "question"]));
  });

  test("the neighbourhood: list on phone, graph one tap away, hops and relation filter", async ({
    page,
  }, info) => {
    await openDemo(page, { concept: "bb" });
    const phone = info.project.name === "phone";
    if (phone) {
      await expect(page.getByTestId("neighbour-list")).toBeVisible();
      await expect(page.getByTestId("graph")).toHaveCount(0);
      await page.getByRole("button", { name: "Graph" }).click();
    }
    await expect(page.getByTestId("graph")).toBeVisible();
    const nodes = page.getByTestId("graph-node");
    await expect(nodes.first()).toBeVisible();
    const direct = await nodes.count();

    await page.getByRole("button", { name: "Two steps" }).click();
    await expect.poll(() => nodes.count()).toBeGreaterThan(direct);

    // hide everything except adverse effects: fewer concepts remain
    const withAll = await nodes.count();
    await page.getByRole("button", { name: "Class", exact: true }).click();
    await expect.poll(() => nodes.count()).toBeLessThan(withAll);

    await page.getByRole("button", { name: "Direct" }).click();
    await page.getByRole("button", { name: "Class", exact: true }).click();
    // tap a neighbour: navigates
    await page.getByTestId("graph-node").filter({ hasText: "Bradycardia" }).click();
    await expect(page.getByTestId("concept-name")).toHaveText("Bradycardia");
    if (phone) await expect(page.getByTestId("neighbour-list")).toBeVisible();
    await page.getByRole("button", { name: "Hide" }).click();
    await expect(page.getByTestId("neighbour-list")).toHaveCount(0);
  });

  test("a merge suggestion is confirmed before it merges", async ({ page }) => {
    await openDemo(page, { concept: "metoprolol" });
    await page.getByRole("button", { name: "Merge into this concept" }).click();
    await expect(page.getByRole("alertdialog")).toContainText(
      "Merge Metoprolol succinate into Metoprolol?",
    );
    await page.getByRole("alertdialog").getByRole("button", { name: "Merge" }).click();
    await expect(page.getByTestId("merge-suggestion")).toHaveCount(0);
  });

  test("loading and error states", async ({ page }) => {
    await page.goto("/concepts-demo.html?bar=0&concept=bb&slow=1500");
    await expect(page.getByRole("status", { name: "Loading concept" })).toBeVisible();
    await page.goto("/concepts-demo.html?bar=0&concept=bb&fail=1");
    await expect(page.getByRole("alert")).toContainText("pretending to be down");
  });
});

test.describe("cross-course questions", () => {
  test("ask in plain words and open a supporting source", async ({ page }) => {
    await openDemo(page, { tab: "find" });
    await page.getByTestId("question-causes").click();
    await pick(page, /Everything that causes/, "Bradycardia");
    const answer = page.getByTestId("finder-answer");
    await expect(answer).toContainText("Everything that causes Bradycardia");
    const atenolol = answer.getByTestId("finder-result").filter({ hasText: "Atenolol" });
    await expect(atenolol).toContainText("Through its class, Beta blockers");
    await atenolol.getByTestId("cite-chip").first().click();
    await expect(page.getByTestId("source-opened")).toBeVisible();

    await page.getByTestId("question-class").click();
    await pick(page, /All drugs in the class/, "ACE inhibitors");
    await expect(answer.getByTestId("finder-result")).toHaveCount(3);
    await expectNoSideScroll(page);
  });
});

test.describe("comparison", () => {
  test("build a table, scroll it sideways with the first column staying, and leave a request", async ({
    page,
  }, info) => {
    await openDemo(page, { tab: "compare" });
    await expect(page.getByRole("button", { name: /Build table/ })).toBeDisabled();
    await pick(page, "Add a drug", "Atenolol");
    await pick(page, "Add a drug", "Lisinopril");
    await pick(page, "Add a whole class", "Nonselective beta blockers");
    await expect(page.getByTestId("compare-drugs").getByRole("listitem")).toHaveCount(4);
    await page.getByLabel("Interactions").check();
    await page.getByLabel("Brand names").check();
    await page.getByRole("button", { name: /Build table/ }).click();

    const table = page.getByTestId("comparison");
    await expect(table.getByTestId("compare-row")).toHaveCount(4);
    await expect(table.getByRole("columnheader", { name: "Interactions" })).toBeVisible();
    await expect(table.getByTestId("cite-chip").first()).toBeVisible();
    await expectNoSideScroll(page);

    if (info.project.name === "phone") {
      const first = table.getByRole("rowheader").first();
      const before = (await first.boundingBox())?.x ?? 0;
      await table.evaluate((el) => {
        el.scrollLeft = 300;
      });
      expect(await table.evaluate((el) => el.scrollLeft)).toBeGreaterThan(100);
      await expect
        .poll(async () => Math.abs(((await first.boundingBox())?.x ?? 0) - before))
        .toBeLessThan(2);
    }

    await page
      .getByRole("button", { name: /Leave a request to add this to a study guide/ })
      .click();
    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();
    await expect(dialog.getByRole("textbox")).toHaveValue(/Atenolol, Lisinopril/);
    await dialog
      .getByRole("button", { name: /^(leave|send|ask|submit)/i })
      .last()
      .click();
    await expect(page.getByTestId("compare-notice")).toBeVisible();
    expect(
      await page.evaluate(
        () => (window.__concepts.store as { requests: unknown[] }).requests.length,
      ),
    ).toBe(1);
  });
});

test.describe("brand and generic drill", () => {
  test("play a round: feedback at once, results, then the missed ones again", async ({ page }) => {
    await openDemo(page, { tab: "drill", seed: 4 });
    await page.getByTestId("start-round").click();
    await expect(page.getByTestId("drill-prompt")).toHaveCount(6);

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

    // a deliberate miss
    const firstText = (await prompts.first().textContent()) ?? "";
    const wrong = answers.filter({ hasNotText: partners[firstText] ?? "" }).first();
    await prompts.first().click();
    await wrong.click();
    await expect(page.getByTestId("drill-message")).toContainText("Not quite");
    await expect(prompts.first()).toHaveAttribute("data-state", "wrong");

    for (let i = 0; i < 6; i++) {
      const text = (await prompts.nth(i).textContent()) ?? "";
      await prompts.nth(i).click();
      await answers.filter({ hasText: new RegExp(`^${partners[text]}$`) }).click();
      if (i < 5) await expect(page.getByTestId("drill-progress")).toContainText(`${i + 1} of 6`);
    }
    await expect(page.getByTestId("drill-results")).toContainText("5 of 6 right on the first try");
    await expectNoSideScroll(page);
    await page.getByTestId("missed-again").click();
    await expect(prompts).toHaveCount(1);
    const text = (await prompts.first().textContent()) ?? "";
    await prompts.first().click();
    await answers.filter({ hasText: new RegExp(`^${partners[text]}$`) }).click();
    await expect(page.getByTestId("drill-results")).toContainText("1 of 1");
    await expect(page.getByTestId("missed-again")).toHaveCount(0);
  });

  test("drug to class mode works too", async ({ page }) => {
    await openDemo(page, { tab: "drill", seed: 2 });
    await page.getByTestId("mode-drug_to_class").click();
    await page.getByTestId("start-round").click();
    await expect(page.getByTestId("drill-prompt").first()).toBeVisible();
    await expect(page.getByTestId("drill-answer").first()).toBeVisible();
  });
});

test("empty library says so", async ({ page }) => {
  await openDemo(page, { empty: true });
  await expect(page.getByText("No concepts yet")).toBeVisible();
});
