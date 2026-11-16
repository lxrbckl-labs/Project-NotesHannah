import { newId } from "@notes/schema";
import { describe, expect, it } from "vitest";
import { agentAuth, general, heading, para, setupDocs, thrown } from "./documents-helpers.js";

const REQ = "req_01J9Z8Y7X6W5V4T3S2R1Q0P9N8";

describe("create_document", () => {
  it("creates a document node and stamps provenance from the caller", () => {
    const t = setupDocs();
    const page = t.addPage();
    const made = t.newDoc(t.bot, [
      heading("Beta blockers"),
      para("Atenolol is β1-selective.", [page.citation]),
    ]);
    expect(made.revision).toBe(1);
    expect(made.blockIds).toHaveLength(2);
    const full = t.service.getFull(t.she, made.documentId);
    expect(full.document).toMatchObject({
      kind: "study_guide",
      title: "Beta blockers",
      revision: 1,
    });
    for (const block of full.blocks) {
      expect(block.origin).toBe("agent");
      expect(block.review.status).toBe("unverified");
      expect(block.provenance.createdBy).toEqual(t.bot.actor);
    }
    expect(full.document.reviewStatus).toBe("unverified");
    // and the node exists in the library
    expect(t.library.get(t.alice, made.nodeId)).toMatchObject({ kind: "document" });
  });

  it("stores the normalised block: rich-text strings become runs", () => {
    const t = setupDocs();
    const made = t.newDoc(t.she, [para("hi")]);
    const [block] = t.service.getFull(t.she, made.documentId).blocks;
    expect(block?.content).toEqual({ text: [{ text: "hi" }] });
  });

  it("her blocks are origin user and reviewed", () => {
    const t = setupDocs();
    const made = t.newDoc(t.she, [para("My own words")]);
    const [block] = t.service.getFull(t.she, made.documentId).blocks;
    expect(block).toMatchObject({ origin: "user", review: { status: "reviewed" } });
  });

  it("fills an existing node once, and refuses folders and other users' nodes", () => {
    const t = setupDocs();
    const { sec } = t.spine();
    const node = t.library.create(t.alice, {
      parentId: sec.study_guides as string,
      kind: "document",
      name: "X",
    });
    const ok = t.service.createDocument(t.she, { nodeId: node.id, kind: "free", title: "X" });
    expect(ok.nodeId).toBe(node.id);
    expect(
      thrown(() => t.service.createDocument(t.she, { nodeId: node.id, kind: "free", title: "Y" }))
        .code,
    ).toBe("conflict");
    expect(
      thrown(() =>
        t.service.createDocument(t.she, {
          nodeId: sec.study_guides as string,
          kind: "free",
          title: "Y",
        }),
      ).code,
    ).toBe("invalid_input");
    expect(
      thrown(() =>
        t.service.createDocument(t.bobUser, { nodeId: node.id, kind: "free", title: "Y" }),
      ).code,
    ).toBe("not_found");
  });

  it("rolls the new node back when the blocks are refused", () => {
    const t = setupDocs();
    const { sec } = t.spine();
    const err = thrown(() =>
      t.service.createDocument(t.bot, {
        parentId: sec.study_guides as string,
        kind: "study_guide",
        title: "Bad",
        blocks: [para("no citation")],
      }),
    );
    expect(err.code).toBe("invalid_input");
    expect(t.library.list(t.alice, { parentId: sec.study_guides as string }).items).toHaveLength(0);
  });
});

