import type { Actor, Canvas, CanvasSourceBlock, Card, Connector, Frame } from "@notes/schema";

/**
 * Deterministic synthetic canvases for layout tests and performance runs:
 * `cardCount` cards with varied block content, frames of 6 to 14 cards,
 * every third frame nested inside the previous one, connectors inside
 * frames and some across them, and a few pinned cards.
 */

function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
}

const CROCKFORD = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
/** A well-formed, deterministic ID. */
export function fixtureId(prefix: string, n: number): string {
  let body = "";
  let v = n;
  for (let i = 0; i < 26; i++) {
    body = CROCKFORD[v % 32] + body;
    v = Math.floor(v / 32);
  }
  return `${prefix}_${body}`;
}

const SENTENCES = [
  "Beta blockers antagonise β-adrenergic receptors.",
  "Cardioselective agents prefer β1 receptors in the heart.",
  "Non-selective agents also block β2 receptors in bronchial smooth muscle.",
  "Lower heart rate and contractility reduce myocardial oxygen demand.",
  "Renin release from the kidney falls, lowering blood pressure.",
  "Abrupt withdrawal can cause rebound tachycardia and angina.",
];

export const fixtureActor: Actor = { type: "user", userId: fixtureId("usr", 1) };

export interface Fixture {
  canvas: Canvas;
  blocks: CanvasSourceBlock[];
}

export function makeFixture(
  cardCount: number,
  options: { seed?: number; pinned?: number } = {},
): Fixture {
  const random = rng(options.seed ?? 7);
  const blocks: CanvasSourceBlock[] = [];
  const cards: Card[] = [];
  const frames: Frame[] = [];
  const connectors: Connector[] = [];
  let id = 1000;
  let frameIndex = 0;
  let current: Frame | null = null;
  let left = 0;
  for (let i = 0; i < cardCount; i++) {
    if (left === 0) {
      left = 6 + Math.floor(random() * 9);
      const previous = current as Frame | null;
      const parent: Frame | null = frameIndex % 3 === 2 && previous ? previous : null;
      current = {
        id: fixtureId("frm", ++id),
        title: `Topic ${frameIndex + 1}`,
        members: [],
        order: frameIndex,
        origin: "document",
        ...(parent && !parent.parent ? { parent: parent.id } : {}),
      } as Frame;
      frames.push(current);
      frameIndex += 1;
    }
    left -= 1;
    const r = random();
    const blockId = fixtureId("blk", ++id);
    let block: CanvasSourceBlock;
    if (r < 0.45) {
      const n = 1 + Math.floor(random() * 4);
      block = {
        id: blockId,
        type: "paragraph",
        content: { text: SENTENCES.slice(0, n).join(" ") },
      };
    } else if (r < 0.65) {
      block = {
        id: blockId,
        type: "bulleted_list",
        content: {
          items: ["Bradycardia", "Fatigue", "Cold hands", "Bronchospasm"].slice(
            0,
            2 + Math.floor(random() * 3),
          ),
        },
      };
    } else if (r < 0.8) {
      block = {
        id: blockId,
        type: "callout",
        content: {
          kind: "exam_tip",
          title: "Exam tip",
          text: SENTENCES[Math.floor(random() * SENTENCES.length)],
        },
      };
    } else if (r < 0.9) {
      block = {
        id: blockId,
        type: "table",
        content: {
          rows: [
            ["Agent", "Selectivity"],
            ["Atenolol", "β1"],
            ["Propranolol", "β1 and β2"],
          ],
        },
      };
    } else {
      block = {
        id: blockId,
        type: "drug_card",
        content: {
          name: "metoprolol",
          drugClass: "Cardioselective beta blocker",
          mechanism: "Blocks β1 receptors in the heart.",
          adverseEffects: ["Bradycardia", "Fatigue", "Dizziness"],
          counselling: ["Do not stop suddenly"],
        },
      };
    }
    blocks.push(block);
    const card: Card = {
      id: fixtureId("crd", ++id),
      content: { kind: "block", blockIds: [blockId] },
      size: "auto",
      origin: "document",
      position: null,
      dimensions: null,
    };
    cards.push(card);
    current?.members.push(card.id);
    const members = current?.members ?? [];
    if (members.length > 1 && random() < 0.55) {
      connectors.push({
        id: fixtureId("edg", ++id),
        from: members[members.length - 2] as string,
        to: card.id,
        kind: "leads_to",
        direction: "forward",
        origin: "agent",
      });
    }
    if (cards.length > 12 && random() < 0.08) {
      const other = cards[Math.floor(random() * (cards.length - 1))] as Card;
      if (other.id !== card.id)
        connectors.push({
          id: fixtureId("edg", ++id),
          from: other.id,
          to: card.id,
          kind: "related",
          direction: "forward",
          origin: "agent",
        });
    }
  }
  const pinned = options.pinned ?? Math.max(1, Math.floor(cardCount / 25));
  for (let k = 0; k < pinned; k++) {
    const card = cards[Math.floor(random() * cards.length)] as Card;
    card.position = {
      x: Math.round(random() * 1600),
      y: Math.round(random() * 1200),
      placedBy: fixtureActor,
      placedAt: "2026-11-15T18:00:00.000Z",
    };
  }
  return {
    blocks,
    canvas: {
      documentId: fixtureId("doc", 1),
      revision: 1,
      cards,
      connectors,
      frames,
      syncedBlockIds: blocks.map((b) => b.id),
      allowSelfLinks: false,
      updatedAt: "2026-11-15T18:00:00.000Z",
    },
  };
}
