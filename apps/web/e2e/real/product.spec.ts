import { expect, type Page, test } from "@playwright/test";
import { converterOnline, signInReal } from "./real";

/**
 * The integrated product on the real server, with the seeded library (`pnpm local:seed`): a lecture
 * with an agent's cited study guide, four practice questions and an exam. Journeys run in order.
 */
test.describe.configure({ mode: "serial" });

const isPhone = (info: { project: { name: string } }) => info.project.name === "real-phone";
const block = (page: Page, type: string, nth = 0) =>
  page.locator(`[data-testid="block"][data-type="${type}"]`).nth(nth);

async function openLecture(page: Page) {
  await page.getByRole("button", { name: "Expand all" }).click();
  await page.getByTestId("tree-item").filter({ hasText: "Autonomic overview" }).first().click();
  await expect(page.getByTestId("doc-screen")).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Autonomic overview", level: 1 }).first(),
  ).toBeVisible();
}

async function edit(page: Page) {
  const toggle = page.getByTestId("mode-toggle");
  if ((await toggle.getAttribute("aria-pressed")) !== "true") await toggle.click();
  await expect(toggle).toHaveAttribute("aria-pressed", "true");
}

test("she opens the lecture and reads the agent's guide, with its trust signals", async ({
  page,
}) => {
  await signInReal(page);
  test.skip(
    !(await converterOnline(page)),
    "Docker is not running: the seed could not convert the slides, so there is no study guide.",
  );
  await openLecture(page);
  await expect(block(page, "paragraph")).toContainText("Beta blockers reduce heart rate");
  await expect(page.getByTestId("unverified-number")).toBeVisible();
  // the page and canvas switch lives in the header
  await expect(page.getByRole("tab", { name: "Page" })).toHaveAttribute("aria-selected", "true");
});

test("a citation opens the real page with the quote highlighted", async ({ page }) => {
  await signInReal(page);
  test.skip(!(await converterOnline(page)), "Docker is not running: no converted pages.");
  await openLecture(page);
  await block(page, "paragraph").getByTestId("cite-chip").first().click();
  const panel = page.getByTestId("citation-panel");
  await expect(panel).toBeVisible();
  await expect(panel.getByTestId("quote-highlight")).toContainText(
    "Beta blockers reduce heart rate",
  );
  await expect(panel.getByTestId("source-file")).toContainText("Lecture 01 slides.pptx");
  // the real page image, served by the real server, has loaded
  const image = panel.locator("img").first();
  await expect
    .poll(() => image.evaluate((el: HTMLImageElement) => el.naturalWidth))
    .toBeGreaterThan(100);
});

test("she edits a block and the server keeps it", async ({ page }, info) => {
  await signInReal(page);
  test.skip(!(await converterOnline(page)), "Docker is not running: no study guide.");
  await openLecture(page);
  await edit(page);
  const para = block(page, "paragraph");
  await para.getByTestId("field-main").click({ position: { x: 20, y: 10 } });
  await expect(para.getByTestId("editor-main")).toBeFocused();
  await page.keyboard.press(process.platform === "darwin" ? "Meta+ArrowDown" : "Control+End");
  const added = ` Remember: start low (${info.project.name}).`;
  await page.keyboard.type(added);
  await page.waitForTimeout(800);
  await expect(page.getByTestId("save-status")).toHaveAttribute("data-status", "saved");
  await page.reload();
  await expect(block(page, "paragraph")).toContainText(`start low (${info.project.name})`);
});

test("she marks a block reviewed, and it is hers on the server", async ({ page }) => {
  await signInReal(page);
  test.skip(!(await converterOnline(page)), "Docker is not running: no study guide.");
  await openLecture(page);
  const before = Number(await page.getByTestId("unverified-number").textContent());
  await page.getByTestId("mark-reviewed").first().click();
  await expect(page.getByTestId("unverified-number")).toHaveText(String(before - 1), {
    timeout: 15_000,
  });
  await page.reload();
  await expect(page.getByTestId("unverified-number")).toHaveText(String(before - 1));
});

