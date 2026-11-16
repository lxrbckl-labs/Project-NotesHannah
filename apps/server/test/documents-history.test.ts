import { citationKey, newId } from "@notes/schema";
import { describe, expect, it } from "vitest";
import { general, heading, para, QUOTE, setupDocs, thrown } from "./documents-helpers.js";

describe("revisions", () => {
  it("every write is a full snapshot, and restore appends instead of rewriting", () => {
    const t = setupDocs();
    const made = t.newDoc(t.she, [para("one"), para("two")]);
    const doc = made.documentId;
    t.service.insertBlocks(t.she, { documentId: doc, blocks: [para("three")] });
    t.service.deleteBlocks(t.she, { documentId: doc, blockIds: [made.blockIds[0] as string] });
    expect(t.service.getDocument(t.she, doc).document.revision).toBe(3);

    const before = [1, 2, 3].map((n) => t.service.getRevision(t.she, doc, n));
    expect(before.map((r) => r.snapshot.blocks.length)).toEqual([2, 3, 2]);
    expect(before[1]?.summary).toBe("Inserted 1 block");

    const restored = t.service.restoreRevision(t.she, { documentId: doc, revision: 1 });
    expect(restored).toMatchObject({ revision: 4, restoredFrom: 1, blockCount: 2 });
    expect(t.service.getDocument(t.she, doc).document.blockIds).toEqual(made.blockIds);

    // history 1..3 is byte-for-byte what it was; 4 is new and marked
    expect([1, 2, 3].map((n) => t.service.getRevision(t.she, doc, n))).toEqual(before);
    const four = t.service.getRevision(t.she, doc, 4);
    expect(four).toMatchObject({ number: 4, restoredFrom: 1, summary: "Restored revision 1" });
    expect(four.snapshot.blocks.map((b) => b.id)).toEqual(made.blockIds);

    // a restore can itself be undone: revision 3 is still there
    t.service.restoreRevision(t.she, { documentId: doc, revision: 3 });
    expect(t.service.getFull(t.she, doc).blocks).toHaveLength(2);
    expect(t.service.getDocument(t.she, doc).document.revision).toBe(5);
    const list = t.service.listRevisions(t.she, doc);
    expect(list.items.map((r) => r.number)).toEqual([5, 4, 3, 2, 1]);
    expect(list.items[0]).toMatchObject({ restoredFrom: 3, blockCount: 2 });
    expect("snapshot" in (list.items[0] as object)).toBe(false);
    expect(thrown(() => t.service.getRevision(t.she, doc, 99)).code).toBe("not_found");
  });

  it("restoring brings back title and kind and keeps recorded provenance", () => {
    const t = setupDocs();
    const made = t.newDoc(t.bot, [general("agent text")]);
    t.service.setReview(t.she, { documentId: made.documentId, status: "reviewed" });
    t.service.deleteBlocks(t.she, { documentId: made.documentId, blockIds: made.blockIds });
    t.service.restoreRevision(t.she, { documentId: made.documentId, revision: 2 });
    const [block] = t.service.getFull(t.she, made.documentId).blocks;
    expect(block).toMatchObject({
      id: made.blockIds[0],
      origin: "agent",
      review: { status: "reviewed" },
    });
    expect(block?.provenance.createdBy).toEqual(t.bot.actor);
  });

  it("keeps only the newest revisions plus the first when over the cap, and says so", () => {
    const t = setupDocs({ revisionCap: 5 });
    const made = t.newDoc(t.she, []);
    for (let i = 0; i < 12; i++)
      t.service.insertBlocks(t.she, { documentId: made.documentId, blocks: [para(`p${i}`)] });
    expect(t.service.getDocument(t.she, made.documentId).document.revision).toBe(13);
    const kept = t.service
      .listRevisions(t.she, made.documentId, { limit: 50 })
      .items.map((r) => r.number);
    expect(kept).toEqual([13, 12, 11, 10, 9, 1]);
    const gone = thrown(() =>
      t.service.restoreRevision(t.she, { documentId: made.documentId, revision: 4 }),
    );
    expect(gone.code).toBe("not_found");
    expect(gone.hint).toContain("newest 5");
    expect(gone.hint).toContain("oldest of those is 9");
    // the current state is always among the snapshots, so a restore never loses it
    t.service.restoreRevision(t.she, { documentId: made.documentId, revision: 1 });
    expect(t.service.getRevision(t.she, made.documentId, 13).snapshot.blocks).toHaveLength(12);
  });

  it("pages the history", () => {
    const t = setupDocs();
    const made = t.newDoc(t.she, []);
    for (let i = 0; i < 4; i++)
      t.service.insertBlocks(t.she, { documentId: made.documentId, blocks: [para("x")] });
    const first = t.service.listRevisions(t.she, made.documentId, { limit: 2 });
    expect(first.items.map((r) => r.number)).toEqual([5, 4]);
    const second = t.service.listRevisions(t.she, made.documentId, {
      limit: 2,
      cursor: first.nextCursor as string,
    });
    expect(second.items.map((r) => r.number)).toEqual([3, 2]);
    expect(
      thrown(() => t.service.listRevisions(t.she, made.documentId, { cursor: "garbage" })).code,
    ).toBe("invalid_input");
  });
});

