import {
  canTransition,
  newId,
  type RequestAction,
  type RequestStatus,
  type RequestTarget,
} from "@notes/schema";
import { describe, expect, it } from "vitest";
import { type Json, type Requests, setupRequests, thrown, userAuth } from "./requests-helpers.js";

const LIBRARY: RequestTarget = { type: "library" };

/** A request in a given state, reached the honest way. */
function makeIn(t: Requests, status: RequestStatus) {
  const made = t.service.create(t.she, { target: LIBRARY, kind: "quiz_me", message: "" });
  const id = made.id;
  switch (status) {
    case "waiting":
      break;
    case "in_progress":
      t.service.claim(t.bot, id);
      break;
    case "done":
      t.service.claim(t.bot, id);
      t.service.complete(t.bot, id, { reply: "Done.", links: [] });
      break;
    case "declined":
      t.service.decline(t.bot, id, { reason: "No." });
      break;
    case "cancelled":
      t.service.cancel(t.she, id);
      break;
  }
  return id;
}

describe("the full lifecycle over HTTP", () => {
  it("is asked, claimed, answered, reopened and answered again", async () => {
    const t = setupRequests();
    const { documentId, blockIds, nodeId } = t.newDoc();
    const block = blockIds[0] as string;

    // She leaves a request on a block.
    const created = await t.call(t.asUser(t.alice), "POST", "/api/requests", {
      target: { type: "block", documentId, blockId: block },
      kind: "wrong",
      message: "Atenolol is not lipid soluble.",
    });
    expect(created.status).toBe(201);
    const id = created.body.request.id as string;
    expect(created.body.request).toMatchObject({
      status: "waiting",
      kind: "wrong",
      createdBy: { type: "user", userId: t.alice },
      claimedBy: null,
      reply: null,
      reopens: [],
      context: { name: "Beta blockers", preview: "Atenolol is β1-selective.", nodeId },
    });
    expect(created.body.request.context.path).toBe(
      "Fall 2026 / Pharmacology II / Study guides / Beta blockers",
    );

    // The badge counts it.
    const counts = await t.call(t.asUser(t.alice), "GET", "/api/requests/counts");
    expect(counts.body.counts).toMatchObject({ waiting: 1, open: 1 });

    // An agent lists the waiting queue, with context to act on.
    const queue = await t.call(t.asKey(t.bot), "GET", "/api/requests?status=waiting&order=oldest");
    expect(queue.body.items).toHaveLength(1);
    expect(queue.body.items[0].context.preview).toBe("Atenolol is β1-selective.");

    // Claim it.
    const claimed = await t.call(t.asKey(t.bot), "POST", `/api/requests/${id}/claim`, {});
    expect(claimed.status).toBe(200);
    expect(claimed.body.request).toMatchObject({
      status: "in_progress",
      claimedBy: { type: "agent", label: "Claude Code" },
    });
    expect(claimed.body.request.claimExpiresAt).toBe(
      new Date(t.clock.now() + 30 * 60_000).toISOString(),
    );

    // Complete with a reply and a link.
    const done = await t.call(t.asKey(t.bot), "POST", `/api/requests/${id}/complete`, {
      reply: "Fixed the sentence.",
      links: [{ type: "block", documentId, blockId: block, label: "Fixed block" }],
    });
    expect(done.status).toBe(200);
    expect(done.body.request).toMatchObject({
      status: "done",
      claimedBy: null,
      claimExpiresAt: null,
      reply: {
        text: "Fixed the sentence.",
        by: { type: "agent", label: "Claude Code" },
        links: [{ type: "block", blockId: block }],
      },
    });
    expect(done.body.request.closedAt).not.toBeNull();

    // She sees the reply and is not satisfied.
    const reopened = await t.call(t.asUser(t.alice), "POST", `/api/requests/${id}/reopen`, {
      note: "Still says the old thing in the table.",
    });
    expect(reopened.body.request).toMatchObject({ status: "waiting", closedAt: null });
    expect(reopened.body.request.reopens).toHaveLength(1);
    expect(reopened.body.request.reopens[0]).toMatchObject({
      note: "Still says the old thing in the table.",
      previousStatus: "done",
      previousReply: { text: "Fixed the sentence." },
    });

    // A different agent takes it and declines it with a reason.
    const other = await t.call(t.asKey(t.otherBot), "POST", `/api/requests/${id}/claim`);
    expect(other.status).toBe(200);
    const declined = await t.call(t.asKey(t.otherBot), "POST", `/api/requests/${id}/decline`, {
      reason: "The table is in a block you wrote; I would have to guess what you want.",
    });
    expect(declined.body.request).toMatchObject({
      status: "declined",
      reply: {
        text: expect.stringContaining("guess"),
        by: { type: "agent", keyId: (t.otherBot.actor as { keyId: string }).keyId },
      },
    });

    // Reopen again, then she withdraws it.
    await t.call(t.asUser(t.alice), "POST", `/api/requests/${id}/reopen`, {});
    const cancelled = await t.call(t.asUser(t.alice), "POST", `/api/requests/${id}/cancel`);
    expect(cancelled.body.request).toMatchObject({ status: "cancelled" });
    expect(cancelled.body.request.reopens).toHaveLength(2);

    // Cancelled is hidden from the default list, and visible when asked for.
    const defaults = await t.call(t.asUser(t.alice), "GET", "/api/requests");
    expect(defaults.body.items).toHaveLength(0);
    const all = await t.call(t.asUser(t.alice), "GET", "/api/requests?status=cancelled");
    expect(all.body.items).toHaveLength(1);

    // The agent's work is in the activity log, and hers is not.
    const logged = t.db
      .prepare(
        "SELECT action FROM activity WHERE user_id = ? AND action LIKE 'request.%' ORDER BY seq",
      )
      .all(t.alice) as Array<{ action: string }>;
    expect(logged.map((r) => r.action)).toEqual([
      "request.claim",
      "request.complete",
      "request.claim",
      "request.decline",
    ]);
  });

  it("lists with filters and pages in both orders", async () => {
    const t = setupRequests();
    const { documentId, nodeId } = t.newDoc();
    const ids: string[] = [];
    for (let i = 0; i < 5; i++) {
      const target: RequestTarget = i % 2 === 0 ? LIBRARY : { type: "document", documentId };
      ids.push(t.service.create(t.she, { target, kind: "expand", message: `n${i}` }).id);
    }
    const newest = t.service.list(t.she, { limit: 2 });
    expect(newest.items.map((r) => r.message)).toEqual(["n4", "n3"]);
    const next = t.service.list(t.she, { limit: 2, cursor: newest.nextCursor as string });
    expect(next.items.map((r) => r.message)).toEqual(["n2", "n1"]);
    const oldest = t.service.list(t.she, { order: "oldest", limit: 3 });
    expect(oldest.items.map((r) => r.message)).toEqual(["n0", "n1", "n2"]);
    expect(t.service.list(t.she, { documentId }).items).toHaveLength(2);
    expect(t.service.list(t.she, { nodeId }).items).toHaveLength(2);
    expect(t.service.list(t.she, { targetType: "library" }).items).toHaveLength(3);
    t.service.claim(t.bot, ids[0] as string);
    expect(t.service.list(t.she, { status: ["in_progress"] }).items).toHaveLength(1);
    expect(thrown(() => t.service.list(t.she, { cursor: "oops" })).code).toBe("invalid_input");
  });
});

