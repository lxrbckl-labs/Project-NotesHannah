import { DEFAULT_TAB_ORDER, PreferencesResponse, resolveTabOrder, TAB_IDS } from "@notes/schema";
import { describe, expect, test } from "vitest";
import { errorCode, makeTestApp } from "./helpers.js";

const PW = "correct horse battery";
const ODD = ["settings", "library", "practice", "search", "inbox"];

async function setup() {
  const t = makeTestApp();
  await t.addUser("hannah", PW);
  await t.addUser("bea", PW);
  const hannah = (await t.signIn("hannah", PW)).cookies;
  const bea = (await t.signIn("bea", PW)).cookies;
  const get = async (cookies: Record<string, string>) =>
    PreferencesResponse.parse((await t.request("/api/me/preferences", { cookies })).body)
      .preferences;
  const patch = (cookies: Record<string, string>, body: unknown) =>
    t.request("/api/me/preferences", { method: "PATCH", cookies, body });
  return { t, hannah, bea, get, patch };
}

describe("the order rule (resolveTabOrder)", () => {
  test("nothing saved, or an empty list, is the default order", () => {
    expect(resolveTabOrder(undefined)).toEqual([...DEFAULT_TAB_ORDER]);
    expect(resolveTabOrder(null)).toEqual([...DEFAULT_TAB_ORDER]);
    expect(resolveTabOrder([])).toEqual([...DEFAULT_TAB_ORDER]);
  });

  test("a tab added to the app after she saved shows at the end, in default order", () => {
    // An order saved when only three tabs existed.
    expect(resolveTabOrder(["settings", "library", "search"])).toEqual([
      "settings",
      "library",
      "search",
      "practice",
      "inbox",
    ]);
  });

  test("ids that are no longer tabs and repeats are dropped", () => {
    expect(resolveTabOrder(["gone", "inbox", "inbox", 7, "library"])).toEqual([
      "inbox",
      "library",
      "practice",
      "search",
      "settings",
    ]);
  });
});

describe("GET and PATCH /api/me/preferences", () => {
  test("a new account has the default order", async () => {
    const { get, hannah } = await setup();
    expect((await get(hannah)).tabOrder).toEqual([...TAB_IDS]);
  });

  test("saves a complete order and returns it", async () => {
    const { get, patch, hannah } = await setup();
    const res = await patch(hannah, { tabOrder: ODD });
    expect(res.status).toBe(200);
    expect(PreferencesResponse.parse(res.body).preferences.tabOrder).toEqual(ODD);
    expect((await get(hannah)).tabOrder).toEqual(ODD);
  });

  test("refuses repeats, unknown ids, missing ids, extra ids and other fields", async () => {
    const { get, patch, hannah } = await setup();
    const bad: unknown[] = [
      { tabOrder: ["library", "library", "practice", "search", "inbox"] },
      { tabOrder: ["library", "practice", "search", "inbox", "trash"] },
      { tabOrder: ["library", "practice", "search", "inbox"] },
      { tabOrder: [...ODD, "library"] },
      { tabOrder: "settings" },
      { theme: "dark" },
    ];
    for (const body of bad) {
      const res = await patch(hannah, body);
      expect(res.status, JSON.stringify(body)).toBe(400);
      expect(errorCode(res.body)).toBe("invalid_input");
    }
    expect((await get(hannah)).tabOrder).toEqual([...TAB_IDS]);
  });

  test("null or an empty list puts the default back; an empty patch changes nothing", async () => {
    const { get, patch, hannah } = await setup();
    await patch(hannah, { tabOrder: ODD });
    await patch(hannah, {});
    expect((await get(hannah)).tabOrder).toEqual(ODD);
    await patch(hannah, { tabOrder: [] });
    expect((await get(hannah)).tabOrder).toEqual([...TAB_IDS]);
    await patch(hannah, { tabOrder: ODD });
    await patch(hannah, { tabOrder: null });
    expect((await get(hannah)).tabOrder).toEqual([...TAB_IDS]);
  });

  test("each account has its own order", async () => {
    const { get, patch, hannah, bea } = await setup();
    await patch(hannah, { tabOrder: ODD });
    expect((await get(bea)).tabOrder).toEqual([...TAB_IDS]);
    const other = [...ODD].reverse();
    await patch(bea, { tabOrder: other });
    expect((await get(hannah)).tabOrder).toEqual(ODD);
    expect((await get(bea)).tabOrder).toEqual(other);
  });

  test("survives signing out and signing in again, and shows on a second device", async () => {
    const { t, get, patch, hannah } = await setup();
    await patch(hannah, { tabOrder: ODD });
    const out = await t.request("/api/auth/logout", { method: "POST", cookies: hannah });
    expect(out.status).toBe(204);
    expect((await t.request("/api/me/preferences", { cookies: hannah })).status).toBe(401);
    const again = (await t.signIn("hannah", PW)).cookies;
    expect((await get(again)).tabOrder).toEqual(ODD);
  });

  test("a saved order that predates a tab is completed on read, and not rewritten", async () => {
    const { t, get, hannah } = await setup();
    const user = t.db.prepare("SELECT id FROM users WHERE username = 'hannah'").get() as {
      id: string;
    };
    t.db
      .prepare("INSERT INTO user_preferences (user_id, doc, updated_at) VALUES (?, ?, 0)")
      .run(user.id, JSON.stringify({ tabOrder: ["settings", "library", "search"] }));
    expect((await get(hannah)).tabOrder).toEqual([
      "settings",
      "library",
      "search",
      "practice",
      "inbox",
    ]);
    const row = t.db.prepare("SELECT doc FROM user_preferences").get() as { doc: string };
    expect(JSON.parse(row.doc)).toEqual({ tabOrder: ["settings", "library", "search"] });
  });

  test("needs a sign-in, a same-origin change, and a browser session (not an API key)", async () => {
    const { t, hannah } = await setup();
    expect((await t.request("/api/me/preferences")).status).toBe(401);
    const noOrigin = await t.request("/api/me/preferences", {
      method: "PATCH",
      cookies: hannah,
      body: { tabOrder: ODD },
      origin: "https://evil.example",
    });
    expect(noOrigin.status).toBe(403);
    const made = await t.request("/api/keys", {
      cookies: hannah,
      body: { name: "Claude Code", scope: "write" },
    });
    const secret = (made.body as { secret: string }).secret;
    const read = await t.request("/api/me/preferences", { bearer: secret });
    expect(read.status).toBe(403);
    const write = await t.request("/api/me/preferences", {
      method: "PATCH",
      bearer: secret,
      body: { tabOrder: ODD },
    });
    expect(write.status).toBe(403);
  });
});
