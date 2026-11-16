import { expect, test } from "@playwright/test";
import {
  allFiles,
  type Layout,
  openLectures,
  openSettings,
  openTrash,
  PASSWORD,
  rowMenu,
  rowTitles,
  savedByServer,
  signIn,
  USERNAME,
} from "./helpers";

const layoutOf = (testInfo: { project: { name: string } }) => testInfo.project.name as Layout;

test.describe("sign in", () => {
  test("wrong password shows an error, the right one gets in, sign out comes back", async ({
    page,
  }) => {
    await page.goto("/settings");
    await expect(page).toHaveURL(/\/login\?next=%2Fsettings/);
    await expect(page.getByText(/sign up/i)).toHaveCount(0);

    await page.getByLabel("Username").fill(USERNAME);
    await page.getByLabel("Password").fill("not the password");
    await page.getByRole("button", { name: "Sign in" }).click();
    await expect(page.getByRole("alert")).toContainText("username or password is not right");

    await page.getByLabel("Password").fill(PASSWORD);
    await page.getByRole("button", { name: "Sign in" }).click();
    // back to the page that was asked for
    await expect(page.getByRole("heading", { level: 1, name: "Settings" })).toBeVisible();
    await page.getByRole("button", { name: "Sign out", exact: true }).click();
    await expect(page.getByRole("heading", { name: "Welcome back" })).toBeVisible();
    await page.goto("/library");
    await expect(page).toHaveURL(/\/login/);
  });
});

