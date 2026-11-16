import { execFileSync } from "node:child_process";
import { readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { expect, test } from "@playwright/test";
import { distDir } from "./built";

/**
 * How the server serves the build: files, types, caching and headers. These are plain requests, with no browser
 * page, so they run once (in the computer project) rather than once per screen size.
 */
test.beforeEach(({ baseURL }, info) => {
  expect(baseURL).toBeTruthy();
  test.skip(info.project.name !== "built-computer", "not about screen size: runs once");
});

const javascript = /javascript/;

test("every script and stylesheet in the build is served with the right type", async ({
  request,
}) => {
  const files = readdirSync(join(distDir, "assets")).filter((f) => /\.(js|css)$/.test(f));
  // The build is split into many lazily loaded files: a handful would mean the walk found the wrong place.
  expect(files.length).toBeGreaterThan(20);
  expect(files.some((f) => f.startsWith("InboxPage-"))).toBe(true);
  const wrong: string[] = [];
  for (const file of files) {
    const response = await request.get(`/assets/${file}`);
    const type = response.headers()["content-type"] ?? "";
    const wanted = file.endsWith(".css") ? /text\/css/ : javascript;
    if (response.status() !== 200 || !wanted.test(type)) {
      wrong.push(`${file}: ${response.status()} ${type}`);
    }
  }
  expect(wrong).toEqual([]);
});

test("a file that is not in the build is a 404, never the page shell", async ({ request }) => {
  for (const path of [
    "/assets/InboxPage-HVDEYoOk.js",
    "/assets/gone-123.css",
    "/images/nothing.png",
    "/assets/",
  ]) {
    const response = await request.get(path);
    expect(response.status(), path).toBe(404);
    expect(response.headers()["content-type"] ?? "", path).not.toContain("text/html");
  }
});

test("a page address answers with the shell, and the shell is never cached", async ({
  request,
}) => {
  for (const path of ["/", "/index.html", "/library", "/doc/anything/canvas"]) {
    const response = await request.get(path);
    expect(response.status(), path).toBe(200);
    expect(response.headers()["content-type"], path).toContain("text/html");
    expect(response.headers()["cache-control"], path).toContain("no-cache");
    expect(await response.text(), path).toContain('<div id="root">');
  }
});

test("the shell carries the security and noindex headers", async ({ request }) => {
  const headers = (await request.get("/library")).headers();
  expect(headers["content-security-policy"]).toContain("default-src 'self'");
  expect(headers["content-security-policy"]).toContain("script-src 'self'");
  expect(headers["x-content-type-options"]).toBe("nosniff");
  expect(headers["x-frame-options"]).toBe("DENY");
  expect(headers["referrer-policy"]).toBe("no-referrer");
  expect(headers["x-robots-tag"]).toContain("noindex");
  expect(headers["strict-transport-security"]).toContain("max-age=");
});

test("the guide PDF is served as a PDF", async ({ request }) => {
  const response = await request.get("/guide/notes-guide.pdf");
  expect(response.status()).toBe(200);
  expect(response.headers()["content-type"]).toContain("application/pdf");
  expect((await response.body()).subarray(0, 5).toString("latin1")).toBe("%PDF-");
});

test("the smoke check (pnpm smoke) passes against this server", () => {
  const baseURL = `http://localhost:${process.env.E2E_BUILT_PORT ?? 3460}`;
  const output = execFileSync("node", [resolve("../../tools/smoke.mjs"), baseURL], {
    encoding: "utf8",
  });
  expect(output).toMatch(/\d+ of \d+ checks passed/);
});
