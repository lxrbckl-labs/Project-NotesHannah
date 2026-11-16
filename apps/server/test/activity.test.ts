import { newId } from "@notes/schema";
import { describe, expect, it } from "vitest";
import { createActivityLog } from "../src/domains/activity/index.js";
import { agentAuth, general, para, setupDocs, thrown } from "./documents-helpers.js";

describe("change feed", () => {
  it("lists changes in order with a cursor that only moves forward", () => {
    const t = setupDocs();
    const a = t.newDoc(t.she, [para("a")], "A");
    const b = t.newDoc(t.bot, [general("b")], "B");
    t.service.insertBlocks(t.she, { documentId: a.documentId, blocks: [para("a2")] });
    t.service.insertBlocks(t.bot, { documentId: b.documentId, blocks: [general("b2")] });
    t.service.insertBlocks(t.she, { documentId: a.documentId, blocks: [para("a3")] });

    const all = t.feed.changesSince(t.alice, undefined, 100);
    expect(all.items.map((c) => [c.documentId === a.documentId ? "A" : "B", c.revision])).toEqual([
      ["A", 1],
      ["B", 1],
      ["A", 2],
      ["B", 2],
      ["A", 3],
    ]);
    const seqs = all.items.map((c) => c.seq);
    expect(seqs).toEqual([...seqs].sort((x, y) => x - y));
    expect(new Set(seqs).size).toBe(5);
    expect(all.hasMore).toBe(false);
    expect(all.items[2]).toMatchObject({
      action: "document.updated",
      objectType: "document",
      nodeId: a.nodeId,
      summary: "A: Inserted 1 block",
    });
    expect(all.items[2]?.objectIds).toContain(a.documentId);

    // paging with a small limit visits each entry once
    let cursor: string | undefined;
    const seen: number[] = [];
    for (let i = 0; i < 10; i++) {
      const page = t.feed.changesSince(t.alice, cursor, 2);
      seen.push(...page.items.map((c) => c.seq));
      cursor = page.nextCursor;
      if (!page.hasMore) break;
    }
    expect(seen).toEqual(seqs);

    // a cursor at the head stays put, and picks up what comes next
    const head = t.feed.changesSince(t.alice, cursor, 10);
    expect(head).toEqual({ items: [], nextCursor: cursor, hasMore: false });
    t.service.insertBlocks(t.she, { documentId: b.documentId, blocks: [para("late")] });
    const next = t.feed.changesSince(t.alice, cursor, 10);
    expect(next.items).toHaveLength(1);
    expect(Number(next.nextCursor)).toBeGreaterThan(Number(cursor));
    expect(t.feed.latestCursor(t.alice)).toBe(next.nextCursor);
  });

  it("interleaved writers by two users never see each other's changes", () => {
    const t = setupDocs();
    const a = t.newDoc(t.she, [para("a")], "A");
    const b = t.newDoc(t.bobUser, [para("b")], "B");
    for (let i = 0; i < 5; i++) {
      t.service.insertBlocks(t.she, { documentId: a.documentId, blocks: [para("x")] });
      t.service.insertBlocks(t.bobUser, { documentId: b.documentId, blocks: [para("y")] });
    }
    const mine = t.feed.changesSince(t.alice, "0", 100).items;
    const his = t.feed.changesSince(t.bob, "0", 100).items;
    expect(mine).toHaveLength(6);
    expect(his).toHaveLength(6);
    expect(mine.every((c) => c.documentId === a.documentId)).toBe(true);
    expect(his.every((c) => c.documentId === b.documentId)).toBe(true);
    expect(mine.map((c) => c.revision)).toEqual([1, 2, 3, 4, 5, 6]);
  });

  it("a failed write leaves no entry; actors and request ids are recorded", () => {
    const t = setupDocs();
    const a = t.newDoc(t.she, [para("a")]);
    const before = t.feed.latestCursor(t.alice);
    expect(
      thrown(() =>
        t.service.insertBlocks(t.bot, { documentId: a.documentId, blocks: [para("no cite")] }),
      ).code,
    ).toBe("invalid_input");
    expect(t.feed.latestCursor(t.alice)).toBe(before);
    t.service.insertBlocks(t.bot, { documentId: a.documentId, blocks: [general("g")] });
    const last = t.feed.changesSince(t.alice, before, 10).items[0];
    expect(last?.actor).toEqual(t.bot.actor);
  });

  it("rejects malformed cursors", () => {
    const t = setupDocs();
    expect(thrown(() => t.feed.changesSince(t.alice, "abc", 10)).code).toBe("invalid_input");
  });
});

