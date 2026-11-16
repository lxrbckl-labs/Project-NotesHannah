// Writes apps/web/public/guide/notes-guide.pdf from the guide's print page.
//
// It starts the web app's dev server on its own port, opens /help/print (the guide as a booklet: no
// sign-in, no app shell, no API calls; its figures are the committed images under
// apps/web/public/guide/figures) in Playwright's Chromium, and prints it to Letter. Run it after any
// change to apps/web/src/features/help/:   pnpm guide:pdf
//
// How the booklet is put together:
// - Page size, margins, the running head (part and section) and the page number in the footer are
//   CSS: named pages with @page margin boxes (GuidePrint.tsx, guide-print.css). Playwright's own
//   header and footer are off.
// - Contents page numbers take two prints. The first is read for the page each heading landed on
//   (tools/guide-pdf-pages.mjs reads the PDF's named destinations); the numbers are written into the
//   contents and part pages, which keeps the layout the same, and it prints again. The second print
//   is read back and must agree, or the script stops without writing.
// - Headings use the app's rounded display face. On a Mac the script hands Chromium the system's
//   SF Rounded so it is embedded; elsewhere the font stack falls back as it does in the app.
//
// GUIDE_PORT picks the port (default 4391). Needs Chromium: pnpm exec playwright install chromium

import { spawn } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { destinationPages } from "./guide-pdf-pages.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const webDir = resolve(root, "apps/web");
const out = resolve(webDir, "public/guide/notes-guide.pdf");
const port = Number(process.env.GUIDE_PORT ?? 4391);
const base = `http://localhost:${port}`;
const ROUNDED = "/System/Library/Fonts/SFNSRounded.ttf";
const FONT_URL = `${base}/__guide-font/rounded.ttf`;

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

/** Contents entries whose page number is wanted: every `data-page-of` id on the page. */
const wanted = (page) =>
  page.evaluate(() => [
    ...new Set([...document.querySelectorAll("[data-page-of]")].map((el) => el.dataset.pageOf)),
  ]);

const print = (page) =>
  page.pdf({
    preferCSSPageSize: true,
    printBackground: true,
    displayHeaderFooter: false,
    outline: true,
    tagged: true,
  });

function pagesFor(pdf, ids) {
  const { pages, dests } = destinationPages(pdf);
  const missing = ids.filter((id) => !dests[id]);
  if (missing.length) throw new Error(`No page found for: ${missing.join(", ")}`);
  return { pages, numbers: Object.fromEntries(ids.map((id) => [id, dests[id]])) };
}

try {
  await waitFor(base);
  const browser = await chromium.launch();
  try {
    const context = await browser.newContext({
      viewport: { width: 816, height: 1056 },
      colorScheme: "light",
    });
    const page = await context.newPage();
    const rounded = existsSync(ROUNDED);
    if (rounded) {
      await page.route(FONT_URL, (route) =>
        route.fulfill({ body: readFileSync(ROUNDED), contentType: "font/ttf" }),
      );
    }
    await page.goto(`${base}/help/print`, { waitUntil: "networkidle" });
    await page.getByRole("heading", { level: 1, name: "Your guide to Notes" }).waitFor();
    if (rounded) {
      await page.addStyleTag({
        content: `@font-face { font-family: "Guide Rounded"; src: url("${FONT_URL}"); font-weight: 100 900; }
          :root { --font-display: "Guide Rounded", ui-rounded, "SF Pro Rounded", "Nunito", system-ui, sans-serif; }`,
      });
    }
    await page.evaluate(async () => {
      document.title = "Your guide to Notes";
      await Promise.all(
        [...document.images].map((img) => (img.complete ? null : img.decode().catch(() => null))),
      );
      await document.fonts.ready;
    });
    // Chromium stores a JPEG in a PDF as it is, but re-encodes WebP and PNG losslessly, which is
    // several times larger. So the figures are handed over as JPEG for the print only, at no more
    // than 330 pixels per inch of their printed size.
    await page.emulateMedia({ media: "print", colorScheme: "light" });
    await page.evaluate(async (quality) => {
      for (const img of document.querySelectorAll(".gp img")) {
        const printed = img.getBoundingClientRect().width / 96;
        const scale = Math.min(1, (printed * 330) / img.naturalWidth);
        const canvas = document.createElement("canvas");
        canvas.width = Math.round(img.naturalWidth * scale);
        canvas.height = Math.round(img.naturalHeight * scale);
        const ctx = canvas.getContext("2d");
        ctx.fillStyle = "#fff";
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        ctx.imageSmoothingQuality = "high";
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        img.src = canvas.toDataURL("image/jpeg", quality);
        await img.decode();
      }
    }, 0.9);
    if (rounded && !(await page.evaluate(() => document.fonts.check('600 20px "Guide Rounded"')))) {
      throw new Error("The rounded display face did not load");
    }
    await page.emulateMedia({ media: "print", colorScheme: "light" });

    const ids = await wanted(page);
    const first = pagesFor(await print(page), ids);
    await page.evaluate((numbers) => {
      for (const el of document.querySelectorAll("[data-page-of]")) {
        el.textContent = String(numbers[el.dataset.pageOf] ?? "");
      }
    }, first.numbers);
    const pdf = await print(page);
    const second = pagesFor(pdf, ids);
    const moved = ids.filter((id) => second.numbers[id] !== first.numbers[id]);
    if (moved.length || second.pages !== first.pages) {
      throw new Error(
        `The page numbers moved between prints (${moved.join(", ")}); nothing written`,
      );
    }
    mkdirSync(dirname(out), { recursive: true });
    writeFileSync(out, pdf);
    console.log(
      `Wrote ${out}: ${second.pages} pages, ${Math.round(statSync(out).size / 1024)} KB` +
        (rounded ? "" : " (SF Rounded not found: headings use the fallback face)"),
    );
  } finally {
    await browser.close();
  }
} catch (error) {
  failed = true;
  console.error(error instanceof Error ? error.message : error);
} finally {
  stop();
}
process.exit(failed ? 1 : 0);
