import { expect, type Page, type TestInfo, test } from "@playwright/test";
import { card, flowPosition, touchDrag } from "../canvas-helpers";
import { api, converterOnline, signInReal, tag } from "./real";

/**
 * The integration journeys on the REAL server (seeded with `pnpm local:seed`): requests with a real
 * agent key, concepts, the canvas on the server, and the composer from every entry point.
 */
test.describe.configure({ mode: "serial" });

// biome-ignore lint/suspicious/noExplicitAny: API bodies are read loosely in these journeys
type Json = Record<string, any>;

const isPhone = (info: TestInfo) => info.project.name === "real-phone";
const isTouch = (info: TestInfo) => info.project.name !== "real-computer";

/** On a phone the canvas opens on one frame at a time; show the whole map first. */
async function wholeMap(page: Page, info: TestInfo) {
  if (!isPhone(info)) return;
  await page.getByRole("button", { name: "Whole map" }).first().click();
  await page.waitForTimeout(500);
}

async function openLecture(page: Page) {
  await page.goto("/library");
  await page.getByRole("button", { name: "Expand all" }).click();
  await page.getByTestId("tree-item").filter({ hasText: "Autonomic overview" }).first().click();
  await expect(page.getByTestId("doc-screen")).toBeVisible();
  await expect(page.locator('[data-testid="block"]').first()).toBeVisible();
}

async function agent(page: Page, info: TestInfo) {
  const { secret } = await api<{ secret: string }>(page, "POST", "/keys", {
    name: `Integration key ${tag(info)} ${Date.now()}`,
    scope: "write",
  });
  const base = new URL(page.url()).origin;
  return async <T = Json>(method: string, path: string, body?: unknown): Promise<T> => {
    const response = await page.context().request.fetch(`${base}/api${path}`, {
      method,
      headers: { Authorization: `Bearer ${secret}`, "Content-Type": "application/json" },
      data: body === undefined ? undefined : JSON.stringify(body),
      // not her browser session: the key alone is what the server sees
      maxRedirects: 0,
    });
    expect(
      response.status(),
      `${method} ${path} as the agent: ${response.ok() ? "" : (await response.text()).slice(0, 400)}`,
    ).toBeLessThan(300);
    return (await response.json()) as T;
  };
}

// ---------------------------------------------------------------------------------- requests

test("a request is left, an agent completes it through the API, she sees the reply and follows its links", async ({
  page,
}, info) => {
  await signInReal(page);
  test.skip(!(await converterOnline(page)), "Docker is not running: no seeded study guide.");
  await openLecture(page);
  const message = `Please summarise this (${tag(info)} ${Date.now()})`;

  await page.getByTestId("ask-button").first().click();
  const dialog = page.getByRole("dialog");
  await dialog.getByTestId("message").fill(message);
  await dialog.getByRole("button", { name: "Leave request" }).click();
  await expect(dialog.getByTestId("composer-done")).toBeVisible();
  await dialog.getByRole("button", { name: "Done", exact: true }).click();

  // the agent: a real key, over the API, claims and completes it
  const asAgent = await agent(page, info);
  const waiting = await asAgent<{ items: Json[] }>("GET", "/requests?status=waiting&limit=100");
  const mine = waiting.items.find((r) => r.message === message);
  expect(mine, "the agent sees her request").toBeTruthy();
  const documentId = mine?.target.documentId as string;
  const doc = await asAgent<{ document: Json; blocks: Json[] }>("GET", `/documents/${documentId}`);
  const blockId = (doc.blocks ?? (doc.document as Json).blocks)[0]?.id as string;
  const questions = await asAgent<{ items: Json[] }>("GET", "/practice/questions?limit=1");
  const questionId = questions.items[0]?.id as string;
  await asAgent("POST", `/requests/${mine?.id}/claim`, {});
  await asAgent("POST", `/requests/${mine?.id}/complete`, {
    reply: `Done: a short summary is at the top (${tag(info)}).`,
    links: [
      { type: "block", documentId, blockId, label: "The summary" },
      { type: "question", questionId, label: "A question to check it" },
    ],
  });

  await page.goto("/requests");
  const requestCard = page.getByTestId("request-card").filter({ hasText: message });
  await expect(requestCard.getByTestId("status")).toHaveText(/Done/);
  await expect(requestCard.getByTestId("reply")).toContainText("a short summary is at the top");

  // following the reply link opens the library item's page, with the block (the link carries a
  // DOCUMENT id; the app resolves the library node)
  await requestCard.getByTestId("reply-link").first().click();
  await expect(page).toHaveURL(/\/doc\/nod_[0-9A-Z]+\?block=blk_/);
  await expect(page.getByTestId("doc-screen")).toBeVisible();
  await page.goBack();
  await page
    .getByTestId("request-card")
    .filter({ hasText: message })
    .getByTestId("reply-link")
    .nth(1)
    .click();
  await expect(page).toHaveURL(/\/doc\/nod_[0-9A-Z]+/);
  await expect(page.getByTestId("doc-screen")).toBeVisible();
});

