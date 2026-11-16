import { API_KEY_PATTERN, ApiKey, CreatedApiKey } from "@notes/schema";
import { Hono } from "hono";
import { describe, expect, test } from "vitest";
import { type AppEnv, getAuth, requireWrite } from "../src/http/auth-context.js";
import { authenticate } from "../src/http/authenticate.js";
import { handleError } from "../src/http/errors.js";
import { errorCode, makeTestApp } from "./helpers.js";

const PW = "correct horse battery";

async function setup() {
  const t = makeTestApp();
  const user = await t.addUser("hannah", PW);
  const { cookies } = await t.signIn("hannah", PW);
  const create = async (name: string, scope: "read" | "write", c = cookies) => {
    const res = await t.request("/api/keys", { cookies: c, body: { name, scope } });
    expect(res.status).toBe(201);
    return CreatedApiKey.parse(res.body);
  };
  return { t, user, cookies, create };
}

/** A tiny app with the real `authenticate` and a dummy write route, to test scopes. */
function probe(t: ReturnType<typeof makeTestApp>) {
  const app = new Hono<AppEnv>();
  app.onError(handleError);
  app.use("*", authenticate({ config: t.config, db: t.db, now: t.clock.now, hasher: t.hasher }));
  app.get("/whoami", (c) => c.json(getAuth(c)));
  app.post("/write", requireWrite, (c) => c.json({ ok: true }));
  return app;
}