describe("writer operations", () => {
  function fixture() {
    const t = setupDocs();
    const made = t.newDoc(t.she, [heading("A"), para("one"), para("two"), para("three")]);
    const ids = made.blockIds;
    return { t, doc: made.documentId, ids };
  }
  const order = (t: ReturnType<typeof setupDocs>, doc: string) =>
    t.service.getDocument(t.she, doc).document.blockIds;

  it("insert_blocks at start, end, after, before, index", () => {
    const { t, doc, ids } = fixture();
    const add = (position: unknown, text: string) =>
      t.service.insertBlocks(t.she, { documentId: doc, blocks: [para(text)], position } as never)
        .blockIds[0] as string;
    const s = add("start", "s");
    const e = add("end", "e");
    const a = add({ after: ids[1] }, "a");
    const b = add({ before: ids[1] }, "b");
    const i = add({ index: 2 }, "i");
    expect(order(t, doc)).toEqual([s, ids[0], i, b, ids[1], a, ids[2], ids[3], e]);
    // default position is the end
    const d = t.service.insertBlocks(t.she, { documentId: doc, blocks: [para("d")] }).blockIds[0];
    expect(order(t, doc).at(-1)).toBe(d);
    // unknown anchor
    expect(thrown(() => add({ after: newId("block") }, "z")).code).toBe("not_found");
  });

  it("update_block replace and patch", () => {
    const { t, doc, ids } = fixture();
    const r = t.service.updateBlock(t.she, {
      mode: "replace",
      documentId: doc,
      blockId: ids[1] as string,
      block: heading("Now a heading", 1),
    });
    expect(r.block).toMatchObject({ id: ids[1], type: "heading", origin: "user" });
    const p = t.service.updateBlock(t.she, {
      mode: "patch",
      documentId: doc,
      blockId: ids[2] as string,
      patch: { content: { text: "patched" }, style: { color: "red" } },
    });
    expect(p.block).toMatchObject({ type: "paragraph", style: { color: "red" } });
    expect(JSON.stringify(p.block.content)).toContain("patched");
    const cleared = t.service.updateBlock(t.she, {
      mode: "patch",
      documentId: doc,
      blockId: ids[2] as string,
      patch: { style: null },
    });
    expect(cleared.block.style).toBeUndefined();
    expect(t.service.getBlock(t.she, doc, ids[2] as string).id).toBe(ids[2]);
  });

  it("move_blocks within a document keeps the requested order", () => {
    const { t, doc, ids } = fixture();
    t.service.moveBlocks(t.she, {
      documentId: doc,
      blockIds: [ids[3], ids[1]] as string[],
      position: "start",
    });
    expect(order(t, doc)).toEqual([ids[3], ids[1], ids[0], ids[2]]);
    t.service.moveBlocks(t.she, {
      documentId: doc,
      blockIds: [ids[0]] as string[],
      position: { after: ids[2] as string },
    });
    expect(order(t, doc)).toEqual([ids[3], ids[1], ids[2], ids[0]]);
    expect(
      thrown(() =>
        t.service.moveBlocks(t.she, {
          documentId: doc,
          blockIds: [ids[0]] as string[],
          position: { after: ids[0] as string },
        }),
      ).code,
    ).toBe("invalid_input");
    expect(
      thrown(() =>
        t.service.moveBlocks(t.she, {
          documentId: doc,
          blockIds: [ids[0], ids[0]] as string[],
          position: "end",
        }),
      ).code,
    ).toBe("invalid_input");
  });

  it("move_blocks to another document bumps both revisions", () => {
    const { t, doc, ids } = fixture();
    const other = t.newDoc(t.she, [para("x")], "Other");
    const r = t.service.moveBlocks(t.she, {
      documentId: doc,
      blockIds: [ids[1]] as string[],
      position: "start",
      toDocumentId: other.documentId,
    });
    expect(r).toMatchObject({ revision: 2, toDocumentId: other.documentId, toRevision: 2 });
    expect(order(t, doc)).toEqual([ids[0], ids[2], ids[3]]);
    expect(order(t, other.documentId)[0]).toBe(ids[1]);
    expect(t.service.getBlock(t.she, other.documentId, ids[1] as string).id).toBe(ids[1]);
    // not someone else's document
    const theirs = t.newDoc(t.bobUser, [para("b")], "Theirs");
    expect(
      thrown(() =>
        t.service.moveBlocks(t.she, {
          documentId: doc,
          blockIds: [ids[0]] as string[],
          position: "end",
          toDocumentId: theirs.documentId,
        }),
      ).code,
    ).toBe("not_found");
  });

  it("delete_blocks removes blocks and reports them", () => {
    const { t, doc, ids } = fixture();
    const r = t.service.deleteBlocks(t.she, {
      documentId: doc,
      blockIds: [ids[1], ids[3]] as string[],
    });
    expect(r.removed).toEqual([ids[1], ids[3]]);
    expect(order(t, doc)).toEqual([ids[0], ids[2]]);
    expect(
      thrown(() =>
        t.service.deleteBlocks(t.she, { documentId: doc, blockIds: [ids[1]] as string[] }),
      ).code,
    ).toBe("not_found");
  });

  it("replace_generated replaces overwritable blocks where the first stood", () => {
    const t = setupDocs();
    const made = t.newDoc(t.bot, [general("old 1"), general("old 2"), general("old 3")]);
    const r = t.service.replaceGenerated(t.bot, {
      documentId: made.documentId,
      blocks: [general("new 1"), general("new 2")],
    });
    expect(r.removed).toEqual(made.blockIds);
    expect(r.written).toHaveLength(2);
    expect(r.skipped).toEqual([]);
    expect(t.service.getDocument(t.she, made.documentId).document.blockIds).toEqual(r.written);
  });

  it("replace_generated respects scope", () => {
    const t = setupDocs();
    const made = t.newDoc(t.bot, [general("a"), general("b"), general("c")]);
    const [a, b, c] = made.blockIds as [string, string, string];
    const r = t.service.replaceGenerated(t.bot, {
      documentId: made.documentId,
      blocks: [general("B2")],
      scope: [b],
    });
    expect(t.service.getDocument(t.she, made.documentId).document.blockIds).toEqual([
      a,
      ...r.written,
      c,
    ]);
    expect(
      thrown(() =>
        t.service.replaceGenerated(t.bot, {
          documentId: made.documentId,
          blocks: [],
          scope: [newId("block")],
        }),
      ).code,
    ).toBe("not_found");
  });

  it("an operation that changes nothing does not bump the revision", () => {
    const t = setupDocs();
    const made = t.newDoc(t.she, [para("x")]);
    const r = t.service.replaceGenerated(t.she, {
      documentId: made.documentId,
      blocks: [],
      scope: [made.blockIds[0] as string],
    });
    expect(r.removed).toHaveLength(1);
    const again = t.service.replaceGenerated(t.she, { documentId: made.documentId, blocks: [] });
    expect(again.revision).toBe(2);
    expect(t.service.getDocument(t.she, made.documentId).document.revision).toBe(2);
  });

  it("refuses more than 1000 blocks", () => {
    const t = setupDocs();
    const made = t.newDoc(t.she, []);
    for (let i = 0; i < 10; i++) {
      t.service.insertBlocks(t.she, {
        documentId: made.documentId,
        blocks: Array.from({ length: 100 }, () => para("x")),
      });
    }
    expect(
      thrown(() =>
        t.service.insertBlocks(t.she, { documentId: made.documentId, blocks: [para("x")] }),
      ).code,
    ).toBe("invalid_input");
  });
});

