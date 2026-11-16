import { expect, type Locator, type Page, test } from "@playwright/test";

/**
 * Sidebars and side notes (features P1 to P8) on the documents demo page and its in-memory store,
 * in the phone, tablet (an iPad held upright) and computer projects.
 */

const DEMO = "/documents-demo.html?latency=30";

const project = () => test.info().project.name;
const isPhone = () => project() === "phone";
const isComputer = () => project() === "computer";

async function open(page: Page, query = "") {
  await page.goto(`${DEMO}${query}`);
  await expect(page.getByRole("heading", { name: "Beta blockers", level: 1 })).toBeVisible();
}

async function edit(page: Page) {
  const toggle = page.getByTestId("mode-toggle");
  if ((await toggle.getAttribute("aria-pressed")) !== "true") await toggle.click();
  await expect(toggle).toHaveAttribute("aria-pressed", "true");
}

const scroller = (page: Page) => page.getByTestId("doc-scroller");
const notesPanel = (page: Page) => page.getByTestId("notes-panel");
const note = (page: Page, text: string) => page.getByTestId("side-note").filter({ hasText: text });

/** Bring the side notes on screen: the sidebar (or its overlay), or the phone's sheet. */
async function showNotes(page: Page) {
  if (await notesPanel(page).isVisible()) return;
  if (isPhone()) {
    await page.getByTestId("outline-button").click();
    await page.getByTestId("sheet-tab-notes").click();
  } else {
    await page.getByTestId("notes-button").click();
  }
  await expect(notesPanel(page)).toBeVisible();
}

async function addNote(page: Page, text: string) {
  await showNotes(page);
  await page.getByTestId("notes-add").first().click();
  await page.getByRole("textbox", { name: "New side note" }).fill(text);
  await page.getByTestId("note-save").click();
  await expect(note(page, text)).toBeVisible();
}

async function scrollBy(page: Page, dy: number) {
  await scroller(page).evaluate((el, d) => {
    el.scrollTop += d;
  }, dy);
  await page.waitForTimeout(250);
}

/** How far a note's card sits from the top of its block, in pixels. */
async function offsetFromBlock(page: Page, text: string): Promise<number> {
  // Cards glide to their place; measure once they are there.
  await page.waitForTimeout(350);
  return note(page, text).evaluate((card) => {
    const block = document.querySelector(
      `[data-block-id="${(card as HTMLElement).dataset.anchor}"]`,
    );
    if (!block) throw new Error("no block");
    return card.getBoundingClientRect().top - block.getBoundingClientRect().top;
  });
}

/** Bring a note's block to the middle of the page, where its card has room to sit level. */
async function centre(page: Page, text: string) {
  const anchor = await note(page, text).getAttribute("data-anchor");
  await page
    .locator(`[data-block-id="${anchor}"]`)
    .evaluate((el) => el.scrollIntoView({ block: "center" }));
  await page.waitForTimeout(250);
}

async function noSidewaysScroll(page: Page) {
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow).toBeLessThanOrEqual(0);
}

test("adds, changes, resolves and deletes a side note", async ({ page }) => {
  await open(page, "&sidenotes=0");
  await addNote(page, "Ask in OH about ISA");
  const card = note(page, "Ask in OH about ISA");
  // The block it is on shows a marker with the count.
  const anchor = await card.getAttribute("data-anchor");
  await expect(page.locator(`[data-block-id="${anchor}"] [data-testid="note-marker"]`)).toHaveText(
    "1",
  );
  // It is the note she is looking at: change it.
  await expect(card).toHaveAttribute("data-focused", "true");
  await card.getByTestId("note-edit").click();
  await page
    .getByRole("textbox", { name: "Change the side note" })
    .fill("Ask in OH about ISA\nand MSA");
  await card.getByRole("button", { name: "Save" }).click();
  await expect(note(page, "and MSA")).toBeVisible();
  // Done: it stays while she looks at it, then tucks away under "Done".
  await note(page, "and MSA").getByTestId("note-resolve").click();
  await expect(note(page, "and MSA")).toHaveAttribute("data-resolved", "true");
  await page.keyboard.press("Escape");
  // (On the phone, Escape also puts the sheet away.)
  await showNotes(page);
  await expect(note(page, "and MSA")).toHaveCount(0);
  await page.getByTestId("notes-show-resolved").click();
  await expect(note(page, "and MSA")).toBeVisible();
  // Delete, then undo.
  await note(page, "and MSA").click();
  await note(page, "and MSA").getByTestId("note-delete").click();
  await expect(note(page, "and MSA")).toHaveCount(0);
  await page
    .locator("div", { hasText: /^Side note deleted\./ })
    .getByRole("button", { name: "Undo" })
    .last()
    .click();
  await showNotes(page);
  await expect(note(page, "and MSA")).toBeVisible();
  // The document itself was never changed by any of it.
  const revision = await page.evaluate(async () => {
    const store = window.__docStore;
    if (!store) throw new Error("no store");
    return (await store.loadDocument(store.documentIds[0] as string)).revision;
  });
  expect(revision).toBe(
    await page.evaluate(async () => {
      const store = window.__docStore;
      if (!store) throw new Error("no store");
      const list = await store.listRevisions(store.documentIds[0] as string);
      return list[0]?.number;
    }),
  );
});

