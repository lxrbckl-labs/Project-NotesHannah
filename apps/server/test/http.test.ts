import { describe, expect, test } from "vitest";
import { loadConfig } from "../src/config.js";
import {
  normaliseAddress,
  proxyMatcher,
  resolveClientAddress,
} from "../src/http/client-address.js";
import { errorCode, makeTestApp } from "./helpers.js";

describe("routing and headers", () => {
  test("unknown /api and /mcp paths are ApiError 404s", async () => {
    const t = makeTestApp();
    // /mcp itself is the MCP endpoint now (401 without a key; see mcp-auth.test.ts).
    for (const path of ["/api/nope", "/api", "/mcp/x", "/elsewhere"]) {
      const res = await t.request(path);
      expect(res.status).toBe(404);
      expect(errorCode(res.body)).toBe("not_found");
    }
  });

  test("security headers on every response", async () => {
    const t = makeTestApp();
    for (const path of ["/healthz", "/api/nope", "/api/me", "/robots.txt"]) {
      const res = await t.request(path);
      expect(res.headers.get("x-content-type-options")).toBe("nosniff");
      expect(res.headers.get("x-frame-options")).toBe("DENY");
      expect(res.headers.get("referrer-policy")).toBe("no-referrer");
      expect(res.headers.get("x-robots-tag")).toBe("noindex, nofollow");
      const csp = res.headers.get("content-security-policy") ?? "";
      expect(csp).toContain("default-src 'self'");
      expect(csp).toContain("script-src 'self'");
      expect(csp).toContain("frame-ancestors 'none'");
      expect(csp).not.toMatch(/script-src[^;]*unsafe/);
    }
  });

  test("robots.txt disallows everything", async () => {
    const t = makeTestApp();
    const res = await t.request("/robots.txt");
    expect(res.status).toBe(200);
    expect(res.body).toBe("User-agent: *\nDisallow: /\n");
  });

  test("API responses are not cached", async () => {
    const t = makeTestApp();
    const res = await t.request("/api/me");
    expect(res.headers.get("cache-control")).toBe("no-store");
  });
});

describe("client address", () => {
  const trusted = proxyMatcher(["172.16.0.0/12", "::1"]);

  test("socket address when the peer is not trusted", () => {
    expect(resolveClientAddress("203.0.113.5", "1.2.3.4", trusted)).toBe("203.0.113.5");
  });

  test("right-most untrusted hop when the peer is trusted", () => {
    expect(resolveClientAddress("172.17.0.1", "6.6.6.6, 203.0.113.5, 172.18.0.3", trusted)).toBe(
      "203.0.113.5",
    );
    expect(resolveClientAddress("::ffff:172.17.0.1", "203.0.113.5", trusted)).toBe("203.0.113.5");
    expect(resolveClientAddress("::1", "2001:db8::1", trusted)).toBe("2001:db8::1");
  });

  test("garbage in the forwarded chain does not become a free new address per request", () => {
    expect(resolveClientAddress("172.17.0.1", "evil, not-an-ip", trusted)).toBe(
      "invalid:not-an-ip",
    );
  });

  test("no trusted proxies configured: always the socket", () => {
    expect(resolveClientAddress("172.17.0.1", "1.2.3.4", proxyMatcher([]))).toBe("172.17.0.1");
    expect(normaliseAddress("::FFFF:10.0.0.1")).toBe("10.0.0.1");
  });
});

describe("config", () => {
  test("APP_ORIGIN is required in production and must be a bare origin", () => {
    expect(() => loadConfig({ NODE_ENV: "production" })).toThrow(/APP_ORIGIN/);
    expect(() => loadConfig({ APP_ORIGIN: "https://x.app/" })).toThrow(/APP_ORIGIN/);
    expect(loadConfig({ APP_ORIGIN: "https://x.app" }).APP_ORIGIN).toBe("https://x.app");
    expect(loadConfig({}).APP_ORIGIN).toBe("http://localhost:5173");
  });

  test("TRUSTED_PROXIES is validated", () => {
    expect(loadConfig({ TRUSTED_PROXIES: "10.0.0.0/8, ::1" }).TRUSTED_PROXIES).toEqual([
      "10.0.0.0/8",
      "::1",
    ]);
    expect(() => loadConfig({ TRUSTED_PROXIES: "10.0.0.0/33" })).toThrow(/TRUSTED_PROXIES/);
    expect(() => loadConfig({ TRUSTED_PROXIES: "example.com" })).toThrow(/TRUSTED_PROXIES/);
  });
});