describe("API keys", () => {
  test("create returns the secret once, in the documented format", async () => {
    const { t, user, create } = await setup();
    const created = await create("Claude Code", "write");
    expect(created.secret).toMatch(API_KEY_PATTERN);
    expect(created.secret.startsWith("nh_write_")).toBe(true);
    expect(created.key.preview).toBe(created.secret.slice(0, 12));
    expect(created.key.userId).toBe(user.id);
    expect(created.key.lastUsedAt).toBeNull();
    const read = await create("reader", "read");
    expect(read.secret).toMatch(/^nh_read_[A-Za-z0-9_-]{43}$/);
    // stored only as a hash
    const dump = JSON.stringify(t.db.prepare("SELECT * FROM api_keys").all());
    expect(dump).not.toContain(created.secret);
    expect(dump).not.toContain(created.secret.slice(12));
  });

  test("list is newest first, includes revoked keys, and never shows the secret", async () => {
    const { t, cookies, create } = await setup();
    const a = await create("first", "read");
    t.clock.advance(1000);
    const b = await create("second", "write");
    await t.request(`/api/keys/${a.key.id}`, { method: "DELETE", cookies });
    const res = await t.request("/api/keys", { cookies });
    expect(res.status).toBe(200);
    const items = (res.body as { items: unknown[] }).items.map((k) => ApiKey.parse(k));
    expect(items.map((k) => k.id)).toEqual([b.key.id, a.key.id]);
    expect(items[1]?.revokedAt).not.toBeNull();
    expect(JSON.stringify(res.body)).not.toContain(a.secret);
    expect(JSON.stringify(res.body)).not.toContain("secret");
  });

  test("bearer key authenticates as an agent with the key's scope and label", async () => {
    const { t, user, create } = await setup();
    const { key, secret } = await create("Claude Code", "read");
    const app = probe(t);
    const res = await app.request("/whoami", {
      headers: { authorization: `Bearer ${secret}`, "x-agent-label": "Claude Code" },
    });
    expect(await res.json()).toEqual({
      userId: user.id,
      actor: { type: "agent", keyId: key.id, label: "Claude Code" },
      via: "key",
      scope: "read",
    });
    const me = await t.request("/api/me", { bearer: secret });
    expect((me.body as { user: { id: string } }).user.id).toBe(user.id);
  });

  test("agent labels over 80 characters are refused", async () => {
    const { t, create } = await setup();
    const { secret } = await create("a", "read");
    const res = await probe(t).request("/whoami", {
      headers: { authorization: `Bearer ${secret}`, "x-agent-label": "x".repeat(81) },
    });
    expect(res.status).toBe(400);
    const ok = await probe(t).request("/whoami", {
      headers: { authorization: `Bearer ${secret}`, "x-agent-label": "x".repeat(80) },
    });
    expect(ok.status).toBe(200);
  });

  test("a read key cannot write; a write key and a session can", async () => {
    const { t, cookies, create } = await setup();
    const read = await create("r", "read");
    const write = await create("w", "write");
    const app = probe(t);
    const r = await app.request("/write", {
      method: "POST",
      headers: { authorization: `Bearer ${read.secret}` },
    });
    expect(r.status).toBe(403);
    expect(errorCode(await r.json())).toBe("read_only_key");
    const w = await app.request("/write", {
      method: "POST",
      headers: { authorization: `Bearer ${write.secret}` },
    });
    expect(w.status).toBe(200);
    const s = await app.request("/write", {
      method: "POST",
      headers: { cookie: `nh_session=${cookies.nh_session}` },
    });
    expect(s.status).toBe(200);
    const none = await app.request("/write", { method: "POST" });
    expect(none.status).toBe(401);
  });

  test("a revoked key is refused immediately", async () => {
    const { t, cookies, create } = await setup();
    const { key, secret } = await create("a", "write");
    expect((await t.request("/api/me", { bearer: secret })).status).toBe(200);
    const del = await t.request(`/api/keys/${key.id}`, { method: "DELETE", cookies });
    expect(del.status).toBe(204);
    const after = await t.request("/api/me", { bearer: secret });
    expect(after.status).toBe(401);
    expect(errorCode(after.body)).toBe("unauthenticated");
    // revoking again is harmless
    expect((await t.request(`/api/keys/${key.id}`, { method: "DELETE", cookies })).status).toBe(
      204,
    );
  });

  test("bad bearer values are unauthenticated and never fall back to the cookie", async () => {
    const { t, cookies, create } = await setup();
    const { secret } = await create("a", "write");
    for (const bearer of [
      `nh_write_${"A".repeat(43)}`,
      secret.replace("nh_write_", "nh_read_"),
      `${secret}x`,
      "garbage",
    ]) {
      const res = await t.request("/api/me", { bearer, cookies });
      expect(res.status).toBe(401);
    }
    const lower = await t.request("/api/me", { headers: { authorization: `bearer ${secret}` } });
    expect(lower.status).toBe(200);
  });

  test("lastUsedAt is written at most once a minute", async () => {
    const { t, cookies, create } = await setup();
    const { key, secret } = await create("a", "read");
    const lastUsed = () =>
      (
        t.db.prepare("SELECT last_used_at FROM api_keys WHERE id = ?").get(key.id) as {
          last_used_at: number | null;
        }
      ).last_used_at;
    const first = t.clock.ms;
    await t.request("/api/me", { bearer: secret });
    expect(lastUsed()).toBe(first);
    t.clock.advance(30_000);
    await t.request("/api/me", { bearer: secret });
    expect(lastUsed()).toBe(first);
    t.clock.advance(30_000);
    await t.request("/api/me", { bearer: secret });
    expect(lastUsed()).toBe(first + 60_000);
    const list = await t.request("/api/keys", { cookies });
    const items = (list.body as { items: ApiKey[] }).items;
    expect(items[0]?.lastUsedAt).toBe(new Date(first + 60_000).toISOString());
  });

  test("key routes refuse API keys", async () => {
    const { t, create } = await setup();
    const { key, secret } = await create("a", "write");
    for (const [method, path, body] of [
      ["GET", "/api/keys", undefined],
      ["POST", "/api/keys", { name: "b", scope: "write" }],
      ["DELETE", `/api/keys/${key.id}`, undefined],
    ] as const) {
      const res = await t.request(path, { method, bearer: secret, body });
      expect(res.status).toBe(403);
      expect(errorCode(res.body)).toBe("forbidden");
    }
    expect((await t.request("/api/me", { bearer: secret })).status).toBe(200);
  });

  test("key routes need sign-in", async () => {
    const { t } = await setup();
    expect((await t.request("/api/keys")).status).toBe(401);
  });

  test("user A cannot see or revoke user B's keys", async () => {
    const { t, cookies: aliceCookies, create } = await setup();
    await t.addUser("bob", PW);
    const bob = await t.signIn("bob", PW, { address: "198.51.100.200" });
    const bobKey = await create("bob's", "write", bob.cookies);
    await create("alice's", "write");
    const list = await t.request("/api/keys", { cookies: aliceCookies });
    const ids = (list.body as { items: ApiKey[] }).items.map((k) => k.id);
    expect(ids).not.toContain(bobKey.key.id);
    const del = await t.request(`/api/keys/${bobKey.key.id}`, {
      method: "DELETE",
      cookies: aliceCookies,
    });
    expect(del.status).toBe(404);
    expect(errorCode(del.body)).toBe("not_found");
    expect((await t.request("/api/me", { bearer: bobKey.secret })).status).toBe(200);
    const junk = await t.request("/api/keys/not-an-id", {
      method: "DELETE",
      cookies: aliceCookies,
    });
    expect(junk.status).toBe(404);
  });

  test("invalid create bodies are refused", async () => {
    const { t, cookies } = await setup();
    for (const body of [
      { name: "", scope: "write" },
      { name: "a", scope: "admin" },
      { name: "a" },
    ]) {
      const res = await t.request("/api/keys", { cookies, body });
      expect(errorCode(res.body)).toBe("invalid_input");
    }
  });
});
