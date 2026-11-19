import { describe, expect, test } from "vitest";
import { connect, realSetup } from "./mcp-harness.js";

/**
 * study_map, the writing-claim extension and the figures check on a request reply, over the REAL
 * composed services (createApp + createServices).
 */

const PW = "correct horse battery";

type Setup = Awaited<ReturnType<typeof realSetup>>;
type Agent = Awaited<ReturnType<Setup["agent"]>>;

async function her(s: Setup) {
  await s.user("hannah");
  return (await s.t.signIn("hannah", PW)).cookies;
}

/** A lecture with a note of one heading and five paragraphs, written by the agent. */
async function lectureWithNote(a: Agent) {
  const term = (
    await a.ok("edit_library", {
      action: "create",
      parentId: null,
      kind: "term",
      name: "Fall 2026",
    })
  ).structured.node as { id: string };
  const course = await a.ok("edit_library", {
    action: "create",
    parentId: term.id,
    kind: "course",
    name: "Pharmacology II",
  });
  const sections = course.structured.sections as Array<{ id: string; name: string }>;
  const idOf = (name: string) => sections.find((x) => x.name === name)?.id as string;
  const lecture = (
    await a.ok("edit_library", {
      action: "create",
      parentId: idOf("Lectures"),
      kind: "lecture",
      name: "Beta blockers",
      lecture: { number: 7, date: "2026-10-14" },
    })
  ).structured.node as { id: string };
  const para = (text: string) => ({
    type: "paragraph",
    content: { text },
    generalKnowledge: true,
  });
  const note = await a.ok("write_document", {
    nodeId: lecture.id,
    kind: "lecture_note",
    title: "Beta blockers",
    blocks: [
      { type: "heading", content: { level: 1, text: "Beta blockers" } },
      para("Metoprolol is beta-1 selective."),
      para("Propranolol is nonselective."),
      para("Beta blockers lower heart rate."),
      para("Avoid in asthma."),
      para("Metoprolol tartrate: usual daily dose 50-200 mg, twice daily."),
    ],
  });
  const blocks = note.structured.written as string[];
  return {
    lecture,
    guidesId: idOf("Study guides"),
    documentId: note.structured.documentId as string,
    heading: blocks[0] as string,
    b: blocks.slice(1) as [string, string, string, string, string],
  };
}

