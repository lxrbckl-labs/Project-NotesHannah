import { expect, type Locator, type Page, test } from "@playwright/test";

/**
 * The documents feature against the demo page and its in-memory store, in the
 * phone, tablet and computer projects.
 */

const DEMO = "/documents-demo.html?latency=40";

const isComputer = (name: string) => name === "computer";

async function open(page: Page, query = "") {
  await page.goto(`${DEMO}${query}`);
  await expect(page.getByRole("heading", { name: "Beta blockers", level: 1 })).toBeVisible();
}

/** Switch to editing (touch devices start in reading mode). */
async function edit(page: Page) {
  const toggle = page.getByTestId("mode-toggle");
  if ((await toggle.getAttribute("aria-pressed")) !== "true") await toggle.click();
  await expect(toggle).toHaveAttribute("aria-pressed", "true");
}

function block(page: Page, type: string, nth = 0): Locator {
  return page.locator(`[data-testid="block"][data-type="${type}"]`).nth(nth);
}

/** Caret to the end of the focused editor. */
async function toEnd(page: Page) {
  await page.keyboard.press(process.platform === "darwin" ? "Meta+ArrowDown" : "Control+End");
}

async function saved(page: Page) {
  await expect(page.getByTestId("save-status")).toHaveAttribute("data-status", "saved");
}

/** The stored document, read back from the demo's mock store. */
async function stored(page: Page) {
  return page.evaluate(async () => {
    const store = window.__docStore;
    if (!store) throw new Error("no store");
    return store.loadDocument(store.documentIds[0] as string);
  });
}

/** Select a block for editing without opening an editor (touch action bar shows). */
async function selectBlock(target: Locator) {
  await target.dispatchEvent("pointerdown");
}

test("reads the guide: every kind of block is there", async ({ page }) => {
  await open(page);
  for (const type of [
    "heading",
    "paragraph",
    "bulleted_list",
    "numbered_list",
    "checklist",
    "callout",
    "drug_card",
    "comparison_table",
    "table",
    "mnemonic",
    "labelled_image",
    "mind_map",
    "quote",
    "divider",
    "image",
    "question",
  ]) {
    await expect(block(page, type)).toBeAttached();
  }
  await expect(page.getByTestId("drug-card")).toHaveAttribute(
    "aria-label",
    "Drug card: metoprolol",
  );
  await expect(page.getByTestId("drug-dosingNotes")).toContainText("25–50 mg");
  await expect(page.getByText("Not from your notes").first()).toBeVisible();
  await expect(page.getByTestId("references")).toBeAttached();
  const count = Number(await page.getByTestId("unverified-number").textContent());
  expect(count).toBeGreaterThan(5);
  // The comparison table scrolls sideways on a phone, with the drug column pinned.
  const scroll = page.getByTestId("comparison-scroll");
  const overflow = await scroll.evaluate((el) => el.scrollWidth > el.clientWidth);
  if (test.info().project.name === "phone") expect(overflow).toBe(true);
});

test("opens a citation and highlights the quote", async ({ page }) => {
  await open(page);
  const chip = block(page, "paragraph").getByTestId("cite-chip").first();
  await chip.click();
  const panel = page.getByTestId("citation-panel");
  await expect(panel).toBeVisible();
  await expect(panel.getByTestId("quote-highlight")).toHaveText(
    "β1 receptors are found mainly in the heart, where stimulation increases heart rate and contractility.",
  );
  await expect(panel.getByTestId("quote-highlight")).toBeInViewport();
  await expect(panel.getByTestId("citation-region")).toBeAttached();
  await expect(panel.getByTestId("source-file")).toHaveText("Lecture 07 – Beta blockers.pptx");
  await panel.getByRole("button", { name: "Next source" }).click();
  await expect(panel).toContainText("Source 3 of");
});

test("shows a clear state for a trashed source", async ({ page }) => {
  await open(page);
  await page
    .getByRole("button", { name: /Textbook p212/ })
    .first()
    .click();
  await expect(page.getByTestId("source-unavailable")).toContainText("trash");
});

