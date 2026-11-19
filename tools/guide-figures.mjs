// Captures the guide's figures: real screenshots of the app, saved as WebP under
// apps/web/public/guide/figures/ (committed), with their sizes in
// apps/web/src/features/help/figures.json. `pnpm guide:pdf` and the /help page only read the
// committed files; this script is the only thing that needs a running app.
//
// It needs a real instance with the pharmacy demo set, on its own ports and its own data directory:
//
//   export NOTES_LOCAL_DIR=$(mktemp -d) NOTES_SERVER_PORT=3330 NOTES_WEB_PORT=5393
//   pnpm local                    # in one terminal: server, converter (Docker) and web app
//   pnpm local:seed:pharm         # in another, with the same three variables
//   pnpm guide:figures            # with the same three variables
//
// It signs in with the credentials `pnpm local` wrote (NOTES_LOCAL_DIR/credentials.json), or
// NOTES_LOCAL_USER and NOTES_LOCAL_PASSWORD. Every figure is light theme. GUIDE_FIGURES=a,b only
// retakes those figures. RAW=1 also writes the uncropped screenshots to guide-figures-raw/ in the
// system temp folder, for checking a crop. Stop the instance afterwards (Ctrl-C on `pnpm local`).

import { mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const webDir = resolve(root, "apps/web");
const outDir = resolve(webDir, "public/guide/figures");
const sizesFile = resolve(webDir, "src/features/help/figures.json");
const rawDir = join(tmpdir(), "guide-figures-raw");
const base =
  process.env.NOTES_APP_ORIGIN ?? `http://localhost:${process.env.NOTES_WEB_PORT ?? 5393}`;
const only = process.env.GUIDE_FIGURES?.split(",").filter(Boolean);
const raw = process.env.RAW === "1";

const { chromium, expect } = createRequire(resolve(webDir, "package.json"))("@playwright/test");

function credentials() {
  if (process.env.NOTES_LOCAL_USER && process.env.NOTES_LOCAL_PASSWORD) {
    return { username: process.env.NOTES_LOCAL_USER, password: process.env.NOTES_LOCAL_PASSWORD };
  }
  const dir = process.env.NOTES_LOCAL_DIR;
  if (!dir)
    throw new Error(
      "Set NOTES_LOCAL_DIR to the instance's data directory (see the top of this file).",
    );
  return JSON.parse(readFileSync(join(dir, "credentials.json"), "utf8"));
}

/** Widest edge of a saved figure, in pixels. Big enough to stay sharp at full page width in print. */
const MAX_WIDTH = 1600;
const QUALITY = 0.86;

async function signIn(page) {
  const { username, password } = credentials();
  await page.goto(`${base}/login`);
  await page.getByLabel("Username").fill(username);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Library" })).toBeVisible({
    timeout: 15_000,
  });
}

/** Quiet the screen before a shot: no caret, no hover, no motion, fonts loaded. */
async function settle(page) {
  await page.mouse.move(0, 0);
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(600);
}

const rectOf = async (locator) => {
  const box = await locator.boundingBox();
  if (!box) throw new Error("element not on screen");
  return box;
};

/** Shrinks a PNG to MAX_WIDTH and encodes WebP, in the browser (no image library needed). */
async function toWebp(page, png) {
  const dataUrl = `data:image/png;base64,${png.toString("base64")}`;
  const result = await page.evaluate(
    async ({ dataUrl, maxWidth, quality }) => {
      const img = new Image();
      img.src = dataUrl;
      await img.decode();
      const scale = Math.min(1, maxWidth / img.naturalWidth);
      const w = Math.round(img.naturalWidth * scale);
      const h = Math.round(img.naturalHeight * scale);
      const canvas = document.createElement("canvas");
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext("2d");
      ctx.imageSmoothingQuality = "high";
      ctx.drawImage(img, 0, 0, w, h);
      return { url: canvas.toDataURL("image/webp", quality), w, h };
    },
    { dataUrl, maxWidth: MAX_WIDTH, quality: QUALITY },
  );
  return {
    bytes: Buffer.from(result.url.slice(result.url.indexOf(",") + 1), "base64"),
    width: result.w,
    height: result.h,
  };
}