test("keeps a note level with its block while scrolling and as text above it grows", async ({
  page,
}) => {
  test.skip(isPhone(), "the phone lists notes in a sheet");
  await open(page);
  await showNotes(page);
  await scrollBy(page, 900);
  await addNote(page, "Level check");
  await centre(page, "Level check");
  expect(Math.abs(await offsetFromBlock(page, "Level check"))).toBeLessThanOrEqual(2);
  await scrollBy(page, 120);
  expect(Math.abs(await offsetFromBlock(page, "Level check"))).toBeLessThanOrEqual(2);
  await scrollBy(page, -200);
  expect(Math.abs(await offsetFromBlock(page, "Level check"))).toBeLessThanOrEqual(2);
  // Text above it grows: the note moves down with its block.
  const anchor = (await note(page, "Level check").getAttribute("data-anchor")) as string;
  const before = await note(page, "Level check").evaluate((el) => el.getBoundingClientRect().top);
  await page.evaluate((id) => {
    const blocks = [
      ...document.querySelectorAll<HTMLElement>('[data-testid="blocks"] > [data-block-id]'),
    ];
    const at = blocks.findIndex((b) => b.dataset.blockId === id);
    const above = blocks[at - 1];
    const grow = document.createElement("div");
    grow.style.height = "140px";
    above?.querySelector(".doc-block-body")?.appendChild(grow);
  }, anchor);
  await page.waitForTimeout(300);
  const after = await note(page, "Level check").evaluate((el) => el.getBoundingClientRect().top);
  expect(after - before).toBeGreaterThan(100);
  expect(Math.abs(await offsetFromBlock(page, "Level check"))).toBeLessThanOrEqual(2);
});

test("stacks several notes on one block without overlap, the focused one level", async ({
  page,
}) => {
  test.skip(isPhone(), "the phone lists notes in a sheet");
  await open(page);
  await scrollBy(page, 600);
  for (const text of ["First of three", "Second of three", "Third of three"]) {
    await addNote(page, text);
  }
  await centre(page, "Third of three");
  await page.waitForTimeout(400);
  const rects = await page
    .getByTestId("side-note")
    .filter({ hasText: "of three" })
    .evaluateAll((cards) =>
      cards.map((c) => c.getBoundingClientRect()).map((r) => [r.top, r.bottom]),
    );
  rects.sort((a, b) => (a[0] as number) - (b[0] as number));
  // (measured after the cards have finished moving)
  for (let i = 1; i < rects.length; i++) {
    expect(rects[i]?.[0] as number).toBeGreaterThanOrEqual((rects[i - 1]?.[1] as number) - 0.5);
  }
  // The newest is focused: it sits exactly level; the others make room.
  expect(Math.abs(await offsetFromBlock(page, "Third of three"))).toBeLessThanOrEqual(2);
  await note(page, "First of three").click();
  await page.waitForTimeout(250);
  expect(Math.abs(await offsetFromBlock(page, "First of three"))).toBeLessThanOrEqual(2);
});