describe("references", () => {
  it("numbers de-duplicated citations in order and resolves sources", () => {
    const t = setupDocs();
    const p1 = t.addPage();
    const p2 = t.addPage();
    const other = { ...p2.citation, quote: "Second quote." };
    t.sources.setTranscript(p2.pageId, `${QUOTE} Second quote. And more.`);
    const made = t.newDoc(t.bot, [
      para("first", [p2.citation]),
      para("second", [p1.citation, p2.citation]),
      {
        type: "drug_card",
        content: {
          name: "metoprolol",
          dosingNotes: [{ text: "25 mg", citations: [other], flags: [{ kind: "dose" }] }],
        },
        citations: [p1.citation],
      },
    ]);
    const { items, revision } = t.service.references(t.she, made.documentId);
    expect(revision).toBe(1);
    expect(items.map((r) => [r.number, r.citation.pageId])).toEqual([
      [1, p2.pageId],
      [2, p1.pageId],
      [3, p2.pageId],
    ]);
    expect(items[0]?.uses).toHaveLength(2);
    expect(items[0]?.citation).toBeDefined();
    expect(citationKey(items[1]?.citation as never)).toBe(citationKey(p1.citation as never));
    expect(items[1]).toMatchObject({
      status: "available",
      fileName: "Lecture 7.pdf",
      pageIndex: 12,
      unavailable: false,
      quoteStillPresent: true,
    });
    expect(items[2]?.uses[0]?.field).toBe("$.content.dosingNotes[0]");
    expect(items[2]?.quoteStillPresent).toBe(true);
  });

  it("shows trashed and deleted sources as unavailable and restores them, never touching blocks", () => {
    const t = setupDocs();
    const a = t.addPage();
    const b = t.addPage();
    const made = t.newDoc(t.bot, [para("a", [a.citation]), para("b", [b.citation])]);
    const blocksBefore = t.service.getFull(t.she, made.documentId).blocks;
    t.sources.trash(a.fileId);
    t.sources.purge(b.fileId);
    const [ra, rb] = t.service.references(t.she, made.documentId).items;
    expect(ra).toMatchObject({
      status: "source_trashed",
      unavailable: true,
      fileName: "Lecture 7.pdf",
    });
    expect(rb).toMatchObject({
      status: "source_deleted",
      unavailable: true,
      fileName: null,
      pageIndex: null,
    });
    expect(t.service.getFull(t.she, made.documentId).blocks).toEqual(blocksBefore);
    expect(t.service.getDocument(t.she, made.documentId).document.revision).toBe(1);
    t.sources.restore(a.fileId);
    expect(t.service.references(t.she, made.documentId).items[0]?.status).toBe("available");
  });

  it("reports quotes that no longer occur after a transcript changes", () => {
    const t = setupDocs();
    const a = t.addPage();
    const made = t.newDoc(t.bot, [para("a", [a.citation])]);
    t.sources.setTranscript(a.pageId, "Rewritten transcript.");
    expect(t.service.references(t.she, made.documentId).items[0]).toMatchObject({
      quoteStillPresent: false,
      currentTranscriptRevision: 2,
    });
  });

  it("the default lookup reports every source as available", () => {
    const t = setupDocs();
    const a = t.addPage();
    // a service with no ports at all
    const bare = setupDocs();
    const made = bare.newDoc(bare.bot, [para("a", [a.citation])]);
    const [r] = bare.service.references(bare.she, made.documentId).items;
    expect(r).toMatchObject({
      status: "available",
      unavailable: false,
      fileName: null,
      quoteStillPresent: null,
    });
  });
});

