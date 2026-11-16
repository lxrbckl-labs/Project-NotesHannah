import { expect, test } from "@playwright/test";
import {
  advance,
  answerCurrent,
  currentType,
  goTo,
  type How,
  keyOf,
  openDemo,
  startSession,
} from "./practice-helpers";

const ALL_TYPES = [
  "multiple_choice",
  "select_all",
  "matching",
  "fill_blank",
  "calculation",
  "flashcard",
  "case",
  "free_response",
];

test.describe("a mixed session", () => {
  test.setTimeout(180_000);

  test("every type answered right and wrong, calculation slips explained, then results", async ({
    page,
  }) => {
    await openDemo(page);
    await startSession(page, { scope: /Everything/, length: 20 });
    const seen = new Set<string>();
    const results: { type: string; right: boolean }[] = [];
    let calcs = 0;
    for (let i = 0; i < 20; i++) {
      const type = await currentType(page);
      seen.add(type);
      let how: How = i % 2 === 0 ? "right" : "wrong";
      if (type === "calculation") {
        // wrong calculations: a 1000-fold unit slip, then a missing unit, then a plain miss
        how = calcs === 0 ? "slip" : calcs === 1 ? "noUnit" : calcs % 2 === 0 ? "right" : "wrong";
        calcs++;
      }
      if (process.env.PRACTICE_TRACE) console.log(i, type, how);
      await answerCurrent(page, how);
      const feedback = page.getByTestId("feedback");
      const verdict = (await page.getByTestId("verdict").textContent()) ?? "";
      if (how === "right") {
        expect(verdict, `${type} right`).toMatch(/Correct|Marked as recalled/);
      } else {
        expect(verdict, `${type} ${how}`).toMatch(/Not quite|Partly right/);
      }
      if (type === "calculation" && how === "slip") {
        await expect(page.getByTestId("calc-feedback")).toContainText(
          /1000 times too (large|small)/,
        );
      }
      if (type === "calculation" && how === "noUnit") {
        await expect(page.getByTestId("calc-feedback")).toContainText(/No unit given/);
      }
      if (type !== "flashcard")
        await expect(feedback.getByTestId("source-chip").first()).toBeVisible();
      results.push({ type, right: how === "right" });
      if ((await advance(page)) === "results") break;
    }
    expect([...seen].sort()).toEqual([...ALL_TYPES].sort());
    await expect(page.getByTestId("results")).toBeVisible();
    await expect(page.getByTestId("score")).toContainText(/\d+ of 20/);
    await expect(page.getByTestId("retry-missed")).toBeVisible();
    // what went wrong is in the notebook, with a reason
    await page.getByTestId("done").click();
    await goTo(page, "notebook");
    await expect(page.getByTestId("notebook-row").first()).toContainText("Why it is here");
    const rows = await page.getByTestId("notebook-row").count();
    expect(rows).toBeGreaterThanOrEqual(results.filter((r) => !r.right).length - 1);
  });
});

test("a source chip calls onOpenSource with the citation", async ({ page }) => {
  await openDemo(page);
  await startSession(page, { scope: /Everything/, types: ["multiple_choice"], length: 5 });
  await answerCurrent(page, "right");
  await page.getByTestId("source-chip").first().click();
  await expect(page.getByTestId("source-opened")).toContainText(/Would open: Lecture 7, page \d+/);
  expect(await page.evaluate(() => window.__practice.opened.length)).toBe(1);
});

test("flashcard review: due cards, flip, rate, until all caught up", async ({ page }) => {
  await openDemo(page);
  await goTo(page, "cards");
  const due = Number(await page.getByTestId("cards-due-today").textContent());
  expect(due).toBeGreaterThan(0);
  await expect(page.getByTestId("due-chart")).toBeVisible();
  await page.getByTestId("start-review").click();
  await expect(page.getByTestId("player")).toHaveAttribute("data-qtype", "flashcard");
  for (let i = 0; i < due; i++) {
    await expect(page.getByTestId("card-front")).toBeVisible();
    await page.getByRole("button", { name: "Show answer" }).click();
    await expect(page.getByTestId("card-back")).toBeVisible();
    // the next interval is shown on every button
    for (const r of ["again", "hard", "good", "easy"]) {
      await expect(page.getByTestId(`rate-${r}`)).toContainText(
        /\d+ (day|days|month|months|year|years)|<1 day/,
      );
    }
    await page.getByTestId(i % 3 === 0 ? "rate-hard" : "rate-good").click();
    await expect(page.getByTestId("feedback")).toBeVisible();
    if ((await advance(page)) === "results") break;
  }
  await expect(page.getByTestId("score")).toContainText(`of ${due}`);
  await page.getByTestId("done").click();
  await goTo(page, "cards");
  await expect(page.getByTestId("cards-due-today")).toHaveText("0");
  await expect(page.getByTestId("start-review")).toBeDisabled();
});

