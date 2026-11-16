import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseOptions } from "@node-rs/argon2";
import { User } from "@notes/schema";
import { describe, expect, test, vi } from "vitest";
import { PasswordHasher } from "../src/domains/accounts/passwords.js";
import { SESSION_TTL_MS } from "../src/domains/accounts/sessions.js";
import { BASE_LOCK_MS, lockDuration, MAX_LOCK_MS } from "../src/domains/accounts/throttle.js";
import { getPasswordHash, setUserDisabled } from "../src/domains/accounts/users.js";
import { errorCode, makeTestApp, TEST_ARGON2 } from "./helpers.js";

const PW = "correct horse battery";

describe("sign-in", () => {
  test("returns the user and sets an HttpOnly, SameSite=Strict session cookie", async () => {
    const t = makeTestApp();
    await t.addUser("hannah", PW);
    const res = await t.request("/api/auth/login", { body: { username: "hannah", password: PW } });
    expect(res.status).toBe(200);
    const { user } = res.body as { user: unknown };
    expect(User.parse(user).username).toBe("hannah");
    const cookie = res.setCookies.get("nh_session");
    expect(cookie?.value).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(cookie?.raw).toMatch(/HttpOnly/);
    expect(cookie?.raw).toMatch(/SameSite=Strict/);
    expect(cookie?.raw).toMatch(/Path=\//);
    expect(cookie?.raw).toMatch(/Max-Age=2592000/);
    expect(cookie?.raw).not.toMatch(/Secure/);
  });

  test("in production the cookie is Secure and __Host- prefixed", async () => {
    const web = mkdtempSync(join(tmpdir(), "notes-web-"));
    writeFileSync(join(web, "index.html"), "<!doctype html><title>x</title>");
    const t = makeTestApp({
      env: { NODE_ENV: "production", APP_ORIGIN: "https://notes.example.app", WEB_DIST: web },
    });
    await t.addUser("hannah", PW);
    const res = await t.request("/api/auth/login", {
      body: { username: "hannah", password: PW },
      origin: "https://notes.example.app",
    });
    expect(res.status).toBe(200);
    const cookie = res.setCookies.get("__Host-nh_session");
    expect(cookie?.raw).toMatch(/; Secure/);
    expect(cookie?.raw).toMatch(/HttpOnly/);
    expect(cookie?.raw).toMatch(/SameSite=Strict/);
    expect(cookie?.raw).toMatch(/Path=\//);
    expect(res.headers.get("strict-transport-security")).toMatch(/max-age=/);
  });

  test("the session token is stored only as a hash", async () => {
    const t = makeTestApp();
    await t.addUser("hannah", PW);
    const { cookies } = await t.signIn("hannah", PW);
    const token = cookies.nh_session as string;
    const dump = JSON.stringify(t.db.prepare("SELECT * FROM sessions").all());
    expect(dump).not.toContain(token);
  });

  test("unknown username and wrong password look identical and both run a hash", async () => {
    const t = makeTestApp();
    await t.addUser("hannah", PW);
    const verify = vi.spyOn(t.hasher, "verify");
    const wrong = await t.request("/api/auth/login", {
      body: { username: "hannah", password: "wrong password" },
    });
    expect(verify).toHaveBeenCalledTimes(1);
    const unknown = await t.request("/api/auth/login", {
      body: { username: "nobody", password: "wrong password" },
      address: "203.0.113.11",
    });
    expect(verify).toHaveBeenCalledTimes(2);
    expect(wrong.status).toBe(401);
    expect(unknown.status).toBe(401);
    expect(unknown.body).toEqual(wrong.body);
    expect([...unknown.headers.keys()].sort()).toEqual([...wrong.headers.keys()].sort());
    expect(wrong.setCookies.size).toBe(0);
    expect(unknown.setCookies.size).toBe(0);
  });

  test("unknown username and wrong password both run one full hash verify", async () => {
    // Wall-clock comparisons are flaky on a busy machine, so check the cause of equal
    // timing instead: each attempt runs exactly one real verify, user or no user.
    const params = { memoryCost: 8192, timeCost: 2, parallelism: 1 };
    const t = makeTestApp({ hasher: new PasswordHasher(params) });
    await t.addUser("hannah", PW, params);
    await t.hasher.warmUp();
    const realVerify = t.hasher.verify.bind(t.hasher);
    let verifies = 0;
    t.hasher.verify = (stored: string, password: string) => {
      verifies++;
      return realVerify(stored, password);
    };
    const attempt = async (username: string, address: string) => {
      const before = verifies;
      const res = await t.request("/api/auth/login", {
        body: { username, password: "wrong password" },
        address,
      });
      expect(res.status).toBe(401);
      return verifies - before;
    };
    expect(await attempt("hannah", "198.51.100.1")).toBe(1);
    expect(await attempt("nobody", "198.51.100.51")).toBe(1);
  });

  test("a malformed username gets the same answer", async () => {
    const t = makeTestApp();
    await t.addUser("hannah", PW);
    const wrong = await t.request("/api/auth/login", {
      body: { username: "hannah", password: "nope nope" },
    });
    const bad = await t.request("/api/auth/login", {
      body: { username: "../../etc", password: "nope nope" },
    });
    expect(bad.status).toBe(401);
    expect(bad.body).toEqual(wrong.body);
  });

  test("usernames are case-insensitive", async () => {
    const t = makeTestApp();
    await t.addUser("hannah", PW);
    const res = await t.request("/api/auth/login", {
      body: { username: " Hannah ", password: PW },
    });
    expect(res.status).toBe(200);
  });

  test("bad bodies are invalid_input", async () => {
    const t = makeTestApp();
    const res = await t.request("/api/auth/login", { body: "{not json" });
    expect(res.status).toBe(400);
    expect(errorCode(res.body)).toBe("invalid_input");
    const res2 = await t.request("/api/auth/login", { body: { username: "hannah" } });
    expect(errorCode(res2.body)).toBe("invalid_input");
  });

  test("oversized bodies are too_large", async () => {
    const t = makeTestApp();
    const res = await t.request("/api/auth/login", {
      body: { username: "hannah", password: "x".repeat(20_000) },
    });
    expect(res.status).toBe(413);
    expect(errorCode(res.body)).toBe("too_large");
  });

  test("an outdated hash is upgraded at sign-in", async () => {
    const strong = { memoryCost: 512, timeCost: 2, parallelism: 1 };
    const t = makeTestApp({ hasher: new PasswordHasher(strong) });
    const user = await t.addUser("hannah", PW, TEST_ARGON2);
    expect(parseOptions(getPasswordHash(t.db, user.id) as string).memoryCost).toBe(256);
    await t.signIn("hannah", PW);
    const after = parseOptions(getPasswordHash(t.db, user.id) as string);
    expect(after.memoryCost).toBe(512);
    expect(after.timeCost).toBe(2);
    expect(getPasswordHash(t.db, user.id)).toMatch(/^\$argon2id\$/);
    // and the new hash still works
    await t.signIn("hannah", PW);
  });

  test("a previous session cookie is ended at sign-in", async () => {
    const t = makeTestApp();
    await t.addUser("hannah", PW);
    const first = await t.signIn("hannah", PW);
    const second = await t.signIn("hannah", PW, { cookies: first.cookies });
    expect(second.cookies.nh_session).not.toBe(first.cookies.nh_session);
    expect((await t.request("/api/me", { cookies: first.cookies })).status).toBe(401);
    expect((await t.request("/api/me", { cookies: second.cookies })).status).toBe(200);
  });
});

describe("sessions", () => {
  test("GET /api/me needs a session", async () => {
    const t = makeTestApp();
    const user = await t.addUser("hannah", PW);
    const anon = await t.request("/api/me");
    expect(anon.status).toBe(401);
    expect(errorCode(anon.body)).toBe("unauthenticated");
    const forged = await t.request("/api/me", { cookies: { nh_session: "A".repeat(43) } });
    expect(forged.status).toBe(401);
    const { cookies } = await t.signIn("hannah", PW);
    const me = await t.request("/api/me", { cookies });
    expect(me.status).toBe(200);
    expect((me.body as { user: { id: string } }).user.id).toBe(user.id);
  });

  test("sliding 30-day expiry", async () => {
    const t = makeTestApp();
    await t.addUser("hannah", PW);
    const { cookies } = await t.signIn("hannah", PW);
    const day = 24 * 60 * 60_000;
    t.clock.advance(29 * day);
    const touched = await t.request("/api/me", { cookies });
    expect(touched.status).toBe(200);
    expect(touched.setCookies.get("nh_session")?.raw).toMatch(/Max-Age=2592000/);
    t.clock.advance(29 * day);
    expect((await t.request("/api/me", { cookies })).status).toBe(200);
    // last-seen is not rewritten on every request
    const quick = await t.request("/api/me", { cookies });
    expect(quick.setCookies.size).toBe(0);
    t.clock.advance(SESSION_TTL_MS + 1);
    expect((await t.request("/api/me", { cookies })).status).toBe(401);
    expect(t.db.prepare("SELECT COUNT(*) AS n FROM sessions").get()).toEqual({ n: 0 });
  });

  test("records created and last-seen per session", async () => {
    const t = makeTestApp();
    await t.addUser("hannah", PW);
    const { cookies } = await t.signIn("hannah", PW);
    const created = t.clock.ms;
    t.clock.advance(5 * 60_000);
    await t.request("/api/me", { cookies });
    const row = t.db.prepare("SELECT created_at, last_seen_at FROM sessions").get();
    expect(row).toEqual({ created_at: created, last_seen_at: created + 5 * 60_000 });
  });

  test("logout ends this session only", async () => {
    const t = makeTestApp();
    await t.addUser("hannah", PW);
    const a = await t.signIn("hannah", PW);
    const b = await t.signIn("hannah", PW);
    const res = await t.request("/api/auth/logout", { method: "POST", cookies: a.cookies });
    expect(res.status).toBe(204);
    expect(res.setCookies.get("nh_session")?.raw).toMatch(/Max-Age=0/);
    expect((await t.request("/api/me", { cookies: a.cookies })).status).toBe(401);
    expect((await t.request("/api/me", { cookies: b.cookies })).status).toBe(200);
  });

  test("logout without a session is still 204", async () => {
    const t = makeTestApp();
    expect((await t.request("/api/auth/logout", { method: "POST" })).status).toBe(204);
  });

  test("logout-all ends every session", async () => {
    const t = makeTestApp();
    await t.addUser("hannah", PW);
    const a = await t.signIn("hannah", PW);
    const b = await t.signIn("hannah", PW);
    expect((await t.request("/api/auth/logout-all", { method: "POST" })).status).toBe(401);
    const res = await t.request("/api/auth/logout-all", { method: "POST", cookies: a.cookies });
    expect(res.status).toBe(204);
    expect((await t.request("/api/me", { cookies: a.cookies })).status).toBe(401);
    expect((await t.request("/api/me", { cookies: b.cookies })).status).toBe(401);
  });

  test("logout-all refuses an API key", async () => {
    const t = makeTestApp();
    await t.addUser("hannah", PW);
    const { cookies } = await t.signIn("hannah", PW);
    const created = await t.request("/api/keys", { cookies, body: { name: "a", scope: "write" } });
    const { secret } = created.body as { secret: string };
    const res = await t.request("/api/auth/logout-all", { method: "POST", bearer: secret });
    expect(res.status).toBe(403);
    expect(errorCode(res.body)).toBe("forbidden");
  });
});

describe("password change", () => {
  test("wrong current password is refused", async () => {
    const t = makeTestApp();
    await t.addUser("hannah", PW);
    const { cookies } = await t.signIn("hannah", PW);
    const res = await t.request("/api/me/password", {
      cookies,
      body: { currentPassword: "not it at all", newPassword: "a brand new password" },
    });
    expect(res.status).toBe(400);
    expect(errorCode(res.body)).toBe("invalid_input");
    expect((await t.request("/api/me", { cookies })).status).toBe(200);
  });

  test("too short a new password is refused", async () => {
    const t = makeTestApp();
    await t.addUser("hannah", PW);
    const { cookies } = await t.signIn("hannah", PW);
    const res = await t.request("/api/me/password", {
      cookies,
      body: { currentPassword: PW, newPassword: "short" },
    });
    expect(errorCode(res.body)).toBe("invalid_input");
  });

  test("ends every other session, keeps this one, swaps the password", async () => {
    const t = makeTestApp();
    await t.addUser("hannah", PW);
    const mine = await t.signIn("hannah", PW);
    const other = await t.signIn("hannah", PW, { address: "198.51.100.7" });
    const res = await t.request("/api/me/password", {
      cookies: mine.cookies,
      body: { currentPassword: PW, newPassword: "a brand new password" },
    });
    expect(res.status).toBe(204);
    expect((await t.request("/api/me", { cookies: mine.cookies })).status).toBe(200);
    expect((await t.request("/api/me", { cookies: other.cookies })).status).toBe(401);
    const old = await t.request("/api/auth/login", { body: { username: "hannah", password: PW } });
    expect(old.status).toBe(401);
    await t.signIn("hannah", "a brand new password");
  });

  test("needs a browser session", async () => {
    const t = makeTestApp();
    await t.addUser("hannah", PW);
    const { cookies } = await t.signIn("hannah", PW);
    const created = await t.request("/api/keys", { cookies, body: { name: "a", scope: "write" } });
    const { secret } = created.body as { secret: string };
    const res = await t.request("/api/me/password", {
      bearer: secret,
      body: { currentPassword: PW, newPassword: "a brand new password" },
    });
    expect(res.status).toBe(403);
  });
});

describe("brute-force limits", () => {
  test("lock schedule doubles up to an hour", () => {
    expect(lockDuration(4)).toBe(0);
    expect(lockDuration(5)).toBe(BASE_LOCK_MS);
    expect(lockDuration(6)).toBe(2 * BASE_LOCK_MS);
    expect(lockDuration(11)).toBe(MAX_LOCK_MS);
    expect(lockDuration(500)).toBe(MAX_LOCK_MS);
  });

  test("an account locks after five failures, refuses even the right password, then expires", async () => {
    const t = makeTestApp();
    await t.addUser("hannah", PW);
    for (let i = 0; i < 5; i++) {
      // a different address each time, so only the account counter trips
      const res = await t.request("/api/auth/login", {
        body: { username: "hannah", password: "wrong password" },
        address: `198.51.100.${i}`,
      });
      expect(res.status).toBe(401);
    }
    const verify = vi.spyOn(t.hasher, "verify");
    const locked = await t.request("/api/auth/login", {
      body: { username: "hannah", password: PW },
      address: "198.51.100.99",
    });
    expect(locked.status).toBe(429);
    expect(errorCode(locked.body)).toBe("rate_limited");
    expect((locked.body as { error: { retryAfter: number } }).error.retryAfter).toBe(60);
    expect(locked.headers.get("retry-after")).toBe("60");
    expect(verify).not.toHaveBeenCalled();

    t.clock.advance(30_000);
    const still = await t.request("/api/auth/login", {
      body: { username: "hannah", password: PW },
      address: "198.51.100.99",
    });
    expect((still.body as { error: { retryAfter: number } }).error.retryAfter).toBe(30);

    t.clock.advance(30_001);
    const ok = await t.request("/api/auth/login", {
      body: { username: "hannah", password: PW },
      address: "198.51.100.99",
    });
    expect(ok.status).toBe(200);
  });

  test("the lock doubles on the next failure after it expires", async () => {
    const t = makeTestApp();
    await t.addUser("hannah", PW);
    const fail = (i: number) =>
      t.request("/api/auth/login", {
        body: { username: "hannah", password: "wrong password" },
        address: `198.51.100.${i}`,
      });
    for (let i = 0; i < 5; i++) await fail(i);
    t.clock.advance(BASE_LOCK_MS + 1);
    expect((await fail(10)).status).toBe(401);
    const res = await fail(11);
    expect(res.status).toBe(429);
    expect((res.body as { error: { retryAfter: number } }).error.retryAfter).toBe(120);
  });

  test("failures decay after a quiet day", async () => {
    const t = makeTestApp();
    await t.addUser("hannah", PW);
    const fail = (i: number) =>
      t.request("/api/auth/login", {
        body: { username: "hannah", password: "wrong password" },
        address: `198.51.100.${i}`,
      });
    for (let i = 0; i < 4; i++) await fail(i);
    t.clock.advance(25 * 60 * 60_000);
    for (let i = 0; i < 4; i++) expect((await fail(20 + i)).status).toBe(401);
    expect((await fail(30)).status).toBe(401); // fifth since the decay: locks now
    expect((await fail(31)).status).toBe(429);
  });

  test("unknown usernames lock exactly like real ones", async () => {
    const t = makeTestApp();
    await t.addUser("hannah", PW);
    const run = async (username: string, base: number) => {
      const statuses: number[] = [];
      for (let i = 0; i < 6; i++) {
        const res = await t.request("/api/auth/login", {
          body: { username, password: "wrong password" },
          address: `198.51.${base}.${i}`,
        });
        statuses.push(res.status);
      }
      return statuses;
    };
    expect(await run("nobody", 1)).toEqual(await run("hannah", 2));
  });

  test("an address locks after five failures across usernames", async () => {
    const t = makeTestApp();
    await t.addUser("hannah", PW);
    for (let i = 0; i < 5; i++) {
      await t.request("/api/auth/login", { body: { username: `user${i}`, password: "wrong pw" } });
    }
    const res = await t.request("/api/auth/login", { body: { username: "hannah", password: PW } });
    expect(res.status).toBe(429);
    const elsewhere = await t.request("/api/auth/login", {
      body: { username: "hannah", password: PW },
      address: "198.51.100.1",
    });
    expect(elsewhere.status).toBe(200);
  });

  test("a parallel burst cannot outrun the counter", async () => {
    const t = makeTestApp();
    await t.addUser("hannah", PW);
    const verify = vi.spyOn(t.hasher, "verify");
    const results = await Promise.all(
      Array.from({ length: 20 }, (_, i) =>
        t.request("/api/auth/login", {
          body: { username: "hannah", password: `guess ${i}` },
          address: `198.51.100.${i}`,
        }),
      ),
    );
    expect(verify.mock.calls.length).toBeLessThanOrEqual(5);
    expect(results.filter((r) => r.status === 429).length).toBeGreaterThanOrEqual(15);
  });

  test("a known device can still sign in while an attacker keeps the account locked", async () => {
    const t = makeTestApp();
    await t.addUser("hannah", PW);
    const { cookies } = await t.signIn("hannah", PW, { address: "192.0.2.1" });
    expect(cookies.nh_device).toMatch(/^[A-Za-z0-9_-]{43}$/);
    for (let i = 0; i < 8; i++) {
      t.clock.advance(MAX_LOCK_MS);
      await t.request("/api/auth/login", {
        body: { username: "hannah", password: "attacker guess" },
        address: `198.51.100.${i}`,
      });
    }
    const fresh = await t.request("/api/auth/login", {
      body: { username: "hannah", password: PW },
      address: "192.0.2.50",
    });
    expect(fresh.status).toBe(429);
    const known = await t.request("/api/auth/login", {
      body: { username: "hannah", password: PW },
      address: "192.0.2.50",
      cookies: { nh_device: cookies.nh_device as string },
    });
    expect(known.status).toBe(200);
  });

  test("a device cookie from another account does not bypass the lock", async () => {
    const t = makeTestApp();
    await t.addUser("hannah", PW);
    await t.addUser("mallory", PW);
    const { cookies } = await t.signIn("mallory", PW, { address: "192.0.2.1" });
    for (let i = 0; i < 5; i++) {
      await t.request("/api/auth/login", {
        body: { username: "hannah", password: "attacker guess" },
        address: `198.51.100.${i}`,
      });
    }
    const res = await t.request("/api/auth/login", {
      body: { username: "hannah", password: PW },
      address: "192.0.2.60",
      cookies: { nh_device: cookies.nh_device as string },
    });
    expect(res.status).toBe(429);
  });

  test("X-Forwarded-For is ignored unless the peer is a trusted proxy", async () => {
    const t = makeTestApp();
    await t.addUser("hannah", PW);
    // Untrusted peer rotating XFF: still one address.
    for (let i = 0; i < 5; i++) {
      await t.request("/api/auth/login", {
        body: { username: `u${i}x`, password: "wrong pw" },
        headers: { "x-forwarded-for": `10.0.0.${i}` },
      });
    }
    const res = await t.request("/api/auth/login", {
      body: { username: "hannah", password: PW },
      headers: { "x-forwarded-for": "10.9.9.9" },
    });
    expect(res.status).toBe(429);
  });

  test("behind a trusted proxy the right-most untrusted hop is the client", async () => {
    const t = makeTestApp({ env: { TRUSTED_PROXIES: "172.16.0.0/12" } });
    await t.addUser("hannah", PW);
    for (let i = 0; i < 5; i++) {
      await t.request("/api/auth/login", {
        body: { username: `u${i}x`, password: "wrong pw" },
        address: "172.18.0.2",
        // the attacker controls the left part; the proxy appended 198.51.100.66
        headers: { "x-forwarded-for": `1.1.1.${i}, 198.51.100.66` },
      });
    }
    const attacker = await t.request("/api/auth/login", {
      body: { username: "hannah", password: PW },
      address: "172.18.0.2",
      headers: { "x-forwarded-for": "9.9.9.9, 198.51.100.66, 172.18.0.5" },
    });
    expect(attacker.status).toBe(429);
    const someoneElse = await t.request("/api/auth/login", {
      body: { username: "hannah", password: PW },
      address: "172.18.0.2",
      headers: { "x-forwarded-for": "198.51.100.67" },
    });
    expect(someoneElse.status).toBe(200);
  });
});

describe("disabled users", () => {
  test("cannot sign in, and their sessions and keys stop at once", async () => {
    const t = makeTestApp();
    const user = await t.addUser("hannah", PW);
    const { cookies } = await t.signIn("hannah", PW);
    const created = await t.request("/api/keys", { cookies, body: { name: "a", scope: "read" } });
    const { secret } = created.body as { secret: string };
    expect((await t.request("/api/me", { bearer: secret })).status).toBe(200);

    setUserDisabled(t.db, user.id, true, t.clock.now());
    expect((await t.request("/api/me", { cookies })).status).toBe(401);
    expect((await t.request("/api/me", { bearer: secret })).status).toBe(401);
    const wrong = await t.request("/api/auth/login", {
      body: { username: "hannah", password: "wrong password" },
      address: "198.51.100.1",
    });
    const right = await t.request("/api/auth/login", {
      body: { username: "hannah", password: PW },
      address: "198.51.100.2",
    });
    expect(right.status).toBe(401);
    expect(right.body).toEqual(wrong.body);

    setUserDisabled(t.db, user.id, false, t.clock.now());
    expect((await t.request("/api/me", { bearer: secret })).status).toBe(200);
    expect((await t.request("/api/me", { cookies })).status).toBe(401); // sessions stay ended
  });
});

describe("origin check", () => {
  test("refuses a cross-site state change made with the session cookie", async () => {
    const t = makeTestApp();
    await t.addUser("hannah", PW);
    const { cookies } = await t.signIn("hannah", PW);
    const evil = await t.request("/api/auth/logout-all", {
      method: "POST",
      cookies,
      origin: "https://evil.example",
    });
    expect(evil.status).toBe(403);
    expect(errorCode(evil.body)).toBe("forbidden");
    expect((await t.request("/api/me", { cookies })).status).toBe(200);
    const nullOrigin = await t.request("/api/keys", {
      cookies,
      body: { name: "x", scope: "write" },
      origin: "null",
    });
    expect(nullOrigin.status).toBe(403);
    const crossSite = await t.request("/api/keys", {
      cookies,
      body: { name: "x", scope: "write" },
      origin: null,
      headers: { "sec-fetch-site": "cross-site" },
    });
    expect(crossSite.status).toBe(403);
    const sameOrigin = await t.request("/api/keys", {
      cookies,
      body: { name: "x", scope: "write" },
    });
    expect(sameOrigin.status).toBe(201);
    const noOrigin = await t.request("/api/keys", {
      cookies,
      body: { name: "y", scope: "write" },
      origin: null,
    });
    expect(noOrigin.status).toBe(201);
  });

  test("refuses a cross-site sign-in", async () => {
    const t = makeTestApp();
    await t.addUser("hannah", PW);
    const res = await t.request("/api/auth/login", {
      body: { username: "hannah", password: PW },
      origin: "https://evil.example",
    });
    expect(res.status).toBe(403);
  });

  test("GET is not checked; API-key requests are exempt", async () => {
    const t = makeTestApp();
    await t.addUser("hannah", PW);
    const { cookies } = await t.signIn("hannah", PW);
    const me = await t.request("/api/me", { cookies, headers: { origin: "https://evil.example" } });
    expect(me.status).toBe(200);
    const created = await t.request("/api/keys", { cookies, body: { name: "a", scope: "write" } });
    const { secret } = created.body as { secret: string };
    // a state-changing request with a key and a foreign Origin reaches the route (and is refused there for another reason)
    const res = await t.request("/api/keys", {
      bearer: secret,
      body: { name: "b", scope: "write" },
      origin: "https://evil.example",
    });
    expect(res.status).toBe(403);
    expect((res.body as { error: { message: string } }).error.message).toMatch(/browser session/);
  });
});