test.describe("library", () => {
  test.beforeEach(async ({ page }) => signIn(page));

  test("navigates term to course to lecture, with breadcrumbs", async ({ page }) => {
    await allFiles(page).getByRole("treeitem", { name: "Fall 2026", exact: true }).click();
    await page
      .getByRole("list", { name: "Courses" })
      .getByRole("link", { name: "Pharmacology II" })
      .click();
    await page
      .getByRole("list", { name: "Sections" })
      .getByRole("link", { name: /^Lectures/ })
      .click();
    await page.getByRole("link", { name: /07 · Beta blockers · Oct 14/ }).click();
    await expect(
      page.getByRole("heading", { level: 1, name: "07 · Beta blockers · Oct 14" }),
    ).toBeVisible();
    await expect(page.getByRole("heading", { name: "Your notes" })).toBeVisible();
    const crumbs = page.getByRole("navigation", { name: "Breadcrumb" });
    await expect(crumbs.getByRole("link", { name: "Pharmacology II" })).toBeVisible();
    await crumbs.getByRole("link", { name: "Fall 2026" }).click();
    await expect(page.getByRole("heading", { level: 1, name: "Fall 2026" })).toBeVisible();
  });

  test("creates a course and shows its five sections", async ({ page }) => {
    await page
      .getByRole("tree", { name: "All files" })
      .getByRole("treeitem", { name: "Spring 2027", exact: true })
      .click();
    await page.getByRole("main").getByRole("button", { name: "New course" }).first().click();
    const dialog = page.getByRole("dialog", { name: "New course" });
    await dialog.getByLabel("Name", { exact: true }).fill("Immunology");
    await dialog.getByRole("button", { name: "Create" }).click();
    await expect(page.getByRole("heading", { level: 1, name: "Immunology" })).toBeVisible();
    const sections = page.getByRole("list", { name: "Sections" }).getByRole("link");
    await expect(sections).toHaveCount(5);
    await expect(sections).toContainText([
      "Sources",
      "Lectures",
      "Study guides",
      "Practice",
      "Exams",
    ]);
    // sections are fixed: no menu on their cards
    await expect(page.getByRole("button", { name: /Actions for Lectures/ })).toHaveCount(0);
  });

  test("renames a lecture in place and rolls nothing back when it works", async ({ page }) => {
    await openLectures(page);
    await rowMenu(page, "Cholinergic agents", "Rename");
    const input = page.getByRole("textbox", { name: "Rename Cholinergic agents" });
    await input.fill("Cholinergic drugs");
    await input.press("Enter");
    await expect(page.getByText("02 · Cholinergic drugs · Sep 2")).toBeVisible();
    await savedByServer(page, "Cholinergic drugs");
    await page.reload();
    await expect(page.getByText("02 · Cholinergic drugs · Sep 2")).toBeVisible();
  });

  test("moves a lecture with the Move to sheet", async ({ page }, testInfo) => {
    test.skip(layoutOf(testInfo) === "computer", "computer layout moves by drag and drop");
    await openLectures(page);
    await rowMenu(page, "Cholinergic agents", "Move to…");
    const sheet = page.getByRole("dialog", { name: /Move "Cholinergic agents"/ });
    await expect(sheet).toBeVisible();
    // the section it is already in cannot be chosen
    await expect(
      sheet.getByRole("button", { name: "Lectures", description: "Already here." }),
    ).toBeDisabled();
    await sheet.getByRole("button", { name: "Expand Pharmacotherapy I" }).click();
    await sheet.locator("button:not([disabled])", { hasText: "Lectures" }).click();
    await sheet.getByRole("button", { name: "Move here" }).click();
    await expect(page.getByText('Moved "Cholinergic agents" to Lectures')).toBeVisible();
    await expect(page.getByText("02 · Cholinergic agents")).toHaveCount(0);

    await page
      .getByRole("navigation", { name: "Breadcrumb" })
      .getByRole("link", { name: "Fall 2026" })
      .click();
    await page
      .getByRole("list", { name: "Courses" })
      .getByRole("link", { name: "Pharmacotherapy I" })
      .click();
    await page
      .getByRole("list", { name: "Sections" })
      .getByRole("link", { name: /^Lectures/ })
      .click();
    await expect(page.getByText("02 · Cholinergic agents · Sep 2")).toBeVisible();
  });

  test("moves a lecture by drag and drop, and reorders with drop indicators", async ({
    page,
  }, testInfo) => {
    test.skip(layoutOf(testInfo) !== "computer", "drag and drop is for the computer layout");
    await openLectures(page);
    const sidebar = page.getByTestId("sidebar");

    // reorder: drop 01 on the bottom half of 03 puts it after 03
    const rows = page.getByTestId("node-row");
    const first = rows.filter({ hasText: "01 · Autonomic overview" });
    const third = rows.filter({ hasText: "03 · Adrenergic agonists" });
    const box = await third.boundingBox();
    if (!box) throw new Error("no box");
    await first.dragTo(third, { targetPosition: { x: 60, y: box.height - 4 } });
    await expect(rowTitles(page).nth(0)).toContainText("02 · Cholinergic agents");
    await expect(rowTitles(page).nth(2)).toContainText("01 · Autonomic overview");

    // move: drop 02 onto the other course's Lectures section in the sidebar
    await sidebar.getByRole("button", { name: "Expand Pharmacotherapy I" }).click();
    await expect(sidebar.getByRole("treeitem", { name: "Lectures" })).toHaveCount(2);
    const target = sidebar.getByRole("treeitem", { name: "Lectures" }).last();
    await rows.filter({ hasText: "02 · Cholinergic agents" }).dragTo(target);
    await expect(page.getByText("02 · Cholinergic agents")).toHaveCount(0);
    await target.click();
    await expect(page.getByRole("heading", { level: 1, name: "Lectures" })).toBeVisible();
    await expect(page.getByText("02 · Cholinergic agents · Sep 2")).toBeVisible();
  });

  test("refuses an invalid drop: a lecture cannot go onto a course", async ({ page }, testInfo) => {
    test.skip(layoutOf(testInfo) !== "computer", "drag and drop is for the computer layout");
    await openLectures(page);
    const sidebar = page.getByTestId("sidebar");
    const course = sidebar.getByRole("treeitem", { name: "Pharmacotherapy I" });
    const row = page.getByTestId("node-row").filter({ hasText: "04 · Adrenergic antagonists" });
    await row.dragTo(course);
    await expect(page.getByText("04 · Adrenergic antagonists · Sep 16")).toBeVisible();
    await expect(page.getByTestId("node-row")).toHaveCount(9);
  });

  test("trashes with an undo, restores from the trash, and deletes forever only after confirming", async ({
    page,
  }, testInfo) => {
    const layout = layoutOf(testInfo);
    await openLectures(page);
    await rowMenu(page, "Diuretics", "Move to trash");
    await expect(page.getByText('Moved "Diuretics" to the trash')).toBeVisible();
    await expect(page.getByText("09 · Diuretics")).toHaveCount(0);
    await rowMenu(page, "ACE inhibitors and ARBs", "Move to trash");
    await expect(page.getByText('Moved "ACE inhibitors and ARBs" to the trash')).toBeVisible();

    await openTrash(page, layout);
    await expect(page.getByTestId("trash-row")).toHaveCount(2);
    await page.getByRole("button", { name: "Restore Diuretics" }).click();
    await expect(page.getByTestId("trash-row")).toHaveCount(1);

    await page.getByRole("button", { name: "Delete ACE inhibitors and ARBs forever" }).click();
    const confirm = page.getByRole("alertdialog");
    await expect(confirm).toContainText('"ACE inhibitors and ARBs"');
    await expect(confirm).toContainText("cannot be undone");
    await confirm.getByRole("button", { name: "Cancel" }).click();
    await expect(page.getByTestId("trash-row")).toHaveCount(1);
    await page.getByRole("button", { name: "Delete ACE inhibitors and ARBs forever" }).click();
    await page.getByRole("alertdialog").getByRole("button", { name: "Delete forever" }).click();
    await expect(page.getByText("The trash is empty")).toBeVisible();

    // the restored lecture is back where it was
    await page.getByRole("link", { name: "Library", exact: true }).click();
    await openLectures(page);
    await expect(page.getByText("09 · Diuretics · Oct 28")).toBeVisible();
    await expect(page.getByText("08 · ACE inhibitors")).toHaveCount(0);
  });

  test("right-click opens the item menu on the computer layout, F2 renames", async ({
    page,
  }, testInfo) => {
    test.skip(layoutOf(testInfo) !== "computer", "right-click is for the computer layout");
    await openLectures(page);
    const row = page.getByTestId("node-row").filter({ hasText: "05 · Calcium channel blockers" });
    await row.click({ button: "right" });
    const menu = page.getByRole("menu");
    await expect(menu.getByRole("menuitem", { name: "Move to…" })).toBeVisible();
    await expect(menu.getByRole("menuitem", { name: "Duplicate" })).toBeVisible();
    await page.keyboard.press("Escape");
    await row.getByRole("link").focus();
    await page.keyboard.press("F2");
    const input = page.getByRole("textbox", { name: "Rename Calcium channel blockers" });
    await input.fill("Calcium blockers");
    await input.press("Enter");
    await expect(page.getByText("05 · Calcium blockers · Sep 30")).toBeVisible();
  });

  test("duplicates a lecture next to the original", async ({ page }) => {
    await openLectures(page);
    await rowMenu(page, "Antiarrhythmics", "Duplicate");
    await expect(page.getByText("06 · Antiarrhythmics copy · Oct 7")).toBeVisible();
    await expect(page.getByTestId("node-row")).toHaveCount(10);
  });

  test("undo from the toast brings a trashed item straight back", async ({ page }) => {
    await openLectures(page);
    await rowMenu(page, "Diuretics", "Move to trash");
    await page.getByRole("button", { name: "Undo" }).click();
    await expect(page.getByText("09 · Diuretics · Oct 28")).toBeVisible();
  });

  test("favourites show on the library home", async ({ page }) => {
    await openLectures(page);
    await rowMenu(page, "Diuretics", "Add to favourites");
    await page.getByRole("link", { name: "Library", exact: true }).first().click();
    const favourites = page.getByRole("region", { name: "Favourites" });
    await expect(favourites.getByRole("link", { name: /Diuretics/ })).toBeVisible();
  });

  test("quick find searches names", async ({ page }, testInfo) => {
    const layout = layoutOf(testInfo);
    if (layout === "computer") await page.keyboard.press("Control+k");
    else if (layout === "tablet") await page.getByRole("button", { name: /Quick find/ }).click();
    else await page.getByTestId("tab-bar").getByRole("link", { name: "Search" }).click();
    await page.getByRole("searchbox", { name: "Search your library" }).fill("adrenergic");
    await expect(page.getByTestId("results-node").getByRole("link")).toHaveCount(2);
    await page.getByRole("link", { name: /Adrenergic antagonists/ }).click();
    await expect(
      page.getByRole("heading", { level: 1, name: "04 · Adrenergic antagonists · Sep 16" }),
    ).toBeVisible();
  });
});

