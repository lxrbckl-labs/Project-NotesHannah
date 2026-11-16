import { blockPlainText, citationIndexRows } from "@notes/schema";
import { describe, expect, it } from "vitest";
import { general, heading, para, QUOTE, setupDocs, thrown } from "./documents-helpers.js";

describe("end to end: a beta blocker study guide", () => {
  it("the agent writes it, she edits and reviews, the agent regenerates, her blocks survive", () => {
    const t = setupDocs({ strictSources: true });
    const slides = t.addPage();
    const handwriting = t.addPage(
      t.alice,
      "Metoprolol 25 mg PO BID. Watch heart rate. Never stop abruptly.",
    );
    const cite = (page: typeof slides, quote: string) => ({ ...page.citation, quote });
    const { sec } = t.spine();

    const guide = [
      heading("Beta blockers", 1),
      heading("Cardioselective agents"),
      para("Atenolol and metoprolol are cardioselective (β1) blockers.", [slides.citation]),
      {
        type: "callout",
        content: {
          kind: "exam_tip",
          title: "Exam tip",
          text: "Know which agents are β1-selective.",
        },
        citations: [slides.citation],
      },
      {
        type: "drug_card",
        content: {
          name: "metoprolol",
          brandNames: ["Lopressor"],
          drugClass: "Cardioselective beta blocker",
          mechanism: { text: "Blocks β1 receptors in the heart", citations: [slides.citation] },
          dosingNotes: [
            {
              text: "25 mg PO BID",
              citations: [cite(handwriting, "Metoprolol 25 mg PO BID.")],
              flags: [{ kind: "dose", quote: "25 mg" }],
            },
          ],
          counselling: [
            {
              text: "Do not stop abruptly",
              citations: [cite(handwriting, "Never stop abruptly.")],
            },
          ],
        },
        citations: [slides.citation],
      },
      {
        type: "comparison_table",
        content: {
          title: "Selectivity",
          attributes: ["Selectivity", "Lipid soluble"],
          rows: [
            {
              subject: "Atenolol",
              cells: [
                { text: "β1", citations: [slides.citation] },
                { text: "No", generalKnowledge: true },
              ],
            },
            {
              subject: "Propranolol",
              cells: [
                { text: "β1 and β2", citations: [slides.citation] },
                { text: "Yes", generalKnowledge: true },
              ],
            },
          ],
        },
        generalKnowledge: false,
        citations: [slides.citation],
      },
      {
        type: "mnemonic",
        content: {
          device: "BAD",
          topic: "Cautions",
          parts: [
            { key: "B", meaning: "Bradycardia" },
            { key: "A", meaning: "Asthma" },
            { key: "D", meaning: "Diabetes" },
          ],
        },
        generalKnowledge: true,
      },
    ];

    // 1. the agent writes it; a block without a source is refused with an example, the rest is not written
    const refused = thrown(() =>
      t.service.createDocument(t.bot, {
        parentId: sec.study_guides as string,
        kind: "study_guide",
        title: "Beta blockers",
        blocks: [...guide, para("An unsourced claim.")],
      }),
    );
    expect(refused.message).toContain(`$.blocks[${guide.length}].citations`);
    expect(t.library.list(t.alice, { parentId: sec.study_guides as string }).items).toHaveLength(0);

    const made = t.service.createDocument(t.bot, {
      parentId: sec.study_guides as string,
      kind: "study_guide",
      title: "Beta blockers",
      blocks: guide,
    });
    const D = made.documentId;
    const ids = made.blockIds;
    expect(ids).toHaveLength(guide.length);
    expect(
      t.service
        .getFull(t.she, D)
        .blocks.every((b) => b.origin === "agent" && b.review.status === "unverified"),
    ).toBe(true);

    // references: two sources, numbered by first appearance, one per quote
    const refs = t.service.references(t.she, D).items;
    expect(refs.map((r) => r.citation.quote)).toEqual([
      QUOTE,
      "Never stop abruptly.",
      "Metoprolol 25 mg PO BID.",
    ]);
    expect(refs.every((r) => r.status === "available" && r.quoteStillPresent === true)).toBe(true);
    expect(refs[0]?.uses.length).toBeGreaterThanOrEqual(6);
    expect(
      t.service
        .citedBy(t.she, { pageId: handwriting.pageId })
        .items.map((i) => i.location.kind === "block" && i.location.field),
    ).toEqual(["$.content.counselling[0]", "$.content.dosingNotes[0]"]);

    // 2. she edits the callout and the paragraph, and reviews the drug card
    const [, , paragraph, callout, card] = ids as [string, string, string, string, string];
    t.service.updateBlock(t.she, {
      mode: "patch",
      documentId: D,
      blockId: callout,
      patch: { content: { text: "Her own exam tip: atenolol, bisoprolol, metoprolol." } },
    });
    t.service.setReview(t.she, { documentId: D, status: "reviewed", blockIds: [card] });
    expect(t.service.getFull(t.she, D).blocks.find((b) => b.id === callout)).toMatchObject({
      origin: "user",
    });

    // an agent patch of her callout is refused; of the unverified paragraph it is allowed
    expect(
      thrown(() =>
        t.service.updateBlock(t.bot, {
          mode: "patch",
          documentId: D,
          blockId: callout,
          patch: { content: { text: "x" } },
        }),
      ).code,
    ).toBe("forbidden");
    t.service.updateBlock(t.bot, {
      mode: "patch",
      documentId: D,
      blockId: paragraph,
      patch: { content: { text: "Atenolol, metoprolol and bisoprolol are cardioselective." } },
    });

    // 3. the agent regenerates the whole guide
    const before = t.service.getFull(t.she, D);
    const regen = t.service.replaceGenerated(t.bot, {
      documentId: D,
      blocks: [
        heading("Beta blockers (second draft)", 1),
        para("Beta blockers reduce heart rate.", [slides.citation]),
        {
          type: "mnemonic",
          content: {
            device: "BAD",
            topic: "Cautions",
            parts: [{ key: "B", meaning: "Bradycardia" }],
          },
          generalKnowledge: true,
        },
      ],
    });
    expect(regen.skipped).toEqual([
      { blockId: callout, type: "callout", reason: "user_edited" },
      { blockId: card, type: "drug_card", reason: "reviewed" },
    ]);
    expect(regen.removed.sort()).toEqual(ids.filter((id) => id !== callout && id !== card).sort());
    expect(regen.written).toHaveLength(3);

    // her blocks are untouched, in place, and the new ones sit where the first removed block stood
    const after = t.service.getFull(t.she, D);
    for (const id of [callout, card]) {
      expect(after.blocks.find((b) => b.id === id)).toEqual(before.blocks.find((b) => b.id === id));
    }
    expect(after.document.blockIds).toEqual([...regen.written, callout, card]);
    expect(
      after.blocks
        .slice(0, 3)
        .every((b) => b.origin === "agent" && b.review.status === "unverified"),
    ).toBe(true);

    // the log shows what the agent did; hers do not appear
    const log = t.log.list(t.alice).items;
    expect(log.map((e) => e.action)).toEqual([
      "replace_generated",
      "update_block",
      "create_document",
    ]);
    expect(log[0]?.summary).toBe(
      "Beta blockers: Regenerated: wrote 3 blocks, removed 5, left 2 of hers alone",
    );
    expect(log[0]?.keyLabel).toBe("Claude Code");
    expect(log.flatMap((e) => e.links).some((l) => l.type === "document" && l.id === D)).toBe(true);

    // 4. nothing was lost: she can go back to the agent's first version
    t.service.restoreRevision(t.she, { documentId: D, revision: 1 });
    expect(t.service.getFull(t.she, D).blocks.map((b) => b.id)).toEqual(ids);
    expect(t.service.getRevision(t.she, D, 2).snapshot.blocks).toHaveLength(guide.length);
    // and the feed told a poller everything in order
    expect(t.feed.changesSince(t.alice, "0", 100).items.map((c) => c.revision)).toEqual([
      1, 2, 3, 4, 5, 6,
    ]);
  });
});

