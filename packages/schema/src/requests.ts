import { z } from "zod";
import { Actor, Timestamp } from "./common.js";
import {
  BlockId,
  ConceptId,
  DocumentId,
  FileId,
  NodeId,
  PageId,
  QuestionId,
  RequestId,
  UserId,
} from "./ids.js";

/**
 * The request queue (features L1 to L5). She leaves a request inside the app;
 * the next agent session finds it over MCP, claims it, does the work and
 * replies. Nothing here runs a model: a request is a note with a target, a
 * status and a reply.
 *
 *   waiting ──claim──▶ in_progress ──complete──▶ done
 *      │  ◀──release / claim expires──┘  └─decline─▶ declined
 *      └──decline──▶ declined          done | declined ──reopen──▶ waiting
 *      └──cancel (hers)──▶ cancelled
 */

export const REQUEST_LIMITS = {
  messageChars: 4000,
  replyChars: 8000,
  reasonChars: 2000,
  /** Result links on one reply. */
  links: 50,
  /** Reopen notes kept on one request. */
  reopens: 50,
} as const;

// ---- targets -----------------------------------------------------------

/**
 * What a request is about: the whole library, a library node, a document, one
 * block, a source file or page, or a practice question.
 *
 * A block target also records its document: an agent regenerating a document
 * replaces blocks, and the document ID is what lets the request still find
 * its way to the right place afterwards.
 */
export const RequestTarget = z.discriminatedUnion(
  "type",
  [
    z.strictObject({ type: z.literal("library") }),
    z.strictObject({ type: z.literal("node"), nodeId: NodeId }),
    z.strictObject({ type: z.literal("document"), documentId: DocumentId }),
    z.strictObject({ type: z.literal("block"), documentId: DocumentId, blockId: BlockId }),
    z.strictObject({ type: z.literal("source"), fileId: FileId, pageId: PageId.optional() }),
    z.strictObject({ type: z.literal("question"), questionId: QuestionId }),
  ],
  {
    error:
      'A target is {"type": "library"}, {"type": "node", "nodeId"}, {"type": "document", "documentId"}, {"type": "block", "documentId", "blockId"}, {"type": "source", "fileId", "pageId"?} or {"type": "question", "questionId"}.',
  },
);
export type RequestTarget = z.infer<typeof RequestTarget>;

export const REQUEST_TARGET_TYPES = [
  "library",
  "node",
  "document",
  "block",
  "source",
  "question",
] as const satisfies ReadonlyArray<RequestTarget["type"]>;

/** The quick actions plus "other" (free text only). */
export const RequestKind = z.enum([
  "wrong",
  "unclear",
  "expand",
  "more_like_this",
  "make_questions",
  "summarise",
  "quiz_me",
  "other",
]);
export type RequestKind = z.infer<typeof RequestKind>;

export const REQUEST_KIND_INFO: Record<RequestKind, { label: string; meaning: string }> = {
  wrong: {
    label: "This is wrong",
    meaning: "She thinks this is incorrect. Check it against the sources and fix or explain.",
  },
  unclear: { label: "This is unclear", meaning: "She could not follow this. Say it more plainly." },
  expand: { label: "Explain more", meaning: "She wants more depth on this." },
  more_like_this: { label: "More like this", meaning: "Make more material of the same kind." },
  make_questions: { label: "Make questions", meaning: "Write practice questions from this." },
  summarise: { label: "Summarize", meaning: "Condense this." },
  quiz_me: { label: "Quiz me", meaning: "Set up practice on this." },
  other: { label: "Something else", meaning: "Read her message." },
};

/** Quick actions need no message; "other" is her words and so needs them. */
export function kindNeedsMessage(kind: RequestKind): boolean {
  return kind === "other";
}

// ---- status and transitions --------------------------------------------

export const RequestStatus = z.enum(["waiting", "in_progress", "done", "declined", "cancelled"]);
export type RequestStatus = z.infer<typeof RequestStatus>;

/** Statuses an agent still has to act on or that she is waiting on. */
export const OPEN_REQUEST_STATUSES: readonly RequestStatus[] = ["waiting", "in_progress"];

export const RequestAction = z.enum([
  "edit",
  "cancel",
  "claim",
  "release",
  "expire",
  "complete",
  "decline",
  "reopen",
  "close_target_deleted",
]);
export type RequestAction = z.infer<typeof RequestAction>;

/** Who may take an action: her (a browser session), an agent (an API key), or the server itself. */
export type RequestActor = "user" | "agent" | "system";

interface TransitionRule {
  from: readonly RequestStatus[];
  to: RequestStatus;
  by: readonly RequestActor[];
  /** One line for docs and error hints. */
  summary: string;
}