describe("study_map over MCP", () => {
  test("get, set_structure with frames and labeled connectors, change, and the activity entry", async () => {
    const s = await realSetup();
    const a = await s.agent("hannah", "write", { "x-agent-label": "Claude Code" });
    const w = await lectureWithNote(a);

    const first = await a.ok("study_map", { action: "get", documentId: w.documentId });
    expect(first.text).toContain('Study map of "Beta blockers"');
    expect(first.text).toContain(w.b[0]);
    expect(JSON.stringify(first.structured)).not.toMatch(/"x":|"position":|"dimensions":/);
    const rev = first.structured.revision as number;

    const set = await a.ok("study_map", {
      action: "set_structure",
      documentId: w.documentId,
      cards: [
        { ref: "m", content: { kind: "block", blockIds: [w.b[0]] } },
        { ref: "p", content: { kind: "block", blockIds: [w.b[1]] } },
        { ref: "e", content: { kind: "block", blockIds: [w.b[2]] }, size: "wide" },
        {
          ref: "key",
          content: { kind: "note", text: "Beta blockers slow the heart." },
          color: "yellow",
        },
      ],
      connectors: [
        { from: "m", to: "e", label: "lowers heart rate", kind: "causes" },
        { from: "m", to: "p", label: "contrasts with", kind: "contrasts" },
      ],
      frames: [
        { ref: "sel", title: "Selectivity", members: ["m", "p"] },
        { title: "Effects", members: ["e", "key"] },
      ],
      expectedRevision: rev,
    });
    expect(set.text).toContain("Set the study map");
    expect(set.text).toContain("Your refs became");
    const again = await a.ok("study_map", { action: "get", documentId: w.documentId });
    expect(again.text).toContain('Frame "Selectivity"');
    expect(again.text).toContain('Frame "Effects"');
    expect(again.text).toMatch(/-\[lowers heart rate\]->/);
    expect(again.text).toContain("Beta blockers slow the heart.");
    const view = again.structured as unknown as {
      frames: Array<{ cards: unknown[] }>;
      connectors: Array<{ kind: string }>;
    };
    expect(view.frames.map((f) => f.cards.length)).toEqual([2, 2]);
    expect(view.connectors.map((c) => c.kind).sort()).toEqual(["causes", "contrasts"]);

    // The same body again changes nothing.
    const same = await a.ok("study_map", {
      action: "set_structure",
      documentId: w.documentId,
      cards: [
        { ref: "m", content: { kind: "block", blockIds: [w.b[0]] } },
        { ref: "p", content: { kind: "block", blockIds: [w.b[1]] } },
        { ref: "e", content: { kind: "block", blockIds: [w.b[2]] }, size: "wide" },
        {
          ref: "key",
          content: { kind: "note", text: "Beta blockers slow the heart." },
          color: "yellow",
        },
      ],
      connectors: [
        { from: "m", to: "e", label: "lowers heart rate", kind: "causes" },
        { from: "m", to: "p", label: "contrasts with", kind: "contrasts" },
      ],
      frames: [
        { ref: "sel", title: "Selectivity", members: ["m", "p"] },
        { title: "Effects", members: ["e", "key"] },
      ],
    });
    expect(same.text).toContain("nothing changed");

    // Incremental ops, with a ref used by a later op (refs of an earlier call became IDs).
    const mechanism = (set.structured.report as { refs: Record<string, string> }).refs.m as string;
    const changed = await a.ok("study_map", {
      action: "change",
      documentId: w.documentId,
      ops: [
        { op: "add_card", card: { ref: "avoid", content: { kind: "block", blockIds: [w.b[3]] } } },
        {
          op: "add_connector",
          connector: { from: "avoid", to: mechanism, label: "contraindication", kind: "related" },
        },
      ],
    });
    expect(changed.text).toContain("added 1 card, 1 connector");

    // The activity entry reads sensibly and uses the shared scheme.
    const log = s.services.activity.list(a.user.id, { limit: 20 }).items;
    const entry = log.find((e) => e.action === "canvas.arranged");
    expect(entry?.summary).toBe("Arranged the study map for Beta blockers into 2 frames");
    expect(entry?.keyLabel).toBe("Claude Code");
    expect(log.some((e) => e.action === "canvas.edited")).toBe(true);
  });

  test("teaches by error: coordinates, a connector to nowhere, a block of another document, ops hers alone", async () => {
    const s = await realSetup();
    const a = await s.agent("hannah");
    const w = await lectureWithNote(a);
    const doc = { documentId: w.documentId };

    const coords = await a.fail("study_map", {
      action: "set_structure",
      ...doc,
      cards: [{ ref: "m", content: { kind: "block", blockIds: [w.b[0]] }, x: 10, y: 20 }],
    });
    expect(coords.error.code).toBe("invalid_input");
    expect(coords.error.message).toContain("$.cards[0].x");
    expect(coords.error.message).toContain("the app lays the canvas out");
    expect(coords.error.hint).toContain('start_here {"topic":"study_map"}');

    const nowhere = await a.fail("study_map", {
      action: "set_structure",
      ...doc,
      cards: [{ ref: "m", content: { kind: "block", blockIds: [w.b[0]] } }],
      connectors: [{ from: "m", to: "ghost", label: "x" }],
    });
    expect(nowhere.error.message).toContain("$.connectors[0].to");
    expect(nowhere.error.message).toContain('"ghost" is not a card');
    expect(nowhere.error.example).toMatchObject({ from: "mechanism", to: "effects" });

    const alien = await a.fail("study_map", {
      action: "change",
      ...doc,
      ops: [
        {
          op: "add_card",
          card: { content: { kind: "block", blockIds: ["blk_01J9Z8Y7X6W5V4T3S2R1Q0P9N8"] } },
        },
      ],
    });
    expect(alien.error.code).toBe("invalid_input");
    expect(alien.error.message).toContain("$.ops[0].card.content.blockIds");

    const hers = await a.fail("study_map", {
      action: "change",
      ...doc,
      ops: [
        { op: "place_cards", placements: [{ id: "crd_01J9Z8Y7X6W5V4T3S2R1Q0P9N8", x: 1, y: 1 }] },
      ],
    });
    expect(hers.error.code).toBe("forbidden");
    expect(hers.error.hint).toContain("hers alone");

    const stale = await a.fail("study_map", {
      action: "change",
      ...doc,
      expectedRevision: 99,
      ops: [{ op: "add_card", card: { content: { kind: "note", text: "x" } } }],
    });
    expect(stale.error.code).toBe("conflict");
    expect(stale.error.hint).toContain("Read it again");

    // A malformed document ID, and a library ID where a document goes.
    const lecture = await a.fail("study_map", { action: "get", documentId: w.lecture.id });
    expect(lecture.error.message).toContain("documentId");
    expect(lecture.error.message).toContain("get_item");
  });

  test("the pin rule: her three pinned cards and her note survive, refusals say why, her request lifts it", async () => {
    const s = await realSetup();
    const a = await s.agent("hannah", "write", { "x-agent-label": "Claude Code" });
    const w = await lectureWithNote(a);
    const cookies = await her(s);
    const base = `/api/documents/${w.documentId}/canvas`;

    // She pins three cards by dragging them.
    const got = await s.t.request(base, { cookies });
    const cards = (
      got.body as { canvas: { cards: Array<{ id: string; content: { blockIds?: string[] } }> } }
    ).canvas.cards;
    const cardOf = (blockId: string) =>
      cards.find((c) => c.content.blockIds?.includes(blockId))?.id as string;
    const pinned = [w.b[0], w.b[1], w.b[2]].map(cardOf);
    const placed = await s.t.request(`${base}/placements`, {
      method: "PUT",
      cookies,
      body: {
        placements: pinned.map((id, i) => ({ id, x: 100 + i * 400, y: 300 })),
      },
    });
    expect(placed.status).toBe(200);
    const before = await a.ok("study_map", { action: "get", documentId: w.documentId });
    expect(before.text).toContain("pinned by her");

    // Setting a structure that leaves her cards out keeps them and says so.
    const set = await a.ok("study_map", {
      action: "set_structure",
      documentId: w.documentId,
      cards: [{ ref: "n", content: { kind: "note", text: "The single key point." } }],
    });
    expect(set.text).toContain("Left 3 item(s) alone");
    expect(set.text).toContain("pinned by her");
    expect(set.text).toContain("request of hers about the WHOLE document");
    const after = await s.t.request(base, { cookies });
    const kept = (
      after.body as {
        canvas: {
          cards: Array<{
            id: string;
            position: { x: number; y: number } | null;
            content: { kind: string; text?: unknown };
          }>;
        };
      }
    ).canvas.cards;
    for (const [i, id] of pinned.entries()) {
      expect(kept.find((c) => c.id === id)?.position).toMatchObject({ x: 100 + i * 400, y: 300 });
    }
    expect(kept.some((c) => c.content.kind === "note")).toBe(true);

    // An op on a pinned card is refused, in her terms and with the way out.
    const refused = await a.fail("study_map", {
      action: "change",
      documentId: w.documentId,
      ops: [{ op: "remove_card", id: pinned[0] }],
    });
    expect(refused.error.code).toBe("forbidden");
    expect(refused.error.message).toContain("She placed this card by hand");
    expect(refused.error.hint).toContain("request of hers about the WHOLE document");

    // A request about one block does not lift it; one about the document does.
    const onBlock = await s.t.request("/api/requests", {
      cookies,
      body: {
        target: { type: "block", documentId: w.documentId, blockId: w.b[0] },
        kind: "other",
        message: "tidy the map",
      },
    });
    const blockReq = (onBlock.body as { request: { id: string } }).request.id;
    await a.ok("requests", { action: "claim", requestId: blockReq });
    const narrow = await a.fail("study_map", {
      action: "change",
      documentId: w.documentId,
      requestId: blockReq,
      ops: [{ op: "remove_card", id: pinned[0] }],
    });
    expect(narrow.error.code).toBe("forbidden");
    expect(narrow.error.message).toContain("does not lift her protection");
    const onDoc = await s.t.request("/api/requests", {
      cookies,
      body: {
        target: { type: "document", documentId: w.documentId },
        kind: "other",
        message: "drop the first card from the map",
      },
    });
    const docReq = (onDoc.body as { request: { id: string } }).request.id;
    await a.ok("requests", { action: "claim", requestId: docReq });
    const lifted = await a.ok("study_map", {
      action: "change",
      documentId: w.documentId,
      requestId: docReq,
      ops: [{ op: "remove_card", id: pinned[0] }],
    });
    expect(lifted.text).toContain("removed 1 card");
  });

  test("read-only keys, another user's document, and a writing claim held by another agent", async () => {
    const s = await realSetup();
    const a = await s.agent("hannah", "write", { "x-agent-label": "Claude Code" });
    const w = await lectureWithNote(a);
    const reader = await s.agent("hannah", "read");
    expect(
      (await reader.ok("study_map", { action: "get", documentId: w.documentId })).text,
    ).toContain("Study map of");
    expect(
      (
        await reader.fail("study_map", {
          action: "change",
          documentId: w.documentId,
          ops: [{ op: "add_card", card: { content: { kind: "note", text: "x" } } }],
        })
      ).error.code,
    ).toBe("read_only_key");
    const mallory = await s.agent("mallory");
    expect(
      (await mallory.fail("study_map", { action: "get", documentId: w.documentId })).error.code,
    ).toBe("not_found");

    await a.ok("edit_library", { action: "claim", id: w.lecture.id, note: "arranging" });
    const b = await connect(s.app, s.key(a.user.id, "write", "codex").secret, {
      "x-agent-label": "Codex",
    });
    const blocked = await b.fail("study_map", {
      action: "change",
      documentId: w.documentId,
      ops: [{ op: "add_card", card: { content: { kind: "note", text: "x" } } }],
    });
    expect(blocked.error.code).toBe("conflict");
    expect(blocked.error.message).toContain("Claude Code");
  });

  test("start_here teaches it: a short section in the overview, the detail in a topic", async () => {
    const s = await realSetup();
    const a = await s.agent();
    const overview = await a.ok("start_here");
    expect(overview.text).toContain("## Study map");
    expect(overview.text).toContain("Never send coordinates");
    expect(overview.text).toContain("what she places stays where she put it");
    expect(overview.text).toContain('"kind":"note"');
    expect(overview.text.length).toBeLessThan(12_000);
    const topic = await a.ok("start_here", { topic: "study_map" });
    expect(topic.text).toContain("add_connector");
    expect(topic.text).toContain("The pin rule");
    expect(topic.text).not.toContain('"op":"place_cards"');
    expect(topic.text.length).toBeLessThan(20_000);
  });
});

