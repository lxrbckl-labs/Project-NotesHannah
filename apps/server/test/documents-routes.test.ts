import { describe, expect, it } from "vitest";
import { general, heading, para, setupDocs } from "./documents-helpers.js";

const REQ = "req_01J9Z8Y7X6W5V4T3S2R1Q0P9N8";
const KEY = "key_01J9Z8Y7X6W5V4T3S2R1Q0P9N8";

function setup() {
  const t = setupDocs();
  const { sec } = t.spine();
  const alice = { user: t.alice };
  const bob = { user: t.bob };
  const agent = () => ({ user: t.alice, key: KEY });
  return { t, sec, alice, bob, agent };
}

async function make(
  f: ReturnType<typeof setup>,
  who: object = f.alice,
  blocks: unknown[] = [heading("H"), para("one"), para("two")],
) {
  const res = await f.t.call(who, "POST", "/api/documents", {
    parentId: f.sec.study_guides,
    kind: "study_guide",
    title: "Guide",
    blocks,
  });
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  return res.body as { documentId: string; nodeId: string; blockIds: string[]; revision: number };
}

describe("document routes", () => {
  it("creates, reads light, reads full in ranges, and by node", async () => {
    const f = setup();
    const doc = await make(f);
    const light = await f.t.call(f.alice, "GET", `/api/documents/${doc.documentId}`);
    expect(light.status).toBe(200);
    expect(light.body.document).toMatchObject({
      id: doc.documentId,
      revision: 1,
      blockIds: doc.blockIds,
    });
    expect(light.body.blocks[0]).toMatchObject({
      id: doc.blockIds[0],
      type: "heading",
      preview: "H",
      origin: "user",
    });
    expect("content" in light.body.blocks[0]).toBe(false);

    const full = await f.t.call(
      f.alice,
      "GET",
      `/api/documents/${doc.documentId}/content?from=1&limit=1`,
    );
    expect(full.body).toMatchObject({ from: 1, total: 3 });
    expect(full.body.blocks).toHaveLength(1);
    expect(full.body.blocks[0].id).toBe(doc.blockIds[1]);

    const byNode = await f.t.call(f.alice, "GET", `/api/nodes/${doc.nodeId}/document`);
    expect(byNode.body.document.id).toBe(doc.documentId);
    const one = await f.t.call(
      f.alice,
      "GET",
      `/api/documents/${doc.documentId}/blocks/${doc.blockIds[2]}`,
    );
    expect(one.body.block.id).toBe(doc.blockIds[2]);
  });

  it("insert, patch, replace, move, delete, regenerate, restore over HTTP", async () => {
    const f = setup();
    const doc = await make(f);
    const D = `/api/documents/${doc.documentId}`;
    const [h, p1, p2] = doc.blockIds as [string, string, string];

    const ins = await f.t.call(f.alice, "POST", `${D}/blocks`, {
      blocks: [para("three")],
      position: { after: h },
      expectedRevision: 1,
    });
    expect(ins.status).toBe(201);
    expect(ins.body.revision).toBe(2);

    const patch = await f.t.call(f.alice, "PATCH", `${D}/blocks/${p1}`, {
      patch: { content: { text: "ONE" } },
    });
    expect(patch.status).toBe(200);
    expect(patch.body.block.id).toBe(p1);
    const repl = await f.t.call(f.alice, "PATCH", `${D}/blocks/${p2}`, { block: heading("Two") });
    expect(repl.body.block.type).toBe("heading");

    const mv = await f.t.call(f.alice, "POST", `${D}/blocks/move`, {
      blockIds: [p2],
      position: "start",
    });
    expect(mv.body.revision).toBe(5);
    const del = await f.t.call(f.alice, "POST", `${D}/blocks/delete`, { blockIds: [p1] });
    expect(del.body.removed).toEqual([p1]);

    const regen = await f.t.call(f.alice, "POST", `${D}/regenerate`, {
      blocks: [heading("Fresh")],
    });
    expect(regen.status).toBe(200);
    expect(regen.body.written).toHaveLength(1);

    const revs = await f.t.call(f.alice, "GET", `${D}/revisions`);
    expect(revs.body.items.map((r: { number: number }) => r.number)).toEqual([7, 6, 5, 4, 3, 2, 1]);
    const rev = await f.t.call(f.alice, "GET", `${D}/revisions/1`);
    expect(rev.body.revision.snapshot.blocks).toHaveLength(3);
    const restored = await f.t.call(f.alice, "POST", `${D}/revisions/1/restore`);
    expect(restored.body).toMatchObject({ restoredFrom: 1, revision: 8 });
    const content = await f.t.call(f.alice, "GET", `${D}/content`);
    expect(content.body.blocks.map((b: { id: string }) => b.id)).toEqual(doc.blockIds);
  });

  it("a body that names another document is refused", async () => {
    const f = setup();
    const doc = await make(f);
    const res = await f.t.call(f.alice, "POST", `/api/documents/${doc.documentId}/blocks`, {
      documentId: "doc_01J9Z8Y7X6W5V4T3S2R1Q0P9N8",
      blocks: [para("x")],
    });
    expect(res.status).toBe(400);
  });

  it("batch applies atomically", async () => {
    const f = setup();
    const doc = await make(f);
    const D = doc.documentId;
    const bad = await f.t.call(f.alice, "POST", "/api/documents/batch", {
      operations: [
        { operation: "insert_blocks", input: { documentId: D, blocks: [para("x")] } },
        {
          operation: "delete_blocks",
          input: { documentId: D, blockIds: ["blk_01J9Z8Y7X6W5V4T3S2R1Q0P9N8"] },
        },
      ],
    });
    expect(bad.status).toBe(404);
    expect((await f.t.call(f.alice, "GET", `/api/documents/${D}`)).body.document.revision).toBe(1);
    const ok = await f.t.call(f.alice, "POST", "/api/documents/batch", {
      operations: [
        { operation: "insert_blocks", input: { documentId: D, blocks: [para("x")] } },
        { operation: "delete_blocks", input: { documentId: D, blockIds: [doc.blockIds[0]] } },
      ],
    });
    expect(ok.status).toBe(200);
    expect(ok.body.results.map((r: { operation: string }) => r.operation)).toEqual([
      "insert_blocks",
      "delete_blocks",
    ]);
    expect(ok.body.results[0].revision).toBe(2);
    const empty = await f.t.call(f.alice, "POST", "/api/documents/batch", { operations: [] });
    expect(empty.status).toBe(400);
  });

  it("validation failures carry path, message and example", async () => {
    const f = setup();
    const doc = await make(f);
    const D = `/api/documents/${doc.documentId}`;
    const noCite = await f.t.call(f.agent(), "POST", `${D}/blocks`, {
      blocks: [heading("ok"), para("claim")],
    });
    expect(noCite.status).toBe(400);
    expect(noCite.body.error.code).toBe("invalid_input");
    expect(noCite.body.error.message).toMatch(
      /^\$\.blocks\[1\]\.citations: This paragraph has no citation/,
    );
    expect(noCite.body.error.example).toMatchObject({
      type: "paragraph",
      citations: [expect.anything()],
    });

    const badType = await f.t.call(f.alice, "POST", `${D}/blocks`, {
      blocks: [{ type: "paragraf", content: { text: "x" } }],
    });
    expect(badType.body.error.message).toContain('Did you mean "paragraph"');
    expect(badType.body.error.example).toMatchObject({ type: "paragraph" });

    const serverField = await f.t.call(f.alice, "POST", `${D}/blocks`, {
      blocks: [{ ...heading("x"), id: "blk_01J9Z8Y7X6W5V4T3S2R1Q0P9N8" }],
    });
    expect(serverField.status).toBe(400);
    expect(serverField.body.error.message).toContain("$.blocks[0].id");

    const badPos = await f.t.call(f.alice, "POST", `${D}/blocks`, {
      blocks: [heading("x")],
      position: "middle",
    });
    expect(badPos.status).toBe(400);
    expect(badPos.body.error.message).toContain("$.position");
    expect(badPos.body.error.example).toMatchObject({
      documentId: expect.any(String),
      blocks: expect.any(Array),
    });

    const notJson = await f.t.call(f.alice, "POST", `${D}/blocks`, undefined);
    expect(notJson.status).toBe(400);
    const emptyPatch = await f.t.call(f.alice, "PATCH", `${D}/blocks/${doc.blockIds[0]}`, {
      patch: {},
    });
    expect(emptyPatch.status).toBe(400);

    const stale = await f.t.call(f.alice, "POST", `${D}/blocks`, {
      blocks: [heading("x")],
      expectedRevision: 9,
    });
    expect(stale.status).toBe(409);
    expect(stale.body.error.hint).toContain("Read it again");
  });

  it("edit protection over HTTP answers 403 with the explanation", async () => {
    const f = setup();
    const doc = await make(f);
    const path = `/api/documents/${doc.documentId}/blocks/${doc.blockIds[1]}`;
    const res = await f.t.call(f.agent(), "PATCH", path, { patch: { generalKnowledge: true } });
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe("forbidden");
    expect(res.body.error.message).toContain("requestId");
    const ok = await f.t.call(f.agent(), "PATCH", path, {
      patch: { generalKnowledge: true },
      requestId: REQ,
    });
    expect(ok.status).toBe(200);
    expect(ok.body.block.origin).toBe("agent");
  });

  it("review is for browser sessions only", async () => {
    const f = setup();
    const doc = await make(f, f.agent(), [general("agent text")]);
    const D = `/api/documents/${doc.documentId}`;
    expect((await f.t.call(f.agent(), "POST", `${D}/review`, { status: "reviewed" })).status).toBe(
      403,
    );
    expect(
      (
        await f.t.call({ user: f.t.alice, via: "key" }, "POST", `${D}/review`, {
          status: "reviewed",
        })
      ).status,
    ).toBe(403);
    expect(
      (
        await f.t.call({ user: f.t.alice, scope: "read" }, "POST", `${D}/review`, {
          status: "reviewed",
        })
      ).status,
    ).toBe(403);
    expect((await f.t.call(f.alice, "POST", `${D}/review`, { status: "maybe" })).status).toBe(400);
    const ok = await f.t.call(f.alice, "POST", `${D}/review`, {
      status: "reviewed",
      expectedRevision: 1,
    });
    expect(ok.status).toBe(200);
    expect(ok.body).toMatchObject({ changed: 1, revision: 2 });
    expect((await f.t.call(f.alice, "GET", D)).body.document.reviewStatus).toBe("reviewed");
  });

  it("references and reverse lookups", async () => {
    const f = setup();
    const page = f.t.addPage();
    const doc = await make(f, f.agent(), [para("cited", [page.citation])]);
    const refs = await f.t.call(f.alice, "GET", `/api/documents/${doc.documentId}/references`);
    expect(refs.body.items).toHaveLength(1);
    expect(refs.body.items[0]).toMatchObject({
      number: 1,
      status: "available",
      fileName: "Lecture 7.pdf",
    });
    const byPage = await f.t.call(f.alice, "GET", `/api/pages/${page.pageId}/citations`);
    expect(byPage.body.items[0]).toMatchObject({
      title: "Guide",
      itemType: "paragraph",
      trashed: false,
    });
    const byFile = await f.t.call(f.alice, "GET", `/api/files/${page.fileId}/citations`);
    expect(byFile.body.items).toHaveLength(1);
    expect(
      (await f.t.call(f.bob, "GET", `/api/pages/${page.pageId}/citations`)).body.items,
    ).toEqual([]);
  });

  it("changes and activity", async () => {
    const f = setup();
    const doc = await make(f, f.agent(), []);
    await f.t.call(f.agent(), "POST", `/api/documents/${doc.documentId}/blocks`, {
      blocks: [general("x")],
    });
    const changes = await f.t.call(f.alice, "GET", "/api/changes?cursor=0&limit=1");
    expect(changes.body.items).toHaveLength(1);
    expect(changes.body.hasMore).toBe(true);
    const rest = await f.t.call(f.alice, "GET", `/api/changes?cursor=${changes.body.nextCursor}`);
    expect(rest.body.items).toHaveLength(1);
    const act = await f.t.call(f.alice, "GET", "/api/activity?action=insert_blocks");
    expect(act.body.items).toHaveLength(1);
    expect(act.body.items[0]).toMatchObject({
      keyLabel: expect.any(String),
      summary: "Guide: Inserted 1 block",
    });
    expect((await f.t.call(f.alice, "GET", "/api/changes?cursor=zzz")).status).toBe(400);
    expect((await f.t.call(f.alice, "GET", "/api/activity?limit=0")).status).toBe(400);
    expect((await f.t.call(null, "GET", "/api/changes")).status).toBe(401);
  });
});