describe("activity log", () => {
  it("records agent actions only, with key, label, plain words and links", () => {
    const t = setupDocs();
    const a = t.newDoc(t.she, [para("hers")], "Guide");
    t.service.insertBlocks(t.she, { documentId: a.documentId, blocks: [para("by her")] });
    expect(t.log.list(t.alice).items).toEqual([]);

    const r = t.service.insertBlocks(t.bot, {
      documentId: a.documentId,
      blocks: [general("g1"), general("g2")],
    });
    t.service.deleteBlocks(t.otherBot, {
      documentId: a.documentId,
      blockIds: [r.blockIds[0] as string],
    });

    const { items } = t.log.list(t.alice);
    expect(items).toHaveLength(2);
    expect(items[0]).toMatchObject({
      keyId: t.otherBot.actor.type === "agent" ? t.otherBot.actor.keyId : "",
      keyLabel: "Codex",
      action: "delete_blocks",
      summary: "Guide: Deleted 1 block",
    });
    expect(items[1]).toMatchObject({
      action: "insert_blocks",
      summary: "Guide: Inserted 2 blocks",
      keyLabel: "Claude Code",
    });
    expect(items[1]?.links[0]).toEqual({
      type: "document",
      id: a.documentId,
      nodeId: a.nodeId,
      label: "Guide",
    });
    expect(items[1]?.links.filter((l) => l.type === "block").map((l) => l.id)).toEqual(r.blockIds);
  });

  it("records the request id an agent acted on", () => {
    const t = setupDocs();
    const a = t.newDoc(t.she, [para("hers")]);
    const req = newId("request");
    t.service.deleteBlocks(t.bot, {
      documentId: a.documentId,
      blockIds: a.blockIds,
      requestId: req,
    });
    expect(t.log.list(t.alice, { objectId: req }).items).toHaveLength(1);
  });

  it("filters by key, action, object and time, and pages newest first", () => {
    const t = setupDocs();
    const a = t.newDoc(t.she, [], "A");
    const b = t.newDoc(t.she, [], "B");
    for (let i = 0; i < 3; i++)
      t.service.insertBlocks(t.bot, { documentId: a.documentId, blocks: [general("x")] });
    t.service.insertBlocks(t.otherBot, { documentId: b.documentId, blocks: [general("y")] });
    const keyOf = (auth: typeof t.bot) => (auth.actor.type === "agent" ? auth.actor.keyId : "");
    expect(t.log.list(t.alice, { keyId: keyOf(t.bot) }).items).toHaveLength(3);
    expect(t.log.list(t.alice, { keyId: keyOf(t.otherBot) }).items).toHaveLength(1);
    expect(t.log.list(t.alice, { objectId: b.documentId }).items).toHaveLength(1);
    expect(t.log.list(t.alice, { action: "delete_blocks" }).items).toHaveLength(0);
    const all = t.log.list(t.alice, { limit: 3 });
    expect(all.items.map((e) => e.id)).toEqual(
      [...all.items.map((e) => e.id)].sort((x, y) => y - x),
    );
    const rest = t.log.list(t.alice, { limit: 3, cursor: all.nextCursor as string });
    expect(rest.items).toHaveLength(1);
    expect(rest.nextCursor).toBeNull();
    const cutoff = all.items[1]?.at as string;
    expect(t.log.list(t.alice, { since: cutoff }).items).toHaveLength(2);
    expect(t.log.list(t.alice, { until: cutoff }).items.length).toBeGreaterThan(1);
    expect(thrown(() => t.log.list(t.alice, { cursor: "x" })).code).toBe("invalid_input");
  });

  it("is private to each user, and the port ignores user actors", () => {
    const t = setupDocs();
    const a = t.newDoc(t.she, [], "A");
    t.service.insertBlocks(t.bot, { documentId: a.documentId, blocks: [general("x")] });
    expect(t.log.list(t.bob).items).toEqual([]);
    const log = createActivityLog(t.db);
    log.port.record(t.alice, { actor: t.she.actor, action: "x", summary: "nope" });
    expect(log.record(t.alice, { actor: t.she.actor, action: "x", summary: "nope" })).toBe(false);
    log.port.record(t.alice, {
      actor: agentAuth(t.alice).actor,
      action: "files.upload",
      summary: "Uploaded a PDF",
      links: [{ type: "file", id: "fil_x" }],
    });
    expect(t.log.list(t.alice, { action: "files.upload" }).items).toHaveLength(1);
  });
});