test("edits a paragraph with formatting", async ({ page }, info) => {
  await open(page);
  await edit(page);
  const para = block(page, "paragraph");
  await para.getByTestId("field-main").click({ position: { x: 20, y: 10 } });
  const editor = para.getByTestId("editor-main");
  await expect(editor).toBeFocused();
  await toEnd(page);
  await page.keyboard.type(" Remember this");
  // Typing is committed after a short pause.
  await page.waitForTimeout(700);
  await saved(page);
  // Select the new words (as a drag or double-tap would).
  await editor.evaluate((el) => {
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      const at = node.textContent?.indexOf("Remember this") ?? -1;
      if (at >= 0) {
        const range = document.createRange();
        range.setStart(node, at);
        range.setEnd(node, at + "Remember this".length);
        const selection = window.getSelection();
        selection?.removeAllRanges();
        selection?.addRange(range);
        return;
      }
    }
  });
  if (isComputer(info.project.name)) {
    // The selection bubble and the ribbon both show; the shortcut works too.
    await expect(page.getByTestId("format-toolbar")).toBeVisible();
    await expect(page.getByTestId("format-ribbon")).toHaveAttribute("data-live", "true");
    await page.keyboard.press("ControlOrMeta+b");
  } else if (info.project.name === "tablet") {
    // A tablet gets the ribbon at the top, as on a computer.
    await page
      .getByTestId("format-ribbon")
      .getByRole("button", { name: "Bold", exact: true })
      .click();
  } else {
    await page
      .getByTestId("format-toolbar")
      .getByRole("button", { name: "Bold", exact: true })
      .click();
  }
  await expect(editor.locator("strong", { hasText: "Remember this" })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(editor).not.toBeFocused();
  await saved(page);
  const doc = await stored(page);
  const saved_ = doc.blocks.find(
    (b) => b.id === doc.blocks.find((x) => x.type === "paragraph")?.id,
  );
  expect(JSON.stringify(saved_?.content)).toContain('{"text":"Remember this","bold":true}');
  expect(saved_?.origin).toBe("user");
});

test("inserts a callout with the slash menu", async ({ page }, info) => {
  await open(page);
  await edit(page);
  const before = await page.locator('[data-testid="block"][data-type="callout"]').count();
  const para = block(page, "paragraph");
  await para.getByTestId("field-main").click();
  await expect(para.getByTestId("editor-main")).toBeFocused();
  await toEnd(page);
  await page.keyboard.press("Enter");
  // The new paragraph takes the caret.
  await expect(
    page.locator('[data-testid="editor-main"][aria-label="Paragraph"]:focus'),
  ).toHaveText("");
  await page.keyboard.type("/call");
  const menu = page.getByTestId("insert-menu");
  await expect(menu).toBeVisible();
  if (isComputer(info.project.name)) await page.keyboard.press("Enter");
  else await menu.getByTestId("insert-callout").click();
  await expect(page.locator('[data-testid="block"][data-type="callout"]')).toHaveCount(before + 1);
  await saved(page);
  const doc = await stored(page);
  expect(doc.blocks.filter((b) => b.type === "callout")).toHaveLength(before + 1);
});

test("turns a paragraph into a heading from the block style menu", async ({ page }) => {
  await open(page);
  await edit(page);
  const para = block(page, "paragraph");
  const id = await para.getAttribute("data-block-id");
  await para.getByTestId("field-main").click({ position: { x: 20, y: 10 } });
  await expect(para.getByTestId("editor-main")).toBeFocused();
  // The ribbon on tablet and computer, the dock above the keyboard on a phone.
  const style = page.getByTestId("block-style");
  await expect(style).toHaveAccessibleName("Block style: Text");
  await style.click();
  await page.getByTestId("style-heading3").click();
  const heading = page.locator(`[data-block-id="${id}"]`);
  await expect(heading).toHaveAttribute("data-type", "heading");
  // The caret is back in the text, now a heading.
  await expect(heading.getByTestId("editor-main")).toBeFocused();
  await expect(style).toHaveAccessibleName("Block style: Heading 3");
  await saved(page);
  const doc = await stored(page);
  expect(doc.blocks.find((b) => b.id === id)?.content).toMatchObject({ level: 3 });
});