/** The whole state machine, as data. `canTransition` and `explainRefusal` are the only readers. */
export const REQUEST_TRANSITIONS: Record<RequestAction, TransitionRule> = {
  edit: {
    from: ["waiting"],
    to: "waiting",
    by: ["user"],
    summary: "She edits her request while nobody has started on it.",
  },
  cancel: {
    from: ["waiting", "in_progress"],
    to: "cancelled",
    by: ["user"],
    summary: "She withdraws a request that is waiting or being worked on.",
  },
  claim: {
    from: ["waiting"],
    to: "in_progress",
    by: ["agent"],
    summary: "An agent takes a waiting request. The claim expires if the agent goes quiet.",
  },
  release: {
    from: ["in_progress"],
    to: "waiting",
    by: ["agent"],
    summary: "The agent that holds the claim hands the request back.",
  },
  expire: {
    from: ["in_progress"],
    to: "waiting",
    by: ["system"],
    summary: "A claim ran out without an answer, so the request is open again.",
  },
  complete: {
    from: ["in_progress"],
    to: "done",
    by: ["agent"],
    summary: "The agent that holds the claim replies and marks the request done.",
  },
  decline: {
    from: ["waiting", "in_progress"],
    to: "declined",
    by: ["agent"],
    summary:
      "An agent says why it will not do this (from waiting, or by the agent that holds the claim).",
  },
  reopen: {
    from: ["done", "declined"],
    to: "waiting",
    by: ["user"],
    summary: "She is not satisfied with the answer and puts the request back in the queue.",
  },
  close_target_deleted: {
    from: ["waiting", "in_progress"],
    to: "declined",
    by: ["system"],
    summary: "What the request was about was deleted for good, so it is closed with a note.",
  },
};

export type TransitionCheck =
  | { ok: true; to: RequestStatus }
  | { ok: false; reason: "actor" | "status"; message: string; hint: string };

const WHO: Record<RequestActor, string> = {
  user: "she (a signed-in browser session)",
  agent: "an agent (an API key)",
  system: "the server",
};

const ACTION_VERB: Record<RequestAction, string> = {
  edit: "edit",
  cancel: "cancel",
  claim: "claim",
  release: "release",
  expire: "expire",
  complete: "complete",
  decline: "decline",
  reopen: "reopen",
  close_target_deleted: "close",
};

/** The actions that can be taken from a status, by anyone. */
export function actionsFrom(status: RequestStatus): RequestAction[] {
  return (Object.keys(REQUEST_TRANSITIONS) as RequestAction[]).filter((action) =>
    REQUEST_TRANSITIONS[action].from.includes(status),
  );
}

/**
 * Whether `actor` may take `action` on a request in `status`, and if not why
 * not, in words an agent can act on.
 */
export function canTransition(
  status: RequestStatus,
  action: RequestAction,
  actor: RequestActor,
): TransitionCheck {
  const rule = REQUEST_TRANSITIONS[action];
  if (!rule.by.includes(actor)) {
    const allowed = rule.by.map((who) => WHO[who]).join(" or ");
    return {
      ok: false,
      reason: "actor",
      message: `Only ${allowed} can ${ACTION_VERB[action]} a request; this was tried by ${WHO[actor]}.`,
      hint:
        actor === "agent"
          ? "Agents claim, release, complete and decline requests. Creating, editing, canceling and reopening are hers."
          : actor === "user"
            ? "She cannot do the agent's part: claiming, releasing, completing and declining are done by an agent through its API key."
            : "This is not something to do by hand.",
    };
  }
  if (!rule.from.includes(status)) {
    const own = actionsFrom(status).filter((a) => REQUEST_TRANSITIONS[a].by.includes(actor));
    const wanted = rule.from.map((value) => value.replace("_", " ")).join(" or ");
    const shown = status.replace("_", " ");
    let hint: string;
    if (own.length > 0) {
      hint = `From ${shown} you can: ${own.join(", ")}.`;
    } else {
      const others = actionsFrom(status).filter(
        (a) => !REQUEST_TRANSITIONS[a].by.includes("system"),
      );
      hint =
        others.length > 0
          ? `A ${shown} request has nothing left for ${WHO[actor]}; it can still be: ${others.join(", ")}.`
          : `A ${shown} request is finished; there is nothing more to do with it. She can leave a new request instead.`;
    }
    return {
      ok: false,
      reason: "status",
      message: `A request that is ${shown} cannot be ${pastTense(action)}: this only works on a request that is ${wanted}.`,
      hint,
    };
  }
  return { ok: true, to: rule.to };
}

