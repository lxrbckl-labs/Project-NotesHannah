// Writes apps/web/public/guide/notes-guide.pdf from the guide page.
//
// It starts the web app's dev server on its own port, opens /help/print (the guide on its own: no
// sign-in, no app shell, no API calls) in Playwright's Chromium, and prints it to Letter with the
// title and page numbers in the footer. Run it after any change to
// apps/web/src/features/help/content.ts:   pnpm guide:pdf
//
// GUIDE_PORT picks the port (default 4391). Needs Chromium: pnpm exec playwright install chromium

import { spawn } from "node:child_process";
import { mkdirSync, statSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const webDir = resolve(root, "apps/web");
const out = resolve(webDir, "public/guide/notes-guide.pdf");
const port = Number(process.env.GUIDE_PORT ?? 4391);
const base = `http://localhost:${port}`;

// Playwright is a dependency of the web app, so resolve it from there.
const { chromium } = createRequire(resolve(webDir, "package.json"))("@playwright/test");

async function waitFor(url, seconds = 90) {
  const until = Date.now() + seconds * 1000;
  while (Date.now() < until) {
    try {
      if ((await fetch(url)).status < 500) return;
    } catch {
      // not up yet
    }
    await new Promise((r) => setTimeout(r, 400));
  }
  throw new Error(`The web server did not come up at ${url} within ${seconds}s`);
}

const server = spawn("pnpm", ["exec", "vite", "--port", String(port), "--strictPort"], {
  cwd: webDir,
  stdio: ["ignore", "ignore", "inherit"],
  env: { ...process.env, VITE_MOCK_API: "" },
});
let failed = false;
const stop = () => {
  if (!server.killed) server.kill("SIGTERM");
};
process.on("SIGINT", () => {
  stop();
  process.exit(130);
});

try {
  await waitFor(base);
  const browser = await chromium.launch();
  try {
    const context = await browser.newContext({
      viewport: { width: 816, height: 1056 },
      colorScheme: "light",
    });
    const page = await context.newPage();
    await page.goto(`${base}/help/print`, { waitUntil: "networkidle" });
    await page.getByRole("heading", { level: 1, name: "Your guide to Notes" }).waitFor();
    await page.evaluate(() => document.fonts.ready);
    await page.evaluate(() => {
      document.title = "Your guide to Notes";
    });
    await page.emulateMedia({ media: "print", colorScheme: "light" });

    const footer = `
      <div style="width:100%;padding:0 0.7in;font-size:8px;color:#555;
        font-family:-apple-system,Helvetica,Arial,sans-serif;display:flex;justify-content:space-between">
        <span>Notes: your guide</span>
        <span>Page <span class="pageNumber"></span> of <span class="totalPages"></span></span>
      </div>`;
    const pdf = await page.pdf({
      format: "Letter",
      printBackground: true,
      displayHeaderFooter: true,
      headerTemplate: "<span></span>",
      footerTemplate: footer,
      margin: { top: "0.7in", right: "0.7in", bottom: "0.8in", left: "0.7in" },
    });
    mkdirSync(dirname(out), { recursive: true });
    writeFileSync(out, pdf);
  } finally {
    await browser.close();
  }
  console.log(`Wrote ${out} (${Math.round(statSync(out).size / 1024)} KB)`);
} catch (error) {
  failed = true;
  console.error(error instanceof Error ? error.message : error);
} finally {
  stop();
}
process.exit(failed ? 1 : 0);
