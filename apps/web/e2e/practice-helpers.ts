import { expect, type Locator, type Page } from "@playwright/test";
import type { AnswerKey } from "../src/features/practice/store/key";

export const DEMO = "/practice-demo.html";

export type How = "right" | "wrong" | "slip" | "noUnit";

export interface Setup {
  /** ?empty=1 starts with no history. */
  empty?: boolean;
  theme?: "light" | "dark";
  fixedNow?: boolean;
  bar?: boolean;
}

export async function openDemo(page: Page, o: Setup = {}) {
  page.on("dialog", (d) => void d.accept());
  const q = new URLSearchParams({ fresh: "1", bar: o.bar ? "1" : "0" });
  if (o.empty) q.set("empty", "1");
  if (o.theme) q.set("theme", o.theme);
  if (o.fixedNow) q.set("now", "2026-11-15T10:00:00");
  await page.goto(`${DEMO}?${q}`);
  await expect(page.getByTestId("start")).toBeVisible();
}

/** A touch device has a coarse primary pointer; a computer has a fine one (and can drag). */
export async function isTouch(page: Page): Promise<boolean> {
  return page.evaluate(() => window.matchMedia("(pointer: coarse)").matches);
}

/** Click or tap, whichever the device does. */
export async function press(page: Page, target: Locator) {
  if (await isTouch(page)) await target.tap();
  else await target.click();
}

export async function keyOf(page: Page): Promise<AnswerKey> {
  return page.evaluate(() => window.__practice.key() as AnswerKey);
}

export async function chooseScope(page: Page, name: RegExp | string) {
  await page.getByRole("radio", { name }).check();
}

/** Start a session from the start screen. `length` picks a chip when given. */
export async function startSession(
  page: Page,
  o: { scope?: RegExp | string; types?: string[]; length?: number } = {},
) {
  if (o.scope) await chooseScope(page, o.scope);
  if (o.types) {
    for (const t of [
      "multiple_choice",
      "select_all",
      "matching",
      "fill_blank",
      "calculation",
      "flashcard",
      "case",
      "free_response",
    ]) {
      const chip = page.getByTestId(`format-${t}`);
      if (
        (await chip.isEnabled()) &&
        ((await chip.getAttribute("aria-pressed")) === "true") !== o.types.includes(t)
      ) {
        await chip.click();
      }
    }
  }
  if (o.length) {
    // chips only exist for lengths below what is available
    const chip = page.getByRole("button", { name: String(o.length), exact: true });
    if ((await chip.count()) > 0) await chip.click();
  }
  await page.getByTestId("start-session").click();
  await expect(page.getByTestId("player")).toBeVisible();
}

export async function currentType(page: Page): Promise<string> {
  return (await page.getByTestId("player").getAttribute("data-qtype")) as string;
}

/** Fill in the answering UI for a key. Does not submit (self-graded types do submit themselves). */
export async function fillAnswer(
  page: Page,
  root: Locator,
  key: AnswerKey,
  how: How,
  part = false,
) {
  const touch = await isTouch(page);
  switch (key.type) {
    case "multiple_choice": {
      const text = how === "right" ? key.correct : key.wrong;
      await root
        .locator("label")
        .filter({ has: page.getByText(text, { exact: true }) })
        .click();
      break;
    }
    case "select_all": {
      const texts = how === "right" ? key.correct : key.wrong;
      for (const t of texts) {
        await root
          .locator("label")
          .filter({ has: page.getByText(t, { exact: true }) })
          .click();
      }
      break;
    }
    case "matching": {
      const pairs = how === "right" ? key.correct : key.wrong;
      const lefts = root.getByRole("list", { name: "Items to match" });
      const rights = root.getByRole("list", { name: "Matches to choose from" });
      let first = true;
      for (const p of pairs) {
        const left = lefts.getByRole("listitem").filter({ hasText: p.left });
        const right = rights.getByRole("button", { name: p.right });
        if (!touch && first) {
          // drag on a computer
          await right.dragTo(left);
        } else {
          await press(page, left.getByRole("button").first());
          await press(page, right);
        }
        first = false;
        await expect(left).toContainText(`→ ${p.right}`);
      }
      break;
    }
    case "fill_blank": {
      const values = how === "right" ? key.correct : key.wrong;
      for (const [i, v] of values.entries()) {
        await root.getByTestId(`blank-${i + 1}`).fill(v);
      }
      break;
    }
    case "calculation": {
      const v =
        how === "right"
          ? key.correct
          : how === "slip"
            ? key.slip
            : how === "noUnit"
              ? key.noUnit
              : key.wrong;
      await root.getByTestId("calc-value").fill(v.value);
      if (v.unit) await root.getByTestId("calc-unit").fill(v.unit);
      break;
    }
    case "flashcard": {
      await root.getByRole("button", { name: "Show answer" }).click();
      await root.getByTestId(how === "right" ? "rate-good" : "rate-again").click();
      break;
    }
    case "free_response": {
      await root.getByLabel("Your answer").fill("In my own words");
      await root.getByRole("button", { name: "Show model answer" }).click();
      const boxes = root.getByTestId("rubric").getByRole("checkbox");
      if (how === "right") for (let i = 0; i < key.covered.length; i++) await boxes.nth(i).check();
      if (!part) await root.getByTestId("submit-self").click();
      break;
    }
    case "case": {
      for (const [i, k] of key.parts.entries()) {
        await fillAnswer(page, root, k, how, true);
        if (i < key.parts.length - 1) await root.getByTestId("next-part").click();
      }
      break;
    }
  }
}

/** Answer the question on screen, check, and leave the feedback showing. */
export async function answerCurrent(page: Page, how: How): Promise<AnswerKey> {
  const key = await keyOf(page);
  const root = page.getByTestId("player");
  await fillAnswer(page, root, key, how);
  if (key.type !== "flashcard" && key.type !== "free_response") {
    await page.getByTestId("submit").click();
  }
  await expect(page.getByTestId("feedback")).toBeVisible();
  return key;
}

export async function next(page: Page) {
  await page.getByTestId("next").click();
}

/** Click Next, then wait for either the next question or the results. */
export async function advance(page: Page): Promise<"player" | "results"> {
  await next(page);
  await expect(page.getByTestId("player").or(page.getByTestId("results"))).toBeVisible();
  return (await page.getByTestId("results").isVisible()) ? "results" : "player";
}

export async function goTo(page: Page, view: "start" | "cards" | "notebook" | "weak" | "exams") {
  await page.getByTestId(`nav-${view}`).click();
}