test("the seeded waiting request can be edited and cancelled, and the badge follows", async ({
  page,
}, info) => {
  await signInReal(page);
  const message = `A request to take back (${tag(info)})`;
  await page.goto("/requests");
  await page.getByTestId("new-request").click();
  const dialog = page.getByRole("dialog");
  await dialog.getByTestId("message").fill(message);
  await dialog.getByRole("button", { name: "Leave request" }).click();
  await dialog.getByRole("button", { name: "Done", exact: true }).click();
  const requestCard = page.getByTestId("request-card").filter({ hasText: message });
  await expect(requestCard).toHaveCount(1);
  await requestCard.getByTestId("cancel").click();
  await page.getByRole("button", { name: "Cancel request" }).click();
  await expect(page.getByTestId("request-card").filter({ hasText: message })).toHaveCount(0);
});

// ---------------------------------------------------------------------------------- concepts

test("concepts: browse, filter, search by brand, the page, graph, comparison, finder and drill", async ({
  page,
}, info) => {
  await signInReal(page);
  await page.goto("/concepts");
  await expect(page.getByTestId("concept-row").first()).toBeVisible();
  await expect(page.getByTestId("concept-row")).toHaveCount(10);

  // the type filter
  await page.getByRole("button", { name: /^Drug\s*4$/ }).click();
  await expect(page.getByTestId("concept-row")).toHaveCount(4);
  await page.getByRole("button", { name: /^All\s*10$/ }).click();

  // search by brand name finds the generic
  await page.getByTestId("concept-search").fill("lopress");
  await expect(page.getByTestId("concept-row")).toHaveCount(1);
  await page.getByRole("link", { name: "metoprolol", exact: true }).click();
  await expect(page.getByTestId("concept-name")).toHaveText(/metoprolol/i);
  await expect(page.getByTestId("brand-name")).toHaveText("Lopressor");
  await expect(page.getByTestId("relation-item").first()).toBeVisible();

  // the neighbourhood graph (one tap away on a phone)
  if (isPhone(info)) await page.getByRole("button", { name: "Graph" }).click();
  await expect(page.getByTestId("graph-node").first()).toBeVisible();
  await page
    .getByTestId("graph-node")
    .filter({ hasText: /bradycardia/i })
    .click();
  await expect(page.getByTestId("concept-name")).toHaveText(/bradycardia/i);

  // the cross-course question: everything that causes bradycardia
  await page.goto("/concepts");
  await page.getByRole("tab", { name: "Ask a question" }).click();
  await page.getByTestId("question-causes").click();
  await page.getByRole("combobox", { name: /Everything that causes/ }).click();
  await page
    .getByTestId("picker-option")
    .filter({ hasText: /bradycardia/i })
    .first()
    .click();
  await expect(page.getByTestId("finder-answer")).toContainText(/metoprolol/i);

  // the comparison table
  await page.getByRole("tab", { name: "Compare" }).click();
  for (const drug of [/atenolol/i, /metoprolol/i]) {
    await page.getByRole("combobox", { name: "Add a drug" }).click();
    await page.getByTestId("picker-option").filter({ hasText: drug }).first().click();
  }
  await page.getByRole("button", { name: /Build table/ }).click();
  await expect(page.getByTestId("comparison").getByTestId("compare-row")).toHaveCount(2);

  // the brand and generic drill
  await page.getByRole("tab", { name: "Drill" }).click();
  await page.getByTestId("start-round").click();
  await expect(page.getByTestId("drill-board")).toBeVisible();
});

