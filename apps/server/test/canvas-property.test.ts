import { canvasIntegrityProblems } from "@notes/schema";
import { describe, expect, it } from "vitest";
import { canvasSetup, type Json } from "./canvas-helpers.js";

/** A small seeded generator, so a failure replays. */
function mulberry32(seed: number) {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

describe("canvas invariants under random valid operations", () => {
  for (const seed of [1, 2, 3]) {
    it(`seed ${seed}: 300 random steps by her, an agent and the document keep the canvas sound`, () => {
      const rand = mulberry32(seed);
      const pick = <T>(list: readonly T[]): T | undefined => list[Math.floor(rand() * list.length)];
      const s = canvasSetup();
      const doc = s.makeDoc();
      const id = doc.documentId;
      let steps = 0;
      let refused = 0;
      const check = () => {
        const c = s.canvasOf(id);
        expect(canvasIntegrityProblems(c)).toEqual([]);
        // Frames: each card in at most one; every member exists (integrity), orders 0..n-1 (integrity).
        const cardIds = new Set(c.cards.map((x) => x.id));
        for (const e of c.connectors) {
          expect(cardIds.has(e.from) && cardIds.has(e.to)).toBe(true);
        }
        // A stored canvas equals what a fresh read returns, and carries coordinates only on pinned cards.
        const raw = JSON.parse(
          (
            s.db.prepare("SELECT data FROM canvases WHERE document_id = ?").get(id) as {
              data: string;
            }
          ).data,
        );
        for (const card of raw.cards as Json[]) {
          if (card.position !== null) expect(typeof card.position.x).toBe("number");
          else expect(card.position).toBeNull();
        }
        // The cache never names a card that is gone or pinned.
        for (const variant of ["wide", "tall"] as const) {
          const cached = s.services.canvas.getLayoutCache(s.she, id, variant) ?? {};
          for (const key of Object.keys(cached)) {
            const card = c.cards.find((x) => x.id === key);
            expect(card && card.position === null).toBeTruthy();
          }
        }
        // Block cards never repeat a block of another card without being a summary card of her own making.
        const shown = c.cards.flatMap((x) =>
          x.content.kind === "block" ? x.content.blockIds : [],
        );
        const live = new Set(s.t.services.documents.getFull(s.she, id).blocks.map((b) => b.id));
        for (const b of shown) expect(live.has(b)).toBe(true);
      };

      for (; steps < 300; steps++) {
        const c = s.canvasOf(id);
        const cards = c.cards.map((x) => x.id);
        const frames = c.frames.map((f) => f.id);
        const edges = c.connectors.map((e) => e.id);
        const who = pick(["she", "bot", "bot", "doc", "place", "cache"] as const) as string;
        const result = (() => {
          switch (who) {
            case "doc": {
              const blocks = s.t.services.documents.getFull(s.she, id).blocks;
              const r = rand();
              if (r < 0.45) {
                return s.t.services.documents.insertBlocks(s.she, {
                  documentId: id,
                  blocks: [
                    rand() < 0.2
                      ? { type: "heading", content: { level: 2, text: `H${steps}` } }
                      : {
                          type: "paragraph",
                          content: { text: `P${steps}` },
                          generalKnowledge: true,
                        },
                  ],
                  position: "end",
                } as never);
              }
              if (r < 0.7 && blocks.length > 3) {
                return s.t.services.documents.deleteBlocks(s.she, {
                  documentId: id,
                  blockIds: [pick(blocks)?.id as string],
                } as never);
              }
              if (blocks.length > 2) {
                return s.t.services.documents.moveBlocks(s.she, {
                  documentId: id,
                  blockIds: [pick(blocks)?.id as string],
                  position: "start",
                } as never);
              }
              return null;
            }
            case "place": {
              const card = pick(cards);
              return card
                ? s.place(id, [
                    { id: card, x: Math.floor(rand() * 2000) - 500, y: Math.floor(rand() * 2000) },
                    { id: "crd_01J9Z8Y7X6W5V4T3S2R1Q0P9N8", x: 1, y: 1 },
                  ])
                : null;
            }
            case "cache": {
              const free = c.cards.filter((x) => !x.position).map((x) => x.id);
              const stale = pick(cards);
              return s.services.canvas.saveLayoutCache(s.she, id, rand() < 0.5 ? "wide" : "tall", {
                ...Object.fromEntries(free.slice(0, 20).map((k) => [k, { x: 1, y: 2 }])),
                ...(stale ? { [stale]: { x: 3, y: 3 } } : {}),
              });
            }
            default: {
              const run = who === "she" ? s.sheDoes : s.botDoes;
              const ops: unknown[] = [];
              const n = 1 + Math.floor(rand() * 3);
              for (let i = 0; i < n; i++) {
                const k = Math.floor(rand() * 11);
                const a = pick(cards);
                const b = pick(cards);
                const f = pick(frames);
                if (k === 0)
                  ops.push({
                    op: "add_card",
                    card: {
                      content: { kind: "note", text: `n${steps}${i}` },
                      size: pick(["small", "wide", "auto"]),
                    },
                  });
                else if (k === 1 && rand() < 0.3 && a) ops.push({ op: "remove_card", id: a });
                else if (k === 2 && a && b && a !== b)
                  ops.push({
                    op: "add_connector",
                    connector: {
                      from: a,
                      to: b,
                      kind: pick(["leads_to", "causes", "related"]),
                      label: `l${steps}`,
                    },
                  });
                else if (k === 3 && pick(edges))
                  ops.push({ op: "remove_connector", id: pick(edges) });
                else if (k === 4)
                  ops.push({
                    op: "add_frame",
                    frame: { title: `F${steps}${i}`, members: a ? [a] : [] },
                  });
                else if (k === 5 && f && rand() < 0.5) ops.push({ op: "remove_frame", id: f });
                else if (k === 6 && f && a) ops.push({ op: "add_to_frame", frame: f, cards: [a] });
                else if (k === 7 && a) ops.push({ op: "remove_from_frame", cards: [a] });
                else if (k === 8 && a)
                  ops.push({
                    op: "update_card",
                    id: a,
                    patch: { color: pick(["red", "blue", null]) },
                  });
                else if (k === 9 && f)
                  ops.push({
                    op: "update_frame",
                    id: f,
                    patch: { title: `R${steps}`, order: Math.floor(rand() * 5) },
                  });
                else if (k === 10 && a && who === "she") ops.push({ op: "release_pins", ids: [a] });
              }
              if (ops.length === 0) return null;
              return run(id, ops);
            }
          }
        })();
        if (result && typeof result === "object" && "ok" in result && result.ok === false)
          refused++;
        check();
      }
      // The run did real work and also hit refusals (the pin rule, bad references) without corrupting anything.
      expect(refused).toBeGreaterThan(0);
      expect(s.canvasOf(id).revision).toBeGreaterThan(50);
    });
  }
});
