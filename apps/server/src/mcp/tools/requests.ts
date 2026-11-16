import {
  ClaimRequestInput,
  CompleteRequestInput,
  DeclineRequestInput,
  NodeId,
  PageRequest,
  REQUEST_KIND_INFO,
  RequestId,
  RequestStatus,
  type StudyRequestWithContext,
} from "@notes/schema";
import { z } from "zod";
import { AppError } from "../../http/errors.js";
import { exampleId } from "../errors.js";
import { clip, json } from "../format.js";
import type { RequestsToolPort } from "../ports.js";
import { describe, flattenActions, jsonOf } from "../schema.js";
import { defineTool, parseAction, type ToolContext } from "../tool.js";

const REQ = exampleId("request");

function port(ctx: ToolContext): RequestsToolPort {
  const p = ctx.backend.requests;
  if (!p) throw new AppError("internal", "Requests are not available.");
  return p;
}

/** Where a request points, as one phrase with the IDs to act on. */
export function targetPhrase(r: StudyRequestWithContext): string {
  const t = r.target;
  const where = r.context.path ? ` at "${r.context.path}"` : "";
  switch (t.type) {
    case "library":
      return "the whole library";
    case "node":
      return `node ${t.nodeId}${r.context.name ? ` "${r.context.name}"` : ""}${where}`;
    case "document":
      return `document ${t.documentId}${r.context.name ? ` "${r.context.name}"` : ""}${where}`;
    case "block":
      return `block ${t.blockId} in document ${t.documentId}${where}`;
    case "source":
      return `file ${t.fileId}${t.pageId ? ` page ${t.pageId}` : ""}${where}`;
    default:
      return `question ${t.questionId}${where}`;
  }
}

/** What to do with a claimed request, concretely. */
function nextStep(r: StudyRequestWithContext): string {
  const t = r.target;
  const id = r.id;
  switch (t.type) {
    case "block":
      return `Open it with get_item {"id":"${t.documentId}"}, then change the block with edit_blocks {"operation":"update_block","documentId":"${t.documentId}","blockId":"${t.blockId}","requestId":"${id}",...}: her block is protected, and only this request lifts that (while you hold the claim). Then complete it.`;
    case "document":
      return `Open it with get_item {"id":"${t.documentId}"}; edits to blocks she wrote need "requestId":"${id}" on edit_blocks while you hold the claim. Then complete it.`;
    case "question":
      return `Open it with get_item {"id":"${t.questionId}"}; change it with practice_questions. Then complete it.`;
    case "source":
      return `Open the page with get_page${t.pageId ? ` {"pageId":"${t.pageId}"}` : ""} or the file with get_item {"id":"${t.fileId}"}. Then complete it.`;
    case "node":
      return `Open it with get_item {"id":"${t.nodeId}"}. Then complete it with links to what you made.`;
    default:
      return "Then complete it with links to what you made.";
  }
}

export function requestLine(r: StudyRequestWithContext): string {
  const claim =
    r.status === "in_progress" && r.claimedBy?.type === "agent"
      ? `, claimed by ${r.claimedBy.label ?? `key ${r.claimedBy.keyId}`} until ${r.claimExpiresAt}`
      : "";
  const said = r.message ? ` She wrote: "${clip(r.message, 300).text}".` : "";
  const preview = r.context.preview ? ` Preview: "${clip(r.context.preview, 120).text}".` : "";
  const note = r.context.note ? ` Note: ${r.context.note}.` : "";
  return `- ${r.id} [${r.status}${claim}] ${r.kind} (${REQUEST_KIND_INFO[r.kind].meaning}) on ${targetPhrase(r)}.${said}${preview}${note}`;
}

function requestItem(r: StudyRequestWithContext) {
  return {
    id: r.id,
    status: r.status,
    kind: r.kind,
    message: r.message,
    target: r.target,
    context: r.context,
    claimedBy: r.claimedBy,
    claimExpiresAt: r.claimExpiresAt,
    reply: r.reply,
    createdAt: r.createdAt,
  };
}

const RequestRef = { requestId: RequestId };

