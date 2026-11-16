import { describe, expect, it } from "vitest";
import { type Composed, composed, type Json } from "./composed.support.js";
import { heading, para, thrown } from "./documents-helpers.js";

/** A converted two-page file, transcribed (both pages), cited by one block of a document on `nodeId`. */
async function citedLecture(t: Composed, nodeId: string) {
  const { file, pages, bytes } = await t.convertedFile(t.she, { nodeId });
  for (const [i, page] of pages.entries()) {
    t.services.files.saveTranscript(t.bot, {
      pageId: page.id,
      text:
        i === 0
          ? "Beta blockers end in olol. Atenolol is cardioselective."
          : "Never stop abruptly.",
      flags: [],
    });
  }
  const quote = "Atenolol is cardioselective.";
  const doc = t.services.documents.createDocument(t.bot, {
    nodeId,
    kind: "lecture_note",
    title: "Beta blockers",
    blocks: [
      heading("Beta blockers", 1),
      para("Atenolol is cardioselective.", [
        { fileId: file.id, pageId: pages[0]?.id as string, quote, label: "Slide 1" },
      ]),
    ],
  } as never);
  return { file, pages, bytes, doc, quote };
}

describe("library hooks: documents follow their node", () => {
  it("trash, restore and delete reach the documents of the node and everything under it", async () => {
    const t = composed();
    const { sections, lecture } = t.spine();
    const folder = t.services.library.create(t.alice, {
      parentId: sections.lectures as string,
      kind: "folder",
      name: "Cardiology",
    });
    const inner = t.services.library.create(t.alice, {
      parentId: folder.id,
      kind: "lecture",
      name: "Inner lecture",
    });
    const mk = (nodeId: string, text: string) =>
      t.services.documents.createDocument(t.she, {
        nodeId,
        kind: "lecture_note",
        title: text,
        blocks: [para(text)],
      } as never);
    const outerDoc = mk(lecture.id, "outer zebra notes");
    const innerDoc = mk(inner.id, "inner zebra notes");
    const search = () => t.services.documents.searchDocuments(t.alice, "zebra").items.length;
    expect(search()).toBe(2);

    // Trash the folder: the inner document goes, the outer (not under it) stays.
    t.services.library.trash(t.alice, folder.id, t.she.actor);
    expect(thrown(() => t.services.documents.getDocument(t.she, innerDoc.documentId)).code).toBe(
      "not_found",
    );
    expect(() => t.services.documents.getDocument(t.she, outerDoc.documentId)).not.toThrow();
    expect(search()).toBe(1);

    // Trash the course's whole lecture too, then bring the folder back.
    t.services.library.trash(t.alice, lecture.id, t.she.actor);
    expect(search()).toBe(0);
    t.services.library.restore(t.alice, folder.id, t.she.actor);
    expect(search()).toBe(1);
    const back = t.services.documents.getDocument(t.she, innerDoc.documentId);
    expect(back.blocks).toHaveLength(1);
    expect(back.document.revision).toBe(1);
    t.services.library.restore(t.alice, lecture.id, t.she.actor);
    expect(search()).toBe(2);

    // Deleting for good removes the rows, not just hides them.
    t.services.library.trash(t.alice, folder.id, t.she.actor);
    t.services.library.permanentDelete(t.alice, folder.id, t.she.actor);
    const left = t.db.prepare("SELECT id FROM documents").all() as Array<{ id: string }>;
    expect(left.map((r) => r.id)).toEqual([outerDoc.documentId]);
    expect(t.db.prepare("SELECT COUNT(*) AS n FROM blocks").get()).toEqual({ n: 1 });
    const kinds = t.changes().map((c) => c.action);
    expect(kinds).toContain("document.trashed");
    expect(kinds).toContain("document.restored_from_trash");
    expect(kinds).toContain("document.deleted");
  });

  it("duplicating a node deep-copies the documents of the whole subtree with fresh block IDs", () => {
    const t = composed();
    const { sections } = t.spine();
    const folder = t.services.library.create(t.alice, {
      parentId: sections.lectures as string,
      kind: "folder",
      name: "Cardiology",
    });
    const lec = t.services.library.create(t.alice, {
      parentId: folder.id,
      kind: "lecture",
      name: "Inner lecture",
    });
    const made = t.services.documents.createDocument(t.she, {
      nodeId: lec.id,
      kind: "lecture_note",
      title: "Inner",
      blocks: [heading("Heading"), para("Body text")],
    } as never);

    const copy = t.services.library.duplicate(t.alice, folder.id, t.she.actor);
    const copiedLecture = t.services.library.list(t.alice, { parentId: copy.id }).items[0];
    expect(copiedLecture?.name).toBe("Inner lecture");
    const copiedDoc = t.services.documents.getDocumentByNode(t.she, copiedLecture?.id as string);
    const original = t.services.documents.getDocument(t.she, made.documentId);
    expect(copiedDoc.document.id).not.toBe(original.document.id);
    expect(copiedDoc.blocks.map((b) => b.preview)).toEqual(original.blocks.map((b) => b.preview));
    const originalIds = new Set(original.blocks.map((b) => b.id));
    for (const block of copiedDoc.blocks) expect(originalIds.has(block.id)).toBe(false);
    // The original is untouched.
    expect(original.document.revision).toBe(1);
    expect(original.blocks).toHaveLength(2);
  });
});

