import { expect, type Page, test } from "@playwright/test";
import { type Layout, openLectures, signIn } from "./helpers";

const layoutOf = (testInfo: { project: { name: string } }) => testInfo.project.name as Layout;
const SEARCH = "https://www.pharmguides.com/search/?query=";

/**
 * The outside site is never loaded: requests to it are refused, and window.open only records the
 * address it was asked for, so the tests read where a link or the search box would go.
 */
async function guard(page: Page): Promise<string[]> {
  const errors: string[] = [];
  page.on("console", (m) => {
    if (m.type() === "error") errors.push(m.text());
  });
  page.on("pageerror", (e) => errors.push(e.message));
  await page.route(/pharmguides\.com/, (route) => route.abort());
  await page.addInitScript(() => {
    const w = window as unknown as { __opened: string[] };
    w.__opened = [];
    window.open = ((url?: string | URL) => {
      w.__opened.push(String(url));
      return null;
    }) as typeof window.open;
  });
  return errors;
}

const opened = (page: Page) =>
  page.evaluate(() => (window as unknown as { __opened: string[] }).__opened);

async function expectNoSideScroll(page: Page) {
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow).toBeLessThanOrEqual(1);
}

async function openReferences(page: Page, layout: Layout) {
  if (layout === "phone") {
    await page.getByTestId("tab-bar").getByRole("link", { name: "Settings" }).click();
    await page.getByRole("link", { name: "References" }).click();
  } else {
    await page.getByTestId("sidebar").getByRole("link", { name: "References" }).click();
  }
  await expect(page.getByRole("heading", { level: 1, name: "References" })).toBeVisible();
}

async function saveReference(
  page: Page,
  scope: ReturnType<Page["getByRole"]> | Page,
  url: string,
  extra: { title?: string; kind?: string; note?: string } = {},
) {
  await scope
    .getByRole("button", { name: /Save a reference|Add a reference here/ })
    .first()
    .click();
  const dialog = page.getByRole("dialog", { name: /Save a reference/ });
  await dialog.getByLabel("Web address").fill(url);
  await dialog.getByLabel("Web address").blur();
  if (extra.title) await dialog.getByLabel("Title").fill(extra.title);
  if (extra.kind) await dialog.getByRole("button", { name: extra.kind, exact: true }).click();
  if (extra.note) await dialog.getByLabel("Note (optional)").fill(extra.note);
  await dialog.getByRole("button", { name: "Save reference" }).click();
  await expect(dialog).toBeHidden();
}