test("a note whose block is deleted is detached, then attached again", async ({ page }) => {
  test.skip(!isComputer(), "deleting from the block menu is the computer's hover gutter");
  await open(page);
  await edit(page);
  const target = page.locator('[data-testid="block"][data-type="quote"]').first();
  await target.scrollIntoViewIfNeeded();
  await target.hover();
  await target.getByTestId("block-handle").click();
  await page.getByRole("menuitem", { name: "Add a side note" }).click();
  await page.getByRole("textbox", { name: "New side note" }).fill("On the quote");
  await page.getByTestId("note-save").click();
  await expect(note(page, "On the quote")).toBeVisible();
  await target.hover();
  await target.getByTestId("block-handle").click();
  await page.getByRole("menuitem", { name: "Delete" }).click();
  // Gone from beside the page; waiting under Detached with what it was on.
  await expect(notesPanel(page).getByTestId("notes-detached-toggle")).toHaveText(/Detached \(1\)/);
  await notesPanel(page).getByTestId("notes-detached-toggle").click();
  const detached = page.getByTestId("notes-detached").getByTestId("side-note");
  await expect(detached).toHaveAttribute("data-detached", "true");
  await expect(detached).toContainText("Was on:");
  await detached.click();
  await detached.getByTestId("note-reattach").click();
  await expect(note(page, "On the quote")).not.toHaveAttribute("data-detached", "true");
  await expect(notesPanel(page).getByTestId("notes-detached-toggle")).toHaveCount(0);
});

test("the Resources panel follows the reading position and jumps to a block", async ({ page }) => {
  await open(page);
  if (isPhone()) {
    await page.getByTestId("outline-button").click();
    await page.getByTestId("sheet-tab-resources").click();
  } else if (!(await page.getByTestId("resources").isVisible())) {
    await page.getByTestId("panels-button").click();
    await page.getByTestId("panels-toggle-resources").click();
    await page.keyboard.press("Escape");
  }
  const resources = page.getByTestId("resources");
  await expect(resources).toBeVisible();
  if (isPhone()) await page.keyboard.press("Escape");
  // Scroll the page to the Cautions section: its group becomes the current one.
  // Twice: blocks are sized by estimate until drawn, so the first jump can land short.
  for (let i = 0; i < 2; i++) {
    await page
      .getByRole("heading", { name: "Cautions" })
      .evaluate((el) => el.scrollIntoView({ block: "start" }));
    await page.waitForTimeout(300);
  }
  if (isPhone()) {
    await page.getByTestId("outline-button").click();
    await page.getByTestId("sheet-tab-resources").click();
  }
  const current = resources.locator('[data-group][aria-current="location"]');
  await expect(current).toContainText("Cautions");
  await expect(
    resources.locator('[data-testid="resource"][data-here="true"]').first(),
  ).toBeVisible();
  // Jump back to the first entry of the first section: its block comes into view and flashes.
  await resources.locator("[data-group]").first().click();
  const entry = resources.getByTestId("resource").first();
  const blockId = (await entry.getAttribute("data-block")) as string;
  await entry.locator("button").first().click();
  const target = page.locator(`[data-block-id="${blockId}"]`);
  await expect(target).toBeInViewport();
  await expect(target).toHaveClass(/doc-flash/);
});

/** A drag from one point to another with pointer events of a given kind (mouse or touch). */
async function drag(
  page: Page,
  from: Locator,
  to: { x: number; y: number },
  kind: "mouse" | "touch",
) {
  const box = await from.boundingBox();
  if (!box) throw new Error("not visible");
  const start = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
  if (kind === "mouse") {
    await page.mouse.move(start.x, start.y);
    await page.mouse.down();
    for (let i = 1; i <= 8; i++)
      await page.mouse.move(
        start.x + ((to.x - start.x) * i) / 8,
        start.y + ((to.y - start.y) * i) / 8,
      );
    await page.mouse.up();
    return;
  }
  await from.dispatchEvent("pointerdown", {
    pointerType: "touch",
    isPrimary: true,
    button: 0,
    clientX: start.x,
    clientY: start.y,
  });
  await page.evaluate(
    async ({ start, to }) => {
      const at = (x: number, y: number, type: string) =>
        window.dispatchEvent(
          new PointerEvent(type, {
            pointerType: "touch",
            isPrimary: true,
            clientX: x,
            clientY: y,
            bubbles: true,
            cancelable: true,
          }),
        );
      for (let i = 1; i <= 8; i++) {
        at(
          start.x + ((to.x - start.x) * i) / 8,
          start.y + ((to.y - start.y) * i) / 8,
          "pointermove",
        );
        await new Promise((r) => requestAnimationFrame(r));
      }
      at(to.x, to.y, "pointerup");
    },
    { start, to },
  );
}