const COMPUTER = { viewport: { width: 1280, height: 800 }, deviceScaleFactor: 2 };
const PHONE = {
  viewport: { width: 390, height: 844 },
  deviceScaleFactor: 3,
  hasTouch: true,
  isMobile: true,
};

/** Main column of the computer layout: everything right of the sidebar. */
const SIDEBAR = 256;

async function openTreeItem(page, name) {
  await page.goto(`${base}/library`);
  await page.getByRole("button", { name: "Expand all" }).click();
  await page.getByTestId("tree-item").filter({ hasText: name }).first().click();
  await expect(page.getByTestId("doc-screen")).toBeVisible();
  await expect(page.locator('[data-testid="block"]').first()).toBeVisible();
}

/**
 * The figures. Each one opens a screen and returns the area to keep (CSS pixels), or null for the
 * whole viewport.
 */
const MAIN = (height = 800) => ({ x: SIDEBAR, y: 0, width: 1280 - SIDEBAR, height });
const scrollMain = (page, y) =>
  page.evaluate((top) => document.getElementById("main")?.scrollTo({ top }), y);

const FIGURES = [
  {
    id: "library-home",
    device: { ...COMPUTER, viewport: { width: 1280, height: 1000 } },
    async take(page) {
      await page.goto(`${base}/library`);
      await expect(page.getByTestId("upcoming-exams")).toBeVisible();
      return { x: 0, y: 0, width: 980, height: 1000 };
    },
  },
  {
    id: "lecture-page",
    device: COMPUTER,
    async take(page) {
      await openTreeItem(page, "Beta blockers");
      await page.getByTestId("cite-chip").first().scrollIntoViewIfNeeded();
      await scrollMain(page, 330);
      return MAIN();
    },
  },
  {
    id: "source-page",
    device: COMPUTER,
    async take(page) {
      await openTreeItem(page, "Beta blockers");
      await page.getByTestId("cite-chip").first().click();
      await expect(page.getByTestId("citation-panel")).toBeVisible();
      await expect
        .poll(() =>
          page
            .getByTestId("citation-panel")
            .locator("img")
            .first()
            .evaluate((el) => el.naturalWidth),
        )
        .toBeGreaterThan(100);
      return MAIN();
    },
  },
  {
    id: "editor",
    device: COMPUTER,
    async take(page) {
      await openTreeItem(page, "In-class notes");
      await expect(page.getByTestId("format-ribbon")).toBeVisible();
      await page.getByText("Pulled up the pathway slide").click();
      await page.getByTestId("block-style").click();
      await expect(page.getByTestId("block-style-menu")).toBeVisible();
      return MAIN(640);
    },
  },
  {
    id: "side-notes",
    device: COMPUTER,
    async take(page) {
      await openTreeItem(page, "Beta blockers");
      const note = page.getByTestId("side-note").filter({ hasText: "labetalol every time" });
      const anchor = await note.getAttribute("data-anchor");
      await page
        .locator(`[data-block-id="${anchor}"]`)
        .evaluate((el) => el.scrollIntoView({ block: "center" }));
      await page.waitForTimeout(500);
      await note.getByTestId("side-note-text").click();
      await expect(note).toHaveAttribute("data-focused", "true");
      await page.waitForTimeout(400);
      return MAIN();
    },
  },
  {
    id: "canvas",
    device: COMPUTER,
    async take(page) {
      await openTreeItem(page, "Beta blockers");
      await page.getByRole("tab", { name: "Canvas" }).click();
      await expect(page.locator(".react-flow__node").first()).toBeVisible({ timeout: 30_000 });
      await page.waitForTimeout(800);
      await page.getByRole("button", { name: "Step through frames" }).click();
      await page.waitForTimeout(1500);
      return MAIN();
    },
  },
  {
    id: "concept",
    device: COMPUTER,
    async take(page) {
      await page.goto(`${base}/concepts`);
      await page.getByTestId("concept-search").fill("metoprolol");
      await page.getByRole("link", { name: "metoprolol tartrate" }).first().click();
      await expect(page.getByTestId("concept-name")).toBeVisible();
      await expect(page.getByTestId("relation-item").first()).toBeVisible();
      const graph = page.getByTestId("graph");
      await page
        .getByRole("radio", { name: "Two steps" })
        .or(page.getByRole("button", { name: "Two steps" }))
        .first()
        .click();
      await graph.scrollIntoViewIfNeeded();
      await scrollMain(
        page,
        (await page.evaluate(() => document.getElementById("main")?.scrollTop ?? 0)) + 160,
      );
      await page.waitForTimeout(1500);
      const box = await rectOf(graph);
      return {
        x: box.x - 28,
        y: Math.max(0, box.y - 146),
        width: box.width + 56,
        height: box.height + 176,
      };
    },
  },
  {
    id: "practice-question",
    device: COMPUTER,
    async take(page) {
      await page.goto(`${base}/practice`);
      await expect(page.getByTestId("start")).toBeVisible();
      await page
        .getByRole("radio", { name: /Beta blockers/ })
        .first()
        .check();
      await page.getByTestId("start-session").click();
      const player = page.getByTestId("player");
      await expect(player).toBeVisible();
      for (let i = 0; i < 12; i++) {
        if ((await player.getAttribute("data-qtype")) === "multiple_choice") break;
        await page.getByTestId("skip").click();
        await page.waitForTimeout(300);
      }
      return { x: 0, y: 0, width: 1280, height: 560 };
    },
  },
  {
    id: "requests",
    device: COMPUTER,
    async take(page) {
      await page.goto(`${base}/requests`);
      await expect(page.getByRole("heading", { level: 1, name: "Requests" })).toBeVisible();
      await expect(page.getByTestId("request-card").first()).toBeVisible();
      return MAIN();
    },
  },
  {
    id: "phone",
    device: PHONE,
    async take(page) {
      await openTreeItem(page, "Beta blockers");
      await page.getByTestId("cite-chip").first().scrollIntoViewIfNeeded();
      await page.waitForTimeout(400);
      return null;
    },
  },
];

