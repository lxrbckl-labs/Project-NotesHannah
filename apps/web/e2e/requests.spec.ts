import { expect, test } from "@playwright/test";
import { expectNoSideScroll, openDemo, opened, smallTargets } from "./requests-helpers";

/** The Requests demo (/requests-demo.html) at phone, tablet (both ways) and computer sizes. */

test.describe("her requests", () => {
  test("lists them newest first with plain words and no sideways scroll", async ({ page }) => {
    await openDemo(page);
    const cards = page.getByTestId("request-card");
    await expect(cards).toHaveCount(11);
    await expect(cards.first().getByTestId("status")).toHaveText("Waiting for an agent");
    await expect(page.getByText("An agent is working on it").first()).toBeVisible();
    await expect(page.getByText(/next time one runs/).first()).toBeVisible();
    await expectNoSideScroll(page);
  });

  test("filters by status", async ({ page }) => {
    await openDemo(page);
    await page.getByTestId("filter-declined").click();
    const cards = page.getByTestId("request-card");
    await expect(cards).toHaveCount(1);
    await expect(cards.first()).toHaveAttribute("data-status", "declined");
    await expect(cards.first().getByTestId("reply")).toContainText("would have to guess");
    await page.getByTestId("filter-cancelled").click();
    await expect(cards).toHaveCount(1);
    await page.getByTestId("filter-all").click();
    await expect(cards).toHaveCount(11);
  });

  test("leaves a request with a quick action, from the new request button", async ({ page }) => {
    await openDemo(page);
    await page.getByTestId("new-request").click();
    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();
    await expect(dialog.getByRole("button", { name: "Leave request" })).toBeDisabled();
    await dialog.getByTestId("kind-summarise").click();
    await dialog.getByRole("button", { name: "Leave request" }).click();
    await expect(dialog.getByTestId("composer-done")).toContainText("next time one runs");
    await dialog.getByRole("button", { name: "Done", exact: true }).click();
    await expect(page.getByTestId("request-card")).toHaveCount(12);
    const first = page.getByTestId("request-card").first();
    await expect(first).toHaveAttribute("data-status", "waiting");
    await expect(first).toContainText("Summarize");
  });

  test("leaves a request with free text, using an example", async ({ page }) => {
    await openDemo(page);
    await page.getByTestId("new-request").click();
    const dialog = page.getByRole("dialog");
    await dialog.getByTestId("example").first().click();
    const box = dialog.getByTestId("message");
    await box.fill("Make a one-page plan for the cardiology exam");
    await dialog.getByRole("button", { name: "Leave request" }).click();
    await dialog.getByRole("button", { name: "Done", exact: true }).click();
    await expect(page.getByTestId("request-card").first()).toContainText(
      "Make a one-page plan for the cardiology exam",
    );
  });

  test("edits a waiting request", async ({ page }) => {
    await openDemo(page);
    const card = page.getByTestId("request-card").filter({ hasText: "hydrophilic, not lipid" });
    await card.getByTestId("edit").click();
    const box = page.getByRole("dialog").getByTestId("message");
    await box.fill("Atenolol is hydrophilic. See slide 12 and the table on 13.");
    await page.getByTestId("save-edit").click();
    await expect(page.getByTestId("request-card").filter({ hasText: "table on 13" })).toHaveCount(
      1,
    );
    await expect(page.getByTestId("notice")).toHaveText("Request updated.");
  });

  test("cancels a request after confirming", async ({ page }) => {
    await openDemo(page);
    const card = page.getByTestId("request-card").filter({ hasText: "ACE inhibitors cause cough" });
    await card.getByTestId("cancel").click();
    await page.getByRole("button", { name: "Cancel request" }).click();
    await expect(page.getByTestId("request-card")).toHaveCount(10);
    await page.getByTestId("filter-cancelled").click();
    await expect(page.getByTestId("request-card")).toHaveCount(2);
  });

  test("reopens an answer with a follow-up note and keeps the history", async ({ page }) => {
    await openDemo(page);
    const card = page
      .getByTestId("request-card")
      .filter({ hasText: "gets stuck" })
      .or(page.getByTestId("request-card").filter({ hasText: "bisoprolol" }));
    await expect(card).toHaveCount(1);
    await card.getByTestId("reopen").click();
    await page.getByRole("dialog").getByTestId("message").fill("The study guide still says 25 mg.");
    await page.getByTestId("confirm-reopen").click();
    await expect(card.getByTestId("status")).toHaveText("Waiting for an agent");
    await card.getByTestId("history-toggle").click();
    await expect(card.getByTestId("history")).toContainText("The study guide still says 25 mg.");
    await expect(card.getByTestId("history")).toContainText("Corrected the transcript");
  });

  test("opens the target and the links of a reply", async ({ page }) => {
    await openDemo(page);
    const card = page.getByTestId("request-card").filter({ hasText: "propranolol is avoided" });
    await card.getByTestId("reply-link").filter({ hasText: "Slide 12" }).click();
    await expect(page.getByTestId("opened")).toContainText("source page");
    await card.getByTestId("open-target").click();
    expect((await opened(page)).map((o) => o.kind)).toEqual(["source", "document"]);
  });

  test("shows an agent picking one up, without a reload", async ({ page }) => {
    await openDemo(page);
    const card = page.getByTestId("request-card").filter({ hasText: "ACE inhibitors cause cough" });
    await expect(card.getByTestId("status")).toHaveText("Waiting for an agent");
    await page.evaluate(() => {
      const { store } = window.__requests;
      const id = store.all().find((r) => r.message.includes("ACE inhibitors cause cough"))
        ?.id as string;
      store.agent.claim(id);
      store.agent.complete(id, "Added a section on bradykinin.", []);
    });
    // polling is slow while only waiting: ask for a look by switching the filter back and forth
    await page.getByTestId("filter-done").click();
    await expect(page.getByTestId("request-card").filter({ hasText: "bradykinin" })).toHaveCount(1);
  });

  test("has empty, loading and error states", async ({ page }) => {
    await openDemo(page, { empty: true });
    await expect(page.getByText("No requests yet")).toBeVisible();
    await openDemo(page, { fail: true }).catch(() => undefined);
    await expect(page.getByRole("alert")).toContainText("pretending to be down");
    await page.goto("/requests-demo.html?bar=0&slow=1500");
    await expect(page.getByRole("status", { name: "Loading your requests" })).toBeVisible();
  });

  test("keeps the badge in step", async ({ page }) => {
    await page.goto("/requests-demo.html?fresh=1");
    await expect(page.getByTestId("request-card").first()).toBeVisible();
    await expect(page.locator('[data-unread="true"]')).toHaveCount(7);
    await page.reload();
    await expect(page.getByTestId("request-card").first()).toBeVisible();
    await expect(page.getByTestId("requests-badge")).toHaveText("3");
  });
});