function pastTense(action: RequestAction): string {
  switch (action) {
    case "edit":
      return "edited";
    case "cancel":
      return "cancelled";
    case "claim":
      return "claimed";
    case "release":
      return "released";
    case "expire":
      return "expired";
    case "complete":
      return "completed";
    case "decline":
      return "declined";
    case "reopen":
      return "reopened";
    case "close_target_deleted":
      return "closed";
  }
}

// ---- the request --------------------------------------------------------

/** An object the agent made or changed in answering. */
export const RequestLink = z.discriminatedUnion("type", [
  z.strictObject({
    type: z.literal("node"),
    nodeId: NodeId,
    label: z.string().max(200).optional(),
  }),
  z.strictObject({
    type: z.literal("document"),
    documentId: DocumentId,
    label: z.string().max(200).optional(),
  }),
  z.strictObject({
    type: z.literal("block"),
    documentId: DocumentId,
    blockId: BlockId,
    label: z.string().max(200).optional(),
  }),
  z.strictObject({
    type: z.literal("question"),
    questionId: QuestionId,
    label: z.string().max(200).optional(),
  }),
  z.strictObject({
    type: z.literal("concept"),
    conceptId: ConceptId,
    label: z.string().max(200).optional(),
  }),
  z.strictObject({
    type: z.literal("source"),
    fileId: FileId,
    pageId: PageId.optional(),
    label: z.string().max(200).optional(),
  }),
]);
export type RequestLink = z.infer<typeof RequestLink>;

/** Who wrote a reply: an agent, or the server when it closes a request itself. */
export const ReplyAuthor = z.discriminatedUnion("type", [
  z.strictObject({
    type: z.literal("agent"),
    keyId: z.string(),
    label: z.string().max(80).optional(),
  }),
  z.strictObject({ type: z.literal("system") }),
]);
export type ReplyAuthor = z.infer<typeof ReplyAuthor>;

export const RequestReply = z.object({
  text: z.string().min(1).max(REQUEST_LIMITS.replyChars),
  links: z.array(RequestLink).max(REQUEST_LIMITS.links),
  by: ReplyAuthor,
  at: Timestamp,
  /**
   * The reply states numbers with units (doses, ranges, decimals) that its sources (the pages or
   * blocks the request is about, and what the agent cited) do not contain, and the agent said to
   * go ahead anyway. She sees "contains figures not found in your notes". Absent on older replies.
   */
  unsourcedFigures: z.boolean().optional(),
  /** Which figures, as the agent wrote them; present when `unsourcedFigures` is true. */
  unsourcedFigureList: z.array(z.string().max(60)).max(20).optional(),
});
export type RequestReply = z.infer<typeof RequestReply>;

export const RequestReopen = z.object({
  at: Timestamp,
  /** What she said when she reopened it, if anything. */
  note: z.string().max(REQUEST_LIMITS.messageChars),
  /** Where it stood before: the reply she was not happy with is kept here. */
  previousStatus: z.enum(["done", "declined"]),
  previousReply: RequestReply.nullable(),
});
export type RequestReopen = z.infer<typeof RequestReopen>;

export const StudyRequest = z.object({
  id: RequestId,
  userId: UserId,
  target: RequestTarget,
  kind: RequestKind,
  /** Her words. May be empty for a quick action. */
  message: z.string().max(REQUEST_LIMITS.messageChars),
  status: RequestStatus,
  /** Always her; agents never create requests. */
  createdBy: z.strictObject({ type: z.literal("user"), userId: UserId }),
  /** The agent working on it; null unless status is in_progress. */
  claimedBy: Actor.nullable(),
  claimedAt: Timestamp.nullable(),
  /** When the claim runs out and the request is open again. */
  claimExpiresAt: Timestamp.nullable(),
  /** The newest answer (or decline reason); kept while it is reopened, replaced by the next. */
  reply: RequestReply.nullable(),
  reopens: z.array(RequestReopen).max(REQUEST_LIMITS.reopens),
  createdAt: Timestamp,
  updatedAt: Timestamp,
  /** When it last became done, declined or cancelled; null while open. */
  closedAt: Timestamp.nullable(),
});
export type StudyRequest = z.infer<typeof StudyRequest>;

/** Where a request points, described for the agent that picks it up. */
export const StudyRequestContext = z.object({
  /** The target's name: a node name, a document title, "Library"… */
  name: z.string().nullable(),
  /** Readable path in the library, e.g. "Fall 2026 / Pharmacology II / Lectures". */
  path: z.string().nullable(),
  /** The first words of the block, document, question or page. */
  preview: z.string().nullable(),
  /** The library node to open, when there is one. */
  nodeId: NodeId.nullable(),
  /** Says what is special: a regenerated block, a trashed target. */
  note: z.string().nullable(),
});
export type StudyRequestContext = z.infer<typeof StudyRequestContext>;