test.describe("references page", () => {
  test("PharmGuides card: search, parts and areas open their addresses in a new tab", async ({
    page,
  }, testInfo) => {
    const errors = await guard(page);
    await signIn(page);
    await openReferences(page, layoutOf(testInfo));
    const card = page.getByTestId("resource-pharmguides");
    await expect(card.getByRole("heading", { name: /PharmGuides/ })).toBeVisible();
    await expect(card).toContainText("Opens pharmguides.com. An independent, pharmacist-curated");

    await card.getByRole("searchbox", { name: "Search PharmGuides" }).fill("heart failure");
    await card.getByRole("button", { name: /Search/ }).click();
    expect(await opened(page)).toEqual([`${SEARCH}heart+failure`]);

    const parts = card.getByRole("list", { name: "Parts of PharmGuides" }).getByRole("link");
    await expect(parts).toHaveCount(5);
    const dose = card.getByRole("link", { name: /DoseDex/ });
    await expect(dose).toHaveAttribute("href", "https://www.pharmguides.com/dosedex/");
    await expect(dose).toHaveAttribute("target", "_blank");
    await expect(dose).toHaveAttribute("rel", "noopener noreferrer");
    await expect(dose).toContainText("opens in a new tab");
    const area = card
      .getByRole("list", { name: "Search PharmGuides by area" })
      .getByRole("link", { name: /Infectious Disease/ });
    await expect(area).toHaveAttribute("href", `${SEARCH}Infectious+Disease`);

    await expect(page.getByRole("heading", { name: "No saved references yet" })).toBeVisible();
    await expectNoSideScroll(page);
    expect(errors).toEqual([]);
  });

  test("save, edit, filter and delete her references", async ({ page }, testInfo) => {
    const errors = await guard(page);
    await signIn(page);
    await openReferences(page, layoutOf(testInfo));

    // A PharmGuides address fills the title and kind, and is tagged.
    await page.getByRole("button", { name: "Save a reference" }).first().click();
    const dialog = page.getByRole("dialog", { name: "Save a reference" });
    await dialog.getByLabel("Web address").fill("https://www.pharmguides.com/dosedex/");
    await dialog.getByLabel("Web address").blur();
    await expect(dialog.getByLabel("Title")).toHaveValue("PharmGuides: DoseDex");
    await expect(dialog.getByText("From PharmGuides")).toBeVisible();
    await expect(dialog.getByRole("button", { name: "Chart", exact: true })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    await dialog.getByRole("button", { name: "Save reference" }).click();
    await expect(dialog).toBeHidden();

    // A bad address is refused with the reason.
    await page.getByRole("button", { name: "Save a reference" }).first().click();
    const again = page.getByRole("dialog", { name: "Save a reference" });
    await again.getByLabel("Web address").fill("javascript:alert(1)");
    await again.getByLabel("Title").fill("Nope");
    await again.getByRole("button", { name: "Save reference" }).click();
    await expect(again.getByText("Only web addresses (http or https) can be saved.")).toBeVisible();
    await again.getByRole("button", { name: "Cancel" }).click();

    await saveReference(page, page, "https://dailymed.nlm.nih.gov/dailymed/", {
      title: "DailyMed labels",
      kind: "Article",
      note: "Package inserts for dosing checks",
    });

    const items = page.getByTestId("reference-item");
    await expect(items).toHaveCount(2);
    const dose = items.filter({ hasText: "PharmGuides: DoseDex" });
    await expect(dose.getByRole("link", { name: /PharmGuides: DoseDex/ })).toHaveAttribute(
      "href",
      "https://www.pharmguides.com/dosedex/",
    );
    await expect(dose.getByText("From PharmGuides")).toBeVisible();

    // Filters: kind, then words.
    await page
      .getByRole("group", { name: "Kind" })
      .getByRole("button", { name: "Article" })
      .click();
    await expect(items).toHaveCount(1);
    await expect(items.first()).toContainText("DailyMed labels");
    await page
      .getByRole("group", { name: "Kind" })
      .getByRole("button", { name: "All kinds" })
      .click();
    await page.getByRole("searchbox", { name: "Filter your references" }).fill("dosedex");
    await expect(items).toHaveCount(1);
    await page.getByRole("searchbox", { name: "Filter your references" }).fill("zzz");
    await expect(page.getByRole("heading", { name: "Nothing matches" })).toBeVisible();
    await page.getByRole("button", { name: "Clear the filters" }).click();
    await expect(items).toHaveCount(2);

    // Pin, edit, delete.
    await page.getByRole("button", { name: "Pin DailyMed labels" }).click();
    await expect(items.first()).toContainText("Pinned");
    await page.getByRole("button", { name: "Actions for DailyMed labels" }).click();
    await page.getByRole("menuitem", { name: "Edit" }).click();
    const edit = page.getByRole("dialog", { name: "Edit reference" });
    await edit.getByLabel("Title").fill("DailyMed drug labels");
    await edit.getByRole("button", { name: "Save changes" }).click();
    await expect(edit).toBeHidden();
    await expect(items.first()).toContainText("DailyMed drug labels");

    await page.getByRole("button", { name: "Actions for DailyMed drug labels" }).click();
    await page.getByRole("menuitem", { name: "Delete" }).click();
    const confirm = page.getByRole("alertdialog", { name: "Delete this reference?" });
    await confirm.getByRole("button", { name: "Delete" }).click();
    await expect(items).toHaveCount(1);
    await expectNoSideScroll(page);
    expect(errors).toEqual([]);
  });
});

test.describe("where she studies", () => {
  test("a lecture's strip adds a reference tied to it; it shows there and on the course", async ({
    page,
  }) => {
    const errors = await guard(page);
    await signIn(page);
    await openLectures(page);
    await page.getByRole("link", { name: /07 · Beta blockers · Oct 14/ }).click();
    const strip = page.getByTestId("references-strip");
    await expect(strip.getByText("No references tied here yet.")).toBeVisible();
    await strip.getByRole("button", { name: "Add a reference here" }).click();
    const dialog = page.getByRole("dialog", { name: "Save a reference" });
    await expect(dialog.getByRole("list", { name: "Places it belongs with" })).toContainText(
      "Beta blockers",
    );
    await dialog.getByLabel("Web address").fill("https://www.pharmguides.com/categories/");
    await dialog.getByLabel("Web address").blur();
    await dialog.getByRole("button", { name: "Save reference" }).click();
    await expect(dialog).toBeHidden();
    await expect(strip.getByTestId("reference-item")).toContainText(
      "PharmGuides: Guidelines by category",
    );
    await expectNoSideScroll(page);

    // The course shows what is tied to anything inside it.
    await page
      .getByRole("navigation", { name: "Breadcrumb" })
      .getByRole("link", { name: "Pharmacology II" })
      .click();
    await expect(page.getByTestId("references-strip").getByTestId("reference-item")).toHaveCount(1);

    // And the list page offers the course as a filter.
    await page.goto("/references");
    await expect(
      page.getByRole("group", { name: "Course" }).getByRole("button", { name: "Pharmacology II" }),
    ).toBeVisible();
    await expect(
      page.getByTestId("reference-item").getByRole("link", { name: "Beta blockers" }),
    ).toBeVisible();
    expect(errors).toEqual([]);
  });

  test("search finds her saved references and offers PharmGuides for the same words", async ({
    page,
  }, testInfo) => {
    const errors = await guard(page);
    await signIn(page);
    await openReferences(page, layoutOf(testInfo));
    await saveReference(page, page, "https://kdigo.org/guidelines/", {
      title: "KDIGO kidney guidelines",
    });
    await page.goto("/search?q=kidney");
    const group = page.getByTestId("results-reference");
    await expect(group.getByRole("link", { name: /KDIGO kidney guidelines/ })).toHaveAttribute(
      "href",
      "https://kdigo.org/guidelines/",
    );
    const outside = page.getByTestId("search-pharmguides");
    await expect(outside).toContainText("Search PharmGuides for “kidney”");
    await expect(outside).toHaveAttribute("href", `${SEARCH}kidney`);
    await expect(outside).toHaveAttribute("target", "_blank");

    // With nothing of hers matching, the outside search is still offered.
    await page.goto("/search?q=tenecteplase");
    await expect(page.getByText("Nothing matches “tenecteplase”.")).toBeVisible();
    await expect(page.getByTestId("search-pharmguides")).toHaveAttribute(
      "href",
      `${SEARCH}tenecteplase`,
    );
    expect(errors).toEqual([]);
  });
});
