import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CreatedApiKey } from "@notes/schema";
import { describe, expect, it } from "vitest";
import { createServices, type Services } from "../src/services.js";
import { initStorage } from "../src/storage/storage.js";
import { blocksOf, GUIDE, type Json } from "./canvas-helpers.js";
import { errorCode, makeTestApp, ORIGIN } from "./helpers.js";

const PW = "correct horse battery";
const note = (text: string) => ({ kind: "note", text });

async function setup() {
  const dir = mkdtempSync(join(tmpdir(), "notes-canvas-"));
  const { storage } = initStorage(dir);
  const t = makeTestApp({
    env: { DATA_DIR: dir, APP_ORIGIN: ORIGIN },
    services: (deps) =>
      createServices(deps, {
        files: { storage, signingSecret: "canvas-secret", partialGraceMs: 0, log: () => {} },
      }),
  });
  if (!t.services) throw new Error("services");
  const services: Services = t.services;
  const hannah = await t.addUser("hannah", PW);
  const sam = await t.addUser("sam", PW);
  const she = (await t.signIn("hannah", PW)).cookies;
  const other = (await t.signIn("sam", PW)).cookies;
  const key = async (scope: "read" | "write", cookies = she) =>
    CreatedApiKey.parse(
      (await t.request("/api/keys", { cookies, body: { name: scope, scope } })).body,
    ).secret;
  const write = await key("write");
  const read = await key("read");

  /** A document in hannah's library, written as her through the services. */
  function doc(owner = hannah.id, lines: readonly string[] = GUIDE) {
    const term = services.library.create(owner, { parentId: null, kind: "term", name: "Fall" });
    const course = services.library.create(owner, { parentId: term.id, kind: "course", name: "C" });
    const section = services.library
      .list(owner, { parentId: course.id })
      .items.find((s) => s.section === "lectures");
    const lecture = services.library.create(owner, {
      parentId: section?.id as string,
      kind: "lecture",
      name: "Beta blockers",
      lecture: { number: 1, date: "2026-10-14" },
    });
    const as = {
      userId: owner,
      actor: { type: "user", userId: owner },
      via: "session",
      scope: "write",
    } as const;
    const created = services.documents.createDocument(
      as as never,
      {
        nodeId: lecture.id,
        kind: "study_guide",
        title: "Beta blockers",
        blocks: blocksOf(lines),
      } as never,
    );
    return { documentId: created.documentId, blockIds: created.blockIds, nodeId: lecture.id };
  }

  const her = (method: string, path: string, body?: unknown, cookies = she) =>
    t.request(path, { method, cookies, ...(body === undefined ? {} : { body }) });
  const agent = (method: string, path: string, body?: unknown, bearer = write) =>
    t.request(path, { method, bearer, origin: null, ...(body === undefined ? {} : { body }) });
  return { t, services, hannah, sam, she, other, write, read, doc, her, agent };
}