// ---------------------------------------------------------------------------

function rng(seed: number) {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

describe("random valid operations", () => {
  it("keep order, indexes and revision numbers consistent", () => {
    const t = setupDocs({ revisionCap: 25 });
    const rand = rng(20261115);
    const pick = <T>(list: readonly T[]): T => list[Math.floor(rand() * list.length)] as T;
    const page = t.addPage();
    const REQ = "req_01J9Z8Y7X6W5V4T3S2R1Q0P9N8";
    const made = t.newDoc(t.she, [heading("Start"), para("seed block about statins")], "Random");
    const D = made.documentId;
    let words = 0;

    const word = () => `w${words++}`;
    const blockFor = (who: "she" | "bot") => {
      const kind = pick(["para", "heading", "cited", "general", "list", "divider"] as const);
      if (kind === "heading") return heading(word());
      if (kind === "divider") return { type: "divider" };
      if (kind === "list")
        return {
          type: "bulleted_list",
          content: { items: [word(), word()] },
          generalKnowledge: true,
        };
      if (kind === "cited") return para(word(), [page.citation]);
      if (kind === "general" || who === "bot") return general(word());
      return para(word());
    };
    const state = () => t.service.getFull(t.she, D);
    const position = (ids: string[]) => {
      const kind = pick(["start", "end", "after", "before", "index"] as const);
      if (kind === "start" || kind === "end" || ids.length === 0)
        return kind === "start" ? "start" : "end";
      if (kind === "after") return { after: pick(ids) };
      if (kind === "before") return { before: pick(ids) };
      return { index: Math.floor(rand() * (ids.length + 1)) };
    };

    function checkInvariants(expectedRevision: number) {
      const full = state();
      const doc = full.document;
      expect(doc.revision).toBe(expectedRevision);
      const rows = t.db
        .prepare(
          "SELECT id, position, plain_text, data FROM blocks WHERE document_id = ? ORDER BY position",
        )
        .all(D) as Array<{ id: string; position: number; plain_text: string; data: string }>;
      // order is a permutation, positions are 0..n-1
      expect(rows.map((r) => r.position)).toEqual(rows.map((_, i) => i));
      expect(new Set(rows.map((r) => r.id)).size).toBe(rows.length);
      expect(rows.map((r) => r.id)).toEqual(doc.blockIds);
      expect(rows.length).toBeLessThanOrEqual(1000);
      // stored text matches blocks
      const blocks = full.blocks;
      expect(rows.map((r) => r.plain_text)).toEqual(blocks.map((b) => blockPlainText(b)));
      expect(rows.map((r) => JSON.parse(r.data))).toEqual(blocks);
      // search index agrees with the table
      t.db.prepare("INSERT INTO blocks_fts(blocks_fts, rank) VALUES ('integrity-check', 1)").run();
      const hits = (
        t.db
          .prepare("SELECT COUNT(*) AS n FROM blocks_fts WHERE blocks_fts MATCH 'statins'")
          .get() as { n: number }
      ).n;
      expect(hits).toBe(blocks.filter((b) => /statins/.test(blockPlainText(b))).length);
      // citation index agrees with blocks
      const idx = t.db
        .prepare(
          "SELECT block_id, field, file_id, page_id, quote, item_type FROM document_citations WHERE document_id = ? ORDER BY seq",
        )
        .all(D);
      const want = citationIndexRows(D, blocks).map((r) => ({
        block_id: r.location.kind === "block" ? r.location.blockId : "",
        field: r.location.kind === "block" ? r.location.field : null,
        file_id: r.fileId,
        page_id: r.pageId,
        quote: r.quote,
        item_type: r.itemType,
      }));
      expect(idx).toEqual(want);
      // review status follows the blocks
      expect(doc.reviewStatus).toBe(
        blocks.every((b) => b.type === "divider" || b.review.status === "reviewed")
          ? "reviewed"
          : "unverified",
      );
      // revisions: contiguous run up to the current one, plus the first
      const nums = t.service.listRevisions(t.she, D, { limit: 200 }).items.map((r) => r.number);
      expect(nums[0]).toBe(expectedRevision);
      const run = nums.filter((n) => n !== 1);
      expect(run).toEqual(Array.from({ length: run.length }, (_, i) => expectedRevision - i));
      expect(nums.at(-1)).toBe(1);
      expect(nums.length).toBeLessThanOrEqual(26);
      expect(t.service.getRevision(t.she, D, expectedRevision).snapshot.blocks).toEqual(blocks);
    }

    let revision = 1;
    let refused = 0;
    let applied = 0;
    for (let step = 0; step < 400; step++) {
      const full = state();
      const ids = full.document.blockIds;
      const who = rand() < 0.5 ? t.she : t.bot;
      const mine = who === t.she ? "she" : "bot";
      const protectedBefore = full.blocks.filter(
        (b) => b.origin === "user" || b.review.status === "reviewed",
      );
      const requestId = mine === "bot" && rand() < 0.1 ? REQ : undefined;
      const op = pick([
        "insert",
        "insert",
        "patch",
        "replace",
        "move",
        "delete",
        "regen",
        "review",
        "restore",
        "batch",
      ] as const);
      const run = () => {
        switch (op) {
          case "insert":
            return t.service.insertBlocks(who, {
              documentId: D,
              blocks: Array.from({ length: 1 + Math.floor(rand() * 3) }, () =>
                blockFor(mine),
              ) as never,
              position: position(ids) as never,
            });
          case "patch": {
            if (ids.length === 0) return null;
            return t.service.updateBlock(who, {
              mode: "patch",
              documentId: D,
              blockId: pick(ids),
              patch: { generalKnowledge: true, citations: [] },
              ...(requestId ? { requestId } : {}),
            } as never);
          }
          case "replace": {
            if (ids.length === 0) return null;
            return t.service.updateBlock(who, {
              mode: "replace",
              documentId: D,
              blockId: pick(ids),
              block: blockFor(mine) as never,
              ...(requestId ? { requestId } : {}),
            });
          }
          case "move": {
            if (ids.length < 2) return null;
            const moving = [pick(ids)];
            const rest = ids.filter((id) => id !== moving[0]);
            return t.service.moveBlocks(who, {
              documentId: D,
              blockIds: moving,
              position: position(rest) as never,
            });
          }
          case "delete": {
            if (ids.length === 0) return null;
            const doomed = [...new Set([pick(ids), pick(ids)])];
            return t.service.deleteBlocks(who, {
              documentId: D,
              blockIds: doomed,
              ...(requestId ? { requestId } : {}),
            });
          }
          case "regen":
            return t.service.replaceGenerated(who, {
              documentId: D,
              blocks: Array.from({ length: Math.floor(rand() * 3) }, () => blockFor(mine)) as never,
              ...(requestId ? { requestId } : {}),
            });
          case "review": {
            if (mine === "bot") return null;
            return t.service.setReview(t.she, {
              documentId: D,
              status: pick(["reviewed", "unverified"] as const),
              ...(rand() < 0.5 && ids.length > 0 ? { blockIds: [pick(ids)] } : {}),
            });
          }
          case "restore": {
            if (revision < 2) return null;
            const kept = t.service
              .listRevisions(t.she, D, { limit: 200 })
              .items.map((r) => r.number);
            return t.service.restoreRevision(who, { documentId: D, revision: pick(kept) });
          }
          case "batch":
            return t.service.batch(who, [
              {
                operation: "insert_blocks",
                input: { documentId: D, blocks: [blockFor(mine)], position: "end" },
              },
              {
                operation: "insert_blocks",
                input: { documentId: D, blocks: [blockFor(mine)], position: "start" },
              },
            ]);
        }
      };

      let result: unknown;
      try {
        result = run();
      } catch (error) {
        const err = error as { code?: string; message?: string };
        // Agents are refused by protection; and a patch of a divider or a list can be refused as invalid.
        expect(["forbidden", "invalid_input"], `${op} by ${mine}: ${err.message}`).toContain(
          err.code,
        );
        refused++;
        checkInvariants(revision);
        continue;
      }
      if (result === null) continue;
      const now = state().document.revision;
      expect([revision, revision + 1], `${op}`).toContain(now);
      if (now !== revision) applied++;
      revision = now;
      checkInvariants(revision);

      if (mine === "bot" && !requestId && op !== "restore") {
        const after = state().blocks;
        for (const keep of protectedBefore) {
          expect(
            after.find((b) => b.id === keep.id),
            `${op} must not touch ${keep.id}`,
          ).toEqual(keep);
        }
      }
    }
    expect(applied).toBeGreaterThan(150);
    expect(refused).toBeGreaterThan(5);
    expect(revision).toBeGreaterThan(50);
  });
});