const BRANCHES = {
  list: z.strictObject({
    status: z.array(RequestStatus).min(1).max(5).optional(),
    nodeId: NodeId.optional(),
    cursor: PageRequest.shape.cursor,
    limit: z.number().int().min(1).max(50).default(20),
  }),
  claim: z.strictObject({ ...RequestRef, ...ClaimRequestInput.shape }),
  release: z.strictObject(RequestRef),
  complete: z.strictObject({ ...RequestRef, ...CompleteRequestInput.shape }),
  decline: z.strictObject({ ...RequestRef, ...DeclineRequestInput.shape }),
};
type Action = keyof typeof BRANCHES;

/** As published: each link as one flat object (the six link shapes are checked on the server). */
const PUBLISHED = {
  ...BRANCHES,
  complete: z.strictObject({
    ...RequestRef,
    reply: CompleteRequestInput.shape.reply,
    links: z
      .array(
        z.looseObject({
          type: z.enum(["node", "document", "block", "question", "concept", "source"]),
          label: z.string().max(200).optional(),
        }),
      )
      .max(50)
      .optional(),
    acknowledgeUnsourced: CompleteRequestInput.shape.acknowledgeUnsourced,
  }),
};

const EXAMPLES: Record<Action, Record<string, unknown>> = {
  list: { action: "list" },
  claim: { action: "claim", requestId: REQ },
  release: { action: "release", requestId: REQ },
  complete: {
    action: "complete",
    requestId: REQ,
    reply: "Corrected the dose to 25 mg twice daily, as on slide 10.",
    links: [
      {
        type: "block",
        documentId: exampleId("document"),
        blockId: exampleId("block"),
        label: "Dosing table",
      },
    ],
  },
  decline: {
    action: "decline",
    requestId: REQ,
    reason: "The lecture has no slides on this yet; upload them and ask again.",
  },
};