test.describe("the Ask button", () => {
  test("opens the composer for its target and leaves a request", async ({ page }) => {
    await openDemo(page, { view: "asks" });
    await page.getByRole("button", { name: "Ask an agent about Question 14" }).click();
    const dialog = page.getByRole("dialog");
    await expect(dialog.getByTestId("composer-target")).toContainText("Question 14");
    await dialog.getByTestId("kind-quiz_me").click();
    await dialog.getByTestId("message").fill("Only the hard ones");
    await dialog.getByRole("button", { name: "Leave request" }).click();
    await expect(dialog.getByTestId("composer-done")).toBeVisible();
    const made = await page.evaluate(() => window.__requests.store.all().at(-1) ?? null);
    expect(made).toMatchObject({
      target: { type: "question" },
      kind: "quiz_me",
      message: "Only the hard ones",
    });
  });

  test("offers the right quick actions for each kind of target", async ({ page }) => {
    await openDemo(page, { view: "asks" });
    const expected = [6, 6, 7, 6, 5, 5];
    const buttons = page.getByTestId("ask-button");
    for (let i = 0; i < expected.length; i++) {
      await buttons.nth(i).click();
      const dialog = page.getByRole("dialog");
      await expect(dialog.getByTestId(/^kind-/)).toHaveCount(i === 0 ? 4 : (expected[i] as number));
      await page.keyboard.press("Escape");
      await expect(dialog).toBeHidden();
    }
  });
});

test("targets are big enough to tap and nothing slides sideways", async ({ page }, info) => {
  await openDemo(page);
  await expectNoSideScroll(page);
  if (info.project.name !== "computer") {
    const small = (await smallTargets(page)).filter((s) => !s.startsWith("BUTTON Close"));
    expect(small).toEqual([]);
  }
  await page.getByTestId("new-request").click();
  await expectNoSideScroll(page);
});

test("works from the keyboard", async ({ page }, info) => {
  test.skip(info.project.name !== "computer", "keyboard layout");
  await openDemo(page);
  await page.getByTestId("new-request").focus();
  await page.keyboard.press("Enter");
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByTestId("message")).toBeFocused();
  await page.keyboard.type("Explain beta-1 selectivity");
  await page.keyboard.press("Tab");
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
});