describe("canvas routes", () => {
  it("GET derives the canvas and returns LoadedCanvas; ops, structure and placements work end to end", async () => {
    const s = await setup();
    const d = s.doc();
    const base = `/api/documents/${d.documentId}/canvas`;
    const got = await s.her("GET", base);
    expect(got.status).toBe(200);
    const loaded = got.body as Json;
    expect(loaded.documentTitle).toBe("Beta blockers");
    expect(loaded.blocks).toHaveLength(GUIDE.length);
    expect(loaded.canvas.cards).toHaveLength(5);

    // An agent describes the structure over PUT, with the key.
    const [p1, p2] = loaded.canvas.cards.map((c: Json) => c.content.blockIds[0]);
    const set = await s.agent("PUT", `${base}/structure`, {
      cards: [
        { ref: "a", content: { kind: "block", blockIds: [p1] } },
        { ref: "b", content: { kind: "block", blockIds: [p2] } },
      ],
      connectors: [{ from: "a", to: "b", label: "causes it", kind: "causes" }],
      frames: [{ title: "Two", members: ["a", "b"] }],
    });
    expect(set.status).toBe(200);
    expect((set.body as Json).canvas.frames).toHaveLength(1);
    expect((set.body as Json).report.added.length).toBeGreaterThan(0);

    // She drags a card: placements, then the web store's ops body shape (documentId inside).
    const cardId = (set.body as Json).canvas.cards[0].id;
    const placed = await s.her("PUT", `${base}/placements`, {
      placements: [{ id: cardId, x: 12, y: 34 }],
    });
    expect(placed.status).toBe(200);
    expect(
      (placed.body as Json).canvas.cards.find((c: Json) => c.id === cardId).position,
    ).toMatchObject({ x: 12, y: 34 });
    expect((placed.body as Json).placed).toEqual([cardId]);
    const ops = await s.her("POST", `${base}/ops`, {
      documentId: d.documentId,
      ops: [{ op: "add_card", card: { content: note("hi") } }],
      expectedRevision: (placed.body as Json).canvas.revision,
    });
    expect(ops.status).toBe(200);
    expect((ops.body as Json).canvas.cards.some((c: Json) => c.origin === "user")).toBe(true);
  });

  it("refusals carry problems with path, message and example, where the web store reads them", async () => {
    const s = await setup();
    const d = s.doc();
    const base = `/api/documents/${d.documentId}/canvas`;
    const bad = await s.her("POST", `${base}/ops`, {
      documentId: d.documentId,
      ops: [{ op: "remove_card", id: "crd_01J9Z8Y7X6W5V4T3S2R1Q0P9N8" }],
    });
    expect(bad.status).toBe(400);
    const body = bad.body as Json;
    expect(errorCode(body)).toBe("invalid_input");
    expect(body.problems[0]).toMatchObject({ path: "$.ops[0].id", example: expect.anything() });
    expect(body.error.problems).toEqual(body.problems);

    const stale = await s.her("POST", `${base}/ops`, {
      documentId: d.documentId,
      ops: [{ op: "add_card", card: { content: note("x") } }],
      expectedRevision: 9,
    });
    expect(stale.status).toBe(409);
    expect(errorCode(stale.body)).toBe("conflict");

    const wrongDoc = await s.her("POST", `${base}/ops`, {
      documentId: "doc_01J9Z8Y7X6W5V4T3S2R1Q0P9N8",
      ops: [],
    });
    expect(wrongDoc.status).toBe(400);
    expect(errorCode((await s.her("POST", `${base}/ops`, "not json")).body)).toBe("invalid_input");

    // The pin rule over HTTP: 403 with the rule in words.
    const card = ((await s.her("GET", base)).body as Json).canvas.cards[0].id;
    await s.her("PUT", `${base}/placements`, { placements: [{ id: card, x: 1, y: 1 }] });
    const refused = await s.agent("POST", `${base}/ops`, {
      ops: [{ op: "remove_card", id: card }],
    });
    expect(refused.status).toBe(403);
    expect((refused.body as Json).error.message).toMatch(/She placed this card by hand/);
    expect((refused.body as Json).error.hint).toMatch(/requestId/);
    // Placement is hers: an agent key is refused on the placements route.
    expect(
      (await s.agent("PUT", `${base}/placements`, { placements: [{ id: card, x: 9, y: 9 }] }))
        .status,
    ).toBe(403);
  });

  it("a read-only key reads but cannot change anything", async () => {
    const s = await setup();
    const d = s.doc();
    const base = `/api/documents/${d.documentId}/canvas`;
    expect((await s.agent("GET", base, undefined, s.read)).status).toBe(200);
    for (const [method, path, body] of [
      ["POST", `${base}/ops`, { ops: [{ op: "add_card", card: { content: note("x") } }] }],
      ["PUT", `${base}/structure`, { cards: [] }],
      ["PUT", `${base}/placements`, { placements: [] }],
      ["POST", `${base}/arrange`, {}],
      ["PUT", `${base}/layout-cache/wide`, { positions: {} }],
    ] as const) {
      const res = await s.agent(method, path, body, s.read);
      expect(`${method} ${path} ${errorCode(res.body)}`).toBe(`${method} ${path} read_only_key`);
    }
    expect((await s.agent("GET", `${base}/layout-cache/wide`, undefined, s.read)).status).toBe(204);
  });

  it("another user's canvas is not_found on every route", async () => {
    const s = await setup();
    const d = s.doc();
    const base = `/api/documents/${d.documentId}/canvas`;
    const card = ((await s.her("GET", base)).body as Json).canvas.cards[0].id;
    const attempts: Array<[string, string, unknown?]> = [
      ["GET", base],
      ["POST", `${base}/ops`, { ops: [{ op: "add_card", card: { content: note("x") } }] }],
      ["PUT", `${base}/structure`, { cards: [] }],
      ["PUT", `${base}/placements`, { placements: [{ id: card, x: 1, y: 1 }] }],
      ["POST", `${base}/arrange`, {}],
      ["GET", `${base}/layout-cache/wide`],
      ["PUT", `${base}/layout-cache/wide`, { positions: {} }],
      ["GET", `${base}/events`],
    ];
    for (const [method, path, body] of attempts) {
      const res = await s.her(method, path, body, s.other);
      expect(`${method} ${path} ${res.status} ${errorCode(res.body)}`).toBe(
        `${method} ${path} 404 not_found`,
      );
    }
    // Nothing of hers changed, and an unknown document looks exactly the same.
    expect(((await s.her("GET", base)).body as Json).canvas.revision).toBe(1);
    expect(
      (await s.her("GET", "/api/documents/doc_01J9Z8Y7X6W5V4T3S2R1Q0P9N8/canvas")).status,
    ).toBe(404);
    expect((await s.t.request(base)).status).toBe(401);
  });

  it("the layout cache round trips per variant, drops pinned and unknown cards, and 204s when empty", async () => {
    const s = await setup();
    const d = s.doc();
    const base = `/api/documents/${d.documentId}/canvas`;
    const cards = ((await s.her("GET", base)).body as Json).canvas.cards.map((c: Json) => c.id);
    expect((await s.her("GET", `${base}/layout-cache/wide`)).status).toBe(204);
    const saved = await s.her("PUT", `${base}/layout-cache/wide`, {
      positions: {
        [cards[0]]: { x: 1, y: 2 },
        [cards[1]]: { x: 3, y: 4 },
        crd_01J9Z8Y7X6W5V4T3S2R1Q0P9N8: { x: 9, y: 9 },
      },
    });
    expect((saved.body as Json).saved).toBe(2);
    await s.her("PUT", `${base}/placements`, { placements: [{ id: cards[1], x: 50, y: 50 }] });
    const wide = await s.her("GET", `${base}/layout-cache/wide`);
    expect(wide.body).toEqual({ positions: { [cards[0]]: { x: 1, y: 2 } } });
    expect((await s.her("GET", `${base}/layout-cache/tall`)).status).toBe(204);
    expect((await s.her("GET", `${base}/layout-cache/sideways`)).status).toBe(404);
    expect(
      (await s.her("PUT", `${base}/layout-cache/wide`, { positions: { [cards[0]]: { x: "no" } } }))
        .status,
    ).toBe(400);
    // Layout never counts as a change of the structure.
    expect(((await s.her("GET", base)).body as Json).canvas.revision).toBe(2);
  });

  it("arrange forgets the cache and, on request, her pins", async () => {
    const s = await setup();
    const d = s.doc();
    const base = `/api/documents/${d.documentId}/canvas`;
    const card = ((await s.her("GET", base)).body as Json).canvas.cards[0].id;
    await s.her("PUT", `${base}/placements`, { placements: [{ id: card, x: 1, y: 1 }] });
    const plain = await s.her("POST", `${base}/arrange`, {});
    expect(plain.status).toBe(200);
    expect(
      (plain.body as Json).canvas.cards.find((c: Json) => c.id === card).position,
    ).not.toBeNull();
    const released = await s.her("POST", `${base}/arrange`, { releasePins: true });
    expect((released.body as Json).canvas.cards.every((c: Json) => c.position === null)).toBe(true);
  });
});