describe("transitions", () => {
  const statuses: RequestStatus[] = ["waiting", "in_progress", "done", "declined", "cancelled"];

  type Step = {
    action: RequestAction;
    who: "user" | "agent";
    run: (t: Requests, id: string) => unknown;
  };
  const steps: Step[] = [
    { action: "edit", who: "user", run: (t, id) => t.service.edit(t.she, id, { message: "new" }) },
    { action: "cancel", who: "user", run: (t, id) => t.service.cancel(t.she, id) },
    { action: "claim", who: "agent", run: (t, id) => t.service.claim(t.otherBot, id) },
    { action: "release", who: "agent", run: (t, id) => t.service.release(t.bot, id) },
    {
      action: "complete",
      who: "agent",
      run: (t, id) => t.service.complete(t.bot, id, { reply: "ok", links: [] }),
    },
    {
      action: "decline",
      who: "agent",
      run: (t, id) => t.service.decline(t.bot, id, { reason: "no" }),
    },
    { action: "reopen", who: "user", run: (t, id) => t.service.reopen(t.she, id, { note: "" }) },
  ];

  it("accepts exactly what the table allows, from every status", () => {
    for (const status of statuses) {
      for (const step of steps) {
        const t = setupRequests();
        const id = makeIn(t, status);
        // The table says what the actor may do; `bot` holds the claim in these fixtures, so
        // claim by `otherBot` on an in-progress request is contention, not a plain transition.
        const verdict = canTransition(status, step.action, step.who);
        const tried = () => step.run(t, id);
        if (verdict.ok && !(status === "in_progress" && step.action === "claim")) {
          expect(tried, `${status} + ${step.action}`).not.toThrow();
        } else {
          const error = thrown(tried);
          expect(["conflict", "forbidden"], `${status} + ${step.action}`).toContain(error.code);
          expect(error.message.length).toBeGreaterThan(10);
        }
      }
    }
  });

  it("says what is wrong and what to do instead", () => {
    const t = setupRequests();
    const done = makeIn(t, "done");
    const error = thrown(() => t.service.claim(t.bot, done));
    expect(error).toMatchObject({ code: "conflict" });
    expect(error.message).toBe(
      "A request that is done cannot be claimed: this only works on a request that is waiting.",
    );
    expect(error.hint).toMatch(/reopen/);
    const waiting = makeIn(t, "waiting");
    const early = thrown(() => t.service.complete(t.bot, waiting, { reply: "x", links: [] }));
    expect(early).toMatchObject({ code: "conflict" });
    expect(early.message).toMatch(/Claim this request before completing it/);
  });

  it("refuses agents the things that are hers, with the rule", () => {
    const t = setupRequests();
    const error = thrown(() =>
      t.service.create(t.bot, { target: LIBRARY, kind: "quiz_me", message: "" }),
    );
    expect(error.code).toBe("forbidden");
    expect(error.message).toMatch(/Agents cannot create requests/);
    const id = makeIn(t, "done");
    expect(thrown(() => t.service.reopen(t.bot, id, { note: "" }))).toMatchObject({
      code: "forbidden",
      message: expect.stringMatching(/Only she/),
    });
    const waiting = makeIn(t, "waiting");
    expect(thrown(() => t.service.edit(t.bot, waiting, { message: "x" })).code).toBe("forbidden");
    expect(thrown(() => t.service.cancel(t.bot, waiting)).code).toBe("forbidden");
  });

  it("refuses her the agent's part", () => {
    const t = setupRequests();
    const id = makeIn(t, "in_progress");
    for (const run of [
      () => t.service.claim(t.she, makeIn(t, "waiting")),
      () => t.service.release(t.she, id),
      () => t.service.complete(t.she, id, { reply: "I did it myself", links: [] }),
      () => t.service.decline(t.she, id, { reason: "no" }),
    ]) {
      const error = thrown(run);
      expect(error.code).toBe("forbidden");
      expect(error.hint).toMatch(/She cannot do the agent's part/);
    }
    // Nothing changed.
    expect(t.service.get(t.she, id).status).toBe("in_progress");
  });

  it("lets her edit only while it waits, and keeps kind other honest", () => {
    const t = setupRequests();
    const id = t.service.create(t.she, { target: LIBRARY, kind: "other", message: "first" }).id;
    expect(t.service.edit(t.she, id, { message: "second" })).toMatchObject({ message: "second" });
    expect(t.service.edit(t.she, id, { kind: "quiz_me", message: "" })).toMatchObject({
      kind: "quiz_me",
      message: "",
    });
    const error = thrown(() => t.service.edit(t.she, id, { kind: "other" }));
    expect(error).toMatchObject({
      code: "invalid_input",
      message: expect.stringMatching(/needs a message/),
    });
    t.service.claim(t.bot, id);
    expect(thrown(() => t.service.edit(t.she, id, { message: "too late" })).code).toBe("conflict");
  });

  it("lets her cancel a request an agent is working on, and the agent finds out", () => {
    const t = setupRequests();
    const id = makeIn(t, "in_progress");
    t.service.cancel(t.she, id);
    const error = thrown(() => t.service.complete(t.bot, id, { reply: "done", links: [] }));
    expect(error.code).toBe("conflict");
    expect(error.message).toMatch(/cancelled cannot be completed/);
  });

  it("reopening keeps the old reply in history and the reply until the next one", () => {
    const t = setupRequests();
    const id = makeIn(t, "done");
    const reopened = t.service.reopen(t.she, id, { note: "no" });
    expect(reopened.reply?.text).toBe("Done.");
    t.service.claim(t.bot, id);
    const again = t.service.complete(t.bot, id, { reply: "Second try.", links: [] });
    expect(again.reply?.text).toBe("Second try.");
    expect(again.reopens[0]?.previousReply?.text).toBe("Done.");
  });

  it("stops a request from being reopened forever", () => {
    const t = setupRequests();
    const id = makeIn(t, "declined");
    for (let i = 0; i < 50; i++) {
      t.service.reopen(t.she, id, { note: `again ${i}` });
      t.service.decline(t.bot, id, { reason: "no" });
    }
    expect(thrown(() => t.service.reopen(t.she, id, { note: "once more" })).message).toMatch(
      /reopened 50 times/,
    );
  });
});

describe("claims", () => {
  it("expires after a while so a crashed agent does not block the request", () => {
    const t = setupRequests();
    const id = makeIn(t, "in_progress");
    expect(t.service.counts(t.she)).toMatchObject({ waiting: 0, in_progress: 1, open: 1 });
    t.clock.advance(30 * 60_000 - 1);
    expect(t.service.get(t.she, id).status).toBe("in_progress");
    t.clock.advance(1);
    const after = t.service.get(t.she, id);
    expect(after).toMatchObject({ status: "waiting", claimedBy: null, claimExpiresAt: null });
    expect(t.service.counts(t.she)).toMatchObject({ waiting: 1, in_progress: 0, open: 1 });
    // another agent can now take it
    expect(t.service.claim(t.otherBot, id).claimedBy).toMatchObject({ label: "Codex" });
    // the first agent has lost it
    const lost = thrown(() => t.service.complete(t.bot, id, { reply: "late", links: [] }));
    expect(lost.code).toBe("conflict");
    expect(lost.message).toMatch(/Another agent holds this request/);
  });

  it("tells a second agent the claim is live and until when", () => {
    const t = setupRequests();
    const id = makeIn(t, "in_progress");
    const error = thrown(() => t.service.claim(t.otherBot, id));
    expect(error.code).toBe("conflict");
    expect(error.message).toBe("Another agent has claimed this request.");
    expect(error.hint).toContain(new Date(t.clock.now() + 30 * 60_000).toISOString());
    expect(thrown(() => t.service.release(t.otherBot, id)).code).toBe("conflict");
    expect(thrown(() => t.service.decline(t.otherBot, id, { reason: "x" })).code).toBe("conflict");
  });

  it("renews when the holder claims again, and honours a requested length", () => {
    const t = setupRequests();
    const id = t.service.create(t.she, { target: LIBRARY, kind: "quiz_me", message: "" }).id;
    t.service.claim(t.bot, id, { ttlSeconds: 120 });
    t.clock.advance(100_000);
    const renewed = t.service.claim(t.bot, id, { ttlSeconds: 600 });
    expect(renewed.claimExpiresAt).toBe(new Date(t.clock.now() + 600_000).toISOString());
    t.clock.advance(599_000);
    expect(t.service.get(t.she, id).status).toBe("in_progress");
    // the claim length is capped
    const t2 = setupRequests();
    const id2 = t2.service.create(t2.she, { target: LIBRARY, kind: "quiz_me", message: "" }).id;
    const long = t2.service.claim(t2.bot, id2, { ttlSeconds: 86_400 });
    expect(Date.parse(long.claimExpiresAt as string) - t2.clock.now()).toBe(86_400_000);
  });

  it("lets the holder release and anyone then claim", () => {
    const t = setupRequests();
    const id = makeIn(t, "in_progress");
    expect(t.service.release(t.bot, id).status).toBe("waiting");
    expect(t.service.claim(t.otherBot, id).status).toBe("in_progress");
  });

  it("lets only the claimant complete", () => {
    const t = setupRequests();
    const id = makeIn(t, "in_progress");
    expect(thrown(() => t.service.complete(t.otherBot, id, { reply: "x", links: [] })).code).toBe(
      "conflict",
    );
    expect(t.service.complete(t.bot, id, { reply: "x", links: [] }).status).toBe("done");
  });

  it("lets an agent decline a waiting request without claiming it", () => {
    const t = setupRequests();
    const id = makeIn(t, "waiting");
    expect(t.service.decline(t.bot, id, { reason: "Out of scope." }).reply?.text).toBe(
      "Out of scope.",
    );
  });

  it("will not claim a request whose target has gone", () => {
    const t = setupRequests();
    const { nodeId, documentId } = t.newDoc();
    const id = t.service.create(t.she, {
      target: { type: "document", documentId },
      kind: "expand",
      message: "",
    }).id;
    t.documents.onNodeDeleted(t.alice, [nodeId]);
    t.db.prepare("DELETE FROM nodes WHERE id = ?").run(nodeId);
    const error = thrown(() => t.service.claim(t.bot, id));
    expect(error).toMatchObject({ code: "conflict" });
    expect(error.hint).toMatch(/Decline it/);
  });
});

describe("targets", () => {
  it("accepts every kind of target that exists, with context for each", () => {
    const t = setupRequests();
    const { documentId, blockIds, nodeId } = t.newDoc();
    const targets: Array<[RequestTarget, string | null]> = [
      [LIBRARY, "Library"],
      [{ type: "node", nodeId }, "Beta blockers"],
      [{ type: "document", documentId }, "Beta blockers"],
      [{ type: "block", documentId, blockId: blockIds[1] as string }, "Beta blockers"],
    ];
    for (const [target, name] of targets) {
      const made = t.service.create(t.she, { target, kind: "expand", message: "" });
      expect(made.target).toEqual(target);
      expect(made.context.name).toBe(name);
    }
    const block = t.service.list(t.she, { targetType: "block" }).items[0];
    expect(block?.context.preview).toBe("Metoprolol too.");
  });

  it("refuses a target that does not exist, is someone else's, or is in the trash", () => {
    const t = setupRequests();
    const { documentId, nodeId, blockIds } = t.newDoc();
    const stranger = t.newDoc(["Secret"], t.bob);
    const errors = [
      thrown(() =>
        t.service.create(t.she, {
          target: { type: "node", nodeId: newId("node") },
          kind: "expand",
          message: "",
        }),
      ),
      thrown(() =>
        t.service.create(t.she, {
          target: { type: "document", documentId: stranger.documentId },
          kind: "expand",
          message: "",
        }),
      ),
      thrown(() =>
        t.service.create(t.she, {
          target: {
            type: "block",
            documentId: stranger.documentId,
            blockId: stranger.blockIds[0] as string,
          },
          kind: "expand",
          message: "",
        }),
      ),
    ];
    for (const error of errors) {
      expect(error.code).toBe("not_found");
      expect((error.example as Json).kind).toBe("wrong");
    }
    t.library.trash(t.alice, nodeId);
    const trashed = thrown(() =>
      t.service.create(t.she, {
        target: { type: "document", documentId },
        kind: "expand",
        message: "",
      }),
    );
    expect(trashed).toMatchObject({
      code: "conflict",
      message: expect.stringMatching(/in the trash/),
    });
    expect(blockIds).toHaveLength(2);
  });

  it("survives its block being regenerated, through the document ID", () => {
    const t = setupRequests();
    const { documentId, blockIds } = t.newDoc();
    const block = blockIds[0] as string;
    const id = t.service.create(t.she, {
      target: { type: "block", documentId, blockId: block },
      kind: "wrong",
      message: "Check this.",
    }).id;
    expect(t.service.get(t.she, id).context.preview).toBe("Atenolol is β1-selective.");

    // An agent regenerates the whole document: the block is gone.
    t.documents.replaceGenerated(t.bot, {
      documentId,
      blocks: [{ type: "paragraph", content: { text: "Brand new text." }, generalKnowledge: true }],
    } as never);

    const after = t.service.get(t.she, id);
    expect(after.status).toBe("waiting");
    expect(after.target).toEqual({ type: "block", documentId, blockId: block });
    expect(after.context.name).toBe("Beta blockers");
    expect(after.context.note).toMatch(/replaced when the document was regenerated/);
    // it can still be claimed and answered
    expect(t.service.claim(t.bot, id).status).toBe("in_progress");
    expect(
      t.service.complete(t.bot, id, {
        reply: "Regenerated.",
        links: [{ type: "document", documentId }],
      }).status,
    ).toBe("done");
  });
});

describe("counts", () => {
  it("counts every status, with open as waiting plus in progress", () => {
    const t = setupRequests();
    for (const status of [
      "waiting",
      "waiting",
      "in_progress",
      "done",
      "declined",
      "cancelled",
    ] as const) {
      makeIn(t, status);
    }
    expect(t.service.counts(t.she)).toEqual({
      waiting: 2,
      in_progress: 1,
      done: 1,
      declined: 1,
      cancelled: 1,
      open: 3,
    });
    expect(t.service.counts(userAuth(t.bob))).toEqual({
      waiting: 0,
      in_progress: 0,
      done: 0,
      declined: 0,
      cancelled: 0,
      open: 0,
    });
  });
});

describe("verifyForEdit", () => {
  function setup() {
    const t = setupRequests();
    const { documentId, blockIds } = t.newDoc();
    const [b0, b1] = blockIds as [string, string];
    const keyOf = (auth: typeof t.bot) => (auth.actor as { keyId: string }).keyId;
    const onBlock = t.service.create(t.she, {
      target: { type: "block", documentId, blockId: b0 },
      kind: "wrong",
      message: "",
    }).id;
    const onDoc = t.service.create(t.she, {
      target: { type: "document", documentId },
      kind: "expand",
      message: "",
    }).id;
    const onLibrary = t.service.create(t.she, { target: LIBRARY, kind: "quiz_me", message: "" }).id;
    return { t, documentId, b0, b1, keyOf, onBlock, onDoc, onLibrary };
  }

  it("is false until the request is claimed", () => {
    const s = setup();
    expect(
      s.t.service.verifyForEdit(s.t.alice, s.onBlock, {
        documentId: s.documentId,
        blockId: s.b0,
        keyId: s.keyOf(s.t.bot),
      }),
    ).toBe(false);
  });

  it("is true for the claiming agent on a block request's own block, and only that", () => {
    const s = setup();
    s.t.service.claim(s.t.bot, s.onBlock);
    const key = s.keyOf(s.t.bot);
    const ask = (scope: { documentId: string; blockId?: string }) =>
      s.t.service.verifyForEdit(s.t.alice, s.onBlock, { ...scope, keyId: key });
    expect(ask({ documentId: s.documentId, blockId: s.b0 })).toBe(true);
    expect(ask({ documentId: s.documentId, blockId: s.b1 })).toBe(false);
    // a whole-document operation names no block: a block request does not cover it
    expect(ask({ documentId: s.documentId })).toBe(false);
    expect(ask({ documentId: newId("document"), blockId: s.b0 })).toBe(false);
  });

  it("is true for a document request on any block of that document and on the document itself", () => {
    const s = setup();
    s.t.service.claim(s.t.bot, s.onDoc);
    const key = s.keyOf(s.t.bot);
    for (const scope of [
      { documentId: s.documentId },
      { documentId: s.documentId, blockId: s.b0 },
      { documentId: s.documentId, blockId: s.b1 },
    ]) {
      expect(s.t.service.verifyForEdit(s.t.alice, s.onDoc, { ...scope, keyId: key })).toBe(true);
    }
    expect(
      s.t.service.verifyForEdit(s.t.alice, s.onDoc, { documentId: newId("document"), keyId: key }),
    ).toBe(false);
  });

  it("never lifts protection for the library, a node, a source or a question", () => {
    const s = setup();
    s.t.service.claim(s.t.bot, s.onLibrary);
    expect(
      s.t.service.verifyForEdit(s.t.alice, s.onLibrary, {
        documentId: s.documentId,
        blockId: s.b0,
        keyId: s.keyOf(s.t.bot),
      }),
    ).toBe(false);
  });

  it("is false for another agent's key, for her session key id, and for a made-up request", () => {
    const s = setup();
    s.t.service.claim(s.t.bot, s.onDoc);
    const scope = { documentId: s.documentId, blockId: s.b0 };
    expect(
      s.t.service.verifyForEdit(s.t.alice, s.onDoc, { ...scope, keyId: s.keyOf(s.t.otherBot) }),
    ).toBe(false);
    expect(s.t.service.verifyForEdit(s.t.alice, s.onDoc, { ...scope, keyId: s.t.alice })).toBe(
      false,
    );
    expect(
      s.t.service.verifyForEdit(s.t.alice, newId("request"), { ...scope, keyId: s.keyOf(s.t.bot) }),
    ).toBe(false);
  });

  it("is false once the claim expired, was released, or the request finished", () => {
    const s = setup();
    const key = s.keyOf(s.t.bot);
    const scope = { documentId: s.documentId, blockId: s.b0, keyId: key };
    s.t.service.claim(s.t.bot, s.onDoc);
    expect(s.t.service.verifyForEdit(s.t.alice, s.onDoc, scope)).toBe(true);
    s.t.clock.advance(31 * 60_000);
    expect(s.t.service.verifyForEdit(s.t.alice, s.onDoc, scope)).toBe(false);
    s.t.service.claim(s.t.bot, s.onDoc);
    s.t.service.release(s.t.bot, s.onDoc);
    expect(s.t.service.verifyForEdit(s.t.alice, s.onDoc, scope)).toBe(false);
    s.t.service.claim(s.t.bot, s.onDoc);
    s.t.service.complete(s.t.bot, s.onDoc, { reply: "x", links: [] });
    expect(s.t.service.verifyForEdit(s.t.alice, s.onDoc, scope)).toBe(false);
  });

  it("is false for another user's request and for a request on trashed things", () => {
    const s = setup();
    s.t.service.claim(s.t.bot, s.onDoc);
    const scope = { documentId: s.documentId, blockId: s.b0, keyId: s.keyOf(s.t.bot) };
    expect(s.t.service.verifyForEdit(s.t.bob, s.onDoc, scope)).toBe(false);
    const node = s.t.db.prepare("SELECT node_id FROM documents WHERE id = ?").get(s.documentId) as {
      node_id: string;
    };
    s.t.service.onNodeTrashed(s.t.alice, [node.node_id]);
    expect(s.t.service.verifyForEdit(s.t.alice, s.onDoc, scope)).toBe(false);
  });

  it("is the check the documents domain calls before it lets a request ID lift protection", () => {
    const s = setup();
    // She edits a block, which protects it from agents.
    s.t.documents.updateBlock(s.t.she, {
      documentId: s.documentId,
      blockId: s.b0,
      mode: "patch",
      patch: { content: { text: "Her words" } },
    } as never);
    const rewrite = (requestId?: string) =>
      s.t.documents.updateBlock(s.t.bot, {
        documentId: s.documentId,
        blockId: s.b0,
        mode: "patch",
        patch: { content: { text: "Agent rewrite" } },
        ...(requestId ? { requestId } : {}),
      } as never);
    expect(thrown(() => rewrite()).code).toBe("forbidden");
    // The documents service in this branch takes any request ID on trust: the integrator
    // plugs `verifyForEdit` in front of it, as here, so only a live, claimed, matching one counts.
    const verified = (requestId: string) =>
      s.t.service.port.verifyForEdit(s.t.alice, requestId, {
        documentId: s.documentId,
        blockId: s.b0,
        keyId: (s.t.bot.actor as { keyId: string }).keyId,
      });
    expect(verified(s.onBlock)).toBe(false);
    s.t.service.claim(s.t.bot, s.onBlock);
    expect(verified(s.onBlock)).toBe(true);
    expect(verified(s.onLibrary)).toBe(false);
    expect(() => rewrite(s.onBlock)).not.toThrow();
  });
});

describe("hooks", () => {
  function setup() {
    const t = setupRequests();
    const d = t.newDoc();
    const onNode = t.service.create(t.she, {
      target: { type: "node", nodeId: d.nodeId },
      kind: "expand",
      message: "",
    }).id;
    const onDoc = t.service.create(t.she, {
      target: { type: "document", documentId: d.documentId },
      kind: "expand",
      message: "",
    }).id;
    const onBlock = t.service.create(t.she, {
      target: { type: "block", documentId: d.documentId, blockId: d.blockIds[0] as string },
      kind: "wrong",
      message: "",
    }).id;
    const elsewhere = t.service.create(t.she, { target: LIBRARY, kind: "quiz_me", message: "" }).id;
    return { t, d, onNode, onDoc, onBlock, elsewhere };
  }

  it("hides requests on trashed nodes and brings them back with the node", () => {
    const { t, d, onNode, onDoc, onBlock, elsewhere } = setup();
    t.service.onNodeTrashed(t.alice, [d.nodeId]);
    expect(t.service.list(t.she).items.map((r) => r.id)).toEqual([elsewhere]);
    expect(t.service.counts(t.she)).toMatchObject({ waiting: 1, open: 1 });
    for (const id of [onNode, onDoc, onBlock]) {
      expect(thrown(() => t.service.get(t.she, id)).code).toBe("not_found");
      expect(thrown(() => t.service.claim(t.bot, id)).code).toBe("not_found");
    }
    t.service.onNodeRestored(t.alice, [d.nodeId]);
    expect(t.service.list(t.she).items).toHaveLength(4);
    expect(t.service.counts(t.she).open).toBe(4);
    expect(t.service.get(t.she, onBlock).status).toBe("waiting");
  });

  it("closes open requests on a node deleted for good, with a note, and keeps finished ones", () => {
    const { t, d, onNode, onDoc, onBlock, elsewhere } = setup();
    t.service.claim(t.bot, onDoc);
    t.service.claim(t.bot, onNode);
    t.service.complete(t.bot, onNode, { reply: "Done earlier.", links: [] });
    t.service.onNodeTrashed(t.alice, [d.nodeId]);
    // What the integrator does when a node is deleted for good: every domain hears of it.
    t.documents.onNodeDeleted(t.alice, [d.nodeId]);
    t.db.prepare("DELETE FROM nodes WHERE id = ?").run(d.nodeId);
    t.service.onNodeDeleted(t.alice, [d.nodeId]);

    const doc = t.service.get(t.she, onDoc);
    expect(doc).toMatchObject({
      status: "declined",
      claimedBy: null,
      reply: { by: { type: "system" }, text: expect.stringMatching(/deleted for good/) },
    });
    expect(t.service.get(t.she, onBlock).status).toBe("declined");
    // the finished one keeps its history
    expect(t.service.get(t.she, onNode)).toMatchObject({
      status: "done",
      reply: { text: "Done earlier." },
    });
    expect(t.service.get(t.she, onDoc).context.note).toBe(
      "What this request was about no longer exists.",
    );
    expect(t.service.get(t.she, elsewhere).status).toBe("waiting");
    // and it cannot be reopened onto nothing
    expect(thrown(() => t.service.reopen(t.she, onDoc, { note: "" })).message).toMatch(
      /no longer exists/,
    );
  });

  it("follows source files and questions", () => {
    const t = setupRequests();
    const file = newId("file");
    const question = newId("question");
    // Sources and questions are not in the tables this test builds, so allow them.
    const t2 = setupRequests({
      ports: {
        lookup: {
          describe: (_user, target) =>
            target.type === "library"
              ? {
                  exists: true,
                  trashed: false,
                  name: "Library",
                  path: "",
                  preview: null,
                  nodeId: null,
                  note: null,
                }
              : {
                  exists: true,
                  trashed: false,
                  name: "thing",
                  path: null,
                  preview: null,
                  nodeId: null,
                  note: null,
                },
        },
      },
    });
    const a = t2.service.create(t2.she, {
      target: { type: "source", fileId: file },
      kind: "summarise",
      message: "",
    }).id;
    const b = t2.service.create(t2.she, {
      target: { type: "question", questionId: question },
      kind: "wrong",
      message: "",
    }).id;
    t2.service.onFilesTrashed(t2.alice, [file]);
    expect(t2.service.list(t2.she).items.map((r) => r.id)).toEqual([b]);
    t2.service.onFilesRestored(t2.alice, [file]);
    expect(t2.service.list(t2.she).items).toHaveLength(2);
    t2.service.onFilesDeleted(t2.alice, [file]);
    t2.service.onQuestionsDeleted(t2.alice, [question]);
    expect(t2.service.get(t2.she, a).status).toBe("declined");
    expect(t2.service.get(t2.she, b).status).toBe("declined");
    expect(t.service.counts(t.she).open).toBe(0);
  });

  it("only touches the owner's requests", () => {
    const { t, d } = setup();
    t.service.onNodeTrashed(t.bob, [d.nodeId]);
    expect(t.service.list(t.she).items).toHaveLength(4);
    t.service.onNodeDeleted(t.bob, [d.nodeId]);
    expect(t.service.counts(t.she).open).toBe(4);
  });
});

describe("the real lookup", () => {
  it("describes source files and pages from the files tables", () => {
    const t = setupRequests();
    const { sec } = t.spine();
    const fileId = newId("file");
    const pageId = newId("page");
    t.db
      .prepare(
        `INSERT INTO source_files (id, user_id, node_id, original_name, sha256, bytes, type, status, uploaded_by, created_at, updated_at)
         VALUES (?, ?, ?, 'Lecture 7.pdf', ?, 10, 'pdf', 'filed', '{}', 1, 1)`,
      )
      .run(fileId, t.alice, sec.sources, "a".repeat(64));
    t.db
      .prepare(
        `INSERT INTO pages (id, file_id, user_id, idx, width, height, image_bytes, has_text_layer, native_text)
         VALUES (?, ?, ?, 3, 10, 10, 10, 1, 'Cardioselective agents block β1 receptors.')`,
      )
      .run(pageId, fileId, t.alice);
    const made = t.service.create(t.she, {
      target: { type: "source", fileId, pageId },
      kind: "unclear",
      message: "",
    });
    expect(made.context).toMatchObject({
      name: "Lecture 7.pdf, page 3",
      path: "Fall 2026 / Pharmacology II / Sources",
      preview: "Cardioselective agents block β1 receptors.",
    });
    const wrongPage = thrown(() =>
      t.service.create(t.she, {
        target: { type: "source", fileId, pageId: newId("page") },
        kind: "unclear",
        message: "",
      }),
    );
    expect(wrongPage.code).toBe("not_found");
  });
});

describe("isolation", () => {
  it("keeps two users' requests apart", async () => {
    const t = setupRequests();
    const mine = t.service.create(t.she, { target: LIBRARY, kind: "quiz_me", message: "" }).id;
    const theirs = t.service.create(t.herBob, { target: LIBRARY, kind: "expand", message: "" }).id;
    expect(t.service.list(t.she).items.map((r) => r.id)).toEqual([mine]);
    expect(t.service.list(t.herBob).items.map((r) => r.id)).toEqual([theirs]);
    for (const act of [
      () => t.service.get(t.herBob, mine),
      () => t.service.edit(t.herBob, mine, { message: "x" }),
      () => t.service.cancel(t.herBob, mine),
    ]) {
      expect(thrown(act).code).toBe("not_found");
    }
    // an agent of Alice cannot see or claim Bob's request, and not the other way round
    expect(thrown(() => t.service.claim(t.bot, theirs)).code).toBe("not_found");
    const bobBot = { ...t.bot, userId: t.bob };
    expect(thrown(() => t.service.claim(bobBot, mine)).code).toBe("not_found");
    expect(t.service.list(t.bot).items.map((r) => r.id)).toEqual([mine]);
    const http = await t.call(t.asUser(t.bob), "GET", `/api/requests/${mine}`);
    expect(http.status).toBe(404);
  });
});

describe("HTTP rules", () => {
  it("needs a sign-in, and a read-only key reads but cannot change anything", async () => {
    const t = setupRequests();
    const id = t.service.create(t.she, { target: LIBRARY, kind: "quiz_me", message: "" }).id;
    expect((await t.call(null, "GET", "/api/requests")).status).toBe(401);
    const read = t.asKey(t.readBot);
    expect((await t.call(read, "GET", "/api/requests")).status).toBe(200);
    expect((await t.call(read, "GET", "/api/requests/counts")).status).toBe(200);
    expect((await t.call(read, "GET", `/api/requests/${id}`)).status).toBe(200);
    const changes: Array<[string, string, unknown]> = [
      ["POST", "/api/requests", { target: { type: "library" }, kind: "quiz_me" }],
      ["PATCH", `/api/requests/${id}`, { message: "x" }],
      ["POST", `/api/requests/${id}/cancel`, {}],
      ["POST", `/api/requests/${id}/reopen`, {}],
      ["POST", `/api/requests/${id}/claim`, {}],
      ["POST", `/api/requests/${id}/release`, {}],
      ["POST", `/api/requests/${id}/complete`, { reply: "x" }],
      ["POST", `/api/requests/${id}/decline`, { reason: "x" }],
    ];
    for (const [method, path, body] of changes) {
      const res = await t.call(read, method, path, body);
      expect(res.status, `${method} ${path}`).toBe(403);
      expect(res.body.error.code).toBe("read_only_key");
    }
    expect(t.service.get(t.she, id).status).toBe("waiting");
  });

  it("answers an agent that tries to create or reopen with the rule", async () => {
    const t = setupRequests();
    const create = await t.call(t.asKey(t.bot), "POST", "/api/requests", {
      target: { type: "library" },
      kind: "quiz_me",
    });
    expect(create.status).toBe(403);
    expect(create.body.error.message).toMatch(/Agents cannot create requests/);
    const id = makeIn(t, "done");
    const reopen = await t.call(t.asKey(t.bot), "POST", `/api/requests/${id}/reopen`, {});
    expect(reopen.status).toBe(403);
    // and she cannot complete over HTTP either
    const claimed = makeIn(t, "in_progress");
    const complete = await t.call(t.asUser(t.alice), "POST", `/api/requests/${claimed}/complete`, {
      reply: "me",
    });
    expect(complete.status).toBe(403);
  });

  it("teaches on invalid input", async () => {
    const t = setupRequests();
    const id = makeIn(t, "in_progress");
    const noReply = await t.call(t.asKey(t.bot), "POST", `/api/requests/${id}/complete`, {});
    expect(noReply.status).toBe(400);
    expect(noReply.body.error.example.reply).toBeTypeOf("string");
    const noMessage = await t.call(t.asUser(t.alice), "POST", "/api/requests", {
      target: { type: "library" },
      kind: "other",
    });
    expect(noMessage.status).toBe(400);
    expect(noMessage.body.error.message).toMatch(/needs a message/);
    const noTarget = await t.call(t.asUser(t.alice), "POST", "/api/requests", { kind: "wrong" });
    expect(noTarget.body.error.example.target.type).toBe("block");
    const bad = await t.call(t.asUser(t.alice), "GET", "/api/requests/not-an-id");
    expect(bad.status).toBe(404);
    const unknownStatus = await t.call(t.asUser(t.alice), "GET", "/api/requests?status=lost");
    expect(unknownStatus.status).toBe(400);
    const notJson = await t.app.request("/api/requests", {
      method: "POST",
      headers: { "x-user": t.alice, "content-type": "application/json" },
      body: "{oops",
    });
    expect(notJson.status).toBe(400);
  });

  it("edits through PATCH and filters a list by several statuses", async () => {
    const t = setupRequests();
    const id = t.service.create(t.she, { target: LIBRARY, kind: "other", message: "first" }).id;
    const patched = await t.call(t.asUser(t.alice), "PATCH", `/api/requests/${id}`, {
      message: "second",
    });
    expect(patched.body.request.message).toBe("second");
    makeIn(t, "done");
    const both = await t.call(t.asUser(t.alice), "GET", "/api/requests?status=waiting,done");
    expect(both.body.items).toHaveLength(2);
  });
});
