import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { UPLOAD_LIMITS } from "@notes/schema";
import { describe, expect, test } from "vitest";
import { sanitizeFileName } from "../src/domains/files/names.js";
import {
  DOCX,
  HEIC,
  harness,
  JPEG,
  type Json,
  listDir,
  multipart,
  PDF,
  PNG,
  PPTX,
  variant,
  zip,
} from "./files.support.js";

const hasBadChar = (s: string): boolean =>
  [...s].some(
    (ch) => ch === "/" || ch === "\\" || (ch.codePointAt(0) ?? 0) < 0x20 || ch === "\u202e",
  );
const sha = (b: Buffer) => createHash("sha256").update(b).digest("hex");

describe("browser upload", () => {
  test.each([
    ["pdf", PDF],
    ["pptx", PPTX],
    ["jpeg", JPEG],
    ["png", PNG],
    ["heic", HEIC],
  ] as const)("a real %s is accepted, stored by content hash and queued", async (type, data) => {
    const h = harness();
    const file = await h.upload(h.alice, data, `slides.${type}`);
    expect(file).toMatchObject({
      type,
      status: "converting",
      bytes: data.length,
      sha256: sha(data),
      userId: h.alice,
      nodeId: null,
      originalName: `slides.${type}`,
    });
    expect(file.uploadedBy).toMatchObject({ type: "user", userId: h.alice });
    // original at originals/<user>/<sha256>, byte for byte
    const stored = join(h.dir, "originals", h.alice, sha(data));
    expect(readFileSync(stored).equals(data)).toBe(true);
    // a job file with the protocol fields
    const [jobId] = h.converter.pending();
    expect(h.converter.job(jobId as string)).toMatchObject({
      userId: h.alice,
      fileId: file.id,
      sha256: sha(data),
      attempt: 0,
    });
    expect(listDir(join(h.dir, "queue", "pending")).filter((n) => !n.endsWith(".json"))).toEqual(
      [],
    );
    expect(listDir(join(h.dir, "tmp"))).toEqual([]);
  });

  test("the type comes from the content, whatever the name and content type claim", async () => {
    const h = harness();
    const m = multipart([
      {
        name: "file",
        filename: "totally-a.pdf",
        type: "application/pdf",
        data: Buffer.from("MZ not a pdf at all, just text".repeat(50)),
      },
    ]);
    const res = await h.send(h.alice, "POST", "/api/uploads", {
      body: m.body,
      headers: { "content-type": m.contentType },
    });
    expect(res.status).toBe(415);
    expect(res.body.error.code).toBe("unsupported_type");
    expect(res.body.error.hint).toMatch(/PDF, PPTX, JPEG, PNG or HEIC/);
    expect(listDir(join(h.dir, "tmp"))).toEqual([]);
    expect(h.converter.pending()).toEqual([]);
    expect(listDir(join(h.dir, "originals"))).toEqual([]);
  });

  test("a PNG named .pdf is a png; a docx (zip without a presentation) and an empty file are refused", async () => {
    const h = harness();
    const png = await h.upload(h.alice, PNG, "scan.pdf");
    expect(png.type).toBe("png");
    for (const data of [DOCX, Buffer.alloc(0), zip({ "a.txt": "hi" })]) {
      const m = multipart([{ name: "file", filename: "x.pptx", data }]);
      const res = await h.send(h.alice, "POST", "/api/uploads", {
        body: m.body,
        headers: { "content-type": m.contentType },
      });
      expect(res.body.error.code).toBe("unsupported_type");
    }
    expect(listDir(join(h.dir, "tmp"))).toEqual([]);
  });

  test("too large is refused while streaming and leaves nothing in tmp", async () => {
    const h = harness({ maxUploadBytes: 100_000 });
    // 1 MB of stream, produced lazily in 64 KB chunks, with a valid PDF header.
    const boundary = "xx";
    let sent = 0;
    let pulled = 0;
    const stream = new ReadableStream<Uint8Array>({
      pull(controller) {
        pulled++;
        if (sent === 0) {
          controller.enqueue(
            Buffer.concat([
              Buffer.from(
                `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="big.pdf"\r\n\r\n`,
              ),
              PDF,
            ]),
          );
          sent = 1;
        } else if (sent < 16) {
          controller.enqueue(Buffer.alloc(64 * 1024, 1));
          sent++;
        } else {
          controller.enqueue(Buffer.from(`\r\n--${boundary}--\r\n`));
          controller.close();
        }
      },
    });
    const res = await h.send(h.alice, "POST", "/api/uploads", {
      body: stream,
      headers: { "content-type": `multipart/form-data; boundary=${boundary}` },
    });
    expect(res.status).toBe(413);
    expect(res.body.error.code).toBe("too_large");
    // aborted before the whole megabyte was read
    expect(pulled).toBeLessThan(16);
    expect(listDir(join(h.dir, "tmp"))).toEqual([]);
    expect(listDir(join(h.dir, "originals"))).toEqual([]);
  });

  test("a declared Content-Length over the limit is refused before reading", async () => {
    const h = harness({ maxUploadBytes: 1000 });
    const m = multipart([{ name: "file", filename: "a.pdf", data: PDF }]);
    const res = await h.send(h.alice, "POST", "/api/uploads", {
      body: m.body,
      headers: { "content-type": m.contentType, "content-length": "999999" },
    });
    expect(res.body.error.code).toBe("too_large");
  });

  test("identical content reuses the original but gets its own record and job", async () => {
    const h = harness();
    const a = await h.upload(h.alice, PDF, "one.pdf");
    const b = await h.upload(h.alice, PDF, "two.pdf");
    expect(a.id).not.toBe(b.id);
    expect(a.sha256).toBe(b.sha256);
    expect(listDir(join(h.dir, "originals", h.alice))).toEqual([sha(PDF)]);
    expect(h.converter.pending()).toHaveLength(2);
    expect(listDir(join(h.dir, "tmp"))).toEqual([]);
    // another user's identical bytes are stored separately
    await h.upload(h.bob, PDF, "mine.pdf");
    expect(listDir(join(h.dir, "originals", h.bob))).toEqual([sha(PDF)]);
  });

  test("optional nodeId files the upload under a lecture; a bad target is refused", async () => {
    const h = harness();
    const lecture = h.lecture(h.alice);
    const file = await h.upload(h.alice, PDF, "a.pdf", [{ name: "nodeId", data: lecture }]);
    expect(file.nodeId).toBe(lecture);
    // field after the file part works too
    const m = multipart([
      { name: "file", filename: "b.pdf", data: variant(PDF, "b") },
      { name: "nodeId", data: lecture },
    ]);
    const res = await h.send(h.alice, "POST", "/api/uploads", {
      body: m.body,
      headers: { "content-type": m.contentType },
    });
    expect(res.body.file.nodeId).toBe(lecture);

    // someone else's node, and a term, are refused and nothing is left behind
    const bobsLecture = h.lecture(h.bob);
    const other = multipart([
      { name: "file", filename: "c.pdf", data: variant(PDF, "c") },
      { name: "nodeId", data: bobsLecture },
    ]);
    const refused = await h.send(h.alice, "POST", "/api/uploads", {
      body: other.body,
      headers: { "content-type": other.contentType },
    });
    expect(refused.body.error.code).toBe("not_found");
    expect(listDir(join(h.dir, "tmp"))).toEqual([]);
    const term = h.library.list(h.alice, {}).items[0]?.id as string;
    const t = multipart([
      { name: "nodeId", data: term },
      { name: "file", filename: "d.pdf", data: variant(PDF, "d") },
    ]);
    const bad = await h.send(h.alice, "POST", "/api/uploads", {
      body: t.body,
      headers: { "content-type": t.contentType },
    });
    expect(bad.body.error.code).toBe("invalid_input");
    expect(bad.body.error.hint).toMatch(/lecture/);
  });

  test("a request without a file, or with two, or not multipart, is invalid_input", async () => {
    const h = harness();
    const none = multipart([{ name: "nodeId", data: "x" }]);
    const r1 = await h.send(h.alice, "POST", "/api/uploads", {
      body: none.body,
      headers: { "content-type": none.contentType },
    });
    expect(r1.body.error.code).toBe("invalid_input");
    const two = multipart([
      { name: "file", filename: "a.pdf", data: PDF },
      { name: "file", filename: "b.pdf", data: PDF },
    ]);
    const r2 = await h.send(h.alice, "POST", "/api/uploads", {
      body: two.body,
      headers: { "content-type": two.contentType },
    });
    expect(r2.body.error.code).toBe("invalid_input");
    const r3 = await h.send(h.alice, "POST", "/api/uploads", {
      body: PDF,
      headers: { "content-type": "application/pdf" },
    });
    expect(r3.body.error.code).toBe("invalid_input");
    const cut = multipart([{ name: "file", filename: "a.pdf", data: PDF }]);
    const r4 = await h.send(h.alice, "POST", "/api/uploads", {
      body: cut.body.subarray(0, cut.body.length - 40),
      headers: { "content-type": cut.contentType },
    });
    expect(r4.body.error.code).toBe("invalid_input");
    expect(listDir(join(h.dir, "tmp"))).toEqual([]);
  });

  test("a large multipart body split into odd chunks arrives intact", async () => {
    const h = harness();
    const data = Buffer.concat([PDF, Buffer.alloc(300_000, 9)]);
    const m = multipart([
      { name: "nodeId", data: "" },
      { name: "file", filename: "big.pdf", data },
    ]);
    let at = 0;
    const stream = new ReadableStream<Uint8Array>({
      pull(controller) {
        if (at >= m.body.length) return controller.close();
        const size = 1 + ((at * 7) % 5000); // irregular chunk sizes, some tiny
        controller.enqueue(m.body.subarray(at, at + size));
        at += size;
      },
    });
    const res = await h.send(h.alice, "POST", "/api/uploads", {
      body: stream,
      headers: { "content-type": m.contentType },
    });
    expect(res.status).toBe(201);
    expect(res.body.file.sha256).toBe(sha(data));
    expect(readFileSync(join(h.dir, "originals", h.alice, sha(data))).equals(data)).toBe(true);
  });

  test("read-only keys cannot upload; no sign-in is refused", async () => {
    const h = harness();
    const m = multipart([{ name: "file", filename: "a.pdf", data: PDF }]);
    const init = { body: m.body, headers: { "content-type": m.contentType } };
    const ro = await h.send(
      { user: h.alice, via: "key", scope: "read" },
      "POST",
      "/api/uploads",
      init,
    );
    expect(ro.body.error.code).toBe("read_only_key");
    const anon = await h.send(null, "POST", "/api/uploads", init);
    expect(anon.body.error.code).toBe("unauthenticated");
    expect(listDir(join(h.dir, "originals"))).toEqual([]);
  });
});