describe("canvas events (server-sent events)", () => {
  async function open(s: Awaited<ReturnType<typeof setup>>, path: string, cookies = s.she) {
    const cookie = Object.entries(cookies)
      .map(([k, v]) => `${k}=${v}`)
      .join("; ");
    const res = await s.t.app.request(path, { headers: { cookie } });
    const reader = res.body?.getReader();
    const decoder = new TextDecoder();
    let text = "";
    /** Read until `until` matches the text so far, or fail after a second. */
    async function readUntil(until: RegExp | (() => boolean)): Promise<string> {
      const deadline = Date.now() + 2000;
      const done = () => (typeof until === "function" ? until() : until.test(text));
      while (!done()) {
        if (!reader || Date.now() > deadline)
          throw new Error(`no match for ${until} in ${JSON.stringify(text)}`);
        const chunk = await Promise.race([
          reader.read(),
          new Promise<null>((r) => setTimeout(() => r(null), 100)),
        ]);
        if (chunk && !chunk.done) text += decoder.decode(chunk.value);
      }
      return text;
    }
    return { res, readUntil, close: () => reader?.cancel(), text: () => text };
  }

  it("streams the whole LoadedCanvas after her drag, an agent write and a document write, and stops on close", async () => {
    const s = await setup();
    const d = s.doc();
    const base = `/api/documents/${d.documentId}/canvas`;
    const cards = ((await s.her("GET", base)).body as Json).canvas.cards;
    const stream = await open(s, `${base}/events`);
    expect(stream.res.status).toBe(200);
    expect(stream.res.headers.get("content-type")).toMatch(/text\/event-stream/);
    expect(stream.res.headers.get("x-accel-buffering")).toBe("no");
    expect(stream.res.headers.get("cache-control")).toMatch(/no-cache/);
    await stream.readUntil(/retry: 3000/);
    expect(s.services.canvas.events.listeners(d.documentId)).toBe(1);

    /** The complete canvas events so far (a message ends with a blank line). */
    const events = (text: string) =>
      text
        .split("\n\n")
        .slice(0, -1)
        .filter((m) => m.includes("event: canvas"))
        .map((m) => JSON.parse(/^data: (.*)$/m.exec(m)?.[1] as string) as Json);

    await s.her("PUT", `${base}/placements`, { placements: [{ id: cards[0].id, x: 5, y: 6 }] });
    await stream.readUntil(() => events(stream.text()).length >= 1);
    let seen = events(stream.text());
    expect(
      seen.at(-1)?.canvas.cards.find((c: Json) => c.id === cards[0].id).position,
    ).toMatchObject({ x: 5, y: 6 });
    expect(seen.at(-1)?.blocks).toHaveLength(GUIDE.length);

    await s.agent("POST", `${base}/ops`, {
      ops: [{ op: "add_card", card: { content: note("from the agent") } }],
    });
    await stream.readUntil(() =>
      JSON.stringify(events(stream.text()).at(-1)).includes("from the agent"),
    );

    // A change to the document itself (a new block) reaches the open canvas as new unpinned cards.
    await s.agent("POST", `/api/documents/${d.documentId}/blocks`, {
      blocks: [
        { type: "paragraph", content: { text: "Brand new block." }, generalKnowledge: true },
      ],
      position: "end",
    });
    await stream.readUntil(() => (events(stream.text()).at(-1)?.canvas.cards.length ?? 0) === 7);
    seen = events(stream.text());
    expect(seen.length).toBeGreaterThanOrEqual(3);

    await stream.close();
    await new Promise((r) => setTimeout(r, 50));
    expect(s.services.canvas.events.listeners(d.documentId)).toBe(0);
  });

  it("only the owner can listen, and a stream ends when the document goes to the trash", async () => {
    const s = await setup();
    const d = s.doc();
    const base = `/api/documents/${d.documentId}/canvas/events`;
    const refused = await s.t.app.request(base, {
      headers: {
        cookie: Object.entries(s.other)
          .map(([k, v]) => `${k}=${v}`)
          .join("; "),
      },
    });
    expect(refused.status).toBe(404);
    const stream = await open(s, base);
    await stream.readUntil(/retry/);
    s.services.library.trash(s.hannah.id, d.nodeId, { type: "user", userId: s.hannah.id });
    s.services.canvas.events.publish(d.documentId);
    await new Promise((r) => setTimeout(r, 100));
    expect(s.services.canvas.events.listeners(d.documentId)).toBe(0);
    await stream.close();
  });
});
