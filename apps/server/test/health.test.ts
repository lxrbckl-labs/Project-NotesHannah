import { describe, expect, test } from "vitest";
import { createApp } from "../src/app.js";
import { ConfigError, loadConfig } from "../src/config.js";

describe("GET /healthz", () => {
  test("returns ok and the version", async () => {
    const app = createApp(loadConfig({ NODE_ENV: "test" }));
    const res = await app.request("/healthz");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, version: "0.0.0" });
  });
});

describe("config", () => {
  test("fails fast with a clear message", () => {
    expect(() => loadConfig({ PORT: "not-a-port" })).toThrow(ConfigError);
    expect(() => loadConfig({ PORT: "not-a-port" })).toThrow(/PORT/);
  });
});
