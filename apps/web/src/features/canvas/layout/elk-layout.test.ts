import {
  applyCanvasChange,
  buildLayoutInput,
  type Canvas,
  estimateCardSize,
  type LayoutResult,
  layoutProblems,
  overlaps,
} from "@notes/schema";
import ELK from "elkjs/lib/elk.bundled.js";
import { describe, expect, it } from "vitest";
import { buildElkGraph, computeLayout } from "./elk-layout";
import { type Fixture, fixtureActor, fixtureId, makeFixture } from "./fixtures";

const elk = new ELK();

function inputOf(fixture: Fixture, previous?: Record<string, { x: number; y: number }>) {
  const blocks = new Map(fixture.blocks.map((b) => [b.id, b]));
  return buildLayoutInput(fixture.canvas, { sizeOf: (c) => estimateCardSize(c, blocks), previous });
}

function displacement(a: LayoutResult, b: LayoutResult, ids: string[]) {
  let moved = 0;
  let total = 0;
  for (const id of ids) {
    const ra = a.cards[id];
    const rb = b.cards[id];
    if (!ra || !rb) continue;
    const d = Math.hypot(ra.x - rb.x, ra.y - rb.y);
    total += d;
    if (d > 1) moved += 1;
  }
  return { moved, mean: total / ids.length };
}

/** Add one card to the middle frame, as an agent would. */
function addOneCard(canvas: Canvas): Canvas {
  const frame = canvas.frames[Math.floor(canvas.frames.length / 2)];
  const result = applyCanvasChange(
    canvas,
    {
      documentId: canvas.documentId,
      ops: [
        { op: "add_card", card: { ref: "n", content: { kind: "note", text: "A new thought" } } },
        { op: "add_to_frame", frame: frame?.id, cards: ["n"] },
      ],
    },
    {
      actor: { type: "agent", keyId: fixtureId("key", 1) },
      now: "2026-11-15T19:00:00.000Z",
      newId: (k) => fixtureId(k === "card" ? "crd" : k === "edge" ? "edg" : "frm", 999_999),
    },
  );
  if (!result.ok) throw new Error(JSON.stringify(result.problems));
  return result.canvas;
}

const timings: string[] = [];

describe.each([10, 100, 300])("ELK layout with %i cards", (count) => {
  const fixture = makeFixture(count);

  it("keeps every invariant, deterministically", async () => {
    const input = inputOf(fixture);
    const t0 = performance.now();
    const first = await computeLayout(input, elk);
    const ms = performance.now() - t0;
    expect(layoutProblems(input, first)).toEqual([]);
    const second = await computeLayout(input, elk);
    expect(second.cards).toEqual(first.cards);
    expect(second.frames).toEqual(first.frames);
    timings.push(
      `${count} cards, ${fixture.canvas.frames.length} frames, ${fixture.canvas.connectors.length} connectors: ${ms.toFixed(0)} ms (ELK ${first.timings.graph.toFixed(0)}, constraints ${first.timings.resolve.toFixed(1)})`,
    );
  });

  it("flows around pinned cards and frames stay apart", async () => {
    const input = inputOf(fixture);
    const result = await computeLayout(input, elk);
    for (const c of input.cards.filter((x) => x.pinned)) {
      expect(result.cards[c.id]).toMatchObject({ x: c.pinned?.x, y: c.pinned?.y });
    }
    // Top-level frames without pinned cards do not overlap each other.
    const pinnedFrames = new Set<string>();
    for (const c of input.cards.filter((x) => x.pinned)) {
      let f = c.frame;
      while (f) {
        pinnedFrames.add(f);
        f = input.frames.find((x) => x.id === f)?.parent ?? null;
      }
    }
    const top = input.frames.filter((f) => !f.parent && !pinnedFrames.has(f.id));
    for (const a of top)
      for (const b of top) {
        if (a.id >= b.id) continue;
        expect(
          overlaps(result.frames[a.id] as never, result.frames[b.id] as never),
          `${a.id} ${b.id}`,
        ).toBe(false);
      }
  });

  it("is stable when one card is added (anchored re-layout)", async () => {
    const input = inputOf(fixture);
    const before = await computeLayout(input, elk);
    const grown = { ...fixture, canvas: addOneCard(fixture.canvas) };
    const ids = input.cards.filter((c) => !c.pinned).map((c) => c.id);
    // Plain re-layout: ELK again from scratch.
    const fresh = await computeLayout(inputOf(grown), elk);
    // Anchored: previous positions of unpinned cards are kept.
    const previous = Object.fromEntries(
      ids.map((id) => [id, { x: before.cards[id]?.x ?? 0, y: before.cards[id]?.y ?? 0 }]),
    );
    const anchoredInput = inputOf(grown, previous);
    const anchored = await computeLayout(anchoredInput, elk);
    expect(layoutProblems(anchoredInput, anchored)).toEqual([]);
    const a = displacement(before, fresh, ids);
    const b = displacement(before, anchored, ids);
    timings.push(
      `${count} cards + 1: from scratch moved ${a.moved}/${ids.length} (mean ${a.mean.toFixed(0)} px); anchored moved ${b.moved}/${ids.length} (mean ${b.mean.toFixed(0)} px)`,
    );
    expect(b.moved).toBeLessThanOrEqual(a.moved);
  });
});

describe("graph building", () => {
  it("leaves pinned cards out of ELK and lifts cross-frame connectors to the common level", () => {
    const fixture = makeFixture(30, { pinned: 2 });
    const input = inputOf(fixture);
    const graph = buildElkGraph(input);
    const ids: string[] = [];
    const walk = (n: { id: string; children?: unknown[] }) => {
      ids.push(n.id);
      for (const c of (n.children ?? []) as Array<{ id: string; children?: unknown[] }>) walk(c);
    };
    walk(graph);
    for (const c of input.cards) expect(ids.includes(c.id)).toBe(!c.pinned);
    const rootEdges = graph.edges ?? [];
    for (const e of rootEdges) {
      const top = new Set((graph.children ?? []).map((c) => c.id));
      expect(top.has(e.sources[0] as string) && top.has(e.targets[0] as string)).toBe(true);
    }
  });

  it("pins survive a drag in the middle of the map", async () => {
    const fixture = makeFixture(40, { pinned: 0 });
    const input = inputOf(fixture);
    const first = await computeLayout(input, elk);
    const target = input.cards[5]?.id as string;
    const at = first.cards[input.cards[20]?.id as string];
    const placed = applyCanvasChange(
      fixture.canvas,
      {
        documentId: fixture.canvas.documentId,
        ops: [{ op: "place_cards", placements: [{ id: target, x: at?.x ?? 0, y: at?.y ?? 0 }] }],
      },
      { actor: fixtureActor },
    );
    if (!placed.ok) throw new Error("place failed");
    const input2 = inputOf({ ...fixture, canvas: placed.canvas });
    const second = await computeLayout(input2, elk);
    expect(second.cards[target]).toMatchObject({ x: at?.x, y: at?.y });
    expect(layoutProblems(input2, second)).toEqual([]);
  });
});

describe("timings", () => {
  it("prints what was measured", () => {
    console.log(`\nLayout timings (Node, ${new Date().toISOString()}):\n  ${timings.join("\n  ")}`);
    expect(timings.length).toBeGreaterThan(0);
  });
});
