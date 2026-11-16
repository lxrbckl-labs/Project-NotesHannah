import { test } from "@playwright/test";
import { signInReal } from "./real";

test("scratch", async ({ page }, info) => {
  const n = info.project.name;
  await signInReal(page);
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
  for (const path of ["/requests", "/concepts"]) {
    await page.goto(path);
    await page.waitForTimeout(1500);
    await page.screenshot({ path: `/tmp/wf-shots/${n}${path.replace("/", "-")}.png` });
  }
  await page.getByTestId("concept-row").first().click();
  await page.waitForTimeout(1500);
  await page.screenshot({ path: `/tmp/wf-shots/${n}-concept.png` });
  console.log(n, page.url(), errors.join("\n"));
});