export const StudyRequestWithContext = StudyRequest.extend({ context: StudyRequestContext });
export type StudyRequestWithContext = z.infer<typeof StudyRequestWithContext>;

export const RequestCounts = z.object({
  waiting: z.number().int().min(0),
  in_progress: z.number().int().min(0),
  done: z.number().int().min(0),
  declined: z.number().int().min(0),
  cancelled: z.number().int().min(0),
  /** Waiting plus in progress: the number for the badge. */
  open: z.number().int().min(0),
});
export type RequestCounts = z.infer<typeof RequestCounts>;

// ---- inputs ---------------------------------------------------------------

const Message = z.string().trim().max(REQUEST_LIMITS.messageChars);

/** Hers. `message` may be left out for a quick action; "other" needs it. */
export const CreateRequestInput = z
  .strictObject({
    target: RequestTarget,
    kind: RequestKind.default("other"),
    message: Message.default(""),
  })
  .refine((input) => !kindNeedsMessage(input.kind) || input.message.length > 0, {
    error:
      'A request of kind "other" needs a message: say what you want. Quick actions (wrong, unclear, expand, more_like_this, make_questions, summarise, quiz_me) can leave it out.',
    path: ["message"],
  });
export type CreateRequestInput = z.infer<typeof CreateRequestInput>;

/** Hers, while the request is still waiting. The target stays; to move a request, cancel and leave a new one. */
export const EditRequestInput = z
  .strictObject({ kind: RequestKind.optional(), message: Message.optional() })
  .refine((input) => input.kind !== undefined || input.message !== undefined, {
    error: "Send a new kind or message to change.",
  });
export type EditRequestInput = z.infer<typeof EditRequestInput>;

/** Hers: put a done or declined request back, optionally saying what is still wrong. */
export const ReopenRequestInput = z.strictObject({ note: Message.default("") });
export type ReopenRequestInput = z.infer<typeof ReopenRequestInput>;

/** Hers: withdraw it. */
export const CancelRequestInput = z.strictObject({});
export type CancelRequestInput = z.infer<typeof CancelRequestInput>;

/** An agent's claim. `ttlSeconds` asks for a shorter or longer hold, within the server's limits. */
export const ClaimRequestInput = z.strictObject({
  ttlSeconds: z.number().int().min(60).max(86_400).optional(),
});
export type ClaimRequestInput = z.infer<typeof ClaimRequestInput>;

export const ReleaseRequestInput = z.strictObject({});
export type ReleaseRequestInput = z.infer<typeof ReleaseRequestInput>;

/** An agent's answer: what it did, and links to what it made or changed. */
export const CompleteRequestInput = z.strictObject({
  reply: z
    .string()
    .trim()
    .min(1, { error: "Say what you did, in a sentence or two, so she can see the answer." })
    .max(REQUEST_LIMITS.replyChars),
  links: z.array(RequestLink).max(REQUEST_LIMITS.links).default([]),
  /**
   * The reply's numbers with units are checked against the pages and blocks the request is about
   * and the ones you cite in `links`. Figures found nowhere are refused with a warning; send true
   * only when they truly come from general knowledge: she then sees the reply flagged.
   */
  acknowledgeUnsourced: z.boolean().optional(),
});
export type CompleteRequestInput = z.infer<typeof CompleteRequestInput>;

export const DeclineRequestInput = z.strictObject({
  reason: z
    .string()
    .trim()
    .min(1, { error: "Say why you are not doing this, so she knows what to change." })
    .max(REQUEST_LIMITS.reasonChars),
});
export type DeclineRequestInput = z.infer<typeof DeclineRequestInput>;

/** Valid examples, for error messages. */
export const REQUEST_EXAMPLES = {
  create: {
    target: {
      type: "block",
      documentId: "doc_01J9Z8Y7X6W5V4T3S2R1Q0P9N8",
      blockId: "blk_01J9Z8Y7X6W5V4T3S2R1Q0P9N8",
    },
    kind: "wrong",
    message: "Atenolol is not lipid soluble, check slide 12.",
  },
  edit: { message: "Atenolol is hydrophilic, check slide 12." },
  reopen: { note: "You fixed the card but the table still says the old thing." },
  claim: { ttlSeconds: 1800 },
  complete: {
    reply: "Fixed the card and added a source for the lipid solubility claim.",
    links: [
      {
        type: "block",
        documentId: "doc_01J9Z8Y7X6W5V4T3S2R1Q0P9N8",
        blockId: "blk_01J9Z8Y7X6W5V4T3S2R1Q0P9N8",
        label: "Atenolol card",
      },
    ],
  },
  decline: { reason: "The slides do not say; I would have to guess. Add the page that covers it." },
} as const;