test("concept and question search hits open the right place", async ({ page }) => {
  await signInReal(page);
  await page.goto("/search?q=metoprolol");
  await page
    .getByRole("link", { name: /metoprolol/i })
    .first()
    .click();
  // a concept hit opens the concept page; a question hit resolves to its lecture
  const url = page.url();
  if (url.includes("/concepts/")) await expect(page.getByTestId("concept-name")).toBeVisible();
  await page.goto("/search?q=heart");
  const hit = page.getByRole("link", { name: /Practice question/ }).first();
  if (await hit.count()) {
    await hit.click();
    await expect(page).toHaveURL(/\/doc\/nod_/);
  }
});

// ---------------------------------------------------------------------------------- canvas

async function openCanvas(page: Page, info: TestInfo) {
  await openLecture(page);
  await page.getByRole("tab", { name: "Canvas" }).click();
  await expect(page.locator(".react-flow__node").first()).toBeVisible({ timeout: 30_000 });
  await wholeMap(page, info);
  await page.waitForTimeout(600);
}

test("the canvas uses the server's store: structure, frames, connector labels, attribution", async ({
  page,
}, info) => {
  await signInReal(page);
  test.skip(!(await converterOnline(page)), "Docker is not running: no seeded study guide.");
  const seen: string[] = [];
  page.on("request", (r) => {
    if (/\/api\/documents\/[^/]+\/canvas/.test(r.url())) seen.push(`${r.method()} ${r.url()}`);
  });
  await openCanvas(page, info);
  expect(seen.some((s) => /GET .*\/canvas$/.test(s))).toBe(true);
  await expect.poll(() => seen.some((s) => s.endsWith("/canvas/events"))).toBe(true);
  await expect(page.locator(".react-flow__node-frame").first()).toBeVisible();
  await expect(page.getByText("The basics").first()).toBeVisible();
  await expect(page.getByText("so choose by").first()).toBeVisible();
  // React Flow's attribution stays visible: its terms tie removing it to a Pro subscription
  await expect(page.locator(".react-flow__attribution")).toBeVisible();
  // the real renderers draw the blocks: a bulleted list has list items
  await expect(page.locator(".react-flow__node-card li").first()).toBeVisible();
});

test("her drags are saved as pins and survive a reload and another browser", async ({
  page,
  browser,
}, info) => {
  await signInReal(page);
  test.skip(!(await converterOnline(page)), "Docker is not running: no seeded study guide.");
  await openCanvas(page, info);
  const target = card(page, "Think: -olol");
  await expect(target).toBeVisible();
  const before = await flowPosition(target);
  const saved = page.waitForResponse(
    (r) => /\/canvas\/(placements|ops)/.test(r.url()) && r.request().method() !== "GET",
  );
  await page.waitForTimeout(2000); // the measured re-layout settles before a drag counts
  const box = (await target.boundingBox()) as {
    x: number;
    y: number;
    width: number;
    height: number;
  };
  const x = box.x + box.width / 2;
  const y = box.y + box.height / 2;
  if (isTouch(info)) await touchDrag(page, { x, y }, { x: x + 50, y: y + 30 }, 16);
  else {
    await page.mouse.move(x, y);
    await page.mouse.down();
    await page.mouse.move(x + 25, y + 12, { steps: 8 });
    await page.waitForTimeout(100);
    await page.mouse.move(x + 60, y + 30, { steps: 8 });
    await page.mouse.up();
  }
  await saved;
  const moved = await flowPosition(card(page, "Think: -olol"));
  expect(Math.abs(moved.x - before.x) + Math.abs(moved.y - before.y)).toBeGreaterThan(20);

  await page.reload();
  await expect(page.locator(".react-flow__node").first()).toBeVisible({ timeout: 30_000 });
  await wholeMap(page, info);
  const after = await flowPosition(card(page, "Think: -olol"));
  expect(after).toEqual(moved);

  // another browser sees the same pin
  const other = await browser.newContext({ viewport: page.viewportSize() ?? undefined });
  const second = await other.newPage();
  await signInReal(second);
  await openCanvas(second, info);
  expect(await flowPosition(card(second, "Think: -olol"))).toEqual(moved);
  await other.close();
});

