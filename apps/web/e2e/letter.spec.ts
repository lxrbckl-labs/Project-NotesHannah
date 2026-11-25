import { expect, test } from "@playwright/test";
import { signIn } from "./helpers";

/**
 * Alex's note to Hannah (features/letter). Its picture is served from his photo library, not from the app,
 * so these tests answer for that server themselves: no test depends on it being up.
 */
const PICTURE = /https:\/\/immich\.lxrbckl\.com\/api\/assets\/.+/;
// A 1 by 1 PNG.
const PIXEL = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);

async function openLetter(page: import("@playwright/test").Page) {
  await signIn(page);
  await page.getByRole("link", { name: "Settings", exact: true }).click();
  await page.getByTestId("love-letter").last().click();
}

test("the note's picture comes from the photo library, not from the app", async ({ page }) => {
  let asked = 0;
  await page.route(PICTURE, (route) => {
    asked++;
    return route.fulfill({ contentType: "image/png", body: PIXEL });
  });
  await openLetter(page);
  const picture = page.getByRole("img", { name: /A handwritten note/ });
  await expect(picture).toBeVisible();
  await expect(picture).toHaveAttribute("src", PICTURE);
  expect(asked).toBeGreaterThan(0);
  await expect(page.getByTestId("love-letter-words")).toHaveCount(0);
});

test("if the picture cannot be reached, the note's words show", async ({ page }) => {
  await page.route(PICTURE, (route) => route.abort());
  await openLetter(page);
  await expect(page.getByTestId("love-letter-words")).toHaveText(
    "This application was made for my Hannah. I wish nothing but the best for you. You are my world. Love, Alex A.",
  );
});