describe("the citation rule", () => {
  it("refuses an agent paragraph without a citation, with the rule and an example", () => {
    const t = setupDocs();
    const made = t.newDoc(t.she, []);
    const err = thrown(() =>
      t.service.insertBlocks(t.bot, {
        documentId: made.documentId,
        blocks: [heading("ok"), para("no source")],
      }),
    );
    expect(err.code).toBe("invalid_input");
    expect(err.message).toContain("$.blocks[1].citations");
    expect(err.message).toContain("no citation");
    expect(err.message).toContain("generalKnowledge");
    expect(err.example).toMatchObject({ type: "paragraph" });
    // nothing was written
    expect(t.service.getDocument(t.she, made.documentId).document.revision).toBe(1);
  });

  it("accepts cited blocks, generalKnowledge, structural blocks and her blocks", () => {
    const t = setupDocs();
    const page = t.addPage();
    const made = t.newDoc(t.she, []);
    const blocks = [
      para("cited", [page.citation]),
      general("not from notes"),
      heading("structural"),
      { type: "divider" },
      { type: "checklist", content: { items: ["a"] } },
    ];
    expect(
      t.service.insertBlocks(t.bot, { documentId: made.documentId, blocks }).blockIds,
    ).toHaveLength(5);
    expect(
      t.service.insertBlocks(t.she, {
        documentId: made.documentId,
        blocks: [para("hers, no cite")],
      }).blockIds,
    ).toHaveLength(1);
  });

  it("counts a citation on a field of a drug card", () => {
    const t = setupDocs();
    const page = t.addPage();
    const made = t.newDoc(t.she, []);
    const card = {
      type: "drug_card",
      content: {
        name: "metoprolol",
        dosingNotes: [{ text: "25 mg", citations: [page.citation], flags: [{ kind: "dose" }] }],
      },
    };
    expect(
      t.service.insertBlocks(t.bot, { documentId: made.documentId, blocks: [card as never] })
        .blockIds,
    ).toHaveLength(1);
  });

  it("applies to patches and replacements by an agent", () => {
    const t = setupDocs();
    const made = t.newDoc(t.bot, [general("g")]);
    const id = made.blockIds[0] as string;
    const err = thrown(() =>
      t.service.updateBlock(t.bot, {
        mode: "patch",
        documentId: made.documentId,
        blockId: id,
        patch: { generalKnowledge: false },
      }),
    );
    expect(err.code).toBe("invalid_input");
    expect(err.message).toContain("$.patch");
    expect(
      thrown(() =>
        t.service.updateBlock(t.bot, {
          mode: "replace",
          documentId: made.documentId,
          blockId: id,
          block: para("x") as never,
        }),
      ).message,
    ).toContain("$.block.citations");
  });

  it("checks new citations against the source lookup", () => {
    const t = setupDocs({ strictSources: true });
    const page = t.addPage();
    const made = t.newDoc(t.she, []);
    const ok = () =>
      t.service.insertBlocks(t.bot, {
        documentId: made.documentId,
        blocks: [para("x", [page.citation])],
      });
    expect(ok().blockIds).toHaveLength(1);
    // invented quote
    const bad = thrown(() =>
      t.service.insertBlocks(t.bot, {
        documentId: made.documentId,
        blocks: [para("x", [{ ...page.citation, quote: "Made up sentence." }])],
      }),
    );
    expect(bad.message).toContain("$.blocks[0].citations[0]");
    expect(bad.message).toContain("character for character");
    // unknown page
    const ghost = t.addPage();
    t.sources.purge(ghost.fileId);
    expect(
      thrown(() =>
        t.service.insertBlocks(t.bot, {
          documentId: made.documentId,
          blocks: [para("x", [ghost.citation])],
        }),
      ).message,
    ).toContain("not in her library");
    // trashed
    t.sources.trash(page.fileId);
    expect(
      thrown(() =>
        t.service.insertBlocks(t.bot, {
          documentId: made.documentId,
          blocks: [para("x", [page.citation])],
        }),
      ).message,
    ).toContain("trash");
    // she is exempt from lookups
    expect(
      t.service.insertBlocks(t.she, {
        documentId: made.documentId,
        blocks: [para("x", [page.citation])],
      }).blockIds,
    ).toHaveLength(1);
  });
});