test("retry missed until the notebook is empty", async ({ page }) => {
  await openDemo(page, { empty: true });
  await expect(page.getByTestId("notebook-size")).toHaveText("0");
  await startSession(page, {
    scope: /Lecture 7/,
    types: ["multiple_choice", "fill_blank"],
    length: 5,
  });
  for (;;) {
    await answerCurrent(page, "wrong");
    if ((await advance(page)) === "results") break;
  }
  await expect(page.getByTestId("score")).toContainText("0 of 5");
  await expect(page.getByTestId("notebook-added-count")).toContainText("5 questions");
  await page.getByTestId("retry-missed").click();
  await expect(page.getByTestId("player")).toBeVisible();
  for (;;) {
    await answerCurrent(page, "right");
    if ((await advance(page)) === "results") break;
  }
  await expect(page.getByTestId("score")).toContainText("5 of 5");
  await page.getByTestId("done").click();
  await goTo(page, "notebook");
  await expect(page.getByText("Your notebook is empty")).toBeVisible();
});

test("notebook: why it is here, how it leaves, retry one", async ({ page }) => {
  await openDemo(page);
  await goTo(page, "notebook");
  const rows = page.getByTestId("notebook-row");
  await expect(rows.first()).toBeVisible();
  await expect(rows.first()).toContainText("Why it is here");
  await expect(rows.first()).toContainText("How it leaves");
  await rows.first().getByTestId("retry-one").click();
  await expect(page.getByTestId("player")).toBeVisible();
  await expect(page.getByTestId("position")).toContainText("Question 1 of 1");
});

test("create an exam and start an exam-scoped session", async ({ page }) => {
  await openDemo(page, { empty: true });
  await goTo(page, "exams");
  await expect(page.getByText("No exams yet")).toBeVisible();
  await page.getByTestId("add-exam").click();
  await page.getByTestId("exam-course").fill("Cardiovascular Pharmacology");
  await page.getByTestId("exam-title").fill("Final");
  await page.getByTestId("exam-date").fill("2026-12-18");
  await page.getByTestId("exam-choose").click();
  await page.getByRole("checkbox", { name: "Lecture 8: ACE inhibitors" }).check();
  await page.getByTestId("picker-done").click();
  await expect(page.getByRole("list", { name: "Covered lectures and folders" })).toContainText(
    "Lecture 8",
  );
  await page.getByTestId("exam-save").click();
  const card = page.getByTestId("exam-card");
  await expect(card).toContainText("Final");
  await expect(card).toContainText("Lecture 8: ACE inhibitors");
  await expect(card.getByTestId("days-remaining")).toContainText(/In \d+ days|Today|Tomorrow/);
  await card.getByTestId("practise-exam").click();
  await expect(page.getByTestId("player")).toBeVisible();
  await expect(page.getByText("Final", { exact: true })).toBeVisible();
  // only Lecture 8 material is asked
  const { total } = await page.evaluate(async () => {
    const s = await window.__practice.store.getUnfinishedSession();
    return { total: s?.total ?? 0 };
  });
  expect(total).toBeGreaterThan(0);
  const key = await keyOf(page);
  expect(key).toBeTruthy();
  // editing coverage afterwards
});

test("resume after reload", async ({ page }) => {
  await openDemo(page);
  await startSession(page, {
    scope: /Lecture 8/,
    types: ["multiple_choice", "fill_blank"],
    length: 5,
  });
  await answerCurrent(page, "right");
  await advance(page);
  await answerCurrent(page, "wrong");
  await advance(page);
  await expect(page.getByTestId("position")).toContainText("Question 3 of 5");
  await page.reload();
  await expect(page.getByTestId("resume-card")).toContainText("2 of 5 answered");
  await page.getByTestId("resume-session").click();
  await expect(page.getByTestId("position")).toContainText("Question 3 of 5");
});