describe("a writing claim on a study guide", () => {
  test("any document or section can be claimed, by node or document ID, and get_item shows it", async () => {
    const s = await realSetup();
    const a = await s.agent("hannah", "write", { "x-agent-label": "Claude Code" });
    const w = await lectureWithNote(a);
    const b = await connect(s.app, s.key(a.user.id, "write", "codex").secret, {
      "x-agent-label": "Codex",
    });

    // A claims the Study guides section; B sees it there and cannot write a guide into it.
    const claimedSection = await a.ok("edit_library", {
      action: "claim",
      id: w.guidesId,
      note: "study guide for lecture 7",
    });
    expect(claimedSection.text).toContain("You hold the writing claim on section");
    expect((await b.ok("get_item", { id: w.guidesId })).text).toContain(
      "Being written for by Claude Code",
    );
    const guideBlocks = [{ type: "paragraph", content: { text: "x" }, generalKnowledge: true }];
    const refused = await b.fail("write_document", {
      parentId: w.guidesId,
      kind: "study_guide",
      title: "Beta blockers guide",
      blocks: guideBlocks,
    });
    expect(refused.error.code).toBe("conflict");
    const guide = await a.ok("write_document", {
      parentId: w.guidesId,
      kind: "study_guide",
      title: "Beta blockers guide",
      blocks: guideBlocks,
    });
    const guideDoc = guide.structured.documentId as string;
    await a.ok("edit_library", { action: "release", id: w.guidesId });

    // Claimed by the document's own ID: shown on the document and on the section above it.
    const claimedDoc = await a.ok("edit_library", {
      action: "claim",
      id: guideDoc,
      note: "rewriting",
    });
    expect(claimedDoc.text).toContain("You hold the writing claim on document");
    const seen = await b.ok("get_item", { id: guideDoc });
    expect(seen.text).toContain("Being written for by Claude Code");
    expect(seen.text).toContain('("rewriting")');
    expect((seen.structured.writingClaim as { keyId: string }).keyId).toBe(a.key.key.id);
    const section = await b.ok("get_item", { id: w.guidesId });
    expect(section.text).toContain("Being written below this");
    expect(section.text).toContain("Claude Code");
    expect(
      (
        await b.fail("edit_blocks", {
          operation: "insert_blocks",
          documentId: guideDoc,
          blocks: guideBlocks,
        })
      ).error.code,
    ).toBe("conflict");
    expect((await b.fail("edit_library", { action: "claim", id: guideDoc })).error.code).toBe(
      "conflict",
    );
    // Claiming the lecture says where a guide for it lives.
    const lectureClaim = await b.ok("edit_library", { action: "claim", id: w.lecture.id });
    expect(lectureClaim.text).toContain("Study guides section");
    // Released by its document ID too.
    expect((await a.ok("edit_library", { action: "release", id: guideDoc })).text).toContain(
      "Released",
    );
    await b.ok("edit_blocks", {
      operation: "insert_blocks",
      documentId: guideDoc,
      blocks: guideBlocks,
    });
  });
});

