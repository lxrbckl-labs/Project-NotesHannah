import { mkdirSync } from "node:fs";
import { describe, expect, test } from "vitest";
import { createFilesService } from "../src/domains/files/index.js";
import { FakeConverter, type Json, multipart, PDF, tempStorage, variant } from "./files.support.js";
import { errorCode, makeTestApp, ORIGIN } from "./helpers.js";

const PW = "correct horse battery";

/** The real app: real sign-in, API keys, Origin check and security headers. */
async function setup() {
  const { dir, storage } = tempStorage();
  const t = makeTestApp({ env: { DATA_DIR: dir } });
  await t.addUser("hannah", PW);
  await t.addUser("other", PW);
  const { cookies } = await t.signIn("hannah", PW);
  const key = async (scope: "read" | "write") => {
    const res = await t.request("/api/keys", { cookies, body: { name: scope, scope } });
    return (res.body as Json).secret as string;
  };
  const service = createFilesService(
    { config: t.config, db: t.db, now: t.clock.now },
    { storage, partialGraceMs: 0, log: () => {} },
  );
  const converter = new FakeConverter(storage.root);
  const cookie = Object.entries(cookies)
    .map(([k, v]) => `${k}=${v}`)
    .join("; ");
  return { t, dir, storage, cookies, cookie, key, service, converter };
}

async function raw(
  s: Awaited<ReturnType<typeof setup>>,
  path: string,
  init: RequestInit,
): Promise<{ status: number; body: Json; headers: Headers }> {
  const res = await s.t.app.request(path, init, {
    incoming: { socket: { remoteAddress: "203.0.113.10" } },
  });
  const text = await res.text();
  let body: Json = text;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    // keep text
  }
  return { status: res.status, body, headers: res.headers };
}

describe("files over the real app", () => {
  test("the app starts without a data volume; files routes then say storage_unavailable", async () => {
    const t = makeTestApp();
    await t.addUser("hannah", PW);
    const { cookies } = await t.signIn("hannah", PW);
    const res = await t.request("/api/converter/status", { cookies });
    expect(res.status).toBe(503);
    expect(errorCode(res.body)).toBe("storage_unavailable");
    // routes that do not touch storage still work
    expect((await t.request("/api/files", { cookies })).status).toBe(200);
  });

  test("browser upload with the session cookie, then the file, its pages and its original", async () => {
    const s = await setup();
    const m = multipart([{ name: "file", filename: "week1.pdf", data: PDF }]);
    const up = await raw(s, "/api/uploads", {
      method: "POST",
      headers: { cookie: s.cookie, origin: ORIGIN, "content-type": m.contentType },
      body: m.body,
    });
    expect(up.status).toBe(201);
    const file = up.body.file as Json;
    s.converter.succeed(s.converter.pending()[0] as string, { pages: 1 });
    s.service.processQueue();

    const get = await s.t.request(`/api/files/${file.id}`, { cookies: s.cookies });
    expect((get.body as Json).file.status).toBe("converted");
    const orig = await raw(s, `/api/files/${file.id}/original`, { headers: { cookie: s.cookie } });
    expect(orig.status).toBe(200);
    expect(orig.headers.get("content-type")).toBe("application/pdf");
    expect(orig.headers.get("etag")).toBe(`"${file.sha256}"`);
    // security headers still apply to file responses
    expect(orig.headers.get("x-content-type-options")).toBe("nosniff");
  });

  test("a cross-site upload with the cookie is refused by the Origin check", async () => {
    const s = await setup();
    const m = multipart([{ name: "file", filename: "a.pdf", data: PDF }]);
    const res = await raw(s, "/api/uploads", {
      method: "POST",
      headers: { cookie: s.cookie, origin: "https://evil.example", "content-type": m.contentType },
      body: m.body,
    });
    expect(res.status).toBe(403);
    expect(errorCode(res.body)).toBe("forbidden");
  });

  test("agent links: a key requests, anyone holding the URL uploads once, with no credentials and no Origin", async () => {
    const s = await setup();
    const secret = await s.key("write");
    const ticket = await s.t.request("/api/uploads/tickets", {
      bearer: secret,
      body: { files: [{ name: "agent.pdf", bytes: 5000 }] },
    });
    expect(ticket.status).toBe(201);
    const { url } = (ticket.body as Json).items[0] as { url: string };
    expect(url.startsWith(`${ORIGIN}/api/uploads/`)).toBe(true);
    const path = new URL(url).pathname;

    // curl-style: no cookie, no Authorization, no Origin
    const put = await raw(s, path, { method: "PUT", body: PDF });
    expect(put.status).toBe(201);
    expect(put.body.file.uploadedBy.type).toBe("agent");
    expect((await raw(s, path, { method: "PUT", body: PDF })).status).toBe(409);

    // a browser on another site cannot use it (the Origin check applies to a PUT that sends an Origin)
    const t2 = await s.t.request("/api/uploads/tickets", {
      bearer: secret,
      body: { files: [{ name: "b.pdf", bytes: 5000 }] },
    });
    const path2 = new URL(((t2.body as Json).items[0] as Json).url).pathname;
    const cross = await raw(s, path2, {
      method: "PUT",
      headers: { origin: "https://evil.example" },
      body: variant(PDF, "x"),
    });
    expect(cross.status).toBe(403);
    // …and a failed Origin check did not spend the ticket
    expect((await raw(s, path2, { method: "PUT", body: variant(PDF, "x") })).status).toBe(201);
    // a stray bad Authorization header does not matter either
    const t3 = await s.t.request("/api/uploads/tickets", {
      bearer: secret,
      body: { files: [{ name: "c.pdf", bytes: 5000 }] },
    });
    const path3 = new URL(((t3.body as Json).items[0] as Json).url).pathname;
    expect(
      (
        await raw(s, path3, {
          method: "PUT",
          headers: { authorization: "Bearer nope" },
          body: variant(PDF, "y"),
        })
      ).status,
    ).toBe(201);
    mkdirSync(s.dir, { recursive: true });
  });

  test("read-only keys can list but not upload links; users are separate", async () => {
    const s = await setup();
    const ro = await s.key("read");
    expect((await s.t.request("/api/files", { bearer: ro })).status).toBe(200);
    const res = await s.t.request("/api/uploads/tickets", {
      bearer: ro,
      body: { files: [{ name: "a.pdf", bytes: 5 }] },
    });
    expect(errorCode(res.body)).toBe("read_only_key");
    const other = await s.t.signIn("other", PW);
    const list = await s.t.request("/api/files", { cookies: other.cookies });
    expect((list.body as Json).items).toEqual([]);
  });
});
