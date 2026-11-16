import { newId } from "@notes/schema";
import type { ChangeOutcome } from "../src/domains/canvas/index.js";
import type { AuthContext } from "../src/http/auth-context.js";
import { type Composed, composed } from "./composed.support.js";
import { agentAuth, type Json } from "./documents-helpers.js";

export type { Json };

/** "# Title" and "## Title" are headings, anything else a paragraph of general knowledge. */
export function blocksOf(lines: readonly string[]): Json[] {
  return lines.map((line) => {
    const m = /^(#{1,3}) (.*)$/.exec(line);
    if (m) return { type: "heading", content: { level: (m[1] as string).length, text: m[2] } };
    return { type: "paragraph", content: { text: line }, generalKnowledge: true };
  });
}

export const GUIDE = [
  "# Beta blockers",
  "## Mechanism",
  "They block beta receptors and lower heart rate.",
  "Cardioselective agents block beta-1 receptors.",
  "## Effects",
  "Lower blood pressure and cardiac output.",
  "## Cautions",
  "Avoid in asthma with non-selective agents.",
  "Never stop abruptly.",
];

/** The composed services, an owner (alice, "she"), an agent key and a second user. */
export function canvasSetup() {
  const t: Composed = composed();
  let lectures = 0;
  const spineOf = new Map<string, ReturnType<Composed["spine"]>>();

  /** A new document under a fresh lecture of this user. */
  function makeDoc(
    lines: readonly string[] = GUIDE,
    options: { owner?: string; as?: AuthContext; title?: string } = {},
  ) {
    const owner = options.owner ?? t.alice;
    let spine = spineOf.get(owner);
    if (!spine) {
      spine = t.spine(owner);
      spineOf.set(owner, spine);
    }
    lectures += 1;
    const lecture = t.services.library.create(owner, {
      parentId: spine.sections.lectures as string,
      kind: "lecture",
      name: options.title ?? `Lecture ${lectures}`,
      lecture: { number: lectures, date: "2026-10-14" },
    });
    const as = options.as ?? (owner === t.alice ? t.bot : agentAuth(owner));
    const created = t.services.documents.createDocument(as, {
      nodeId: lecture.id,
      kind: "study_guide",
      title: options.title ?? `Lecture ${lectures}`,
      blocks: blocksOf(lines),
    } as never);
    return { documentId: created.documentId, nodeId: lecture.id, blockIds: created.blockIds };
  }

  const canvasOf = (documentId: string, auth: AuthContext = t.she) =>
    t.services.canvas.get(auth, documentId).canvas;

  /** The ID of the card that shows exactly this block. */
  function cardOfBlock(documentId: string, blockId: string): string {
    const card = canvasOf(documentId).cards.find(
      (c) => c.content.kind === "block" && c.content.blockIds.includes(blockId),
    );
    if (!card) throw new Error(`no card for ${blockId}`);
    return card.id;
  }

  /** The first block a card shows. */
  function blockOfCard(documentId: string, cardId: string): string {
    const card = canvasOf(documentId).cards.find((c) => c.id === cardId);
    if (card?.content.kind !== "block") throw new Error(`${cardId} is not a block card`);
    return card.content.blockIds[0] as string;
  }

  function ok(outcome: ChangeOutcome) {
    if (!outcome.ok)
      throw new Error(`refused (${outcome.kind}): ${JSON.stringify(outcome.problems)}`);
    return outcome;
  }

  /** Her ops, as she. */
  const sheDoes = (documentId: string, ops: unknown[], extra: object = {}) =>
    t.services.canvas.change(t.she, documentId, { documentId, ops, ...extra });
  /** The agent's ops. */
  const botDoes = (documentId: string, ops: unknown[], extra: object = {}, as = t.bot) =>
    t.services.canvas.change(as, documentId, { documentId, ops, ...extra });

  /** She opens a request on the document and an agent key claims it: the ID that lifts protection. */
  function claimedRequest(documentId: string, as: AuthContext = t.bot): string {
    const request = t.services.requests.create(t.she, {
      target: { type: "document", documentId },
      kind: "other",
      message: "Change her map",
    } as never);
    t.services.requests.claim(as, request.id);
    return request.id;
  }

  const place = (documentId: string, placements: Array<{ id: string; x: number; y: number }>) =>
    t.services.canvas.savePlacements(t.she, documentId, { placements });

  const otherBot = agentAuth(t.alice, newId("apiKey"), "write", "Codex");

  return {
    ...t,
    t,
    otherBot,
    makeDoc,
    canvasOf,
    cardOfBlock,
    blockOfCard,
    ok,
    sheDoes,
    botDoes,
    claimedRequest,
    place,
    newCardId: () => newId("card"),
  };
}

export type CanvasSetup = ReturnType<typeof canvasSetup>;

export function thrownOf(fn: () => unknown): { code: string; message: string; hint?: string } {
  try {
    fn();
  } catch (error) {
    return error as never;
  }
  throw new Error("expected the call to throw");
}