describe("a request reply is checked against its sources", () => {
  test("a dose the slide does not say is a warning; acknowledged, she sees it flagged", async () => {
    const s = await realSetup();
    const a = await s.agent("hannah", "write", { "x-agent-label": "Claude Code" });
    const w = await lectureWithNote(a);
    const cookies = await her(s);
    const ask = async (body: Record<string, unknown>) =>
      ((await s.t.request("/api/requests", { cookies, body })).body as { request: { id: string } })
        .request.id;
    const reqId = await ask({
      target: { type: "block", documentId: w.documentId, blockId: w.b[4] },
      kind: "wrong",
      message: "this is wrong: fix the dose",
    });
    await a.ok("requests", { action: "claim", requestId: reqId });

    const refused = await a.fail("requests", {
      action: "complete",
      requestId: reqId,
      reply: "Corrected: 50-100 mg twice daily; maximum 400 mg.",
      links: [{ type: "block", documentId: w.documentId, blockId: w.b[4] }],
    });
    expect(refused.error.code).toBe("invalid_input");
    expect(refused.error.message).toContain('"50-100 mg", "400 mg"');
    expect(refused.error.hint).toContain("acknowledgeUnsourced");
    const stillOpen = await s.t.request(`/api/requests/${reqId}`, { cookies });
    expect((stillOpen.body as { request: { status: string } }).request.status).toBe("in_progress");

    const good = await a.ok("requests", {
      action: "complete",
      requestId: reqId,
      reply: "The slide says 50-200 mg twice daily; fixed.",
      links: [{ type: "block", documentId: w.documentId, blockId: w.b[4] }],
    });
    expect(good.text).not.toContain("flagged");
    const seen = await s.t.request(`/api/requests/${reqId}`, { cookies });
    expect(
      (seen.body as { request: { reply: { unsourcedFigures: boolean } } }).request.reply
        .unsourcedFigures,
    ).toBe(false);

    const second = await ask({
      target: { type: "block", documentId: w.documentId, blockId: w.b[4] },
      kind: "wrong",
      message: "and the maximum?",
    });
    await a.ok("requests", { action: "claim", requestId: second });
    const acknowledged = await a.ok("requests", {
      action: "complete",
      requestId: second,
      reply: "Reference maximum is 450 mg/day.",
      acknowledgeUnsourced: true,
    });
    expect(acknowledged.text).toContain("contains figures not found in your notes");
    const flagged = await s.t.request(`/api/requests/${second}`, { cookies });
    expect(
      (
        flagged.body as {
          request: { reply: { unsourcedFigures: boolean; unsourcedFigureList: string[] } };
        }
      ).request.reply,
    ).toMatchObject({ unsourcedFigures: true, unsourcedFigureList: ["450 mg"] });
    expect((await a.ok("get_item", { id: second })).text).toContain("Flagged for her");
  });
});