describe("file names are harmless", () => {
  test.each([
    ["../../etc/passwd", "passwd"],
    ["..\\..\\windows\\system32.pdf", "system32.pdf"],
    ["/abs/path/file.pdf", "file.pdf"],
    ["a\u0000b\r\nc‮D.pdf", "a b c D.pdf"],
    ["...hidden", "hidden"],
    ["", "file"],
    ["   ", "file"],
  ])("%j", (raw, _) => {
    const clean = sanitizeFileName(raw);
    expect(hasBadChar(clean)).toBe(false);
    expect(clean.startsWith(".")).toBe(false);
    expect(clean.length).toBeGreaterThan(0);
  });

  test("a very long name is shortened and keeps its extension", () => {
    const clean = sanitizeFileName(`${"x".repeat(5000)}.pdf`);
    expect([...clean].length).toBeLessThanOrEqual(200);
    expect(clean.endsWith(".pdf")).toBe(true);
  });

  test("hostile names upload fine, are stored cleaned, and never touch the path", async () => {
    const h = harness();
    const names = [
      "../../../evil.pdf",
      `${"y".repeat(3000)}.pdf`,
      "tab\there\u0007bell.pdf",
      "emoji 🧪 note.pdf",
    ];
    for (const [i, name] of names.entries()) {
      const file = await h.upload(h.alice, variant(PDF, `n${i}`), name);
      expect(hasBadChar(file.originalName)).toBe(false);
      expect([...file.originalName].length).toBeLessThanOrEqual(255);
    }
    expect(existsSync(join(h.dir, "evil.pdf"))).toBe(false);
    for (const entry of listDir(join(h.dir, "originals", h.alice)))
      expect(entry).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe("agent upload links", () => {
  const FILES = { files: [{ name: "agent.pdf", bytes: 10_000 }] };

  async function ticket(
    h: ReturnType<typeof harness>,
    body: Json = FILES,
    who: Json = h.agent(h.alice),
  ) {
    const res = await h.call(who, "POST", "/api/uploads/tickets", body);
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    return res.body.items[0] as Json;
  }
  const put = (h: ReturnType<typeof harness>, url: string, data: Buffer | null) =>
    h.send(null, "PUT", new URL(url).pathname, { body: data });

  test("a ticket is returned with a URL under APP_ORIGIN, and accepts one PUT with no credentials", async () => {
    const h = harness();
    const t = await ticket(h);
    expect(t.url).toMatch(/^http:\/\/localhost:5173\/api\/uploads\/[A-Za-z0-9_-]{43}$/);
    expect(t).toMatchObject({ method: "PUT", name: "agent.pdf", maxBytes: 10_000 });
    expect(Date.parse(t.expiresAt) - h.clock.now()).toBe(UPLOAD_LIMITS.linkTtlSeconds * 1000);

    const res = await put(h, t.url, PDF);
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    expect(res.body.file).toMatchObject({
      userId: h.alice,
      type: "pdf",
      originalName: "agent.pdf",
      status: "converting",
    });
    expect(res.body.file.uploadedBy).toMatchObject({ type: "agent", label: "Test agent" });
    expect(h.converter.pending()).toHaveLength(1);
  });

  test("single use: a second PUT is refused, also after a failed first attempt", async () => {
    const h = harness();
    const t = await ticket(h);
    expect((await put(h, t.url, PDF)).status).toBe(201);
    const again = await put(h, t.url, variant(PDF, "2"));
    expect(again.status).toBe(409);
    expect(again.body.error.message).toMatch(/already been used/);

    const t2 = await ticket(h);
    const wrongType = await put(h, t2.url, Buffer.from("x".repeat(2000)));
    expect(wrongType.body.error.code).toBe("unsupported_type");
    const retry = await put(h, t2.url, PDF);
    expect(retry.status).toBe(409);
    expect(listDir(join(h.dir, "tmp"))).toEqual([]);
  });

  test("two simultaneous PUTs: exactly one wins", async () => {
    const h = harness();
    const t = await ticket(h);
    const results = await Promise.all([put(h, t.url, PDF), put(h, t.url, PDF)]);
    expect(results.map((r) => r.status).sort()).toEqual([201, 409]);
    expect(h.db.prepare("SELECT COUNT(*) AS n FROM source_files").get()).toEqual({ n: 1 });
  });

  test("expires after the link lifetime", async () => {
    const h = harness();
    const t = await ticket(h);
    h.clock.advance(UPLOAD_LIMITS.linkTtlSeconds * 1000 + 1);
    const res = await put(h, t.url, PDF);
    expect(res.status).toBe(409);
    expect(res.body.error.message).toMatch(/expired/);
    expect(h.db.prepare("SELECT COUNT(*) AS n FROM source_files").get()).toEqual({ n: 0 });
  });

  test("capped at the declared size, by header and by streaming", async () => {
    const h = harness();
    const small = await ticket(h, { files: [{ name: "a.pdf", bytes: 500 }] });
    const over = Buffer.concat([PDF, Buffer.alloc(2000, 1)]);
    const res = await put(h, small.url, over);
    expect(res.status).toBe(413);
    expect(res.body.error.code).toBe("too_large");
    expect(listDir(join(h.dir, "tmp"))).toEqual([]);
    expect(listDir(join(h.dir, "originals"))).toEqual([]);

    const small2 = await ticket(h, { files: [{ name: "a.pdf", bytes: 500 }] });
    const chunked = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(PDF);
        controller.enqueue(Buffer.alloc(1000, 2));
        controller.close();
      },
    });
    const res2 = await put(h, small2.url, chunked as never);
    expect(res2.body.error.code).toBe("too_large");
    expect(listDir(join(h.dir, "tmp"))).toEqual([]);
  });

  test("a batch yields one distinct ticket per file, optionally filed under a node", async () => {
    const h = harness();
    const lecture = h.lecture(h.alice);
    const res = await h.call(h.agent(h.alice), "POST", "/api/uploads/tickets", {
      files: [
        { name: "a.pdf", bytes: 10_000 },
        { name: "b.pdf", bytes: 20_000 },
      ],
      nodeId: lecture,
    });
    const [a, b] = res.body.items as Json[];
    expect(a.url).not.toBe(b.url);
    expect(a.id).not.toBe(b.id);
    const up = await put(h, a.url, PDF);
    expect(up.body.file.nodeId).toBe(lecture);
  });

  test("tokens are stored hashed", async () => {
    const h = harness();
    const t = await ticket(h);
    const token = t.url.split("/").pop() as string;
    const rows = h.db.prepare("SELECT * FROM upload_tickets").all() as Array<
      Record<string, unknown>
    >;
    expect(
      JSON.stringify(
        rows.map((r) => ({
          ...r,
          token_hash: Buffer.from(r.token_hash as Buffer).toString("hex"),
        })),
      ),
    ).not.toContain(token);
  });

  test("unknown or malformed tokens are not_found; the route needs no other credential, and nothing else works without one", async () => {
    const h = harness();
    expect((await put(h, "http://x/api/uploads/not-a-token", PDF)).body.error.code).toBe(
      "not_found",
    );
    expect((await put(h, `http://x/api/uploads/${"A".repeat(43)}`, PDF)).body.error.code).toBe(
      "not_found",
    );
    // everything else needs a credential
    for (const [method, path] of [
      ["POST", "/api/uploads/tickets"],
      ["POST", "/api/uploads"],
      ["GET", "/api/files"],
      ["GET", "/api/converter/status"],
    ]) {
      const res = await h.call(
        null,
        method as string,
        path as string,
        method === "POST" ? {} : undefined,
      );
      expect(res.body.error.code, `${method} ${path}`).toBe("unauthenticated");
    }
  });

  test("tickets: bad input explains itself; read-only keys and other users' nodes are refused", async () => {
    const h = harness();
    const bad = await h.call(h.agent(h.alice), "POST", "/api/uploads/tickets", { files: [] });
    expect(bad.body.error.code).toBe("invalid_input");
    expect(bad.body.error.example).toBeTruthy();
    const ro = await h.call(
      { user: h.alice, via: "key", scope: "read" },
      "POST",
      "/api/uploads/tickets",
      FILES,
    );
    expect(ro.body.error.code).toBe("read_only_key");
    const foreign = await h.call(h.agent(h.alice), "POST", "/api/uploads/tickets", {
      ...FILES,
      nodeId: h.lecture(h.bob),
    });
    expect(foreign.body.error.code).toBe("not_found");
  });
});
