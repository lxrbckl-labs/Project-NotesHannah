import {
  type Actor,
  applyCanvasChange,
  applySetStructure,
  type Block,
  CANVAS_EXAMPLES,
  CANVAS_LIMITS,
  Canvas,
  type CanvasApplyReport,
  type Card,
  canvasIntegrityProblems,
  DocumentId,
  deriveCanvas,
  mergeDocumentBlocks,
  newId,
  type Point,
  type Problem,
  validateCanvasChange,
} from "@notes/schema";
import type { Db } from "../../db/client.js";
import type { AuthContext } from "../../http/auth-context.js";
import type { ServerDeps } from "../../http/deps.js";
import { AppError } from "../../http/errors.js";
import type { ActivityPort } from "../activity/activity.js";
import type { ChangeFeed } from "../activity/changes.js";
import { notFoundDocument } from "../documents/errors.js";
import type { DocumentsService } from "../documents/index.js";
import type { RequestsPort } from "../requests/service.js";
import { type CanvasEvents, createCanvasEvents } from "./events.js";
import { type AgentCanvasView, renderForAgent, withoutCoordinates } from "./render.js";
import { type CanvasRepo, createCanvasRepo, type LayoutVariant, type VisibleDoc } from "./repo.js";

export type { LayoutVariant } from "./repo.js";

/** A canvas with what it shows (what the web store loads). */
export interface LoadedCanvas {
  canvas: Canvas;
  /** The document's blocks in reading order (the canvas shows a subset). */
  blocks: Block[];
  documentTitle: string;
}

/** Why a change was refused, so a caller can pick its status code and its wording. */
export type RefusalKind =
  /** The input is wrong: shape, references, limits. */
  | "invalid"
  /** `expectedRevision` is behind the canvas. */
  | "conflict"
  /** The pin rule: she made, edited or pinned it. */
  | "protected"
  /** Not the caller's to do (an agent placing cards). */
  | "forbidden";

export type ChangeOutcome =
  | { ok: true; canvas: Canvas; report: CanvasApplyReport; changed: boolean }
  | { ok: false; kind: RefusalKind; problems: Problem[] };

export interface PlacementsOutcome {
  canvas: Canvas;
  /** Cards that were pinned (or re-pinned somewhere else) by this call. */
  placed: string[];
  /** Placements for cards that are not on the canvas any more (deleted, merged away): skipped, not an error. */
  ignored: string[];
  changed: boolean;
}

/** What the document domain tells the canvas when it commits a write. */
export interface BlocksChanged {
  userId: string;
  documentId: string;
  nodeId: string;
  title: string;
  blocks: readonly Block[];
  actor: Actor;
  at: string;
}