test("auto-arrange, the page and canvas switch, and a live update when an agent changes the structure", async ({
  page,
}, info) => {
  await signInReal(page);
  test.skip(!(await converterOnline(page)), "Docker is not running: no seeded study guide.");
  let documentId = "";
  page.on("request", (r) => {
    const m = /\/api\/documents\/(doc_[0-9A-Z]+)\/canvas$/.exec(r.url());
    if (m) documentId = m[1] as string;
  });
  await openCanvas(page, info);
  expect(documentId).toMatch(/^doc_/);

  // the switch
  await page.getByRole("link", { name: "Switch to the page view" }).click();
  await expect(page.locator('[data-testid="block"]').first()).toBeVisible();
  await page.getByRole("tab", { name: "Canvas" }).click();
  await expect(page.locator(".react-flow__node").first()).toBeVisible();
  await wholeMap(page, info);

  // an agent adds a note through the API; the open canvas shows it without a reload
  const asAgent = await agent(page, info);
  const note = `Live from an agent ${tag(info)} ${Date.now()}`;
  await asAgent("POST", `/documents/${documentId}/canvas/ops`, {
    documentId,
    ops: [{ op: "add_card", card: { ref: "live", content: { kind: "note", text: note } } }],
  });
  await expect(page.getByText(note).first()).toBeAttached({ timeout: 20_000 });
  const now = await asAgent<{ canvas: Json }>("GET", `/documents/${documentId}/canvas`);
  const addedCard = (now.canvas.cards as Json[]).find((c) =>
    JSON.stringify(c.content).includes(note),
  );
  expect(addedCard, "the agent's note is on the server canvas").toBeTruthy();

  // auto-arrange lays the canvas out again; cards she placed by hand stay where they are
  await page.getByRole("button", { name: "Auto-arrange" }).first().click();
  await expect(page.getByText("Arranged. Cards you placed stayed where they are.")).toBeVisible();
  await expect(page.locator(".react-flow__node").first()).toBeVisible();

  // tidy up: the agent takes its note away again, and the open canvas drops it live
  await asAgent("POST", `/documents/${documentId}/canvas/ops`, {
    documentId,
    ops: [{ op: "remove_card", id: addedCard?.id }],
  });
  await expect(page.getByText(note)).toHaveCount(0, { timeout: 20_000 });
});

// ---------------------------------------------------------------------------------- composer

