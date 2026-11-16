import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { expect, test } from "@playwright/test";
import { signInBuilt } from "./built";

/**
 * An upload through the built app's server, converted by the real converter. The converter is a Docker container
 * that this suite does not start unless `E2E_BUILT_CONVERTER=1`; without it the test is skipped, never failed.
 */
test("an uploaded PDF is converted into pages", async ({ page }, info) => {
  test.skip(info.project.name !== "built-computer", "not about screen size: runs once");
  test.setTimeout(240_000);
  await signInBuilt(page);
  const status = await page.request.get("/api/converter/status");
  const online =
    status.ok() &&
    ((await status.json()) as { converter: { state: string } }).converter.state === "online";
  test.skip(!online, "the converter is not running (needs Docker and E2E_BUILT_CONVERTER=1)");

  const origin = new URL(page.url()).origin;
  const upload = await page.request.post("/api/uploads", {
    headers: { Origin: origin },
    multipart: {
      file: {
        name: "Built suite notes.pdf",
        mimeType: "application/pdf",
        buffer: readFileSync(resolve("../../fixtures/generated/text-layer.pdf")),
      },
    },
  });
  expect(upload.status()).toBe(201);
  const { file } = (await upload.json()) as { file: { id: string } };
  await expect
    .poll(
      async () =>
        (
          (await (await page.request.get(`/api/files/${file.id}`)).json()) as {
            file: { status: string };
          }
        ).file.status,
      { timeout: 200_000 },
    )
    .not.toMatch(/^(uploaded|converting)$/);
  const pages = await page.request.get(`/api/files/${file.id}/pages`);
  expect(((await pages.json()) as { items: unknown[] }).items.length).toBeGreaterThan(0);
});