test("drags a panel to the other sidebar with mouse and with touch", async ({ page }) => {
  test.skip(isPhone(), "the phone has no sidebars");
  await open(page);
  await showNotes(page);
  const width = page.viewportSize()?.width ?? 1000;
  // Notes start on the right; drag them to the left.
  await drag(
    page,
    page.getByTestId("panel-grip-notes"),
    { x: 40, y: 300 },
    isComputer() ? "mouse" : "touch",
  );
  await expect(page.getByTestId("sidebar-left").getByTestId("panel-notes")).toBeVisible();
  // And back to the right with the other kind of pointer.
  await drag(
    page,
    page.getByTestId("panel-grip-notes"),
    { x: width - 40, y: 300 },
    isComputer() ? "touch" : "mouse",
  );
  await expect(page.getByTestId("sidebar-right").getByTestId("panel-notes")).toBeVisible();
  await noSidewaysScroll(page);
});

test("moves, closes and reopens panels from the keyboard and menus, and remembers it", async ({
  page,
}) => {
  test.skip(isPhone(), "the phone has no sidebars");
  await open(page);
  await showNotes(page);
  // Keyboard: the grip opens its menu.
  await page.getByTestId("panel-grip-notes").focus();
  await page.keyboard.press("Enter");
  await page.getByTestId("panel-move-left").click();
  await expect(page.getByTestId("sidebar-left").getByTestId("panel-notes")).toBeVisible();
  // Close it, and bring it back from the Panels button.
  await page.getByTestId("panel-grip-notes").click();
  await page.getByTestId("panel-close-notes").click();
  await expect(page.getByTestId("panel-notes")).toHaveCount(0);
  await page.getByTestId("panels-button").click();
  await page.getByTestId("panels-toggle-notes").click();
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("panel-notes")).toBeVisible();
  // It came back to its home, the right sidebar; move it left again and reload: remembered.
  await page.getByTestId("panel-grip-notes").click();
  await page.getByTestId("panel-move-left").click();
  await expect(page.getByTestId("sidebar-left").getByTestId("panel-notes")).toBeVisible();
  await page.reload();
  await expect(page.getByRole("heading", { name: "Beta blockers", level: 1 })).toBeVisible();
  if (isComputer())
    await expect(page.getByTestId("sidebar-left").getByTestId("panel-notes")).toBeVisible();
  else {
    await page.getByTestId("notes-button").click();
    await expect(page.getByTestId("sidebar-left").getByTestId("panel-notes")).toBeVisible();
  }
});

test("on a phone the panels open as a bottom sheet with tabs; a marker opens it at the note", async ({
  page,
}) => {
  test.skip(!isPhone(), "phone only");
  await open(page);
  await page.getByTestId("outline-button").click();
  const sheet = page.getByTestId("panels-sheet");
  await expect(sheet).toBeVisible();
  await expect(sheet.getByTestId("outline")).toBeVisible();
  await sheet.getByTestId("sheet-tab-resources").click();
  await expect(sheet.getByTestId("resources")).toBeVisible();
  await sheet.getByTestId("sheet-tab-notes").click();
  await expect(sheet.getByTestId("notes-panel")).toHaveAttribute("data-mode", "list");
  await page.keyboard.press("Escape");
  await expect(sheet).toHaveCount(0);
  // A marker on a block opens the sheet at its note.
  const marker = page.getByTestId("note-marker").first();
  await marker.click();
  await expect(page.getByTestId("panels-sheet")).toBeVisible();
  await expect(page.locator('[data-testid="side-note"][data-focused="true"]')).toBeVisible();
  await noSidewaysScroll(page);
});

test("never scrolls sideways at common widths", async ({ browser }) => {
  test.skip(!isComputer(), "one run is enough; it makes its own windows");
  for (const [w, h] of [
    [375, 812],
    [390, 844],
    [834, 1194],
    [1024, 768],
    [1440, 900],
  ] as const) {
    // Phones and iPads are touch screens; the wider ones are computers here.
    const context = await browser.newContext({
      viewport: { width: w, height: h },
      hasTouch: w < 1024,
    });
    const page = await context.newPage();
    await open(page);
    await noSidewaysScroll(page);
    await edit(page);
    await noSidewaysScroll(page);
    if (w >= 768) {
      await showNotes(page);
      await noSidewaysScroll(page);
    }
    await context.close();
  }
});