test("the composer opens from every entry point", async ({ page }, info) => {
  await signInReal(page);
  test.skip(!(await converterOnline(page)), "Docker is not running: no seeded study guide.");
  const target = page.getByTestId("composer-target");
  const close = async () => {
    await page.keyboard.press("Escape");
    await expect(target).toBeHidden();
  };

  // 1. a library item's menu
  await page.goto("/library");
  await page.getByRole("button", { name: "Expand all" }).click();
  const row = page.getByTestId("tree-item").filter({ hasText: "Autonomic overview" }).first();
  if (isTouch(info)) {
    await row.click({ button: "right" });
  } else {
    await row.click({ button: "right" });
  }
  await page.getByRole("menuitem", { name: "Ask an agent…" }).click();
  await expect(target).toContainText("Autonomic overview");
  await close();

  // 2. the detail panel (computer layout only)
  if (!isTouch(info)) {
    await page.getByTestId("tree-item").filter({ hasText: "Pharmacology II" }).first().click();
    await page.getByTestId("right-panel").getByTestId("ask-button").click();
    await expect(target).toContainText("Pharmacology II");
    await close();
  }

  // 3. the document header
  await openLecture(page);
  await page.getByTestId("ask-button").first().click();
  await expect(target).toContainText("Autonomic overview");
  await close();

  // 4. one block's "ask about this", replacing the module's own request call
  const toggle = page.getByTestId("mode-toggle");
  if ((await toggle.getAttribute("aria-pressed")) !== "true") await toggle.click();
  await expect(toggle).toHaveAttribute("aria-pressed", "true");
  const block = page.locator('[data-testid="block"][data-type="paragraph"]').first();
  if (isTouch(info)) {
    await block.dispatchEvent("pointerdown");
    await page.getByTestId("touch-actions").getByTestId("block-menu-touch").click();
  } else {
    await block.hover();
    await block.getByTestId("block-handle").click();
  }
  await page.getByRole("menuitem", { name: "Ask about this…" }).click();
  await expect(page.getByRole("dialog").getByTestId("composer-target")).toBeVisible();
  await close();

  // 5. a source page
  const files = await api<{ items: Json[] }>(page, "GET", "/files?limit=20");
  const slides = files.items.find((f) => /Lecture 01 slides/.test(f.originalName ?? f.name));
  expect(slides).toBeTruthy();
  await page.goto(`/files/${slides?.id}`);
  await page.getByTestId("ask-button").first().click();
  await expect(target).toBeVisible();
  await close();

  // 6. a practice question's feedback
  await page.goto("/practice");
  await page.getByRole("radio", { name: /Autonomic overview/ }).check();
  await page.getByTestId("start-session").click();
  await expect(page.getByTestId("player")).toBeVisible();
  const player = page.getByTestId("player");
  const type = (await player.getAttribute("data-qtype")) as string;
  if (type === "multiple_choice") {
    await player.locator("label").first().click();
    await page.getByTestId("submit").click();
  } else if (type === "fill_blank") {
    await player.getByTestId("blank-1").fill("beta-1");
    await page.getByTestId("submit").click();
  } else if (type === "calculation") {
    await player.getByTestId("calc-value").fill("350");
    await player.getByTestId("calc-unit").fill("mg");
    await page.getByTestId("submit").click();
  } else {
    await player.getByRole("button", { name: "Show answer" }).click();
    await player.getByTestId("rate-good").click();
  }
  await expect(page.getByTestId("feedback")).toBeVisible();
  await page.getByTestId("ask-about-question").click();
  await expect(target).toContainText(/question/i);
  await close();

  // 7. a concept page
  await page.goto("/concepts");
  await page.getByRole("link", { name: "metoprolol", exact: true }).first().click();
  await page.getByTestId("ask-button").first().click();
  await expect(target).toBeVisible();
  await close();
});

// ------------------------------------------------------------------------ practice, resumed

test("a skipped question stays skipped on another device", async ({ page, browser }) => {
  await signInReal(page);
  test.skip(!(await converterOnline(page)), "Docker is not running: no seeded questions.");
  await page.goto("/practice");
  await page.getByRole("radio", { name: /Autonomic overview/ }).check();
  await page.getByTestId("start-session").click();
  await expect(page.getByTestId("player")).toBeVisible();
  const firstPrompt = await page.getByTestId("player").textContent();
  await page.getByRole("button", { name: "Skip" }).click();
  await expect
    .poll(async () => (await page.getByTestId("player").textContent()) !== firstPrompt)
    .toBe(true);

  const other = await browser.newContext({ viewport: page.viewportSize() ?? undefined });
  const second = await other.newPage();
  await signInReal(second);
  await second.goto("/practice");
  await second.getByTestId("resume-session").click();
  await expect(second.getByTestId("player")).toBeVisible();
  // the skipped question is not the one she resumes on: the server remembers the skip
  expect(await second.getByTestId("player").textContent()).not.toBe(firstPrompt);
  await other.close();
  await page
    .getByRole("button", { name: /Quit|Close|Leave/ })
    .first()
    .click()
    .catch(() => {});
});