test("the canvas shows the same document, and switching back keeps it", async ({ page }) => {
  await signInReal(page);
  test.skip(!(await converterOnline(page)), "Docker is not running: no study guide.");
  await openLecture(page);
  await page.getByRole("tab", { name: "Canvas" }).click();
  await expect(page.getByTestId("canvas-screen")).toBeVisible();
  await expect(page.locator(".react-flow")).toBeVisible();
  await expect(page.locator(".react-flow__node").first()).toBeVisible({ timeout: 30_000 });
  await page.getByRole("link", { name: "Switch to the page view" }).click();
  await expect(page.getByTestId("doc-screen")).toHaveAttribute("data-mode", "page");
  await expect(block(page, "paragraph")).toContainText("Beta blockers reduce heart rate");
});

test("practice: start from the lecture, answer a calculation wrong by 1000 and see why, finish, see the notebook", async ({
  page,
}) => {
  test.setTimeout(240_000);
  await signInReal(page);
  test.skip(!(await converterOnline(page)), "Docker is not running: no questions were seeded.");
  await openLecture(page);
  await page.getByRole("button", { name: "Practise this" }).click();
  await expect(page.getByTestId("player")).toBeVisible({ timeout: 30_000 });

  let sawSlip = false;
  for (let i = 0; i < 6; i++) {
    const player = page.getByTestId("player");
    const type = (await player.getAttribute("data-qtype")) as string;
    if (type === "multiple_choice") {
      await player.locator("label").first().click();
      await page.getByTestId("submit").click();
    } else if (type === "calculation") {
      await player.getByTestId("calc-value").fill("350000"); // 350 mg written in micrograms' place: 1000 times too large
      await player.getByTestId("calc-unit").fill("mg");
      await page.getByTestId("submit").click();
    } else if (type === "fill_blank") {
      await player.getByTestId("blank-1").fill("beta-1");
      await page.getByTestId("submit").click();
    } else if (type === "flashcard") {
      await player.getByRole("button", { name: "Show answer" }).click();
      await player.getByTestId("rate-good").click();
    } else {
      throw new Error(`unexpected question type ${type}`);
    }
    await expect(page.getByTestId("feedback")).toBeVisible();
    if (type === "calculation") {
      await expect(page.getByTestId("calc-feedback")).toContainText(/1000 times too large/);
      sawSlip = true;
    }
    await page.getByTestId("next").click();
    // the next question has replaced this one (its feedback is gone), or the results are up
    await expect(page.getByTestId("feedback")).toBeHidden();
    await expect(page.getByTestId("player").or(page.getByTestId("results"))).toBeVisible();
    if (await page.getByTestId("results").isVisible()) break;
  }
  expect(sawSlip).toBe(true);
  await expect(page.getByTestId("results")).toBeVisible();
  await page.getByTestId("done").click();
  await page.getByTestId("nav-notebook").click();
  await expect(page.getByTestId("notebook-row").first()).toBeVisible();
  // a citation in feedback or results opens the same source viewer
});

test("the exam planner lists the exam and the picker chooses lectures", async ({ page }) => {
  await signInReal(page);
  test.skip(!(await converterOnline(page)), "Docker is not running: no exam was seeded.");
  await page.goto("/exams");
  await expect(page.getByTestId("exam-planner")).toBeVisible();
  await expect(page.getByTestId("exam-card").filter({ hasText: "Exam 1" })).toBeVisible();
  await page.getByTestId("add-exam").click();
  await page.getByTestId("exam-title").fill("Midterm");
  await page.getByTestId("exam-date").fill("2027-03-01");
  await page.getByTestId("exam-choose").click();
  const picker = page.getByRole("dialog").last();
  await picker.getByRole("button", { name: /Autonomic overview/ }).click();
  await picker.getByRole("button", { name: "Use these" }).click();
  await page.getByTestId("exam-save").click();
  await expect(page.getByTestId("exam-card").filter({ hasText: "Midterm" })).toBeVisible();
  // the library home shows the upcoming exams
  await page.getByRole("link", { name: "Library", exact: true }).first().click();
  await expect(page.getByTestId("upcoming-exams")).toBeVisible();
  void isPhone;
});