describe("reverse citation lookup", () => {
  it("lists what cites a page or a file, with trashed documents flagged", () => {
    const t = setupDocs();
    const a = t.addPage();
    const b = t.addPage();
    const d1 = t.newDoc(t.bot, [para("x", [a.citation]), para("y", [b.citation])], "Guide one");
    const d2 = t.newDoc(
      t.bot,
      [
        {
          type: "drug_card",
          content: {
            name: "m",
            dosingNotes: [{ text: "5 mg", citations: [a.citation], flags: [{ kind: "dose" }] }],
          },
          generalKnowledge: true,
        },
      ],
      "Guide two",
    );
    const forPage = t.service.citedBy(t.she, { pageId: a.pageId });
    expect(forPage.fileId).toBe(a.fileId);
    expect(forPage.items.map((i) => [i.title, i.itemType, i.location])).toEqual([
      [
        "Guide one",
        "paragraph",
        { kind: "block", documentId: d1.documentId, blockId: d1.blockIds[0], field: null },
      ],
      [
        "Guide two",
        "drug_card",
        {
          kind: "block",
          documentId: d2.documentId,
          blockId: d2.blockIds[0],
          field: "$.content.dosingNotes[0]",
        },
      ],
    ]);
    expect(forPage.items[0]).toMatchObject({
      quote: a.citation.quote,
      trashed: false,
      nodeId: d1.nodeId,
    });
    expect(t.service.citedBy(t.she, { fileId: b.fileId }).items).toHaveLength(1);

    t.service.onNodeTrashed(t.alice, [d1.nodeId]);
    expect(t.service.citedBy(t.she, { pageId: a.pageId }).items.map((i) => i.trashed)).toEqual([
      true,
      false,
    ]);

    // she changes the block: the index follows
    t.service.deleteBlocks(t.she, { documentId: d2.documentId, blockIds: d2.blockIds });
    expect(t.service.citedBy(t.she, { pageId: a.pageId }).items).toHaveLength(1);
    expect(t.service.citedBy(t.she, { pageId: newId("page") })).toMatchObject({
      items: [],
      fileId: null,
    });
  });

  it("is private to the user and pages", () => {
    const t = setupDocs();
    const a = t.addPage();
    t.newDoc(t.bot, [para("x", [a.citation])]);
    expect(t.service.citedBy(t.bobUser, { pageId: a.pageId }).items).toEqual([]);
    const page1 = t.service.citedBy(t.she, { pageId: a.pageId }, { limit: 1 });
    expect(page1.nextCursor).toBeNull();
  });
});

describe("search", () => {
  it("finds block text with snippets, scoped to the user, excluding trashed documents", () => {
    const t = setupDocs();
    const made = t.newDoc(t.she, [
      heading("Beta blockers"),
      para("Metoprolol is a cardioselective agent"),
      para("Unrelated heparin note"),
    ]);
    const theirs = t.newDoc(t.bobUser, [para("Metoprolol in Bob's notes")], "Bob's");
    const hits = t.service.searchDocuments(t.alice, "cardioselect");
    expect(hits.items).toHaveLength(1);
    expect(hits.items[0]).toMatchObject({
      documentId: made.documentId,
      blockId: made.blockIds[1],
      blockType: "paragraph",
      documentTitle: "Beta blockers",
    });
    expect(hits.items[0]?.snippet).toContain("cardioselective");
    expect(t.service.searchDocuments(t.alice, "metoprolol").items).toHaveLength(1);
    expect(t.service.searchDocuments(t.bob, "metoprolol").items[0]?.documentId).toBe(
      theirs.documentId,
    );
    expect(t.service.searchDocuments(t.alice, "   ").items).toEqual([]);
    expect(t.service.searchDocuments(t.alice, '"; DROP TABLE blocks; --').items).toEqual([]);

    // follows edits
    t.service.updateBlock(t.she, {
      mode: "patch",
      documentId: made.documentId,
      blockId: made.blockIds[1] as string,
      patch: { content: { text: "Atenolol only" } },
    });
    expect(t.service.searchDocuments(t.alice, "metoprolol").items).toHaveLength(0);
    expect(t.service.searchDocuments(t.alice, "atenolol").items).toHaveLength(1);
    t.service.deleteBlocks(t.she, {
      documentId: made.documentId,
      blockIds: [made.blockIds[1] as string],
    });
    expect(t.service.searchDocuments(t.alice, "atenolol").items).toHaveLength(0);

    // trash hides, restore returns
    expect(t.service.searchDocuments(t.alice, "heparin").items).toHaveLength(1);
    t.service.onNodeTrashed(t.alice, [made.nodeId]);
    expect(t.service.searchDocuments(t.alice, "heparin").items).toHaveLength(0);
    t.service.onNodeRestored(t.alice, [made.nodeId]);
    expect(t.service.searchDocuments(t.alice, "heparin").items).toHaveLength(1);
  });

  it("pages", () => {
    const t = setupDocs();
    t.newDoc(
      t.she,
      Array.from({ length: 5 }, (_, i) => para(`statin number ${i}`)),
    );
    const first = t.service.searchDocuments(t.alice, "statin", { limit: 2 });
    expect(first.items).toHaveLength(2);
    const second = t.service.searchDocuments(t.alice, "statin", {
      limit: 2,
      cursor: first.nextCursor as string,
    });
    expect(second.items).toHaveLength(2);
    expect(new Set([...first.items, ...second.items].map((h) => h.blockId)).size).toBe(4);
  });
});

