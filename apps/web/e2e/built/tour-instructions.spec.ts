import { expect, test } from "@playwright/test";
import { signInBuilt, watch } from "./built";

/**
 * Two things added on 2026-11-21, against the real server and the production build:
 * the tour (started from the guide; it never starts by itself under automation), and saved
 * instructions (written in Settings, chosen in the request dialog, carried by the request).
 */

test("the tour never starts by itself under automation, and runs from the guide to its end", async ({
  page,
}) => {
  const seen = watch(page);
  await signInBuilt(page);
  await expect(page.getByTestId("tour")).toHaveCount(0);

  await page.goto("/help");
  await page.getByTestId("tour-start").first().click();
  const tour = page.getByTestId("tour");
  await expect(tour).toHaveAttribute("data-step", "welcome");
  await expect(page.getByTestId("tour-skip")).toBeVisible();

  // Every stop: the card is on screen and Next moves on; the last stop is back in the guide.
  const stops: string[] = [];
  for (let i = 0; i < 20; i++) {
    const card = page.getByTestId("tour-card");
    await expect(card).toHaveAttribute("data-ready", "true");
    const box = await card.boundingBox();
    const size = page.viewportSize();
    expect(box && size && box.x >= 0 && box.y >= 0 && box.x + box.width <= size.width).toBe(true);
    const step = (await tour.getAttribute("data-step")) ?? "";
    stops.push(step);
    if (step === "guide") break;
    await page.getByTestId("tour-next").click();
    await expect(tour).not.toHaveAttribute("data-step", step);
  }
  expect(stops[0]).toBe("welcome");
  expect(stops.at(-1)).toBe("guide");
  expect(stops).toContain("practice");
  await expect(page).toHaveURL(/\/help$/);
  await page.getByTestId("tour-next").click();
  await expect(tour).toHaveCount(0);

  // Skip ends it from the middle, and the account remembers it was seen.
  await page.getByTestId("tour-start").first().click();
  await page.getByTestId("tour-next").click();
  await page.getByTestId("tour-skip").click();
  await expect(tour).toHaveCount(0);
  const prefs = await (await page.request.get("/api/me/preferences")).json();
  expect(prefs.preferences.tourSeen).toBe(true);
  seen.assertClean("the tour");
});

test("an instruction saved in Settings is chosen in the request dialog and travels with the request", async ({
  page,
}) => {
  const seen = watch(page);
  await signInBuilt(page);
  await page.goto("/settings");
  await page.getByTestId("instruction-new").click();
  const name = `Lecture notes ${Date.now()}`;
  await page.getByTestId("instruction-title").fill(name);
  await page.getByTestId("instruction-body").fill("One section per slide.\nBold every drug name.");
  await page.getByTestId("instruction-save").click();
  await expect(page.getByTestId("instruction-item").filter({ hasText: name })).toBeVisible();

  // It is on the account, not just in the page.
  await page.reload();
  await expect(page.getByTestId("instruction-item").filter({ hasText: name })).toBeVisible();

  await page.goto("/requests");
  await page.getByRole("button", { name: /New request/ }).click();
  await page.getByTestId("instruction-select").selectOption({ label: name });
  await expect(page.getByTestId("instruction-preview")).toContainText("Bold every drug name.");
  // The instruction alone is enough to send.
  await expect(page.getByTestId("send-request")).toBeEnabled();
  await page.getByTestId("send-request").click();
  await expect(page.getByTestId("composer-done")).toBeVisible();

  const list = await (await page.request.get("/api/requests?limit=5&order=newest")).json();
  const mine = list.items.find(
    (r: { instructions?: { title: string } | null }) => r.instructions?.title === name,
  );
  expect(mine?.instructions?.body).toContain("One section per slide.");

  // Put things back for the other tests in this suite.
  const origin = new URL(page.url()).origin;
  await page.request.post(`/api/requests/${mine.id}/cancel`, { headers: { Origin: origin } });
  await page.request.patch("/api/me/preferences", {
    data: { instructions: [] },
    headers: { Origin: origin },
  });
  seen.assertClean("saved instructions");
});