test.describe("the whole library as one tree", () => {
  test.beforeEach(async ({ page }) => signIn(page));

  test("shows terms open, an Inbox count, then everything with Expand all and Collapse all", async ({
    page,
  }) => {
    const tree = allFiles(page);
    await expect(
      tree.getByRole("treeitem", { name: "Pharmacology II", exact: true }),
    ).toBeVisible();
    await expect(tree.getByTestId("tree-inbox")).toContainText("3");
    await expect(tree.getByRole("treeitem", { name: "Lectures", exact: true })).toHaveCount(0);

    await page.getByRole("button", { name: "Expand all" }).click();
    await expect(tree.getByRole("treeitem", { name: "07 · Beta blockers · Oct 14" })).toBeVisible();
    await expect(tree.getByRole("treeitem", { name: "Slide transcript" })).toBeVisible();
    const deck = tree.getByTestId("tree-file").filter({ hasText: "Lecture 07 slides.pptx" });
    await expect(deck).toContainText("34 pages");
    await expect(deck).toContainText("Filed");
    await expect(
      tree.getByTestId("tree-file").filter({ hasText: "handwritten notes.pdf" }).first(),
    ).toBeVisible();

    await page.getByRole("button", { name: "Collapse all" }).click();
    await expect(tree.getByRole("treeitem", { name: "Pharmacology II", exact: true })).toHaveCount(
      0,
    );
    await expect(tree.getByRole("treeitem", { name: "Fall 2026", exact: true })).toBeVisible();
  });

  test("opens a document and a file, and going back keeps the same rows open and the same scroll", async ({
    page,
  }) => {
    const tree = allFiles(page);
    await page.getByRole("button", { name: "Expand all" }).click();
    await expect(tree.getByRole("treeitem", { name: "Slide transcript" })).toBeVisible();
    const main = page.locator("#main");
    await tree.getByRole("treeitem", { name: "Slide transcript" }).scrollIntoViewIfNeeded();
    const before = await main.evaluate((el) => el.scrollTop);
    expect(before).toBeGreaterThan(100);
    await expect
      .poll(() => page.evaluate(() => Object.values(localStorage).join("")), {
        message: "scroll saved",
      })
      .toContain(`"scroll":${before}`);

    // a document
    await tree.getByRole("treeitem", { name: "Slide transcript" }).click();
    await expect(page.getByRole("heading", { level: 1, name: "Slide transcript" })).toBeVisible();
    await expect(page.getByText("This is a document")).toBeVisible();
    await page.goBack();
    await expect(tree.getByRole("treeitem", { name: "Slide transcript" })).toBeVisible();
    await expect.poll(() => main.evaluate((el) => el.scrollTop)).toBeGreaterThan(before - 8);
    expect(await main.evaluate((el) => el.scrollTop)).toBeLessThan(before + 8);

    // a source file
    await tree.getByTestId("tree-file").filter({ hasText: "Lecture 07 slides.pptx" }).click();
    await expect(
      page.getByRole("heading", { level: 1, name: "Lecture 07 slides.pptx" }),
    ).toBeVisible();
    await expect(page.getByRole("navigation", { name: "Pages" })).toBeVisible();
    await page.getByRole("button", { name: "Back" }).click();
    await expect(tree.getByRole("treeitem", { name: "Slide transcript" })).toBeVisible();
    await expect.poll(() => main.evaluate((el) => el.scrollTop)).toBeGreaterThan(before - 8);

    // and after a reload
    await page.reload();
    await expect(tree.getByRole("treeitem", { name: "Slide transcript" })).toBeVisible();
    await expect.poll(() => main.evaluate((el) => el.scrollTop)).toBeGreaterThan(before - 8);
  });

  test("the Inbox row opens the inbox", async ({ page }) => {
    await allFiles(page).getByTestId("tree-inbox").click();
    await expect(page.getByRole("heading", { level: 1, name: "Inbox" })).toBeVisible();
    await expect(page.getByRole("list", { name: "Unfiled files" }).getByRole("link")).toHaveCount(
      3,
    );
  });

  test("the sidebar and the page share what is open", async ({ page }, testInfo) => {
    test.skip(layoutOf(testInfo) === "phone", "the phone has no sidebar");
    await allFiles(page).getByRole("button", { name: "Expand Pharmacotherapy I" }).click();
    const sidebar = page.getByTestId("sidebar");
    await expect(sidebar.getByRole("treeitem", { name: "Study guides" })).toBeVisible();
  });
});

