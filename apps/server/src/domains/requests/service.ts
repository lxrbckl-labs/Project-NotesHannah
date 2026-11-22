import {
  type Actor,
  type ClaimRequestInput,
  type CompleteRequestInput,
  type CreateRequestInput,
  canTransition,
  type DeclineRequestInput,
  type EditRequestInput,
  kindNeedsMessage,
  newId,
  REQUEST_EXAMPLES,
  REQUEST_LIMITS,
  type ReleaseRequestInput,
  type ReopenRequestInput,
  type RequestAction,
  type RequestCounts,
  type RequestInstructions,
  type RequestReopen,
  type RequestReply,
  type RequestStatus,
  type RequestTarget,
  type StudyRequest,
  type StudyRequestContext,
  type StudyRequestWithContext,
} from "@notes/schema";
import type { AuthContext } from "../../http/auth-context.js";
import type { ServerDeps } from "../../http/deps.js";
import { AppError } from "../../http/errors.js";
import { type ActivityPort, createActivityLog } from "../activity/activity.js";
import type { ChangeRecorder } from "../activity/trace.js";
import { figuresNotIn } from "../files/figures.js";
import { createDbTargetLookup, type TargetInfo, type TargetLookup } from "./lookup.js";
import { createDbSourceTexts, type SourceTexts } from "./sources.js";

/** How long a claim lasts without being renewed. */
export const DEFAULT_CLAIM_TTL_MS = 30 * 60_000;
const MAX_CLAIM_TTL_MS = 24 * 60 * 60_000;
const DEFAULT_PAGE = 50;
/** Open requests one user may have at once; a guard against a runaway client. */
const MAX_OPEN = 1000;

export interface RequestsPorts {
  /** Where targets are described. Default: read the library, documents and files tables. */
  lookup?: TargetLookup;
  /** Agent work is logged here. Default: the shared activity log over the same database. */
  activity?: ActivityPort;
  /** Every step of a request (made, claimed, answered, ...) is appended here. Default: none. */
  changes?: ChangeRecorder;
  /** Default claim length in milliseconds (default 30 minutes). */
  claimTtlMs?: number;
  /** The text a reply's figures are checked against. Default: read the documents, files and questions tables. */
  sourceTexts?: SourceTexts;
}

interface Row {
  seq: number;
  id: string;
  user_id: string;
  target_type: RequestTarget["type"];
  node_id: string | null;
  document_id: string | null;
  block_id: string | null;
  file_id: string | null;
  page_id: string | null;
  question_id: string | null;
  scope_node_id: string | null;
  kind: StudyRequest["kind"];
  message: string;
  instructions: string | null;
  status: RequestStatus;
  claimed_by: string | null;
  claimed_at: number | null;
  claim_expires_at: number | null;
  reply: string | null;
  reopens: string;
  hidden_at: number | null;
  created_at: number;
  updated_at: number;
  closed_at: number | null;
}

export interface ListFilters {
  /** Any of the statuses. Default: everything except cancelled. */
  status?: readonly RequestStatus[] | undefined;
  targetType?: RequestTarget["type"] | undefined;
  /** Requests on this node, or on a document or block under it. */
  nodeId?: string | undefined;
  documentId?: string | undefined;
  blockId?: string | undefined;
  fileId?: string | undefined;
  questionId?: string | undefined;
  /** "newest" (default, for her screen) or "oldest" (for an agent working the queue in order). */
  order?: "newest" | "oldest" | undefined;
  cursor?: string | undefined;
  limit?: number | undefined;
}

export interface RequestPage {
  items: StudyRequestWithContext[];
  nextCursor: string | null;
}

/** What `verifyForEdit` is asked: this agent wants to edit this document, or this block of it. */
export interface EditScope {
  documentId: string;
  blockId?: string | undefined;
  /** The calling agent's API key ID. */
  keyId: string;
}