test("a wide table scrolls sideways inside its box", async ({ page }) => {
  await open(page);
  await edit(page);
  const table = block(page, "table");
  await table.getByTestId("field-cell-1-0").click();
  for (let i = 0; i < 4; i++) await table.getByTestId("add-column").click();
  const box = table.getByTestId("table-scroll");
  const sizes = await box.evaluate((el) => ({
    scroll: el.scrollWidth,
    client: el.clientWidth,
    block: (el.closest("[data-block-id]") as HTMLElement).getBoundingClientRect().width,
    box: el.getBoundingClientRect().width,
  }));
  // Wider than its box, which stays inside the block instead of being cut off.
  expect(sizes.scroll).toBeGreaterThan(sizes.client);
  expect(sizes.box).toBeLessThanOrEqual(sizes.block + 0.5);
  await box.evaluate((el) => el.scrollTo({ left: el.scrollWidth }));
  await expect.poll(() => box.evaluate((el) => el.scrollLeft)).toBeGreaterThan(0);
});

test("edits a drug card field", async ({ page }) => {
  await open(page);
  await edit(page);
  const card = page.getByTestId("drug-card");
  await card.getByTestId("field-dosingNotes.0").click();
  await expect(card.getByTestId("editor-dosingNotes.0")).toBeFocused();
  await toEnd(page);
  await page.keyboard.type(", max 200 mg BID");
  await page.keyboard.press("Escape");
  await expect(card.getByTestId("editor-dosingNotes.0")).not.toBeFocused();
  await saved(page);
  const doc = await stored(page);
  const saved_ = doc.blocks.find((b) => b.type === "drug_card") as unknown as {
    content: { dosingNotes: Array<{ text: Array<{ text: string }>; citations: unknown[] }> };
    origin: string;
  };
  expect(saved_.content.dosingNotes[0]?.text.map((t) => t.text).join("")).toContain(
    "max 200 mg BID",
  );
  expect(saved_.content.dosingNotes[0]?.citations.length).toBe(1);
  expect(saved_.origin).toBe("user");
});

test("adds a table row", async ({ page }) => {
  await open(page);
  await edit(page);
  const table = block(page, "table");
  const rows = await table.getByTestId("table-row").count();
  await table.getByTestId("field-cell-1-0").click();
  await page.keyboard.press("Escape");
  await table.getByTestId("add-row").click();
  await expect(table.getByTestId("table-row")).toHaveCount(rows + 1);
  await saved(page);
  const doc = await stored(page);
  const saved_ = doc.blocks.find((b) => b.type === "table") as unknown as {
    content: { rows: unknown[] };
  };
  expect(saved_.content.rows).toHaveLength(rows + 1);
});

test("reorders blocks (drag on a computer, move down on touch)", async ({ page }, info) => {
  await open(page);
  await edit(page);
  const initial = (await stored(page)).blockIds;
  const first = page.locator('[data-testid="block"]').first();
  const firstId = await first.getAttribute("data-block-id");
  if (isComputer(info.project.name)) {
    const target = page.locator('[data-testid="block"]').nth(3);
    await first.hover();
    const handle = first.getByTestId("block-handle");
    const from = await handle.boundingBox();
    const to = await target.boundingBox();
    if (!from || !to) throw new Error("no boxes");
    await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
    await page.mouse.down();
    await page.mouse.move(from.x + 5, from.y + 30, { steps: 4 });
    await page.mouse.move(to.x + 20, to.y + to.height * 0.75, { steps: 8 });
    await expect(page.getByTestId("drop-indicator")).toBeVisible();
    await page.mouse.up();
  } else {
    await selectBlock(first);
    await page.getByTestId("touch-actions").getByRole("button", { name: "Move down" }).click();
  }
  await saved(page);
  const after = (await stored(page)).blockIds;
  expect(after).not.toEqual(initial);
  expect(after[0]).not.toBe(firstId);
  expect(after).toContain(firstId);
});