describe("library node hooks", () => {
  it("trash hides the document everywhere, restore brings it back intact", () => {
    const t = setupDocs();
    const made = t.newDoc(t.bot, [general("hello")]);
    t.service.onNodeTrashed(t.alice, [made.nodeId]);
    for (const read of [
      () => t.service.getDocument(t.she, made.documentId),
      () => t.service.getFull(t.she, made.documentId),
      () => t.service.getDocumentByNode(t.she, made.nodeId),
      () => t.service.references(t.she, made.documentId),
      () => t.service.listRevisions(t.she, made.documentId),
      () => t.service.insertBlocks(t.she, { documentId: made.documentId, blocks: [para("x")] }),
    ]) {
      expect(thrown(read).code).toBe("not_found");
    }
    t.service.onNodeRestored(t.alice, [made.nodeId]);
    expect(t.service.getFull(t.she, made.documentId).blocks).toHaveLength(1);
    expect(t.service.getDocument(t.she, made.documentId).document.trashedAt).toBeNull();
    const actions = t.feed.changesSince(t.alice, "0", 50).items.map((c) => c.action);
    expect(actions).toEqual([
      "document.created",
      "document.trashed",
      "document.restored_from_trash",
    ]);
  });

  it("delete removes the document, blocks, revisions, citations and search entries", () => {
    const t = setupDocs();
    const a = t.addPage();
    const made = t.newDoc(t.bot, [para("uniqueword here", [a.citation])]);
    t.service.onNodeDeleted(t.alice, [made.nodeId]);
    expect(thrown(() => t.service.getDocument(t.she, made.documentId)).code).toBe("not_found");
    const count = (table: string) =>
      (t.db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get() as { n: number }).n;
    expect(count("documents")).toBe(0);
    expect(count("blocks")).toBe(0);
    expect(count("document_revisions")).toBe(0);
    expect(count("document_citations")).toBe(0);
    expect(t.service.searchDocuments(t.alice, "uniqueword").items).toEqual([]);
    expect(
      t.db
        .prepare("SELECT COUNT(*) AS n FROM blocks_fts WHERE blocks_fts MATCH 'uniqueword'")
        .get(),
    ).toEqual({ n: 0 });
    expect(t.feed.changesSince(t.alice, "0", 50).items.at(-1)?.action).toBe("document.deleted");
    // the node can have a document again
    expect(
      t.service.createDocument(t.she, { nodeId: made.nodeId, kind: "free", title: "again" })
        .revision,
    ).toBe(1);
  });

  it("duplicate deep-copies with fresh block ids and leaves the original alone", () => {
    const t = setupDocs();
    const a = t.addPage();
    const made = t.newDoc(t.bot, [para("cite me", [a.citation]), general("two")]);
    t.service.setReview(t.she, {
      documentId: made.documentId,
      status: "reviewed",
      blockIds: [made.blockIds[0] as string],
    });
    const node = t.library.duplicate(t.alice, made.nodeId);
    const copyId = t.service.onNodeDuplicated(t.alice, made.nodeId, node.id) as string;
    expect(copyId).not.toBe(made.documentId);
    const copy = t.service.getFull(t.she, copyId);
    const orig = t.service.getFull(t.she, made.documentId);
    expect(copy.document).toMatchObject({ nodeId: node.id, revision: 1, title: node.name });
    expect(copy.blocks).toHaveLength(2);
    expect(copy.blocks.map((b) => b.id).some((id) => orig.blocks.some((o) => o.id === id))).toBe(
      false,
    );
    expect(copy.blocks.map(({ id: _i, ...rest }) => rest)).toEqual(
      orig.blocks.map(({ id: _i, ...rest }) => rest),
    );
    // the copy is independent
    t.service.deleteBlocks(t.she, { documentId: copyId, blockIds: [copy.blocks[1]?.id as string] });
    expect(t.service.getFull(t.she, made.documentId).blocks).toHaveLength(2);
    // its citations are indexed too, and search sees both
    expect(t.service.citedBy(t.she, { pageId: a.pageId }).items).toHaveLength(2);
    expect(t.service.searchDocuments(t.alice, "cite").items).toHaveLength(2);
    // nothing to copy, or already has one
    const empty = t.library.create(t.alice, {
      parentId: t.library.get(t.alice, made.nodeId).parentId,
      kind: "document",
      name: "Empty",
    });
    expect(t.service.onNodeDuplicated(t.alice, empty.id, node.id)).toBeNull();
    expect(t.service.onNodeDuplicated(t.alice, made.nodeId, node.id)).toBeNull();
  });

  it("hooks only reach the user's own documents", () => {
    const t = setupDocs();
    const made = t.newDoc(t.she, [para("x")]);
    t.service.onNodeTrashed(t.bob, [made.nodeId]);
    t.service.onNodeDeleted(t.bob, [made.nodeId]);
    expect(t.service.getDocument(t.she, made.documentId).document.trashedAt).toBeNull();
  });
});
