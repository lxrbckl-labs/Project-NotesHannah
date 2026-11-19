import { BackgroundMeta } from "@notes/schema";
import { describe, expect, test } from "vitest";
import { errorCode, makeTestApp, ORIGIN } from "./helpers.js";

const PW = "correct horse battery";
/** The first bytes of a PNG, then filler: enough for the server to recognize the kind. */
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4, 5, 6]);

async function setup() {
  const t = makeTestApp();
  await t.addUser("hannah", PW);
  await t.addUser("bea", PW);
  const hannah = (await t.signIn("hannah", PW)).cookies;
  const bea = (await t.signIn("bea", PW)).cookies;
  const cookie = (c: Record<string, string>) =>
    Object.entries(c)
      .map(([k, v]) => `${k}=${v}`)
      .join("; ");
  const put = (c: Record<string, string>, bytes: Uint8Array) =>
    t.app.request("/api/me/background", {
      method: "PUT",
      headers: { cookie: cookie(c), origin: ORIGIN, "content-type": "application/octet-stream" },
      body: bytes,
    });
  const meta = async (c: Record<string, string>) =>
    BackgroundMeta.parse((await t.request("/api/me/background/meta", { cookies: c })).body);
  return { t, hannah, bea, put, meta, cookie };
}

describe("her background picture", () => {
  test("none to begin with; saving one gives it back byte for byte, to her only", async () => {
    const { t, hannah, bea, put, meta, cookie } = await setup();
    expect((await meta(hannah)).updatedAt).toBeNull();
    expect((await t.request("/api/me/background", { cookies: hannah })).status).toBe(404);

    const saved = await put(hannah, PNG);
    expect(saved.status).toBe(200);
    expect(typeof (await meta(hannah)).updatedAt).toBe("number");

    const got = await t.app.request("/api/me/background", { headers: { cookie: cookie(hannah) } });
    expect(got.status).toBe(200);
    expect(got.headers.get("content-type")).toBe("image/png");
    expect(new Uint8Array(await got.arrayBuffer())).toEqual(PNG);

    // Each account has its own.
    expect((await meta(bea)).updatedAt).toBeNull();
    expect((await t.request("/api/me/background", { cookies: bea })).status).toBe(404);
  });

  test("refuses something that is not a picture, whatever it says it is", async () => {
    const { hannah, put, meta } = await setup();
    const res = await put(hannah, new TextEncoder().encode("<svg onload=alert(1)>"));
    expect(res.status).toBe(400);
    expect(errorCode(await res.json())).toBe("invalid_input");
    expect((await meta(hannah)).updatedAt).toBeNull();
  });

  test("removing it goes back to none", async () => {
    const { t, hannah, put, meta } = await setup();
    await put(hannah, PNG);
    const res = await t.request("/api/me/background", { method: "DELETE", cookies: hannah });
    expect(res.status).toBe(200);
    expect((await meta(hannah)).updatedAt).toBeNull();
  });

  test("needs a sign-in", async () => {
    const { t } = await setup();
    expect((await t.request("/api/me/background/meta")).status).toBe(401);
    expect((await t.request("/api/me/background")).status).toBe(401);
  });
});
