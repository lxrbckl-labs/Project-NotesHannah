import { mkdirSync } from "node:fs";
import { expect, type Page, test } from "@playwright/test";
import {
  advance,
  answerCurrent,
  currentType,
  fillAnswer,
  goTo,
  keyOf,
  openDemo,
  startSession,
} from "./practice-helpers";

/**
 * Captures the main states into screenshots/practice/ at phone, tablet (portrait and landscape)
 * and computer sizes, in both themes. Run on demand: `pnpm exec playwright test practice-screenshots`.
 */
const OUT = "screenshots/practice";
test.skip(!process.env.PRACTICE_SHOTS, "set PRACTICE_SHOTS=1 to regenerate the screenshots");

const TYPES = [
  "multiple_choice",
  "select_all",
  "matching",
  "fill_blank",
  "calculation",
  "flashcard",
  "case",
  "free_response",
] as const;

async function shot(page: Page, label: string, theme: string, state: string, full = true) {
  mkdirSync(OUT, { recursive: true });
  await page.waitForTimeout(450);
  await page.screenshot({
    path: `${OUT}/${label}-${theme}-${state}.jpg`,
    type: "jpeg",
    quality: 80,
    fullPage: full,
  });
}

/** The player is a fixed full-screen layer, so grow the viewport until its whole content fits. */
async function shotPlayer(page: Page, label: string, theme: string, state: string) {
  const size = page.viewportSize() as { width: number; height: number };
  const need = await page.evaluate(() => {
    const main = document.querySelector('[data-testid="player-main"]') as HTMLElement | null;
    const header = document.querySelector(
      '[data-testid="player-shell"] header',
    ) as HTMLElement | null;
    const footer = document.querySelector(
      '[data-testid="player-shell"] footer',
    ) as HTMLElement | null;
    return (main?.scrollHeight ?? 0) + (header?.offsetHeight ?? 0) + (footer?.offsetHeight ?? 0);
  });
  if (need > size.height) {
    await page.setViewportSize({ width: size.width, height: Math.min(need + 4, 3000) });
    await shot(page, label, theme, state, false);
    await page.setViewportSize(size);
  } else {
    await shot(page, label, theme, state, false);
  }
}

async function leave(page: Page) {
  await page.getByTestId("leave").click();
  await page.getByRole("button", { name: "Leave", exact: true }).click();
  await expect(page.getByTestId("start")).toBeVisible();
}

const projects = ["phone", "tablet", "computer"];

for (const theme of ["light", "dark"] as const) {
  test(`screenshots in the ${theme} theme`, async ({ page }, info) => {
    test.setTimeout(600_000);
    const project = info.project.name;
    expect(projects).toContain(project);
    const sizes =
      project === "tablet"
        ? [
            {
              label: "tablet-portrait",
              size: page.viewportSize() as { width: number; height: number },
            },
            { label: "tablet-landscape", size: { width: 1194, height: 834 } },
          ]
        : [{ label: project, size: page.viewportSize() as { width: number; height: number } }];

    for (const { label, size } of sizes) {
      await page.setViewportSize(size);
      await openDemo(page, { theme, fixedNow: true });
      await shot(page, label, theme, "start");

      for (const t of TYPES) {
        await startSession(page, { scope: /Everything/, types: [t], length: 5 });
        await expect(page.getByTestId("player")).toBeVisible();
        const type = await currentType(page);
        expect(type).toBe(t);
        await shotPlayer(page, label, theme, `${t}-unanswered`);
        if (t === "flashcard") {
          await page.getByRole("button", { name: "Show answer" }).click();
          await shotPlayer(page, label, theme, "flashcard-flipped");
          await page.getByTestId("rate-good").click();
          await expect(page.getByTestId("feedback")).toBeVisible();
        } else if (t === "free_response") {
          await page
            .getByLabel("Your answer")
            .fill("It lowers the heart rate and the oxygen demand.");
          await page.getByRole("button", { name: "Show model answer" }).click();
          await shotPlayer(page, label, theme, "free_response-rubric");
          const boxes = page.getByTestId("rubric").getByRole("checkbox");
          await boxes.nth(0).check();
          await page.getByTestId("submit-self").click();
          await expect(page.getByTestId("feedback")).toBeVisible();
        } else {
          const key = await keyOf(page);
          if (t === "matching" || t === "case") {
            // a half-finished state first
            if (key.type === "matching") {
              await fillAnswer(
                page,
                page.getByTestId("player"),
                { ...key, correct: key.correct.slice(0, 1) },
                "right",
              );
              await shotPlayer(page, label, theme, "matching-paired");
            }
          }
          if (t === "calculation") {
            await answerCurrent(page, "slip");
          } else {
            await answerCurrent(page, "wrong");
          }
        }
        await shotPlayer(page, label, theme, `${t}-feedback`);
        await leave(page);
      }

      // results
      await startSession(page, {
        scope: /Lecture 7/,
        types: ["multiple_choice", "fill_blank", "calculation"],
        length: 5,
      });
      for (let i = 0; i < 5; i++) {
        await answerCurrent(page, i % 3 === 1 ? "wrong" : "right");
        if ((await advance(page)) === "results") break;
      }
      await expect(page.getByTestId("results")).toBeVisible();
      await shot(page, label, theme, "results");
      await page.getByTestId("review-0").getByRole("button").click();
      await shot(page, label, theme, "results-review");
      await page.getByTestId("done").click();

      await goTo(page, "notebook");
      await expect(page.getByTestId("notebook-row").first()).toBeVisible();
      await shot(page, label, theme, "notebook");
      await goTo(page, "weak");
      await expect(page.getByTestId("area-card").first()).toBeVisible();
      await shot(page, label, theme, "weak-areas");
      await page.getByRole("tab", { name: "Lectures" }).click();
      await shot(page, label, theme, "weak-areas-lectures");
      await goTo(page, "cards");
      await expect(page.getByTestId("due-chart")).toBeVisible();
      await shot(page, label, theme, "due-chart");
      await goTo(page, "exams");
      await expect(page.getByTestId("exam-card").first()).toBeVisible();
      await shot(page, label, theme, "exam-planner");
      await page.getByTestId("edit-exam").first().click();
      await expect(page.getByTestId("exam-save")).toBeVisible();
      await shot(page, label, theme, "exam-form", false);
    }
  });
}