export interface CanvasPorts {
  /** Reads the document's blocks as the caller (scoped, trash-aware). */
  documents: Pick<DocumentsService, "getFull">;
  changes: ChangeFeed;
  activity: ActivityPort;
  /**
   * Decides whether a `requestId` really lifts the pin rule: a request this very key has claimed,
   * still live, and about this document. Without it (isolated tests) any `requestId` is accepted.
   */
  requests?: RequestsPort;
  events?: CanvasEvents;
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

const PROTECTION_TEXT = "act on a request from her";
const isProtection = (p: Problem) => p.message.includes(PROTECTION_TEXT);
const isHersAlone = (p: Problem) => p.message.includes("is hers alone");

function classify(problems: readonly Problem[]): RefusalKind {
  if (problems.some((p) => p.path === "$.expectedRevision")) return "conflict";
  if (problems.some(isProtection)) return "protected";
  if (problems.some(isHersAlone)) return "forbidden";
  return "invalid";
}

const refuse = (problems: Problem[]): ChangeOutcome => ({
  ok: false,
  kind: classify(problems),
  problems,
});

const isAgent = (auth: AuthContext) => auth.actor.type === "agent";

function summarise(report: CanvasApplyReport) {
  const count = (ids: string[], prefix: string) => ids.filter((id) => id.startsWith(prefix)).length;
  const bits: string[] = [];
  const part = (verb: string, ids: string[]) => {
    const cards = count(ids, "crd_");
    const edges = count(ids, "edg_");
    const frames = count(ids, "frm_");
    const what = [
      cards ? plural(cards, "card") : "",
      edges ? plural(edges, "connector") : "",
      frames ? plural(frames, "frame") : "",
    ].filter(Boolean);
    if (what.length > 0) bits.push(`${verb} ${what.join(", ")}`);
  };
  part("added", report.added);
  part("changed", report.updated);
  part("removed", report.removed);
  if (report.skipped.length > 0)
    bits.push(`left ${plural(report.skipped.length, "item")} of hers alone`);
  return bits.join("; ") || "no visible change";
}

/** The example a refused lift of the pin rule teaches from. */
const REQUEST_EXAMPLE = {
  documentId: "doc_01J9Z8Y7X6W5V4T3S2R1Q0P9N8",
  ops: [{ op: "remove_card", id: "crd_01J9Z8Y7X6W5V4T3S2R1Q0P9N8" }],
  requestId: "req_01J9Z8Y7X6W5V4T3S2R1Q0P9N8",
};

interface Open {
  doc: VisibleDoc;
  canvas: Canvas;
  blocks: Block[];
}

export function createCanvasService(deps: Pick<ServerDeps, "db" | "now">, ports: CanvasPorts) {
  const db: Db = deps.db;
  const repo: CanvasRepo = createCanvasRepo(db);
  const events = ports.events ?? createCanvasEvents();
  const nowIso = () => new Date(deps.now()).toISOString();

  // ---- guards -----------------------------------------------------------

  function assertWrite(auth: AuthContext): void {
    if (auth.scope !== "write") {
      throw new AppError("read_only_key", "This API key is read-only.", {
        hint: "Create a read-write key in Settings to make changes.",
      });
    }
  }

  function visibleDoc(userId: string, documentId: string): VisibleDoc {
    const parsed = DocumentId.safeParse(documentId);
    const doc = parsed.success ? repo.doc(userId, documentId) : undefined;
    if (!doc) throw notFoundDocument();
    return doc;
  }

  // ---- load, derive, merge ----------------------------------------------

  /** Write a canvas whose revision moved on from `previous`, after checking it is still well formed. */
  function store(userId: string, canvas: Canvas, previous: number): Canvas {
    const checked = Canvas.parse(canvas);
    if (!repo.update(userId, checked, previous)) {
      throw new AppError("conflict", "The canvas changed while it was being saved.", {
        hint: "Read it again and resend.",
      });
    }
    return checked;
  }

  /**
   * The document's canvas, derived on first read and merged with its blocks (a safety net: the
   * documents hook keeps it in step, so this normally changes nothing). Runs inside a transaction.
   */
  function open(auth: AuthContext, documentId: string): Open {
    const doc = visibleDoc(auth.userId, documentId);
    const blocks = ports.documents.getFull(auth, documentId).blocks;
    const at = nowIso();
    let canvas = repo.get(auth.userId, documentId);
    if (!canvas) {
      canvas = Canvas.parse(deriveCanvas(documentId, blocks, { now: at }));
      repo.insert(auth.userId, canvas);
      return { doc, canvas, blocks };
    }
    const merged = mergeDocumentBlocks(canvas, blocks, { now: at });
    if (merged.changed) canvas = store(auth.userId, merged.canvas, canvas.revision);
    return { doc, canvas, blocks };
  }

  function loaded(o: Open): LoadedCanvas {
    return { canvas: o.canvas, blocks: o.blocks, documentTitle: o.doc.title };
  }

  // ---- reads --------------------------------------------------------------

  /** The canvas of a document with its blocks. Creates it from the document the first time. */
  function get(auth: AuthContext, documentId: string): LoadedCanvas {
    return loaded(db.transaction(() => open(auth, documentId))());
  }

  /** Throws `not_found` unless the document is hers and not in the trash. */
  function assertVisible(auth: AuthContext, documentId: string): void {
    visibleDoc(auth.userId, documentId);
  }

  /** The canvas as an agent reads it: short previews, `pinned` flags, no coordinates. */
  function view(
    auth: AuthContext,
    documentId: string,
    include: "structure" | "full" = "structure",
  ): AgentCanvasView & { structure?: unknown } {
    const o = db.transaction(() => open(auth, documentId))();
    const out: AgentCanvasView & { structure?: unknown } = renderForAgent(
      o.canvas,
      o.doc.title,
      o.blocks,
    );
    if (include === "full") out.structure = withoutCoordinates(o.canvas);
    return out;
  }

  // ---- writes ------------------------------------------------------------

  /** Record the change in the feed, and for an agent in the activity log, then wake the listeners. */
  function trace(
    auth: AuthContext,
    o: Open,
    canvas: Canvas,
    action: string,
    summary: string,
    activitySummary: string,
    requestId: string | undefined,
  ): void {
    const at = nowIso();
    ports.changes.record(auth.userId, {
      action,
      objectType: "canvas",
      objectIds: [o.doc.id],
      documentId: o.doc.id,
      nodeId: o.doc.nodeId,
      revision: canvas.revision,
      actor: auth.actor,
      requestId: requestId ?? null,
      summary: `${o.doc.title}: ${summary}`,
      at,
    });
    if (isAgent(auth)) {
      ports.activity.record(auth.userId, {
        actor: auth.actor,
        action,
        summary: activitySummary,
        links: [
          { type: "document", id: o.doc.id, nodeId: o.doc.nodeId, label: o.doc.title },
          ...(requestId ? [{ type: "request", id: requestId }] : []),
        ],
        at,
      });
    }
  }

  /**
   * The pin rule's one gate. An agent's `requestId` lifts her protection only when the requests
   * domain confirms it for this document and this very key; otherwise it is dropped (the change then
   * meets the rule) and a refusal explains why the request did not count.
   */
  function withVerifiedRequest(
    auth: AuthContext,
    documentId: string,
    input: unknown,
  ): { input: unknown; requestId: string | undefined; rejected: string | undefined } {
    if (typeof input !== "object" || input === null || Array.isArray(input))
      return { input, requestId: undefined, rejected: undefined };
    const body = { ...(input as Record<string, unknown>) };
    const given = typeof body.requestId === "string" ? body.requestId : undefined;
    if (!isAgent(auth) || given === undefined) {
      // Her own writes need no request; a stray requestId from her is not an error, just ignored.
      if (!isAgent(auth)) delete body.requestId;
      return { input: body, requestId: undefined, rejected: undefined };
    }
    const keyId = auth.actor.type === "agent" ? auth.actor.keyId : "";
    const covers = ports.requests
      ? ports.requests.verifyForEdit(auth.userId, given, { documentId, keyId })
      : true;
    if (covers) return { input: body, requestId: given, rejected: undefined };
    delete body.requestId;
    return { input: body, requestId: undefined, rejected: given };
  }

  function rejectedRequest(requestId: string): Problem {
    return {
      path: "$.requestId",
      message: `Request ${requestId} does not lift her protection of this canvas. A request counts only when it is one you claimed with this very API key (POST /api/requests/${requestId}/claim, and the claim has not run out), it is still in progress, and it is about this document as a whole (a request on a single block does not cover canvas items).`,
      example: REQUEST_EXAMPLE,
    };
  }

  type Apply = (
    canvas: Canvas,
    input: unknown,
    ctx: { actor: Actor; requestId: string | undefined; now: string; documentBlockIds: string[] },
  ) => ReturnType<typeof applyCanvasChange>;

  function commitChange(
    auth: AuthContext,
    documentId: string,
    rawInput: unknown,
    apply: Apply,
    describe: (
      o: Open,
      canvas: Canvas,
      report: CanvasApplyReport,
    ) => {
      action: string;
      summary: string;
      activity: string;
    },
  ): ChangeOutcome {
    assertWrite(auth);
    return db.transaction((): ChangeOutcome => {
      const o = open(auth, documentId);
      const { input, requestId, rejected } = withVerifiedRequest(auth, documentId, rawInput);
      const at = nowIso();
      const result = apply(o.canvas, input, {
        actor: auth.actor,
        requestId,
        now: at,
        documentBlockIds: o.blocks.map((b) => b.id),
      });
      if (!result.ok) {
        const problems = [...result.problems];
        if (rejected !== undefined && problems.some(isProtection))
          problems.push(rejectedRequest(rejected));
        return refuse(problems);
      }
      if (!result.changed)
        return { ok: true, canvas: o.canvas, report: result.report, changed: false };
      const canvas = store(auth.userId, result.canvas, o.canvas.revision);
      const text = describe(o, canvas, result.report);
      trace(auth, o, canvas, text.action, text.summary, text.activity, requestId);
      events.publish(documentId);
      return { ok: true, canvas, report: result.report, changed: true };
    })();
  }

  /** Replace the structure (agents: no coordinates anywhere). What she made, edited or pinned stays. */
  function setStructure(auth: AuthContext, documentId: string, input: unknown): ChangeOutcome {
    return commitChange(
      auth,
      documentId,
      input,
      (canvas, body, ctx) => applySetStructure(canvas, body, ctx),
      (o, canvas, report) => {
        const frames = canvas.frames.length;
        const activity =
          frames > 0
            ? `Arranged the study map for ${o.doc.title} into ${plural(frames, "frame")}`
            : `Set the study map for ${o.doc.title}: ${plural(canvas.cards.length, "card")}, ${plural(canvas.connectors.length, "connector")}`;
        return {
          action: "canvas.arranged",
          summary: `study map set (${summarise(report)})`,
          activity,
        };
      },
    );
  }

  /** Apply ops in order, all or nothing. Hers (place, release, insert) are refused to agents. */
  function change(auth: AuthContext, documentId: string, input: unknown): ChangeOutcome {
    return commitChange(
      auth,
      documentId,
      input,
      (canvas, body, ctx) => applyCanvasChange(canvas, body, ctx),
      (o, _canvas, report) => ({
        action: "canvas.edited",
        summary: `study map changed (${summarise(report)})`,
        activity: `Changed the study map for ${o.doc.title}: ${summarise(report)}`,
      }),
    );
  }

  const samePin = (card: Card, p: { x: number; y: number; width?: number; height?: number }) =>
    card.position !== null &&
    card.position.x === p.x &&
    card.position.y === p.y &&
    (p.width === undefined ||
      p.height === undefined ||
      (card.dimensions !== null &&
        card.dimensions.width === p.width &&
        card.dimensions.height === p.height));

  /**
   * Her drags and resizes become pins. Only she places cards. The rule for concurrency: placements
   * are absolute, per card and idempotent, so they never conflict on the revision (the debounced app
   * may be several revisions behind an agent's writes and must not lose a drag). The last placement
   * to arrive wins for a card; a placement equal to the card's pin changes nothing (no revision);
   * a card that is gone is skipped and reported in `ignored`, and never fails the rest.
   */
  function savePlacements(
    auth: AuthContext,
    documentId: string,
    input: unknown,
  ): PlacementsOutcome | { ok: false; problems: Problem[] } {
    assertWrite(auth);
    if (isAgent(auth)) {
      throw new AppError("forbidden", "Only she places cards.", {
        hint: "Agents describe structure (cards, connectors, frames); the app lays the canvas out and her drags stay where she put them. Leave coordinates out.",
        example: CANVAS_EXAMPLES.setStructure,
      });
    }
    const raw =
      typeof input === "object" && input !== null ? (input as Record<string, unknown>) : {};
    const checked = validateCanvasChange({
      documentId,
      ops: [{ op: "place_cards", placements: raw.placements }],
    });
    if (!checked.ok) {
      return {
        ok: false,
        problems: checked.problems.map((p) => ({
          ...p,
          path: p.path.replace("$.ops[0].placements", "$.placements"),
        })),
      };
    }
    const op = checked.value.ops[0];
    if (op?.op !== "place_cards") return { ok: false, problems: [] };
    return db.transaction((): PlacementsOutcome => {
      const o = open(auth, documentId);
      const byId = new Map(o.canvas.cards.map((c) => [c.id, c]));
      const last = new Map(op.placements.map((p) => [p.id, p]));
      const ignored: string[] = [];
      const todo = [];
      for (const p of last.values()) {
        const card = byId.get(p.id);
        if (!card) ignored.push(p.id);
        else if (!samePin(card, p)) todo.push(p);
      }
      if (todo.length === 0) {
        return { canvas: o.canvas, placed: [], ignored, changed: false };
      }
      const result = applyCanvasChange(
        o.canvas,
        { documentId, ops: [{ op: "place_cards", placements: todo }] },
        { actor: auth.actor, now: nowIso(), documentBlockIds: o.blocks.map((b) => b.id) },
      );
      if (!result.ok || !result.changed) {
        return { canvas: o.canvas, placed: [], ignored, changed: false };
      }
      const canvas = store(auth.userId, result.canvas, o.canvas.revision);
      trace(
        auth,
        o,
        canvas,
        "canvas.placed",
        `she placed ${plural(todo.length, "card")} on the study map`,
        "",
        undefined,
      );
      events.publish(documentId);
      return { canvas, placed: todo.map((p) => p.id), ignored, changed: true };
    })();
  }

  /**
   * Auto-arrange. The layout itself runs in the browser (ELK in a worker, docs/canvas.md), so the
   * server only forgets the cached positions, and with `releasePins` also her pins; every open view
   * is told and lays the map out again. Hers alone.
   */
  function arrange(
    auth: AuthContext,
    documentId: string,
    options: { releasePins?: boolean } = {},
  ): ChangeOutcome {
    assertWrite(auth);
    if (isAgent(auth)) {
      throw new AppError("forbidden", "Only she arranges the map.", {
        hint: "Describe structure and let her arrange it. Her cards stay where she put them.",
      });
    }
    return db.transaction((): ChangeOutcome => {
      const o = open(auth, documentId);
      repo.cacheClear(documentId);
      let canvas = o.canvas;
      let report: CanvasApplyReport = {
        added: [],
        updated: [],
        removed: [],
        skipped: [],
        refs: {},
      };
      if (options.releasePins) {
        const result = applyCanvasChange(
          o.canvas,
          { documentId, ops: [{ op: "release_pins" }] },
          { actor: auth.actor, now: nowIso() },
        );
        if (!result.ok) return refuse(result.problems);
        report = result.report;
        if (result.changed) canvas = store(auth.userId, result.canvas, o.canvas.revision);
      }
      trace(
        auth,
        o,
        canvas,
        "canvas.arranged",
        options.releasePins
          ? "she released her pins and arranged the study map"
          : "she arranged the study map",
        "",
        undefined,
      );
      events.publish(documentId);
      return { ok: true, canvas, report, changed: canvas !== o.canvas };
    })();
  }

  // ---- layout cache ---------------------------------------------------------

  /** Last automatic positions of unpinned cards; null when none. Positions of cards that are gone or pinned are dropped. */
  function getLayoutCache(
    auth: AuthContext,
    documentId: string,
    variant: LayoutVariant,
  ): Record<string, Point> | null {
    const doc = visibleDoc(auth.userId, documentId);
    const canvas = repo.get(auth.userId, doc.id);
    if (!canvas) return null;
    const stored = repo.cacheGet(documentId, variant);
    if (!stored) return null;
    const free = new Set(canvas.cards.filter((c) => c.position === null).map((c) => c.id));
    const kept = Object.fromEntries(Object.entries(stored).filter(([id]) => free.has(id)));
    return Object.keys(kept).length > 0 ? kept : null;
  }

  function saveLayoutCache(
    auth: AuthContext,
    documentId: string,
    variant: LayoutVariant,
    positions: unknown,
  ): { saved: number } {
    assertWrite(auth);
    if (isAgent(auth)) {
      throw new AppError("forbidden", "The layout cache belongs to her browser.", {
        hint: "Agents never send coordinates.",
      });
    }
    const limit = CANVAS_LIMITS.coordinate;
    const entries =
      typeof positions === "object" && positions !== null && !Array.isArray(positions)
        ? Object.entries(positions as Record<string, unknown>)
        : null;
    const example = { positions: { crd_01J9Z8Y7X6W5V4T3S2R1Q0P9N8: { x: 120, y: 80 } } };
    if (!entries || entries.length > CANVAS_LIMITS.cards) {
      throw new AppError("invalid_input", "positions must be an object of card ID to { x, y }.", {
        hint: `At most ${CANVAS_LIMITS.cards} cards.`,
        example,
      });
    }
    const clean: Record<string, Point> = {};
    for (const [id, value] of entries) {
      const p = value as { x?: unknown; y?: unknown } | null;
      if (
        !p ||
        typeof p.x !== "number" ||
        typeof p.y !== "number" ||
        !Number.isFinite(p.x) ||
        !Number.isFinite(p.y) ||
        Math.abs(p.x) > limit ||
        Math.abs(p.y) > limit
      ) {
        throw new AppError("invalid_input", `positions.${id} must be { x, y } within ±${limit}.`, {
          example,
        });
      }
      clean[id] = { x: p.x, y: p.y };
    }
    return db.transaction(() => {
      const o = open(auth, documentId);
      const free = new Set(o.canvas.cards.filter((c) => c.position === null).map((c) => c.id));
      const kept = Object.fromEntries(Object.entries(clean).filter(([id]) => free.has(id)));
      repo.cachePut(documentId, variant, kept, nowIso());
      return { saved: Object.keys(kept).length };
    })();
  }

  // ---- the documents hook -------------------------------------------------

  /**
   * The document committed a write: bring its canvas up to date in the same transaction. New blocks
   * become unpinned cards, deleted blocks' cards go, pins stay. A document that has no canvas yet
   * needs nothing: the first read derives it from the blocks.
   */
  function onBlocksChanged(change: BlocksChanged): void {
    const canvas = repo.get(change.userId, change.documentId);
    if (!canvas) return;
    const merged = mergeDocumentBlocks(canvas, change.blocks, { now: change.at });
    if (merged.changed) {
      const saved = store(change.userId, merged.canvas, canvas.revision);
      const bits = [
        merged.addedCards.length ? `${plural(merged.addedCards.length, "card")} added` : "",
        merged.removedCards.length ? `${plural(merged.removedCards.length, "card")} removed` : "",
        merged.addedFrames.length ? `${plural(merged.addedFrames.length, "frame")} added` : "",
        merged.removedFrames.length
          ? `${plural(merged.removedFrames.length, "frame")} removed`
          : "",
      ].filter(Boolean);
      ports.changes.record(change.userId, {
        action: "canvas.synced",
        objectType: "canvas",
        objectIds: [change.documentId],
        documentId: change.documentId,
        nodeId: change.nodeId,
        revision: saved.revision,
        actor: change.actor,
        summary: `${change.title}: study map follows the document (${bits.join(", ") || "updated"})`,
        at: change.at,
      });
    }
    // Block text changes show on the cards too, so every open view gets the new blocks.
    events.publish(change.documentId);
  }

  /** A node was duplicated: copy the canvas of its document (fresh IDs, same pins) onto the copy. */
  function onNodeDuplicated(userId: string, fromNodeId: string, toNodeId: string): void {
    db.transaction(() => {
      const from = repo.docOfNode(userId, fromNodeId);
      const to = repo.docOfNode(userId, toNodeId);
      if (!from || !to || from.trashed || to.trashed) return;
      const source = repo.get(userId, from.id);
      if (!source || repo.get(userId, to.id)) return;
      const copy = duplicateCanvas(
        source,
        repo.blockIds(from.id),
        to.id,
        repo.blockIds(to.id),
        nowIso(),
      );
      if (copy) repo.insert(userId, Canvas.parse(copy));
    })();
  }

  return {
    get,
    view,
    setStructure,
    change,
    savePlacements,
    arrange,
    getLayoutCache,
    saveLayoutCache,
    assertVisible,
    events,
    onBlocksChanged,
    onNodeDuplicated,
  };
}

export type CanvasService = ReturnType<typeof createCanvasService>;

/**
 * A deep copy of a canvas for a duplicated document: every card, connector and frame gets a fresh
 * ID, block references follow the copied blocks (which keep their order), pins and provenance stay.
 * Null when the two block lists do not line up, so the copy derives its own canvas on first read.
 */
export function duplicateCanvas(
  source: Canvas,
  fromBlocks: readonly string[],
  toDocumentId: string,
  toBlocks: readonly string[],
  now: string,
): Canvas | null {
  if (fromBlocks.length !== toBlocks.length) return null;
  const blockMap = new Map(fromBlocks.map((id, i) => [id, toBlocks[i] as string]));
  const cardMap = new Map(source.cards.map((c) => [c.id, newId("card")]));
  const frameMap = new Map(source.frames.map((f) => [f.id, newId("frame")]));
  const mapBlock = (id: string) => blockMap.get(id);
  const cards: Card[] = [];
  for (const c of source.cards) {
    let content = c.content;
    if (content.kind === "block") {
      const ids = content.blockIds.map(mapBlock);
      if (ids.some((id) => id === undefined)) return null;
      content = { ...content, blockIds: ids as string[] };
    }
    cards.push({ ...structuredClone(c), id: cardMap.get(c.id) as string, content });
  }
  const copy: Canvas = {
    documentId: toDocumentId,
    revision: 1,
    cards,
    connectors: source.connectors.map((e) => ({
      ...structuredClone(e),
      id: newId("edge"),
      from: cardMap.get(e.from) as string,
      to: cardMap.get(e.to) as string,
    })),
    frames: source.frames.map((f) => {
      const { parent, headingBlockId, ...rest } = structuredClone(f);
      return {
        ...rest,
        id: frameMap.get(f.id) as string,
        members: f.members.map((m) => cardMap.get(m) as string),
        ...(parent ? { parent: frameMap.get(parent) as string } : {}),
        ...(headingBlockId ? { headingBlockId: mapBlock(headingBlockId) as string } : {}),
      };
    }),
    syncedBlockIds: source.syncedBlockIds.map((id) => mapBlock(id) as string),
    allowSelfLinks: source.allowSelfLinks,
    updatedAt: now,
  };
  if (copy.syncedBlockIds.some((id) => id === undefined)) return null;
  return canvasIntegrityProblems(copy).length === 0 ? copy : null;
}