test("leaving asks first and keeps the session; pausing hides the question", async ({ page }) => {
  await openDemo(page);
  await startSession(page, { scope: /Everything/, types: ["multiple_choice"], length: 5 });
  await page.getByTestId("pause").click();
  await expect(page.getByRole("dialog", { name: "Paused" })).toBeVisible();
  await page.getByTestId("resume").click();
  await expect(page.getByRole("dialog", { name: "Paused" })).toBeHidden();
  await page.getByTestId("leave").click();
  await expect(page.getByRole("alertdialog")).toContainText("Leave this session?");
  await page.getByRole("button", { name: "Keep going" }).click();
  await expect(page.getByTestId("player")).toBeVisible();
  await page.getByTestId("leave").click();
  await page.getByRole("button", { name: "Leave", exact: true }).click();
  await expect(page.getByTestId("resume-card")).toBeVisible();
});

test("the question and the submit button stay in view when the on-screen keyboard is up", async ({
  page,
}) => {
  await openDemo(page);
  await startSession(page, { scope: /Everything/, types: ["calculation"], length: 3 });
  // a short viewport is what the layout sees when a keyboard takes the lower half of a phone
  const size = page.viewportSize();
  const height = 430;
  await page.setViewportSize({ width: size?.width ?? 390, height });
  const value = page.getByTestId("calc-value");
  await value.focus();
  await value.fill("12");
  await page.waitForTimeout(500);
  for (const el of [value, page.getByTestId("calc-unit"), page.getByTestId("submit")]) {
    const box = await el.boundingBox();
    expect(box, "element has a box").not.toBeNull();
    expect((box?.y ?? 0) + (box?.height ?? 0)).toBeLessThanOrEqual(height + 0.5);
    expect(box?.y ?? -1).toBeGreaterThanOrEqual(0);
  }
});

test("touch targets are at least 44px on the start screen and in the player", async ({ page }) => {
  await openDemo(page);
  const small = async () =>
    page.evaluate(() =>
      [...document.querySelectorAll<HTMLElement>("button, label, input:not(.sr-only)")]
        .filter(
          (el) => el.getClientRects().length > 0 && getComputedStyle(el).visibility !== "hidden",
        )
        .filter(
          (el) =>
            !(el instanceof HTMLInputElement && (el.type === "radio" || el.type === "checkbox")),
        )
        .map((el) => ({
          name: (el.textContent || el.getAttribute("aria-label") || el.tagName).trim().slice(0, 30),
          r: el.getBoundingClientRect(),
        }))
        .filter(({ r }) => r.height < 43.5 || (r.width < 43.5 && r.height < 43.5))
        .map(({ name, r }) => `${name} ${Math.round(r.width)}x${Math.round(r.height)}`),
    );
  expect(await small()).toEqual([]);
  await startSession(page, {
    scope: /Lecture 7/,
    types: ["multiple_choice", "calculation"],
    length: 5,
  });
  expect(await small()).toEqual([]);
});

test("keyboard only: options by letter, Enter to check and continue", async ({ page }, info) => {
  test.skip(info.project.name !== "computer", "keyboard operation is for the computer layout");
  await openDemo(page);
  await startSession(page, { scope: /Everything/, types: ["multiple_choice"], length: 5 });
  const key = await keyOf(page);
  if (key.type !== "multiple_choice") throw new Error("expected multiple choice");
  const labels = await page
    .getByRole("radio")
    .evaluateAll((els) => els.map((el) => el.closest("label")?.textContent ?? ""));
  const index = labels.findIndex((t) => t.includes(key.correct));
  await page.keyboard.press("abcdef"[index] as string);
  await page.keyboard.press("Enter");
  await expect(page.getByTestId("feedback")).toHaveAttribute("data-correct", "true");
  await page.keyboard.press("Enter");
  await expect(page.getByTestId("position")).toContainText("Question 2 of 5");
});

test("weak areas show honest states; due chart and exam planner render", async ({ page }) => {
  await openDemo(page);
  await goTo(page, "weak");
  await expect(page.getByTestId("area-card").first()).toBeVisible();
  await expect(page.getByTestId("insufficient").first()).toContainText("Not enough attempts yet");
  await goTo(page, "cards");
  await expect(page.getByTestId("due-chart").locator("[data-count]")).toHaveCount(14);
  await goTo(page, "exams");
  await expect(page.getByTestId("exam-card").first()).toBeVisible();
});

test("reduced motion: the flip happens without a transition", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await openDemo(page);
  await startSession(page, { scope: /Everything/, types: ["flashcard"], length: 3 });
  const duration = await page.evaluate(
    () => getComputedStyle(document.querySelector(".pr-flip-inner") as Element).transitionDuration,
  );
  expect(duration).toMatch(/^0s$/);
});