describe("library hooks: source files under a trashed or deleted node", () => {
  it("files return to the inbox, nothing is deleted, restoring files them again", async () => {
    const t = composed();
    const { lecture } = t.spine();
    const { file, pages, bytes } = await citedLecture(t, lecture.id);
    expect(t.services.files.getFile(t.alice, file.id).status).toBe("filed");

    t.services.library.trash(t.alice, lecture.id, t.she.actor);
    const inbox = t.services.files.getFile(t.alice, file.id);
    expect(inbox.nodeId).toBeNull();
    expect(inbox.status).toBe("transcribed");
    expect(inbox.trashedAt).toBeNull();
    expect(t.services.files.listFiles(t.alice, { inbox: true }).items.map((f) => f.id)).toEqual([
      file.id,
    ]);
    // The original and its pages and transcripts are all still there.
    expect(t.originalExists(t.alice, inbox.sha256)).toBe(true);
    expect(t.services.files.listPages(t.alice, file.id)).toHaveLength(pages.length);
    expect(t.services.files.getTranscript(t.alice, pages[0]?.id as string)).not.toBeNull();
    expect(bytes.length).toBe(inbox.bytes);

    t.services.library.restore(t.alice, lecture.id, t.she.actor);
    const filed = t.services.files.getFile(t.alice, file.id);
    expect(filed.nodeId).toBe(lecture.id);
    expect(filed.status).toBe("filed");
  });

  it("a file she filed somewhere else while the node was away stays where she put it", async () => {
    const t = composed();
    const { sections, lecture } = t.spine();
    const other = t.services.library.create(t.alice, {
      parentId: sections.lectures as string,
      kind: "lecture",
      name: "Other",
    });
    const { file } = await citedLecture(t, lecture.id);
    t.services.library.trash(t.alice, lecture.id, t.she.actor);
    t.services.files.fileUnder(t.she, file.id, other.id);
    t.services.library.restore(t.alice, lecture.id, t.she.actor);
    expect(t.services.files.getFile(t.alice, file.id).nodeId).toBe(other.id);
  });

  it("deleting the node for good leaves the file in the inbox, with its original", async () => {
    const t = composed();
    const { sections, lecture } = t.spine();
    const folder = t.services.library.create(t.alice, {
      parentId: sections.lectures as string,
      kind: "folder",
      name: "Cardiology",
    });
    t.services.library.move(t.alice, lecture.id, { parentId: folder.id }, t.she.actor);
    const { file } = await t.convertedFile(t.she, { nodeId: lecture.id });
    t.services.library.trash(t.alice, folder.id, t.she.actor);
    t.services.library.permanentDelete(t.alice, folder.id, t.she.actor);
    const row = t.services.files.getFile(t.alice, file.id);
    expect(row.nodeId).toBeNull();
    expect(row.status).toBe("converted");
    expect(t.originalExists(t.alice, row.sha256)).toBe(true);
    const parked = t.db
      .prepare("SELECT parked_node_id FROM source_files WHERE id = ?")
      .get(file.id);
    expect(parked).toEqual({ parked_node_id: null });
  });

  it("another user's files are not touched", async () => {
    const t = composed();
    const mine = t.spine();
    const hers = t.spine(t.bob);
    const bobFile = await t.convertedFile(t.bobUser, { nodeId: hers.lecture.id });
    t.services.library.trash(t.alice, mine.lecture.id, t.she.actor);
    expect(t.services.files.getFile(t.bob, bobFile.file.id).nodeId).toBe(hers.lecture.id);
  });
});

describe("citations to a trashed source, end to end", () => {
  it("the document still loads and the reference reads unavailable, then available again", async () => {
    const t = composed();
    const { lecture } = t.spine();
    const { file, pages, doc } = await citedLecture(t, lecture.id);
    const ref = () => t.services.documents.references(t.she, doc.documentId).items[0];
    expect(ref()).toMatchObject({
      status: "available",
      unavailable: false,
      fileName: "beta-blockers.pdf",
      pageIndex: 1,
      quoteStillPresent: true,
      currentTranscriptRevision: 1,
    });

    t.services.files.trash(t.she, file.id);
    expect(ref()).toMatchObject({ status: "source_trashed", unavailable: true });
    expect(() => t.services.documents.getFull(t.she, doc.documentId)).not.toThrow();
    // Her new citations of a trashed page are refused for agents.
    const refused = thrown(() =>
      t.services.documents.insertBlocks(t.bot, {
        documentId: doc.documentId,
        blocks: [
          para("More", [
            { fileId: file.id, pageId: pages[0]?.id as string, quote: "olol", label: "x" },
          ]),
        ],
      } as never),
    );
    expect(refused.message).toContain("trash");

    t.services.files.restore(t.she, file.id);
    expect(ref()?.status).toBe("available");

    t.services.files.trash(t.she, file.id);
    t.services.files.permanentDelete(t.she, file.id);
    expect(ref()).toMatchObject({ status: "source_deleted", fileName: null, pageIndex: null });
    expect(() => t.services.documents.getFull(t.she, doc.documentId)).not.toThrow();
  });

  it("quoteStillPresent turns false when the transcript changes", async () => {
    const t = composed();
    const { lecture } = t.spine();
    const { pages, doc } = await citedLecture(t, lecture.id);
    t.services.files.saveTranscript(t.bot, {
      pageId: pages[0]?.id as string,
      text: "Rewritten with nothing quoted.",
      flags: [],
    });
    const ref = t.services.documents.references(t.she, doc.documentId).items[0];
    expect(ref).toMatchObject({ quoteStillPresent: false, currentTranscriptRevision: 2 });
  });
});