describe("edit protection", () => {
  function setup() {
    const t = setupDocs();
    const made = t.newDoc(t.bot, [
      general("agent plain"),
      general("agent edited by her"),
      general("agent reviewed"),
      general("agent untouched"),
    ]);
    const [plain, edited, reviewed, untouched] = made.blockIds as [string, string, string, string];
    t.service.updateBlock(t.she, {
      mode: "patch",
      documentId: made.documentId,
      blockId: edited,
      patch: { content: { text: "her edit" } },
    });
    t.service.setReview(t.she, {
      documentId: made.documentId,
      status: "reviewed",
      blockIds: [reviewed],
    });
    const hers = t.service.insertBlocks(t.she, {
      documentId: made.documentId,
      blocks: [para("she wrote this")],
    }).blockIds[0] as string;
    return { t, doc: made.documentId, plain, edited, reviewed, untouched, hers };
  }

  it("lets an agent overwrite and delete only blocks that are hers-free", () => {
    const { t, doc, plain, untouched } = setup();
    expect(
      t.service.updateBlock(t.bot, {
        mode: "patch",
        documentId: doc,
        blockId: plain,
        patch: { content: { text: "v2" } },
      }).block.origin,
    ).toBe("agent");
    expect(
      t.service.deleteBlocks(t.otherBot, { documentId: doc, blockIds: [untouched] }).removed,
    ).toEqual([untouched]);
  });

  for (const which of ["edited", "reviewed", "hers"] as const) {
    it(`refuses an agent patch, replace and delete of a block that is ${which}`, () => {
      const f = setup();
      const id = f[which];
      const patch = thrown(() =>
        f.t.service.updateBlock(f.t.bot, {
          mode: "patch",
          documentId: f.doc,
          blockId: id,
          patch: { content: { text: "x" } },
        }),
      );
      expect(patch.code).toBe("forbidden");
      expect(patch.message).toContain(which === "reviewed" ? "reviewed" : "wrote or edited");
      expect(patch.message).toContain("requestId");
      expect(patch.hint).toContain("requestId");
      expect(
        thrown(() =>
          f.t.service.updateBlock(f.t.bot, {
            mode: "replace",
            documentId: f.doc,
            blockId: id,
            block: general("x") as never,
          }),
        ).code,
      ).toBe("forbidden");
      expect(
        thrown(() => f.t.service.deleteBlocks(f.t.bot, { documentId: f.doc, blockIds: [id] })).code,
      ).toBe("forbidden");
      expect(f.t.service.getDocument(f.t.she, f.doc).document.blockIds).toContain(id);
    });

    it(`allows it with a request id when the block is ${which}`, () => {
      const f = setup();
      const id = f[which];
      const r = f.t.service.updateBlock(f.t.bot, {
        mode: "patch",
        documentId: f.doc,
        blockId: id,
        patch: { content: { text: "asked" }, generalKnowledge: true },
        requestId: REQ,
      });
      // agent rewriting at her request makes it agent's, unverified again
      expect(r.block).toMatchObject({ origin: "agent", review: { status: "unverified" } });
      const del = f.t.service.deleteBlocks(f.t.bot, {
        documentId: f.doc,
        blockIds: [id],
        requestId: REQ,
      });
      expect(del.removed).toEqual([id]);
      const changes = f.t.feed.changesSince(f.t.alice, "0", 100).items;
      expect(changes.filter((c) => c.requestId === REQ)).toHaveLength(2);
    });
  }

  it("a delete naming several blocks is refused as a whole and names the protected ones", () => {
    const { t, doc, plain, edited, reviewed } = setup();
    const err = thrown(() =>
      t.service.deleteBlocks(t.bot, { documentId: doc, blockIds: [plain, edited, reviewed] }),
    );
    expect(err.message).toContain(edited);
    expect(err.message).toContain(reviewed);
    expect(err.message).not.toContain(plain);
    expect(t.service.getDocument(t.she, doc).document.blockIds).toContain(plain);
  });

  it("she is never held back, and moving protected blocks is allowed", () => {
    const { t, doc, edited, reviewed } = setup();
    expect(
      t.service.updateBlock(t.she, {
        mode: "patch",
        documentId: doc,
        blockId: reviewed,
        patch: { content: { text: "mine" } },
      }).block.origin,
    ).toBe("user");
    t.service.moveBlocks(t.bot, { documentId: doc, blockIds: [edited], position: "start" });
    expect(t.service.getDocument(t.she, doc).document.blockIds[0]).toBe(edited);
  });

  it("un-reviewing an agent block makes it overwritable again", () => {
    const { t, doc, reviewed } = setup();
    t.service.setReview(t.she, { documentId: doc, status: "unverified", blockIds: [reviewed] });
    expect(
      t.service.deleteBlocks(t.bot, { documentId: doc, blockIds: [reviewed] }).removed,
    ).toEqual([reviewed]);
  });

  it("regeneration keeps her blocks and reports why", () => {
    const { t, doc, plain, edited, reviewed, untouched, hers } = setup();
    const r = t.service.replaceGenerated(t.bot, { documentId: doc, blocks: [general("fresh")] });
    expect(r.removed.sort()).toEqual([plain, untouched].sort());
    expect(r.skipped).toEqual(
      expect.arrayContaining([
        { blockId: edited, type: "paragraph", reason: "user_edited" },
        { blockId: reviewed, type: "paragraph", reason: "reviewed" },
        { blockId: hers, type: "paragraph", reason: "user_edited" },
      ]),
    );
    expect(r.skipped).toHaveLength(3);
    const ids = t.service.getDocument(t.she, doc).document.blockIds;
    expect(ids).toEqual([r.written[0], edited, reviewed, hers]);
  });

  it("regeneration with a request id replaces hers too", () => {
    const { t, doc } = setup();
    const r = t.service.replaceGenerated(t.bot, {
      documentId: doc,
      blocks: [general("fresh")],
      requestId: REQ,
    });
    expect(r.skipped).toEqual([]);
    expect(t.service.getDocument(t.she, doc).document.blockIds).toEqual(r.written);
  });

  it("restoring an old revision cannot be used to get round protection", () => {
    const { t, doc } = setup();
    // revision 1 holds the agent's blocks as first written, before she edited them
    const err = thrown(() => t.service.restoreRevision(t.bot, { documentId: doc, revision: 1 }));
    expect(err.code).toBe("forbidden");
    expect(err.message).toContain("ask her to restore");
    expect(t.service.restoreRevision(t.she, { documentId: doc, revision: 1 }).restoredFrom).toBe(1);
  });
});