/**
 * The narrow view the documents domain and the MCP layer get. The integrator
 * plugs `verifyForEdit` into the documents service so a request's ID lifts
 * edit protection on exactly the thing it asks about.
 */
export interface RequestsPort {
  verifyForEdit(userId: string, requestId: string, scope: EditScope): boolean;
}

function parseCursor(cursor: string | undefined): number | null {
  if (cursor === undefined) return null;
  if (!/^\d{1,15}$/.test(cursor)) {
    throw new AppError("invalid_input", "That cursor is not one this list gave out.", {
      hint: 'Use the "nextCursor" of a previous response.',
      example: { cursor: "42" },
    });
  }
  return Number(cursor);
}

const notFoundRequest = () =>
  new AppError("not_found", "No such request.", {
    hint: "List requests with GET /api/requests to find the ID.",
  });

export function createRequestsService(
  deps: Pick<ServerDeps, "db" | "now">,
  ports: RequestsPorts = {},
) {
  const { db, now } = deps;
  const lookup = ports.lookup ?? createDbTargetLookup(db);
  const activity = ports.activity ?? createActivityLog(db, now);
  const defaultTtl = ports.claimTtlMs ?? DEFAULT_CLAIM_TTL_MS;
  const sourceTexts = ports.sourceTexts ?? createDbSourceTexts(db);
  const iso = (ms: number) => new Date(ms).toISOString();

  const q = {
    byId: db.prepare("SELECT * FROM requests WHERE id = ? AND user_id = ?"),
    insert: db.prepare(
      `INSERT INTO requests (id, user_id, target_type, node_id, document_id, block_id, file_id, page_id,
         question_id, scope_node_id, kind, message, instructions, status, reopens, created_at, updated_at)
       VALUES (@id, @user_id, @target_type, @node_id, @document_id, @block_id, @file_id, @page_id,
         @question_id, @scope_node_id, @kind, @message, @instructions, 'waiting', '[]', @t, @t)`,
    ),
    sweep: db.prepare(
      `UPDATE requests SET status = 'waiting', claimed_by = NULL, claimed_at = NULL,
         claim_expires_at = NULL, updated_at = @now
       WHERE user_id = @user AND status = 'in_progress' AND claim_expires_at <= @now`,
    ),
    openCount: db.prepare(
      "SELECT COUNT(*) AS n FROM requests WHERE user_id = ? AND status IN ('waiting', 'in_progress')",
    ),
    counts: db.prepare(
      "SELECT status, COUNT(*) AS n FROM requests WHERE user_id = ? AND hidden_at IS NULL GROUP BY status",
    ),
  };

  const rowOf = (userId: string, id: string) => q.byId.get(id, userId) as Row | undefined;

  /** Claims that have run out make their request waiting again. Cheap, and run before every read or change. */
  function sweep(userId: string): void {
    q.sweep.run({ now: now(), user: userId });
  }

  function need(userId: string, id: string): Row {
    sweep(userId);
    const row = rowOf(userId, id);
    if (!row || row.hidden_at !== null) throw notFoundRequest();
    return row;
  }

  // ---- mapping --------------------------------------------------------------

  function targetOf(r: Row): RequestTarget {
    switch (r.target_type) {
      case "library":
        return { type: "library" };
      case "node":
        return { type: "node", nodeId: r.node_id as string };
      case "document":
        return { type: "document", documentId: r.document_id as string };
      case "block":
        return {
          type: "block",
          documentId: r.document_id as string,
          blockId: r.block_id as string,
        };
      case "source":
        return {
          type: "source",
          fileId: r.file_id as string,
          ...(r.page_id ? { pageId: r.page_id } : {}),
        };
      case "question":
        return { type: "question", questionId: r.question_id as string };
    }
  }

  function toRequest(r: Row): StudyRequest {
    const claimed = r.status === "in_progress" && r.claimed_by !== null;
    return {
      id: r.id,
      userId: r.user_id,
      target: targetOf(r),
      kind: r.kind,
      message: r.message,
      instructions: r.instructions ? (JSON.parse(r.instructions) as RequestInstructions) : null,
      status: r.status,
      createdBy: { type: "user", userId: r.user_id },
      claimedBy: claimed ? (JSON.parse(r.claimed_by as string) as Actor) : null,
      claimedAt: claimed && r.claimed_at !== null ? iso(r.claimed_at) : null,
      claimExpiresAt: claimed && r.claim_expires_at !== null ? iso(r.claim_expires_at) : null,
      reply: r.reply ? (JSON.parse(r.reply) as RequestReply) : null,
      reopens: JSON.parse(r.reopens) as RequestReopen[],
      createdAt: iso(r.created_at),
      updatedAt: iso(r.updated_at),
      closedAt: r.closed_at === null ? null : iso(r.closed_at),
    };
  }

  function contextOf(userId: string, target: RequestTarget): StudyRequestContext {
    const info: TargetInfo = lookup.describe(userId, target);
    let note = info.note;
    if (!info.exists) note = "What this request was about no longer exists.";
    else if (info.trashed) note = "What this request is about is in the trash.";
    return {
      name: info.name,
      path: info.path,
      preview: info.preview,
      nodeId: info.nodeId,
      note,
    };
  }

  function view(r: Row): StudyRequestWithContext {
    const request = toRequest(r);
    return { ...request, context: contextOf(r.user_id, request.target) };
  }

  // ---- guards ------------------------------------------------------------------

  const actorKind = (auth: AuthContext): "user" | "agent" =>
    auth.via === "session" ? "user" : "agent";

  /** Check the state machine and turn a refusal into the right error. */
  function check(auth: AuthContext, status: RequestStatus, action: RequestAction): void {
    const verdict = canTransition(status, action, actorKind(auth));
    if (verdict.ok) return;
    throw new AppError(verdict.reason === "actor" ? "forbidden" : "conflict", verdict.message, {
      hint: verdict.hint,
    });
  }

  const keyOf = (auth: AuthContext): string | null =>
    auth.actor.type === "agent" ? auth.actor.keyId : null;

  function claimedByKey(r: Row, keyId: string | null): boolean {
    if (r.claimed_by === null || keyId === null) return false;
    const claimant = JSON.parse(r.claimed_by) as Actor;
    return claimant.type === "agent" && claimant.keyId === keyId;
  }

  const holdsClaim = (auth: AuthContext, r: Row): boolean => claimedByKey(r, keyOf(auth));

  function needClaim(auth: AuthContext, r: Row, what: string): void {
    if (r.status === "in_progress" && !holdsClaim(auth, r)) {
      throw new AppError(
        "conflict",
        `Another agent holds this request, so you cannot ${what} it.`,
        {
          hint: `Its claim ends at ${iso(r.claim_expires_at as number)}. Take a different request.`,
        },
      );
    }
  }

  function log(auth: AuthContext, r: Row, action: string, summary: string): void {
    const name = contextOf(r.user_id, targetOf(r)).name;
    const nodeId = r.scope_node_id ?? r.node_id;
    ports.changes?.record(auth.userId, {
      action,
      objectType: "request",
      objectIds: [r.id],
      documentId: r.document_id,
      nodeId,
      actor: auth.actor,
      requestId: r.id,
      summary,
      at: iso(now()),
    });
    activity.record(auth.userId, {
      actor: auth.actor,
      action,
      summary,
      links: [{ type: "request", id: r.id, label: name ?? r.kind }],
      at: iso(now()),
    });
  }

  /** "a fix request on "Beta blockers"": a request in plain words. */
  function words(r: Row): string {
    const name = contextOf(r.user_id, targetOf(r)).name;
    const kind = r.kind.replaceAll("_", " ");
    return `${/^[aeiou]/i.test(kind) ? "an" : "a"} ${kind} request${name ? ` on "${name}"` : ""}`;
  }

  // ---- her side --------------------------------------------------------------------

  function create(auth: AuthContext, input: CreateRequestInput): StudyRequestWithContext {
    if (actorKind(auth) !== "user") {
      throw new AppError(
        "forbidden",
        "Agents cannot create requests; only she does, from the app.",
        {
          hint: "A request is her way of asking for work. If you think something needs doing, say so in your reply to the request you are working on, or add a note in the document.",
        },
      );
    }
    sweep(auth.userId);
    const info = lookup.describe(auth.userId, input.target);
    if (!info.exists) {
      throw new AppError("not_found", `No such ${input.target.type} for this request.`, {
        hint: "Check the ID. Requests can point at the library, a node, a document, a block, a source file or page, or a question that exists in her library.",
        example: REQUEST_EXAMPLES.create,
      });
    }
    if (info.trashed) {
      throw new AppError(
        "conflict",
        "That is in the trash. Restore it first, or leave the request somewhere else.",
        {
          hint: "Requests on trashed things are hidden, so a new one would never be seen.",
        },
      );
    }
    if ((q.openCount.get(auth.userId) as { n: number }).n >= MAX_OPEN) {
      throw new AppError("conflict", `There are already ${MAX_OPEN} open requests.`, {
        hint: "Cancel some, or wait for an agent to work through the queue.",
      });
    }
    const t = now();
    const target = input.target;
    const id = newId("request", t);
    q.insert.run({
      id,
      user_id: auth.userId,
      target_type: target.type,
      node_id: target.type === "node" ? target.nodeId : null,
      document_id: target.type === "document" || target.type === "block" ? target.documentId : null,
      block_id: target.type === "block" ? target.blockId : null,
      file_id: target.type === "source" ? target.fileId : null,
      page_id: target.type === "source" ? (target.pageId ?? null) : null,
      question_id: target.type === "question" ? target.questionId : null,
      scope_node_id:
        target.type === "node" ||
        target.type === "document" ||
        target.type === "block" ||
        target.type === "question"
          ? info.nodeId
          : null,
      kind: input.kind,
      message: input.message,
      // A copy of the instructions as they are now; later edits in Settings never reach this request.
      instructions: input.instructions ? JSON.stringify(input.instructions) : null,
      t,
    });
    log(auth, need(auth.userId, id), "request.created", `Left ${words(need(auth.userId, id))}`);
    return view(need(auth.userId, id));
  }

  function edit(auth: AuthContext, id: string, input: EditRequestInput): StudyRequestWithContext {
    const r = need(auth.userId, id);
    check(auth, r.status, "edit");
    const kind = input.kind ?? r.kind;
    const message = input.message ?? r.message;
    if (kindNeedsMessage(kind) && message.length === 0) {
      throw new AppError("invalid_input", 'A request of kind "other" needs a message.', {
        hint: "Say what you want, or pick one of the quick actions.",
        example: REQUEST_EXAMPLES.edit,
      });
    }
    db.prepare("UPDATE requests SET kind = ?, message = ?, updated_at = ? WHERE id = ?").run(
      kind,
      message,
      now(),
      r.id,
    );
    log(auth, need(auth.userId, id), "request.edited", `Changed ${words(r)}`);
    return view(need(auth.userId, id));
  }

  function cancel(auth: AuthContext, id: string): StudyRequestWithContext {
    const r = need(auth.userId, id);
    check(auth, r.status, "cancel");
    const t = now();
    db.prepare(
      `UPDATE requests SET status = 'cancelled', claimed_by = NULL, claimed_at = NULL,
         claim_expires_at = NULL, updated_at = ?, closed_at = ? WHERE id = ?`,
    ).run(t, t, r.id);
    log(auth, need(auth.userId, id), "request.cancelled", `Withdrew ${words(r)}`);
    return view(need(auth.userId, id));
  }

  function reopen(
    auth: AuthContext,
    id: string,
    input: ReopenRequestInput,
  ): StudyRequestWithContext {
    const r = need(auth.userId, id);
    check(auth, r.status, "reopen");
    const reopens = JSON.parse(r.reopens) as RequestReopen[];
    if (reopens.length >= REQUEST_LIMITS.reopens) {
      throw new AppError(
        "conflict",
        `This request has been reopened ${REQUEST_LIMITS.reopens} times.`,
        {
          hint: "Leave a new request that says what is still wrong.",
        },
      );
    }
    const info = lookup.describe(r.user_id, targetOf(r));
    if (!info.exists) {
      throw new AppError(
        "conflict",
        "What this request was about no longer exists, so it cannot be reopened.",
        {
          hint: "Leave a new request somewhere that still exists.",
        },
      );
    }
    const t = now();
    const entry: RequestReopen = {
      at: iso(t),
      note: input.note,
      previousStatus: r.status as "done" | "declined",
      previousReply: r.reply ? (JSON.parse(r.reply) as RequestReply) : null,
    };
    db.prepare(
      `UPDATE requests SET status = 'waiting', reopens = ?, claimed_by = NULL, claimed_at = NULL,
         claim_expires_at = NULL, updated_at = ?, closed_at = NULL WHERE id = ?`,
    ).run(JSON.stringify([...reopens, entry]), t, r.id);
    log(auth, need(auth.userId, id), "request.reopened", `Reopened ${words(r)}`);
    return view(need(auth.userId, id));
  }

  // ---- reading -----------------------------------------------------------------------------

  function get(auth: AuthContext, id: string): StudyRequestWithContext {
    return view(need(auth.userId, id));
  }

  function list(auth: AuthContext, filters: ListFilters = {}): RequestPage {
    sweep(auth.userId);
    const limit = Math.min(Math.max(filters.limit ?? DEFAULT_PAGE, 1), 200);
    const oldest = filters.order === "oldest";
    const where = ["user_id = ?", "hidden_at IS NULL"];
    const args: unknown[] = [auth.userId];
    const statuses = filters.status ?? (["waiting", "in_progress", "done", "declined"] as const);
    where.push(`status IN (${statuses.map(() => "?").join(", ")})`);
    args.push(...statuses);
    if (filters.targetType) {
      where.push("target_type = ?");
      args.push(filters.targetType);
    }
    if (filters.nodeId) {
      where.push("scope_node_id = ?");
      args.push(filters.nodeId);
    }
    if (filters.documentId) {
      where.push("document_id = ?");
      args.push(filters.documentId);
    }
    if (filters.blockId) {
      where.push("block_id = ?");
      args.push(filters.blockId);
    }
    if (filters.fileId) {
      where.push("file_id = ?");
      args.push(filters.fileId);
    }
    if (filters.questionId) {
      where.push("question_id = ?");
      args.push(filters.questionId);
    }
    const cursor = parseCursor(filters.cursor);
    if (cursor !== null) {
      where.push(oldest ? "seq > ?" : "seq < ?");
      args.push(cursor);
    }
    const rows = db
      .prepare(
        `SELECT * FROM requests WHERE ${where.join(" AND ")}
         ORDER BY seq ${oldest ? "ASC" : "DESC"} LIMIT ?`,
      )
      .all(...args, limit + 1) as Row[];
    const page = rows.slice(0, limit);
    const last = page[page.length - 1];
    return {
      items: page.map(view),
      nextCursor: rows.length > limit && last ? String(last.seq) : null,
    };
  }

  function counts(auth: AuthContext): RequestCounts {
    sweep(auth.userId);
    const out: RequestCounts = {
      waiting: 0,
      in_progress: 0,
      done: 0,
      declined: 0,
      cancelled: 0,
      open: 0,
    };
    for (const row of q.counts.all(auth.userId) as Array<{ status: RequestStatus; n: number }>) {
      out[row.status] = row.n;
    }
    out.open = out.waiting + out.in_progress;
    return out;
  }

  // ---- the agent's side ---------------------------------------------------------------------------

  function claim(
    auth: AuthContext,
    id: string,
    input: ClaimRequestInput = {},
  ): StudyRequestWithContext {
    const r = need(auth.userId, id);
    const ttl = Math.min(
      input.ttlSeconds !== undefined ? input.ttlSeconds * 1000 : defaultTtl,
      MAX_CLAIM_TTL_MS,
    );
    const t = now();
    if (r.status === "in_progress") {
      if (!holdsClaim(auth, r)) {
        throw new AppError("conflict", "Another agent has claimed this request.", {
          hint: `Its claim ends at ${iso(r.claim_expires_at as number)}. Take a different request; if that agent crashed the request opens again by itself.`,
        });
      }
      // The agent that holds it asks again: renew.
      db.prepare("UPDATE requests SET claim_expires_at = ?, updated_at = ? WHERE id = ?").run(
        t + ttl,
        t,
        r.id,
      );
      return view(need(auth.userId, id));
    }
    check(auth, r.status, "claim");
    const info = lookup.describe(r.user_id, targetOf(r));
    if (!info.exists) {
      throw new AppError("conflict", "What this request was about no longer exists.", {
        hint: "Decline it with that reason.",
      });
    }
    db.prepare(
      `UPDATE requests SET status = 'in_progress', claimed_by = ?, claimed_at = ?,
         claim_expires_at = ?, updated_at = ? WHERE id = ?`,
    ).run(JSON.stringify(auth.actor), t, t + ttl, t, r.id);
    const fresh = need(auth.userId, id);
    log(auth, fresh, "request.claimed", `Claimed ${words(fresh)}`);
    return view(fresh);
  }

  function release(
    auth: AuthContext,
    id: string,
    _input: ReleaseRequestInput = {},
  ): StudyRequestWithContext {
    const r = need(auth.userId, id);
    check(auth, r.status, "release");
    needClaim(auth, r, "release");
    db.prepare(
      `UPDATE requests SET status = 'waiting', claimed_by = NULL, claimed_at = NULL,
         claim_expires_at = NULL, updated_at = ? WHERE id = ?`,
    ).run(now(), r.id);
    const fresh = need(auth.userId, id);
    log(auth, fresh, "request.released", `Handed ${words(fresh)} back`);
    return view(fresh);
  }

  /**
   * The reply's numbers with units that neither the request's target, nor her own words, nor what the
   * agent cited contain. Only a check that the figures occur somewhere in the sources: it cannot tell
   * whether a figure that does occur is the right one.
   */
  function unsourcedFigures(r: Row, input: CompleteRequestInput): string[] {
    const texts = [r.message, ...sourceTexts(r.user_id, targetOf(r), input.links)];
    return figuresNotIn(input.reply, texts);
  }

  function replyOf(
    auth: AuthContext,
    text: string,
    links: RequestReply["links"],
    unsourced: readonly string[] = [],
  ): RequestReply {
    const by =
      auth.actor.type === "agent"
        ? ({
            type: "agent",
            keyId: auth.actor.keyId,
            ...(auth.actor.label ? { label: auth.actor.label } : {}),
          } as const)
        : ({ type: "system" } as const);
    return {
      text,
      links,
      by,
      at: iso(now()),
      unsourcedFigures: unsourced.length > 0,
      ...(unsourced.length > 0 ? { unsourcedFigureList: unsourced.slice(0, 20) } : {}),
    };
  }

  function complete(
    auth: AuthContext,
    id: string,
    input: CompleteRequestInput,
  ): StudyRequestWithContext {
    const r = need(auth.userId, id);
    if (r.status === "waiting" && actorKind(auth) === "agent") {
      throw new AppError("conflict", "Claim this request before completing it.", {
        hint: "Your claim may have run out. Claim it again (POST /api/requests/:id/claim), then complete it.",
      });
    }
    check(auth, r.status, "complete");
    needClaim(auth, r, "complete");
    // An agent's reply is never checked against its source by a person; check the figures here.
    const unsourced = actorKind(auth) === "agent" ? unsourcedFigures(r, input) : [];
    if (unsourced.length > 0 && !input.acknowledgeUnsourced) {
      const shown = unsourced.slice(0, 8).map((f) => `"${f}"`);
      throw new AppError(
        "invalid_input",
        `Warning: the reply states ${shown.join(", ")}${unsourced.length > shown.length ? ", …" : ""}, which ${unsourced.length === 1 ? "does" : "do"} not occur in the pages or blocks this request is about, in her message, or in what you cited. Nothing was completed.`,
        {
          hint: 'Check each figure against the source page. Fix the reply, or add to "links" the page ({"type":"source",...}) or block that contains it. Only if it truly comes from general knowledge, complete again with "acknowledgeUnsourced": true: she then sees the reply flagged "contains figures not found in your notes".',
          example: {
            reply: input.reply.slice(0, 80),
            links: [{ type: "source", fileId: "fil_…", pageId: "pag_…" }],
            acknowledgeUnsourced: true,
          },
        },
      );
    }
    const t = now();
    db.prepare(
      `UPDATE requests SET status = 'done', reply = ?, claimed_by = NULL, claimed_at = NULL,
         claim_expires_at = NULL, updated_at = ?, closed_at = ? WHERE id = ?`,
    ).run(JSON.stringify(replyOf(auth, input.reply, input.links, unsourced)), t, t, r.id);
    const fresh = need(auth.userId, id);
    log(auth, fresh, "request.completed", `Answered ${words(fresh)}: ${input.reply}`);
    return view(fresh);
  }

  function decline(
    auth: AuthContext,
    id: string,
    input: DeclineRequestInput,
  ): StudyRequestWithContext {
    const r = need(auth.userId, id);
    check(auth, r.status, "decline");
    needClaim(auth, r, "decline");
    const t = now();
    db.prepare(
      `UPDATE requests SET status = 'declined', reply = ?, claimed_by = NULL, claimed_at = NULL,
         claim_expires_at = NULL, updated_at = ?, closed_at = ? WHERE id = ?`,
    ).run(JSON.stringify(replyOf(auth, input.reason, [])), t, t, r.id);
    const fresh = need(auth.userId, id);
    log(auth, fresh, "request.declined", `Declined ${words(fresh)}: ${input.reason}`);
    return view(fresh);
  }

  // ---- edit protection -----------------------------------------------------------------------------------

  /**
   * Whether this agent may edit protected blocks because of this request: the
   * request is live (claimed and not expired), claimed by this very key, and
   * asks about this document, or this block of it. A document-wide request
   * covers every block in the document; a block request covers only its own
   * block (and none of a whole-document operation). Requests on the library,
   * a node, a source or a question never lift protection.
   */
  function verifyForEdit(userId: string, requestId: string, scope: EditScope): boolean {
    sweep(userId);
    const r = rowOf(userId, requestId);
    if (!r || r.hidden_at !== null || r.status !== "in_progress") return false;
    if (!claimedByKey(r, scope.keyId)) return false;
    if (r.claim_expires_at === null || r.claim_expires_at <= now()) return false;
    if (r.target_type === "document") return r.document_id === scope.documentId;
    if (r.target_type === "block") {
      return (
        r.document_id === scope.documentId &&
        scope.blockId !== undefined &&
        r.block_id === scope.blockId
      );
    }
    return false;
  }

  // ---- hooks -------------------------------------------------------------------------------------------------

  const hide = (column: string, ids: readonly string[], userId: string) =>
    forEach(ids, (chunk) =>
      db
        .prepare(
          `UPDATE requests SET hidden_at = ? WHERE user_id = ? AND hidden_at IS NULL AND ${column} IN (${chunk.map(() => "?").join(", ")})`,
        )
        .run(now(), userId, ...chunk),
    );
  const unhide = (column: string, ids: readonly string[], userId: string) =>
    forEach(ids, (chunk) =>
      db
        .prepare(
          `UPDATE requests SET hidden_at = NULL WHERE user_id = ? AND hidden_at IS NOT NULL AND ${column} IN (${chunk.map(() => "?").join(", ")})`,
        )
        .run(userId, ...chunk),
    );
  /** Close the open requests on things that no longer exist, with a note; finished ones stay as history. */
  const closeDeleted = (column: string, ids: readonly string[], userId: string, what: string) =>
    forEach(ids, (chunk) => {
      const t = now();
      const reply: RequestReply = {
        text: `${what} was deleted for good, so this request can no longer be done.`,
        links: [],
        by: { type: "system" },
        at: iso(t),
      };
      const marks = chunk.map(() => "?").join(", ");
      db.prepare(
        `UPDATE requests SET status = 'declined', reply = ?, claimed_by = NULL, claimed_at = NULL,
           claim_expires_at = NULL, updated_at = ?, closed_at = ?
         WHERE user_id = ? AND status IN ('waiting', 'in_progress') AND ${column} IN (${marks})`,
      ).run(JSON.stringify(reply), t, t, userId, ...chunk);
      // Whatever its state, it is no longer hidden by a trash that will never be restored.
      db.prepare(
        `UPDATE requests SET hidden_at = NULL WHERE user_id = ? AND hidden_at IS NOT NULL AND ${column} IN (${marks})`,
      ).run(userId, ...chunk);
    });

  function forEach(ids: readonly string[], run: (chunk: readonly string[]) => unknown): void {
    for (let i = 0; i < ids.length; i += 500) run(ids.slice(i, i + 500));
  }

  const hooks = {
    /** Library nodes (and everything under them) went to the trash: hide the requests on them and on their documents and blocks. */
    onNodeTrashed(userId: string, nodeIds: readonly string[]): void {
      db.transaction(() => hide("scope_node_id", nodeIds, userId))();
    },
    /** They came back: show the requests again. */
    onNodeRestored(userId: string, nodeIds: readonly string[]): void {
      db.transaction(() => unhide("scope_node_id", nodeIds, userId))();
    },
    /** They were deleted for good: close the open requests on them with a note. */
    onNodeDeleted(userId: string, nodeIds: readonly string[]): void {
      db.transaction(() => closeDeleted("scope_node_id", nodeIds, userId, "What it was about"))();
    },
    /** Source files in or out of the trash, or gone. */
    onFilesTrashed(userId: string, fileIds: readonly string[]): void {
      db.transaction(() => hide("file_id", fileIds, userId))();
    },
    onFilesRestored(userId: string, fileIds: readonly string[]): void {
      db.transaction(() => unhide("file_id", fileIds, userId))();
    },
    onFilesDeleted(userId: string, fileIds: readonly string[]): void {
      db.transaction(() => closeDeleted("file_id", fileIds, userId, "The source file"))();
    },
    /** Practice questions deleted for good. */
    onQuestionsDeleted(userId: string, questionIds: readonly string[]): void {
      db.transaction(() => closeDeleted("question_id", questionIds, userId, "The question"))();
    },
    /** A document deleted on its own (its node survives). */
    onDocumentsDeleted(userId: string, documentIds: readonly string[]): void {
      db.transaction(() => closeDeleted("document_id", documentIds, userId, "The document"))();
    },
  };

  return {
    create,
    edit,
    cancel,
    reopen,
    get,
    list,
    counts,
    claim,
    release,
    complete,
    decline,
    verifyForEdit,
    ...hooks,
    /** The narrow port for the documents domain. */
    port: { verifyForEdit } satisfies RequestsPort,
  };
}

export type RequestsService = ReturnType<typeof createRequestsService>;