describe("change feed and activity log cover every domain", () => {
  it("agent work reads as plain words in the activity log; hers does not appear", async () => {
    const t = composed();
    const { sections } = t.spine();
    // Hers.
    t.services.library.create(
      t.alice,
      { parentId: sections.lectures as string, kind: "folder", name: "Her folder" },
      t.she.actor,
    );
    // The agent's.
    const lecture = t.services.library.create(
      t.alice,
      {
        parentId: sections.lectures as string,
        kind: "lecture",
        name: "Beta blockers",
        lecture: { number: 7, date: "2026-10-14" },
      },
      t.bot.actor,
    );
    const { file, pages } = await t.convertedFile(t.bot, { name: "beta-blockers.pptx" });
    t.services.files.saveTranscript(t.bot, {
      pageId: pages[1]?.id as string,
      text: "Page two text",
      flags: [],
    });
    t.services.files.fileUnder(t.bot, file.id, lecture.id);
    t.services.library.update(t.alice, lecture.id, { name: "Beta blockers II" }, t.bot.actor);
    t.services.library.trash(t.alice, lecture.id, t.bot.actor);

    const words = t.activity().map((a) => a.summary);
    expect(words).toContain("Created lecture 07 · Beta blockers");
    expect(words).toContain("Uploaded beta-blockers.pptx");
    expect(words).toContain("Transcribed page 2 of beta-blockers.pptx");
    expect(words).toContain("Filed beta-blockers.pptx under lecture 07 · Beta blockers");
    expect(words).toContain('Renamed lecture 07 · Beta blockers to "Beta blockers II"');
    expect(
      words.some((w) => w.startsWith("Moved lecture 07 · Beta blockers II to the trash")),
    ).toBe(true);
    // Hers, and the system's, are not in the log.
    expect(words.join("\n")).not.toContain("Her folder");
    expect(words.join("\n")).not.toContain("Converted");
    for (const entry of t.activity()) {
      expect(entry.keyLabel).toBe("Claude Code");
      expect(entry.links.length).toBeGreaterThan(0);
    }
  });

  it("the change feed gets library, file, transcript and document changes, in order, with actors", async () => {
    const t = composed();
    const { lecture } = t.spine();
    const { file, pages } = await t.convertedFile(t.she, { nodeId: lecture.id });
    t.services.files.saveTranscript(t.she, {
      pageId: pages[0]?.id as string,
      text: "hello",
      flags: [],
    });
    t.services.files.setReview(t.she, pages[0]?.id as string, true);
    t.services.library.trash(t.alice, lecture.id, t.she.actor);
    const feed = t.changes();
    const actions = feed.map((c) => c.action);
    for (const expected of [
      "node.created",
      "file.uploaded",
      "file.converted",
      "transcript.saved",
      "transcript.reviewed",
      "node.trashed",
      "file.unfiled",
    ]) {
      expect(actions, expected).toContain(expected);
    }
    const seqs = feed.map((c) => c.seq);
    expect([...seqs].sort((a, b) => a - b)).toEqual(seqs);
    const saved = feed.find((c) => c.action === "transcript.saved") as Json;
    expect(saved).toMatchObject({
      objectType: "page",
      objectIds: [file.id, pages[0]?.id],
      summary: `Transcribed page 1 of ${file.originalName}`,
      actor: { type: "user", userId: t.alice },
    });
    // A second user sees none of it.
    expect(t.changes(t.bob)).toEqual([]);
    expect(t.activity(t.bob)).toEqual([]);
  });

  it("a rolled-back library change leaves no feed entry", () => {
    const t = composed();
    const { sections } = t.spine();
    const before = t.changes().length;
    expect(
      thrown(() =>
        t.services.library.create(t.alice, {
          parentId: sections.sources as string,
          kind: "lecture",
          name: "x",
          course: { code: "no" },
        } as never),
      ).code,
    ).toBe("invalid_input");
    expect(t.changes()).toHaveLength(before);
  });
});