describe("batches and concurrency", () => {
  it("applies every operation or none", () => {
    const t = setupDocs();
    const a = t.newDoc(t.she, [para("a1"), para("a2")], "A");
    const b = t.newDoc(t.she, [para("b1")], "B");
    const before = {
      a: t.service.getFull(t.she, a.documentId),
      b: t.service.getFull(t.she, b.documentId),
    };
    const feedBefore = t.feed.latestCursor(t.alice);
    const err = thrown(() =>
      t.service.batch(t.she, [
        { operation: "insert_blocks", input: { documentId: a.documentId, blocks: [para("new")] } },
        {
          operation: "delete_blocks",
          input: { documentId: b.documentId, blockIds: [b.blockIds[0]] },
        },
        {
          operation: "delete_blocks",
          input: { documentId: a.documentId, blockIds: [newId("block")] },
        },
      ]),
    );
    expect(err.code).toBe("not_found");
    expect(t.service.getFull(t.she, a.documentId)).toEqual(before.a);
    expect(t.service.getFull(t.she, b.documentId)).toEqual(before.b);
    expect(t.feed.latestCursor(t.alice)).toBe(feedBefore);
    expect(t.service.listRevisions(t.she, a.documentId).items).toHaveLength(1);
  });

  it("rolls back a validation failure in operation 2 with its index in the path", () => {
    const t = setupDocs();
    const a = t.newDoc(t.she, [para("a1")]);
    const err = thrown(() =>
      t.service.batch(t.bot, [
        {
          operation: "insert_blocks",
          input: { documentId: a.documentId, blocks: [general("fine")] },
        },
        {
          operation: "insert_blocks",
          input: { documentId: a.documentId, blocks: [para("no cite")] },
        },
      ]),
    );
    expect(err.message).toContain("$.operations[1].input.blocks[0].citations");
    expect(t.service.getDocument(t.she, a.documentId).document.revision).toBe(1);
  });

  it("gives a document one revision per batch, and results carry it", () => {
    const t = setupDocs();
    const a = t.newDoc(t.she, [para("a1")]);
    const results = t.service.batch(t.she, [
      { operation: "insert_blocks", input: { documentId: a.documentId, blocks: [para("x")] } },
      {
        operation: "insert_blocks",
        input: { documentId: a.documentId, blocks: [para("y")], expectedRevision: 1 },
      },
    ]);
    expect(results.map((r) => (r as { revision: number }).revision)).toEqual([2, 2]);
    expect(t.service.getDocument(t.she, a.documentId).document).toMatchObject({ revision: 2 });
    expect(t.service.getDocument(t.she, a.documentId).document.blockIds).toHaveLength(3);
  });

  it("a stale expectedRevision gets conflict with a hint to re-read", () => {
    const t = setupDocs();
    const a = t.newDoc(t.she, [para("a1")]);
    t.service.insertBlocks(t.bot, {
      documentId: a.documentId,
      blocks: [general("x")],
      expectedRevision: 1,
    });
    const err = thrown(() =>
      t.service.insertBlocks(t.otherBot, {
        documentId: a.documentId,
        blocks: [general("y")],
        expectedRevision: 1,
      }),
    );
    expect(err.code).toBe("conflict");
    expect(err.message).toContain("revision 2");
    expect(err.hint).toContain("Read it again");
    expect(err.example).toEqual({ expectedRevision: 2 });
    expect(
      t.service.insertBlocks(t.otherBot, {
        documentId: a.documentId,
        blocks: [general("y")],
        expectedRevision: 2,
      }).revision,
    ).toBe(3);
    // not setting it means last write wins
    expect(
      t.service.insertBlocks(t.otherBot, { documentId: a.documentId, blocks: [general("z")] })
        .revision,
    ).toBe(4);
  });

  it("refuses unknown operations and empty batches", () => {
    const t = setupDocs();
    expect(thrown(() => t.service.batch(t.she, [])).code).toBe("invalid_input");
    expect(
      thrown(() => t.service.batch(t.she, [{ operation: "nope" as never, input: {} }])).code,
    ).toBe("invalid_input");
  });

  it("read-only keys cannot write, whatever the route", () => {
    const t = setupDocs();
    const a = t.newDoc(t.she, [para("a1")]);
    const ro = agentAuth(t.alice, newId("apiKey"), "read");
    expect(
      thrown(() => t.service.insertBlocks(ro, { documentId: a.documentId, blocks: [general("x")] }))
        .code,
    ).toBe("read_only_key");
    expect(t.service.getDocument(ro, a.documentId).document.id).toBe(a.documentId);
  });

  it("every user's object is not_found to someone else", () => {
    const t = setupDocs();
    const a = t.newDoc(t.she, [para("a1")]);
    const id = a.blockIds[0] as string;
    const get = (fn: () => unknown) => thrown(fn).code;
    expect(get(() => t.service.getDocument(t.bobUser, a.documentId))).toBe("not_found");
    expect(get(() => t.service.getFull(t.bobUser, a.documentId))).toBe("not_found");
    expect(get(() => t.service.getBlock(t.bobUser, a.documentId, id))).toBe("not_found");
    expect(
      get(() =>
        t.service.insertBlocks(t.bobUser, { documentId: a.documentId, blocks: [para("x")] }),
      ),
    ).toBe("not_found");
    expect(
      get(() => t.service.deleteBlocks(t.bobUser, { documentId: a.documentId, blockIds: [id] })),
    ).toBe("not_found");
    expect(get(() => t.service.listRevisions(t.bobUser, a.documentId))).toBe("not_found");
    expect(get(() => t.service.references(t.bobUser, a.documentId))).toBe("not_found");
    expect(
      get(() => t.service.setReview(t.bobUser, { documentId: a.documentId, status: "reviewed" })),
    ).toBe("not_found");
    expect(get(() => t.service.getDocumentByNode(t.bobUser, a.nodeId))).toBe("not_found");
  });
});