test("marks a block reviewed and the count drops", async ({ page }) => {
  await open(page);
  const count = Number(await page.getByTestId("unverified-number").textContent());
  await page.getByTestId("mark-reviewed").first().click();
  await expect(page.getByTestId("unverified-number")).toHaveText(String(count - 1));
  await saved(page);
  await page.getByTestId("unverified-count").click();
  await page.getByTestId("mark-all-reviewed").click();
  await expect(page.getByTestId("all-reviewed")).toBeVisible();
  await expect(page.getByTestId("unverified-count")).toHaveCount(0);
});

test("uses the outline to jump to a section", async ({ page }, info) => {
  await open(page);
  if (!isComputer(info.project.name)) await page.getByTestId("outline-button").click();
  const outline = page.getByTestId("outline");
  await outline.getByRole("button", { name: /Cautions/ }).click();
  const heading = page.getByRole("heading", { name: "Cautions" });
  await expect(heading).toBeInViewport();
  if (isComputer(info.project.name))
    await expect(outline.getByRole("button", { name: /Cautions/ })).toHaveAttribute(
      "aria-current",
      "location",
    );
});

test("restores an earlier revision", async ({ page }, info) => {
  await open(page);
  await page.getByTestId("history-button").click();
  const history = page.getByTestId("history");
  await expect(history.getByTestId("revision-list")).toBeVisible();
  await history.getByRole("button", { name: /Revision 1/ }).click();
  await expect(history.getByTestId("revision-preview")).toContainText("Beta blockers");
  await history.getByTestId("restore-revision").click();
  await page.getByRole("alertdialog").getByRole("button", { name: "Restore" }).click();
  await expect(page.getByText("Restored revision 1.")).toBeVisible();
  await expect(page.getByTestId("drug-card")).toHaveCount(0);
  const doc = await stored(page);
  expect(doc.revision).toBe(5);
  expect(info.project.name).toBeTruthy();
});

test("raises a request on a block", async ({ page }, info) => {
  await open(page);
  await edit(page);
  const card = page.getByTestId("drug-card").locator("xpath=ancestor::*[@data-testid='block']");
  if (isComputer(info.project.name)) {
    await card.hover();
    await card.getByTestId("block-handle").click();
  } else {
    await selectBlock(card);
    await page.getByTestId("touch-actions").getByTestId("block-menu-touch").click();
  }
  await page.getByRole("menuitem", { name: "Ask about this…" }).click();
  const dialog = page.getByTestId("request-dialog");
  await expect(dialog).toBeVisible();
  await dialog.getByRole("radio", { name: "This is wrong" }).check();
  await dialog.getByRole("textbox").fill("The succinate dose is not on the slide");
  await dialog.getByTestId("send-request").click();
  await expect(page.getByText(/Request sent/)).toBeVisible();
  const requests = await page.evaluate(() => window.__docStore?.requests);
  expect(requests).toHaveLength(1);
  expect(requests?.[0]).toMatchObject({
    kind: "wrong",
    note: "The succinate dose is not on the slide",
  });
});

test("rolls back a failed edit and offers retry", async ({ page }) => {
  await open(page, "&fail=1");
  await edit(page);
  const count = Number(await page.getByTestId("unverified-number").textContent());
  await page.getByTestId("mark-reviewed").first().click();
  await expect(page.getByTestId("save-status")).toHaveAttribute("data-status", "failed");
  await expect(page.getByTestId("unverified-number")).toHaveText(String(count));
  await expect(page.getByRole("button", { name: "Retry" })).toBeVisible();
});
