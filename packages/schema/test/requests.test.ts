import { describe, expect, it } from "vitest";
import { newId } from "../src/ids.js";
import {
  actionsFrom,
  CancelRequestInput,
  CompleteRequestInput,
  CreateRequestInput,
  canTransition,
  DeclineRequestInput,
  EditRequestInput,
  REQUEST_EXAMPLES,
  REQUEST_TRANSITIONS,
  ReopenRequestInput,
  RequestAction,
  RequestCounts,
  RequestKind,
  RequestLink,
  RequestStatus,
  RequestTarget,
  StudyRequest,
} from "../src/requests.js";

const doc = newId("document");
const blk = newId("block");

describe("request targets", () => {
  it("accepts every kind of target", () => {
    const targets = [
      { type: "library" },
      { type: "node", nodeId: newId("node") },
      { type: "document", documentId: doc },
      { type: "block", documentId: doc, blockId: blk },
      { type: "source", fileId: newId("file") },
      { type: "source", fileId: newId("file"), pageId: newId("page") },
      { type: "question", questionId: newId("question") },
    ];
    for (const target of targets) expect(RequestTarget.parse(target)).toEqual(target);
  });

  it("makes a block target carry its document", () => {
    const result = RequestTarget.safeParse({ type: "block", blockId: blk });
    expect(result.success).toBe(false);
  });

  it("refuses an ID of the wrong kind and unknown keys", () => {
    expect(RequestTarget.safeParse({ type: "node", nodeId: doc }).success).toBe(false);
    expect(RequestTarget.safeParse({ type: "library", extra: 1 }).success).toBe(false);
  });

  it("names the valid shapes when the type is unknown", () => {
    const result = RequestTarget.safeParse({ type: "folder" });
    expect(result.success).toBe(false);
    expect(JSON.stringify(result.error?.issues)).toContain("block");
  });
});

describe("create input", () => {
  it("lets a quick action leave the message out", () => {
    const parsed = CreateRequestInput.parse({ target: { type: "library" }, kind: "quiz_me" });
    expect(parsed.message).toBe("");
  });

  it("requires words for kind other, and says so", () => {
    const result = CreateRequestInput.safeParse({ target: { type: "library" }, kind: "other" });
    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.message).toMatch(/needs a message/);
    expect(
      CreateRequestInput.safeParse({ target: { type: "library" }, message: "Explain QT" }).success,
    ).toBe(true);
  });

  it("trims her message and caps its length", () => {
    expect(
      CreateRequestInput.parse({ target: { type: "library" }, message: "  hi  " }).message,
    ).toBe("hi");
    expect(
      CreateRequestInput.safeParse({ target: { type: "library" }, message: "x".repeat(4001) })
        .success,
    ).toBe(false);
  });

  it("accepts its own published example", () => {
    expect(CreateRequestInput.safeParse(REQUEST_EXAMPLES.create).success).toBe(true);
  });

  it("refuses fields it does not own", () => {
    expect(
      CreateRequestInput.safeParse({ target: { type: "library" }, kind: "wrong", status: "done" })
        .success,
    ).toBe(false);
  });

  it("knows every quick action", () => {
    expect(RequestKind.options).toEqual([
      "wrong",
      "unclear",
      "expand",
      "more_like_this",
      "make_questions",
      "summarise",
      "quiz_me",
      "other",
    ]);
  });
});

describe("other inputs", () => {
  it("edit needs something to change", () => {
    expect(EditRequestInput.safeParse({}).success).toBe(false);
    expect(EditRequestInput.safeParse({ message: "new" }).success).toBe(true);
    expect(EditRequestInput.safeParse({ kind: "unclear" }).success).toBe(true);
    // the target cannot be moved
    expect(EditRequestInput.safeParse({ target: { type: "library" }, message: "x" }).success).toBe(
      false,
    );
  });

  it("reopen and cancel accept an empty body", () => {
    expect(ReopenRequestInput.parse({})).toEqual({ note: "" });
    expect(CancelRequestInput.safeParse({}).success).toBe(true);
  });

  it("complete needs a reply and defaults links", () => {
    expect(CompleteRequestInput.safeParse({}).success).toBe(false);
    const parsed = CompleteRequestInput.parse({ reply: "Done." });
    expect(parsed.links).toEqual([]);
    expect(CompleteRequestInput.safeParse(REQUEST_EXAMPLES.complete).success).toBe(true);
    const blank = CompleteRequestInput.safeParse({ reply: "   " });
    expect(blank.success).toBe(false);
    expect(blank.error?.issues[0]?.message).toMatch(/what you did/);
  });

  it("decline needs a reason", () => {
    const blank = DeclineRequestInput.safeParse({ reason: "" });
    expect(blank.success).toBe(false);
    expect(blank.error?.issues[0]?.message).toMatch(/why/);
    expect(DeclineRequestInput.safeParse(REQUEST_EXAMPLES.decline).success).toBe(true);
  });

  it("result links point at things an agent can make", () => {
    for (const link of [
      { type: "node", nodeId: newId("node") },
      { type: "document", documentId: doc },
      { type: "block", documentId: doc, blockId: blk },
      { type: "question", questionId: newId("question") },
      { type: "concept", conceptId: newId("concept"), label: "Metoprolol" },
      { type: "source", fileId: newId("file") },
    ]) {
      expect(RequestLink.safeParse(link).success).toBe(true);
    }
    expect(RequestLink.safeParse({ type: "block", blockId: blk }).success).toBe(false);
  });
});