describe("review", () => {
  it("only a browser session can verify, and review bumps the revision", () => {
    const t = setupDocs();
    const made = t.newDoc(t.bot, [general("a"), general("b")]);
    expect(
      thrown(() => t.service.setReview(t.bot, { documentId: made.documentId, status: "reviewed" }))
        .code,
    ).toBe("forbidden");
    const viaKey = { ...t.she, via: "key" as const };
    expect(
      thrown(() => t.service.setReview(viaKey, { documentId: made.documentId, status: "reviewed" }))
        .code,
    ).toBe("forbidden");
    const r = t.service.setReview(t.she, {
      documentId: made.documentId,
      status: "reviewed",
      blockIds: [made.blockIds[0] as string],
    });
    expect(r).toMatchObject({ revision: 2, changed: 1 });
    expect(t.service.getDocument(t.she, made.documentId)).toMatchObject({
      unverifiedCount: 1,
      document: { reviewStatus: "unverified" },
    });
    const all = t.service.setReview(t.she, { documentId: made.documentId, status: "reviewed" });
    expect(all.changed).toBe(1);
    expect(t.service.getDocument(t.she, made.documentId).document.reviewStatus).toBe("reviewed");
    // reviewing is not editing
    const [first] = t.service.getFull(t.she, made.documentId).blocks;
    expect(first).toMatchObject({ origin: "agent", provenance: { lastEditedBy: t.bot.actor } });
    // nothing to change, no new revision
    expect(
      t.service.setReview(t.she, { documentId: made.documentId, status: "reviewed" }).changed,
    ).toBe(0);
    expect(t.service.getDocument(t.she, made.documentId).document.revision).toBe(3);
    // stale view
    expect(
      thrown(() =>
        t.service.setReview(t.she, {
          documentId: made.documentId,
          status: "unverified",
          expectedRevision: 1,
        }),
      ).code,
    ).toBe("conflict");
  });
});