test.describe("settings", () => {
  test.beforeEach(async ({ page }) => signIn(page));

  test("creates an API key, shows the secret once, then revokes it", async ({ page }) => {
    await openSettings(page);
    await expect(page.getByTestId("key-row")).toHaveCount(2);
    await page.getByRole("button", { name: "New key" }).click();
    const dialog = page.getByRole("dialog", { name: "New API key" });
    await dialog.getByLabel("Name", { exact: true }).fill("Codex on the iPad");
    await dialog.getByLabel(/Read and write/).check();
    await dialog.getByRole("button", { name: "Create key" }).click();

    await expect(page.getByTestId("api-secret")).toHaveText(/^nh_write_[A-Za-z0-9_-]{43}$/);
    await expect(page.getByRole("alert")).toContainText("You will not see this again");
    await page.getByRole("button", { name: "I have saved it" }).click();
    await expect(page.getByRole("dialog")).toHaveCount(0);

    const row = page.getByTestId("key-row").filter({ hasText: "Codex on the iPad" });
    await expect(row).toContainText("Read and write");
    await expect(row).toContainText("Never used");
    await expect(page.getByTestId("api-secret")).toHaveCount(0);

    await row.getByRole("button", { name: "Revoke Codex on the iPad" }).click();
    const confirm = page.getByRole("alertdialog");
    await expect(confirm).toContainText('"Codex on the iPad"');
    await confirm.getByRole("button", { name: "Revoke key" }).click();
    await expect(row).toContainText("Revoked");
    await expect(row.getByRole("button", { name: /Revoke/ })).toHaveCount(0);
  });

  test("switches the theme and remembers it", async ({ page }) => {
    await openSettings(page);
    const html = page.locator("html");
    const background = () => page.evaluate(() => getComputedStyle(document.body).backgroundColor);
    await page.getByRole("radio", { name: "Light", exact: true }).click();
    await expect(html).toHaveAttribute("data-theme", "light");
    const light = await background();
    await page.getByRole("radio", { name: "Dark", exact: true }).click();
    await expect(html).toHaveAttribute("data-theme", "dark");
    expect(await background()).not.toBe(light);
    await page.reload();
    await expect(html).toHaveAttribute("data-theme", "dark");
    await page.getByRole("radio", { name: "System", exact: true }).click();
    await expect(html).not.toHaveAttribute("data-theme", /.+/);
  });

  test("changing the password needs the right current one", async ({ page }) => {
    await openSettings(page);
    await page.getByLabel("Current password").fill("wrong-password-1");
    await page.getByLabel("New password", { exact: true }).fill("a-better-password-9");
    await page.getByLabel("New password again").fill("a-better-password-9");
    await page.getByRole("button", { name: "Change password" }).click();
    await expect(page.getByRole("alert").filter({ hasText: "current password" })).toBeVisible();
  });
});
