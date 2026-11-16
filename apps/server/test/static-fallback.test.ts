import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { isFilePath } from "../src/app.js";
import { makeTestApp } from "./helpers.js";

function productionApp() {
  const dist = mkdtempSync(join(tmpdir(), "notes-dist-"));
  writeFileSync(join(dist, "index.html"), "<!doctype html><title>shell</title>");
  return makeTestApp({
    env: { NODE_ENV: "production", APP_ORIGIN: "https://x.app", WEB_DIST: dist },
  });
}

describe("the page shell fallback", () => {
  test("page addresses get the shell, uncached", async () => {
    const t = productionApp();
    for (const path of ["/", "/library", "/doc/nod_1/canvas", "/help/print"]) {
      const res = await t.request(path);
      expect(res.status).toBe(200);
      expect(res.headers.get("content-type")).toContain("text/html");
      expect(res.headers.get("cache-control")).toBe("no-cache");
    }
  });

  test("a script file from an older build is a 404, not the shell", async () => {
    const t = productionApp();
    for (const path of [
      "/assets/InboxPage-HVDEYoOk.js",
      "/assets/index-old.css",
      "/guide/gone.pdf",
    ]) {
      const res = await t.request(path);
      expect(res.status).toBe(404);
      expect(res.headers.get("content-type") ?? "").not.toContain("text/html");
    }
  });

  test("isFilePath", () => {
    expect(isFilePath("/assets/anything")).toBe(true);
    expect(isFilePath("/favicon.ico")).toBe(true);
    expect(isFilePath("/library/nod_01ABC")).toBe(false);
    expect(isFilePath("/")).toBe(false);
  });
});