export const requestsTool = defineTool({
  name: "requests",
  title: "Her requests: what she asked agents to do",
  description: `What she has asked for, left on a lecture, a document, a block, a page, a question or the whole library ("this is wrong", "make me a quiz on this", ...). CHECK THESE FIRST in every session. Actions: "list" (open ones, waiting first, each with what it points at, its path and a preview); "claim" one before working on it (30 minutes, claim again to renew; another agent's claim is refused); "complete" it with a short reply saying what you did and links to what you made or changed (doses and other numbers with units in the reply are checked against the page or block it is about and what you link; figures found nowhere are refused with a warning until you link a source that has them or pass acknowledgeUnsourced: true, which flags the reply for her); "decline" with a reason when it cannot be done; "release" it if you stop. Her blocks and the questions she wrote are protected from agents: completing her request is the one way to change them, by passing "requestId" to edit_blocks while you hold the claim.`,
  annotations: {
    readOnlyHint: false,
    destructiveHint: false,
    idempotentHint: false,
    openWorldHint: false,
  },
  inputSchema: describe(
    flattenActions(
      "action",
      Object.fromEntries(Object.entries(PUBLISHED).map(([k, v]) => [k, jsonOf(v)])),
      '"list" open requests; "claim" one; "complete" it with a reply; "decline" it with a reason; "release" it.',
    ),
    {
      status:
        'list: only these statuses ("waiting", "in_progress", "done", "declined", "cancelled"). Default: the open ones, waiting first.',
      nodeId: "list: only requests on this node or on documents and blocks under it.",
      cursor: "list (with status): the nextCursor of the previous call.",
      limit: "list: requests per page, 1 to 50 (default 20).",
      requestId: `The request, e.g. "${REQ}".`,
      ttlSeconds: "claim: how long to hold it, 60 to 86400 seconds (default 1800).",
      reply:
        "complete: what you did, in a sentence or two, for her to read (shown on the request).",
      links: "complete: what you made or changed, up to 50, so she can open it from the reply.",
      "links[].type":
        '"node" (with nodeId), "document" (documentId), "block" (documentId and blockId), "question" (questionId), "concept" (conceptId) or "source" (fileId, pageId?).',
      "links[].label": "Optional short label, e.g. the block's heading.",
      acknowledgeUnsourced:
        'complete: true only when the reply states figures (doses, ranges, decimals) that are not on the pages or blocks it is about or that you linked, because they come from general knowledge. She sees "contains figures not found in your notes".',
      reason: "decline: why it cannot be done, and what she could change.",
    },
  ),
  parse: (raw) => parseAction("requests", "action", BRANCHES, EXAMPLES, raw),
  writes: (input) => (input as { action: string }).action !== "list",
  action: (input) => (input as { action: string }).action,
  run(ctx, input) {
    const p = port(ctx);
    const { action, value } = input as unknown as {
      action: Action;
      value: Record<string, unknown>;
    };
    if (action === "list") {
      const v = value as unknown as z.output<typeof BRANCHES.list>;
      let items: StudyRequestWithContext[];
      let nextCursor: string | null = null;
      if (v.status) {
        const page = p.list(ctx.auth, {
          status: v.status,
          nodeId: v.nodeId,
          order: "oldest",
          cursor: v.cursor,
          limit: v.limit,
        });
        items = page.items;
        nextCursor = page.nextCursor;
      } else {
        const of = (status: "waiting" | "in_progress") =>
          p.list(ctx.auth, { status: [status], nodeId: v.nodeId, order: "oldest", limit: v.limit })
            .items;
        items = [...of("waiting"), ...of("in_progress")].slice(0, v.limit);
      }
      const counts = p.counts(ctx.auth);
      const lines = [
        `Requests: ${counts.waiting} waiting, ${counts.in_progress} in progress, ${counts.done} done.`,
        ...items.map(requestLine),
      ];
      if (items.length === 0) lines.push("(nothing open: she has not asked for anything new)");
      else
        lines.push(
          'Claim one before working on it: requests {"action":"claim","requestId":"req_…"}.',
        );
      if (nextCursor)
        lines.push(`More: requests ${json({ ...v, action: "list", cursor: nextCursor })}.`);
      return {
        text: lines.join("\n"),
        structured: { counts, items: items.map(requestItem), nextCursor },
      };
    }
    const id = value.requestId as string;
    const { requestId: _drop, ...rest } = value;
    const r =
      action === "claim"
        ? p.claim(ctx.auth, id, rest as z.output<typeof ClaimRequestInput>)
        : action === "release"
          ? p.release(ctx.auth, id)
          : action === "complete"
            ? p.complete(ctx.auth, id, rest as z.output<typeof CompleteRequestInput>)
            : p.decline(ctx.auth, id, rest as z.output<typeof DeclineRequestInput>);
    const said: Record<Exclude<Action, "list">, string> = {
      claim: `Claimed until ${r.claimExpiresAt}:\n${requestLine(r)}\n${nextStep(r)}`,
      release: `Released; it is waiting again:\n${requestLine(r)}`,
      complete: `Completed; she sees your reply${r.reply?.unsourcedFigures ? `, flagged "contains figures not found in your notes" (${(r.reply.unsourcedFigureList ?? []).join(", ")})` : ""}:\n${requestLine(r)}`,
      decline: `Declined; she sees your reason:\n${requestLine(r)}`,
    };
    return { text: said[action], structured: { action, request: requestItem(r) } };
  },
});

/** get_item on a req_ ID. */
export function getRequest(ctx: ToolContext, id: string) {
  const r = port(ctx).get(ctx.auth, id);
  const reply = r.reply
    ? `\nReply (${r.reply.by.type}, ${r.reply.at}): ${r.reply.text}${r.reply.unsourcedFigures ? `\n(Flagged for her: contains figures not found in her notes: ${(r.reply.unsourcedFigureList ?? []).join(", ")}.)` : ""}`
    : "";
  return {
    text: `Request ${r.id}, created ${r.createdAt}:\n${requestLine(r)}${reply}${r.status === "waiting" ? `\nTo work on it: requests {"action":"claim","requestId":"${r.id}"}.` : ""}`,
    structured: { kind: "request", request: requestItem(r) },
  };
}
