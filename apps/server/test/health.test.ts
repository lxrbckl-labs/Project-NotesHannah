import { readFileSync } from "node:fs";
import { describe, expect, test } from "vitest";
import { createApp } from "../src/app.js";
import { ConfigError, loadConfig } from "../src/config.js";

describe("GET /healthz", () => {
  test("returns ok and the version", async () => {
    const app = createApp(loadConfig({ NODE_ENV: "test" }));
    const res = await app.request("/healthz");
    expect(res.status).toBe(200);
    // The repo's one version number (tools/version.mjs), read from the root package.json so this test never
    // has to change when the number does.
    const root = JSON.parse(
      readFileSync(new URL("../../../package.json", import.meta.url), "utf8"),
    ) as { version: string };
    expect(root.version).toMatch(/^\d+\.\d+\.\d+$/);
    expect(await res.json()).toEqual({ ok: true, version: root.version });
  });
});

describe("config", () => {
  test("fails fast with a clear message", () => {
    expect(() => loadConfig({ PORT: "not-a-port" })).toThrow(ConfigError);
    expect(() => loadConfig({ PORT: "not-a-port" })).toThrow(/PORT/);
  });
});