mkdirSync(outDir, { recursive: true });
if (raw) mkdirSync(rawDir, { recursive: true });
let sizes = {};
try {
  sizes = JSON.parse(readFileSync(sizesFile, "utf8"));
} catch {
  // first run
}

const browser = await chromium.launch();
let failed = false;
try {
  for (const figure of FIGURES) {
    if (only && !only.includes(figure.id)) continue;
    const context = await browser.newContext({ ...figure.device, colorScheme: "light" });
    await context.addInitScript(() => localStorage.setItem("notes-theme", "light"));
    const page = await context.newPage();
    try {
      await signIn(page);
      const clip = await figure.take(page, { rectOf });
      await settle(page);
      const png = await page.screenshot(clip ? { clip } : {});
      if (raw) writeFileSync(join(rawDir, `${figure.id}.png`), png);
      const { bytes, width, height } = await toWebp(page, png);
      writeFileSync(join(outDir, `${figure.id}.webp`), bytes);
      sizes[figure.id] = { width, height };
      const kb = Math.round(statSync(join(outDir, `${figure.id}.webp`)).size / 1024);
      console.log(`${figure.id}: ${width}x${height}, ${kb} KB`);
    } catch (error) {
      failed = true;
      console.error(`${figure.id} failed: ${error instanceof Error ? error.message : error}`);
      await page.screenshot({ path: join(tmpdir(), `guide-figure-${figure.id}-failed.png`) });
    } finally {
      await context.close();
    }
  }
} finally {
  await browser.close();
}
const ordered = Object.fromEntries(Object.entries(sizes).sort(([a], [b]) => a.localeCompare(b)));
writeFileSync(sizesFile, `${JSON.stringify(ordered, null, 2)}\n`);
process.exit(failed ? 1 : 0);