describe("isolation and access on every route", () => {
  it("another user gets not_found, never forbidden", async () => {
    const f = setup();
    const page = f.t.addPage();
    const doc = await make(f, f.agent(), [para("cited", [page.citation])]);
    const D = `/api/documents/${doc.documentId}`;
    const [b0] = doc.blockIds as [string];
    const calls: Array<[string, string, unknown?]> = [
      ["GET", D],
      ["GET", `/api/nodes/${doc.nodeId}/document`],
      ["GET", `${D}/content`],
      ["GET", `${D}/blocks/${b0}`],
      ["GET", `${D}/references`],
      ["GET", `${D}/revisions`],
      ["GET", `${D}/revisions/1`],
      ["POST", `${D}/blocks`, { blocks: [heading("x")] }],
      ["PATCH", `${D}/blocks/${b0}`, { patch: { generalKnowledge: true } }],
      ["POST", `${D}/blocks/move`, { blockIds: [b0], position: "start" }],
      ["POST", `${D}/blocks/delete`, { blockIds: [b0] }],
      ["POST", `${D}/regenerate`, { blocks: [] }],
      ["POST", `${D}/revisions/1/restore`],
      ["POST", `${D}/review`, { status: "reviewed" }],
      [
        "POST",
        "/api/documents/batch",
        {
          operations: [
            { operation: "delete_blocks", input: { documentId: doc.documentId, blockIds: [b0] } },
          ],
        },
      ],
      ["POST", "/api/documents", { nodeId: doc.nodeId, kind: "free", title: "steal" }],
    ];
    for (const [method, path, body] of calls) {
      const res = await f.t.call(f.bob, method, path, body);
      expect(res.status, `${method} ${path}`).toBe(404);
      expect(res.body.error.code).toBe("not_found");
    }
    const mine = await f.t.call(f.alice, "GET", D);
    expect(mine.body.document.revision).toBe(1);
    expect((await f.t.call(f.bob, "GET", "/api/changes")).body.items).toEqual([]);
    expect((await f.t.call(f.bob, "GET", "/api/activity")).body.items).toEqual([]);
  });

  it("a read-only key may read but is refused on every changing route", async () => {
    const f = setup();
    const doc = await make(f);
    const D = `/api/documents/${doc.documentId}`;
    const [b0] = doc.blockIds as [string];
    const ro = { user: f.t.alice, key: KEY, scope: "read" };
    for (const [method, path, body] of [
      ["POST", "/api/documents", { parentId: f.sec.study_guides, kind: "free", title: "x" }],
      [
        "POST",
        "/api/documents/batch",
        {
          operations: [
            { operation: "delete_blocks", input: { documentId: doc.documentId, blockIds: [b0] } },
          ],
        },
      ],
      ["POST", `${D}/blocks`, { blocks: [heading("x")] }],
      ["PATCH", `${D}/blocks/${b0}`, { patch: { content: { text: "x" } } }],
      ["POST", `${D}/blocks/move`, { blockIds: [b0], position: "end" }],
      ["POST", `${D}/blocks/delete`, { blockIds: [b0] }],
      ["POST", `${D}/regenerate`, { blocks: [] }],
      ["POST", `${D}/revisions/1/restore`],
      ["POST", `${D}/review`, { status: "reviewed" }],
    ] as Array<[string, string, unknown?]>) {
      const res = await f.t.call(ro, method, path, body);
      expect(res.status, `${method} ${path}`).toBe(403);
      expect(res.body.error.code, `${method} ${path}`).toBe("read_only_key");
    }
    for (const path of [
      D,
      `${D}/content`,
      `${D}/references`,
      `${D}/revisions`,
      "/api/changes",
      "/api/activity",
    ]) {
      expect((await f.t.call(ro, "GET", path)).status, path).toBe(200);
    }
    expect((await f.t.call(f.alice, "GET", D)).body.document.revision).toBe(1);
  });

  it("anonymous callers get 401", async () => {
    const f = setup();
    const doc = await make(f);
    expect((await f.t.call(null, "GET", `/api/documents/${doc.documentId}`)).status).toBe(401);
    expect((await f.t.call(null, "POST", "/api/documents", {})).status).toBe(401);
  });
});