describe("the request object", () => {
  const userId = newId("user");
  const base = {
    id: newId("request"),
    userId,
    target: { type: "library" },
    kind: "quiz_me",
    message: "",
    status: "waiting",
    createdBy: { type: "user", userId },
    claimedBy: null,
    claimedAt: null,
    claimExpiresAt: null,
    reply: null,
    reopens: [],
    createdAt: "2026-11-15T12:00:00.000Z",
    updatedAt: "2026-11-15T12:00:00.000Z",
    closedAt: null,
  };

  it("parses a waiting request", () => {
    expect(StudyRequest.parse(base)).toEqual(base);
  });

  it("only her can be the creator", () => {
    const agent = { type: "agent", keyId: newId("apiKey") };
    expect(StudyRequest.safeParse({ ...base, createdBy: agent }).success).toBe(false);
  });

  it("carries a claim, a reply with links and reopen history", () => {
    const keyId = newId("apiKey");
    const reply = {
      text: "Done",
      links: [{ type: "document", documentId: doc }],
      by: { type: "agent", keyId, label: "Claude Code" },
      at: "2026-11-15T13:00:00.000Z",
    };
    const full = {
      ...base,
      status: "in_progress",
      claimedBy: { type: "agent", keyId },
      claimedAt: "2026-11-15T12:30:00.000Z",
      claimExpiresAt: "2026-11-15T13:00:00.000Z",
      reply,
      reopens: [
        {
          at: "2026-11-15T14:00:00.000Z",
          note: "still wrong",
          previousStatus: "done",
          previousReply: reply,
        },
      ],
    };
    expect(StudyRequest.safeParse(full).success).toBe(true);
  });

  it("counts include the open total", () => {
    expect(
      RequestCounts.safeParse({
        waiting: 2,
        in_progress: 1,
        done: 0,
        declined: 0,
        cancelled: 0,
        open: 3,
      }).success,
    ).toBe(true);
  });
});

describe("the transition table", () => {
  const statuses = RequestStatus.options;
  const actors = ["user", "agent", "system"] as const;

  it("accepts exactly the transitions in the table, for every status, action and actor", () => {
    for (const status of statuses) {
      for (const action of RequestAction.options) {
        for (const actor of actors) {
          const rule = REQUEST_TRANSITIONS[action];
          const expected = rule.from.includes(status) && rule.by.includes(actor);
          const result = canTransition(status, action, actor);
          expect(result.ok, `${status} --${action}--> by ${actor}`).toBe(expected);
          if (result.ok) expect(result.to).toBe(rule.to);
        }
      }
    }
  });

  it("walks the happy path", () => {
    expect(canTransition("waiting", "claim", "agent")).toEqual({ ok: true, to: "in_progress" });
    expect(canTransition("in_progress", "complete", "agent")).toEqual({ ok: true, to: "done" });
    expect(canTransition("done", "reopen", "user")).toEqual({ ok: true, to: "waiting" });
  });

  it("lets a claim run out or be released back to waiting", () => {
    expect(canTransition("in_progress", "release", "agent")).toEqual({ ok: true, to: "waiting" });
    expect(canTransition("in_progress", "expire", "system")).toEqual({ ok: true, to: "waiting" });
  });

  it("lets an agent decline from waiting or in progress", () => {
    expect(canTransition("waiting", "decline", "agent").ok).toBe(true);
    expect(canTransition("in_progress", "decline", "agent").ok).toBe(true);
    expect(canTransition("done", "decline", "agent").ok).toBe(false);
  });

  it("makes canceled final", () => {
    expect(actionsFrom("cancelled")).toEqual([]);
  });

  it("explains a refused actor", () => {
    const agentCreateLike = canTransition("done", "reopen", "agent");
    expect(agentCreateLike.ok).toBe(false);
    if (!agentCreateLike.ok) {
      expect(agentCreateLike.reason).toBe("actor");
      expect(agentCreateLike.message).toMatch(/Only she/);
      expect(agentCreateLike.hint).toMatch(/Creating, editing, canceling and reopening are hers/);
    }
    const userComplete = canTransition("in_progress", "complete", "user");
    expect(userComplete.ok).toBe(false);
    if (!userComplete.ok) {
      expect(userComplete.message).toMatch(/Only an agent/);
      expect(userComplete.hint).toMatch(/She cannot do the agent's part/);
    }
  });

  it("explains a refused status and lists what is possible instead", () => {
    const result = canTransition("done", "claim", "agent");
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe("status");
      expect(result.message).toBe(
        "A request that is done cannot be claimed: this only works on a request that is waiting.",
      );
      expect(result.hint).toMatch(/nothing left for an agent.*reopen/);
    }
  });

  it("tells an agent what it can do from the state it is in", () => {
    const result = canTransition("waiting", "complete", "agent");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.hint).toBe("From waiting you can: claim, decline.");
  });

  it("says a finished request is finished", () => {
    const result = canTransition("cancelled", "reopen", "user");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.hint).toMatch(/leave a new request/);
  });
});
