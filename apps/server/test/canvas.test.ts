import { canvasIntegrityProblems } from "@notes/schema";
import { describe, expect, it } from "vitest";
import { type CanvasSetup, canvasSetup, GUIDE, thrownOf } from "./canvas-helpers.js";

const note = (text: string) => ({ kind: "note", text });

function structureFor(_s: CanvasSetup, doc: ReturnType<CanvasSetup["makeDoc"]>) {
  const [h1, , p1, p2, , p3] = doc.blockIds;
  return {
    documentId: doc.documentId,
    cards: [
      { ref: "mech", content: { kind: "block", blockIds: [p1] } },
      { ref: "sel", content: { kind: "block", blockIds: [p2] }, size: "wide" },
      { ref: "effects", content: { kind: "block", blockIds: [p3] } },
      { ref: "tip", content: note("Think: -olol = beta blocker"), color: "yellow" },
      { ref: "title", content: { kind: "block", blockIds: [h1] } },
    ],
    connectors: [
      { from: "mech", to: "effects", label: "lowers heart rate", kind: "causes" },
      { from: "sel", to: "mech", kind: "part_of" },
    ],
    frames: [
      { ref: "f1", title: "Mechanism", members: ["mech", "sel"] },
      { ref: "f2", title: "Effects", members: ["effects", "tip"] },
    ],
  };
}

describe("canvas: lazy derive and reading", () => {
  it("derives the canvas from the document's headings and blocks on first read", () => {
    const s = canvasSetup();
    const doc = s.makeDoc();
    expect(s.db.prepare("SELECT COUNT(*) AS n FROM canvases").get()).toEqual({ n: 0 });
    const loaded = s.services.canvas.get(s.she, doc.documentId);
    expect(loaded.documentTitle).toBe("Lecture 1");
    expect(loaded.blocks.map((b) => b.id)).toEqual(doc.blockIds);
    const { canvas } = loaded;
    expect(canvas.revision).toBe(1);
    expect(canvas.frames.map((f) => f.title)).toEqual([
      "Beta blockers",
      "Mechanism",
      "Effects",
      "Cautions",
    ]);
    expect(canvas.cards).toHaveLength(5);
    expect(canvas.cards.every((c) => c.position === null && c.origin === "document")).toBe(true);
    expect(canvasIntegrityProblems(canvas)).toEqual([]);
    // Reading again changes nothing.
    expect(s.services.canvas.get(s.she, doc.documentId).canvas).toEqual(canvas);
    expect(s.db.prepare("SELECT COUNT(*) AS n FROM canvases").get()).toEqual({ n: 1 });
  });

  it("a read-only key can read (and derive) but not write", () => {
    const s = canvasSetup();
    const doc = s.makeDoc();
    const reader = { ...s.bot, scope: "read" as const };
    expect(s.services.canvas.get(reader, doc.documentId).canvas.cards).toHaveLength(5);
    expect(
      thrownOf(() =>
        s.services.canvas.change(reader, doc.documentId, { documentId: doc.documentId, ops: [] }),
      ).code,
    ).toBe("read_only_key");
    expect(thrownOf(() => s.services.canvas.setStructure(reader, doc.documentId, {})).code).toBe(
      "read_only_key",
    );
  });

  it("an unknown, malformed or another user's document is not_found", () => {
    const s = canvasSetup();
    const mine = s.makeDoc();
    expect(thrownOf(() => s.services.canvas.get(s.bobUser, mine.documentId)).code).toBe(
      "not_found",
    );
    expect(
      thrownOf(() => s.services.canvas.get(s.she, "doc_01J9Z8Y7X6W5V4T3S2R1Q0P9N8")).code,
    ).toBe("not_found");
    expect(thrownOf(() => s.services.canvas.get(s.she, "nonsense")).code).toBe("not_found");
    expect(
      thrownOf(() =>
        s.services.canvas.setStructure(s.bobUser, mine.documentId, { documentId: mine.documentId }),
      ).code,
    ).toBe("not_found");
  });
});

describe("canvas: set structure", () => {
  it("an agent sets the whole structure with refs, and sending it again changes nothing", () => {
    const s = canvasSetup();
    const doc = s.makeDoc();
    const body = structureFor(s, doc);
    const out = s.ok(s.services.canvas.setStructure(s.bot, doc.documentId, body));
    expect(out.changed).toBe(true);
    expect(out.canvas.frames.map((f) => f.title)).toEqual(["Mechanism", "Effects"]);
    expect(out.canvas.connectors).toHaveLength(2);
    expect(out.canvas.cards.every((c) => c.position === null && c.dimensions === null)).toBe(true);
    expect(Object.keys(out.report.refs).sort()).toEqual([
      "effects",
      "f1",
      "f2",
      "mech",
      "sel",
      "tip",
      "title",
    ]);
    const revision = out.canvas.revision;
    const again = s.ok(s.services.canvas.setStructure(s.bot, doc.documentId, body));
    expect(again.changed).toBe(false);
    expect(again.canvas.revision).toBe(revision);
    expect(canvasIntegrityProblems(again.canvas)).toEqual([]);
  });

  it("refuses bad structures with a path, a message and an example", () => {
    const s = canvasSetup();
    const doc = s.makeDoc();
    const base = structureFor(s, doc);
    const cases: Array<[string, unknown, RegExp]> = [
      ["coordinates", { ...base, cards: [{ ref: "a", content: note("x"), x: 10 }] }, /x/],
      [
        "missing card in a connector",
        { ...base, connectors: [{ from: "mech", to: "nope" }] },
        /not a card/,
      ],
      [
        "card in two frames",
        {
          ...base,
          frames: [
            { title: "A", members: ["mech"] },
            { title: "B", members: ["mech"] },
          ],
        },
        /one frame/,
      ],
      [
        "a block of another document",
        {
          ...base,
          cards: [
            { ref: "a", content: { kind: "block", blockIds: ["blk_01J9Z8Y7X6W5V4T3S2R1Q0P9N8"] } },
          ],
        },
        /not in this document/,
      ],
    ];
    for (const [, input, message] of cases) {
      const out = s.services.canvas.setStructure(s.bot, doc.documentId, input);
      expect(out.ok).toBe(false);
      if (out.ok) continue;
      expect(out.kind).toBe("invalid");
      const [first] = out.problems;
      expect(first?.path).toMatch(/^\$/);
      expect(first?.message).toMatch(message);
      expect(first?.example).toBeDefined();
    }
    // Nothing was stored by the refused calls.
    expect(s.canvasOf(doc.documentId).revision).toBe(1);
  });

  it("expectedRevision mismatch is a conflict naming the current revision", () => {
    const s = canvasSetup();
    const doc = s.makeDoc();
    const out = s.services.canvas.setStructure(s.bot, doc.documentId, {
      ...structureFor(s, doc),
      expectedRevision: 9,
    });
    expect(out).toMatchObject({ ok: false, kind: "conflict" });
    if (!out.ok) expect(out.problems[0]?.message).toMatch(/revision 1/);
  });
});

describe("canvas: incremental ops", () => {
  it("adds, updates and removes cards, connectors and frames, and moves cards between frames", () => {
    const s = canvasSetup();
    const doc = s.makeDoc();
    s.ok(s.services.canvas.setStructure(s.bot, doc.documentId, structureFor(s, doc)));
    const before = s.canvasOf(doc.documentId);
    const [mech, , effects] = before.cards.filter((c) => c.content.kind === "block");
    const [f1, f2] = before.frames;
    expect(mech && effects && f1 && f2).toBeTruthy();

    const out = s.ok(
      s.botDoes(doc.documentId, [
        { op: "add_card", card: { ref: "new", content: note("Beta-1 = 1 heart"), size: "small" } },
        {
          op: "add_connector",
          connector: { from: "new", to: mech?.id, kind: "related", label: "see" },
        },
        { op: "add_frame", frame: { ref: "f3", title: "Extra", members: ["new"] } },
        { op: "update_card", id: effects?.id, patch: { color: "blue", title: "BP" } },
        { op: "update_frame", id: f1?.id, patch: { title: "How it works" } },
        { op: "add_to_frame", frame: f2?.id, cards: [mech?.id] },
      ]),
    );
    expect(out.canvas.revision).toBe(before.revision + 1);
    const after = out.canvas;
    expect(after.frames.find((f) => f.id === f1?.id)?.title).toBe("How it works");
    expect(after.frames.find((f) => f.id === f2?.id)?.members).toContain(mech?.id);
    expect(after.frames.find((f) => f.id === f1?.id)?.members).not.toContain(mech?.id);
    expect(after.cards.find((c) => c.id === effects?.id)).toMatchObject({
      color: "blue",
      title: "BP",
    });

    const newCard = out.report.refs.new as string;
    const f3 = out.report.refs.f3 as string;
    const out2 = s.ok(
      s.botDoes(doc.documentId, [
        { op: "remove_from_frame", cards: [newCard] },
        { op: "remove_frame", id: f3 },
        { op: "remove_card", id: newCard },
      ]),
    );
    expect(out2.canvas.cards.some((c) => c.id === newCard)).toBe(false);
    expect(out2.canvas.connectors.every((e) => e.from !== newCard && e.to !== newCard)).toBe(true);
    expect(canvasIntegrityProblems(out2.canvas)).toEqual([]);
    const edge = out2.canvas.connectors[0];
    const out3 = s.ok(
      s.botDoes(doc.documentId, [
        { op: "update_connector", id: edge?.id, patch: { label: "x", direction: "both" } },
        { op: "remove_connector", id: out2.canvas.connectors[1]?.id },
      ]),
    );
    expect(out3.canvas.connectors).toHaveLength(1);
    expect(out3.canvas.connectors[0]).toMatchObject({ label: "x", direction: "both" });
  });

  it("is all or nothing, and teaches with the op's path and example", () => {
    const s = canvasSetup();
    const doc = s.makeDoc();
    const before = s.canvasOf(doc.documentId);
    const out = s.botDoes(doc.documentId, [
      { op: "add_card", card: { content: note("fine") } },
      { op: "remove_card", id: "crd_01J9Z8Y7X6W5V4T3S2R1Q0P9N8" },
    ]);
    expect(out.ok).toBe(false);
    if (!out.ok) {
      expect(out.kind).toBe("invalid");
      expect(out.problems[0]?.path).toBe("$.ops[1].id");
      expect(out.problems[0]?.example).toBeDefined();
    }
    expect(s.canvasOf(doc.documentId)).toEqual(before);
    const unknown = s.botDoes(doc.documentId, [{ op: "teleport" }]);
    expect(unknown.ok).toBe(false);
    if (!unknown.ok) expect(unknown.problems[0]?.message).toMatch(/Valid ops/);
  });

  it("agents may not place, release or insert: those are hers", () => {
    const s = canvasSetup();
    const doc = s.makeDoc();
    const card = s.canvasOf(doc.documentId).cards[0]?.id as string;
    for (const op of [
      { op: "place_cards", placements: [{ id: card, x: 1, y: 2 }] },
      { op: "release_pins" },
      { op: "insert_items", cards: [] },
    ]) {
      const out = s.botDoes(doc.documentId, [op]);
      expect(out).toMatchObject({ ok: false, kind: "forbidden" });
    }
    expect(s.canvasOf(doc.documentId).cards[0]?.position).toBeNull();
  });

  it("her ops mark what she makes and edits as hers", () => {
    const s = canvasSetup();
    const doc = s.makeDoc();
    const out = s.ok(
      s.sheDoes(doc.documentId, [{ op: "add_card", card: { ref: "n", content: note("mine") } }]),
    );
    const id = out.report.refs.n as string;
    expect(out.canvas.cards.find((c) => c.id === id)?.origin).toBe("user");
    const first = s.canvasOf(doc.documentId).cards.find((c) => c.origin === "document");
    s.ok(
      s.sheDoes(doc.documentId, [{ op: "update_card", id: first?.id, patch: { color: "red" } }]),
    );
    expect(s.canvasOf(doc.documentId).cards.find((c) => c.id === first?.id)?.origin).toBe("user");
  });
});

describe("canvas: the pin rule", () => {
  /** An agent card she pinned, one she edited, one she made, and the same for a connector and a frame. */
  function arena() {
    const s = canvasSetup();
    const doc = s.makeDoc();
    s.ok(s.services.canvas.setStructure(s.bot, doc.documentId, structureFor(s, doc)));
    const c = s.canvasOf(doc.documentId);
    const blockCards = c.cards.filter((x) => x.content.kind === "block");
    const [pinned, edited, free] = blockCards;
    s.place(doc.documentId, [{ id: pinned?.id as string, x: 40, y: 50 }]);
    s.ok(
      s.sheDoes(doc.documentId, [{ op: "update_card", id: edited?.id, patch: { color: "green" } }]),
    );
    const made = s.ok(
      s.sheDoes(doc.documentId, [
        { op: "add_card", card: { ref: "mine", content: note("her note") } },
        { op: "add_connector", connector: { from: free?.id, to: edited?.id, label: "hers" } },
        { op: "add_frame", frame: { ref: "hers", title: "Her frame" } },
      ]),
    );
    const after = s.canvasOf(doc.documentId);
    return {
      s,
      doc,
      pinned: pinned?.id as string,
      edited: edited?.id as string,
      free: free?.id as string,
      herCard: made.report.refs.mine as string,
      herFrame: made.report.refs.hers as string,
      herEdge: after.connectors.find((e) => e.origin === "user")?.id as string,
      agentEdge: after.connectors.find((e) => e.origin === "agent")?.id as string,
      agentFrame: after.frames.find((f) => f.origin === "agent")?.id as string,
    };
  }

  it("an agent may change and remove what it made and she left alone", () => {
    const a = arena();
    expect(
      a.s.botDoes(a.doc.documentId, [{ op: "update_card", id: a.free, patch: { color: "red" } }])
        .ok,
    ).toBe(true);
    expect(a.s.botDoes(a.doc.documentId, [{ op: "remove_connector", id: a.agentEdge }]).ok).toBe(
      true,
    );
    expect(a.s.botDoes(a.doc.documentId, [{ op: "remove_frame", id: a.agentFrame }]).ok).toBe(true);
    expect(a.s.botDoes(a.doc.documentId, [{ op: "remove_card", id: a.free }]).ok).toBe(true);
  });

  it("refuses every change to a card she pinned, edited or created, and to her connectors and frames", () => {
    const a = arena();
    const attempts: Array<[string, unknown]> = [
      ["remove pinned", { op: "remove_card", id: a.pinned }],
      ["resize pinned", { op: "update_card", id: a.pinned, patch: { size: "large" } }],
      ["recolour edited", { op: "update_card", id: a.edited, patch: { color: "red" } }],
      ["remove edited", { op: "remove_card", id: a.edited }],
      ["remove her note", { op: "remove_card", id: a.herCard }],
      ["edit her note", { op: "update_card", id: a.herCard, patch: { content: note("agent") } }],
      ["remove her connector", { op: "remove_connector", id: a.herEdge }],
      [
        "relabel her connector",
        { op: "update_connector", id: a.herEdge, patch: { label: "agent" } },
      ],
      ["remove her frame", { op: "remove_frame", id: a.herFrame }],
      ["rename her frame", { op: "update_frame", id: a.herFrame, patch: { title: "agent" } }],
    ];
    const before = a.s.canvasOf(a.doc.documentId);
    for (const [name, op] of attempts) {
      const out = a.s.botDoes(a.doc.documentId, [op]);
      expect(out, name).toMatchObject({ ok: false, kind: "protected" });
      if (!out.ok) {
        expect(out.problems[0]?.message, name).toMatch(/request/);
        expect(out.problems[0]?.example, name).toBeDefined();
      }
    }
    expect(a.s.canvasOf(a.doc.documentId)).toEqual(before);
  });

  it("set structure keeps what she made, edited or pinned and reports it as skipped", () => {
    const a = arena();
    const out = a.s.ok(
      a.s.services.canvas.setStructure(a.s.bot, a.doc.documentId, {
        documentId: a.doc.documentId,
        cards: [],
      }),
    );
    const ids = out.canvas.cards.map((c) => c.id);
    expect(ids).toContain(a.pinned);
    expect(ids).toContain(a.edited);
    expect(ids).toContain(a.herCard);
    expect(ids).not.toContain(a.free);
    expect(out.report.skipped.map((x) => x.reason).sort()).toContain("pinned");
    expect(out.canvas.cards.find((c) => c.id === a.pinned)?.position).toMatchObject({
      x: 40,
      y: 50,
    });
  });

  it("a request id lifts the rule only when it is claimed by this key and about this document", () => {
    const a = arena();
    const { s, doc } = a;
    const remove = { op: "remove_card", id: a.pinned };

    // No request, a made-up one (no claim), and a request another key claimed.
    expect(s.botDoes(doc.documentId, [remove]).ok).toBe(false);
    const unclaimed = s.t.services.requests.create(s.she, {
      target: { type: "document", documentId: doc.documentId },
      kind: "other",
      message: "x",
    } as never);
    for (const requestId of ["req_01J9Z8Y7X6W5V4T3S2R1Q0P9N8", unclaimed.id]) {
      const out = s.botDoes(doc.documentId, [remove], { requestId });
      expect(out).toMatchObject({ ok: false, kind: "protected" });
      if (!out.ok) expect(out.problems.at(-1)).toMatchObject({ path: "$.requestId" });
    }
    const other = s.otherBot;
    const theirs = s.claimedRequest(doc.documentId, other);
    const wrongKey = s.botDoes(doc.documentId, [remove], { requestId: theirs });
    expect(wrongKey).toMatchObject({ ok: false, kind: "protected" });
    if (!wrongKey.ok) expect(wrongKey.problems.at(-1)?.message).toMatch(/very API key/);

    // A request on one block does not cover the canvas.
    const blockRequest = s.t.services.requests.create(s.she, {
      target: { type: "block", documentId: doc.documentId, blockId: doc.blockIds[2] as string },
      kind: "other",
      message: "x",
    } as never);
    s.t.services.requests.claim(s.bot, blockRequest.id);
    expect(s.botDoes(doc.documentId, [remove], { requestId: blockRequest.id }).ok).toBe(false);

    // The valid one lifts it for every kind of protected item.
    const good = s.claimedRequest(doc.documentId);
    const out = s.ok(
      s.botDoes(
        doc.documentId,
        [
          remove,
          { op: "remove_card", id: a.herCard },
          { op: "update_card", id: a.edited, patch: { color: "red" } },
          { op: "remove_connector", id: a.herEdge },
          { op: "remove_frame", id: a.herFrame },
        ],
        { requestId: good },
      ),
    );
    expect(out.canvas.cards.some((c) => c.id === a.pinned || c.id === a.herCard)).toBe(false);
    expect(out.canvas.frames.some((f) => f.id === a.herFrame)).toBe(false);
    // And through set structure.
    const again = s.claimedRequest(doc.documentId);
    const wiped = s.ok(
      s.services.canvas.setStructure(s.bot, doc.documentId, {
        documentId: doc.documentId,
        cards: [],
        requestId: again,
      }),
    );
    expect(wiped.canvas.cards).toHaveLength(0);
  });

  it("her own placements, edits and removals are never refused", () => {
    const a = arena();
    const { s, doc } = a;
    expect(a.s.place(doc.documentId, [{ id: a.pinned, x: 400, y: 10 }])).toMatchObject({
      placed: [a.pinned],
    });
    expect(
      s.sheDoes(doc.documentId, [
        { op: "remove_card", id: a.herCard },
        { op: "remove_card", id: a.pinned },
      ]).ok,
    ).toBe(true);
  });
});

describe("canvas: placements, pins and revisions", () => {
  it("her drags pin cards with who placed them; the same placement again is a no-op", () => {
    const s = canvasSetup();
    const doc = s.makeDoc();
    const [a, b] = s.canvasOf(doc.documentId).cards;
    const first = s.place(doc.documentId, [
      { id: a?.id as string, x: 10, y: 20 },
      { id: b?.id as string, x: 300, y: 40 },
    ]);
    if ("ok" in first) throw new Error("refused");
    expect(first.placed).toHaveLength(2);
    expect(first.canvas.cards.find((c) => c.id === a?.id)?.position).toMatchObject({
      x: 10,
      y: 20,
      placedBy: { type: "user", userId: s.alice },
    });
    const revision = first.canvas.revision;
    const feedBefore = s.changes().length;
    const again = s.place(doc.documentId, [{ id: a?.id as string, x: 10, y: 20 }]);
    if ("ok" in again) throw new Error("refused");
    expect(again).toMatchObject({ changed: false, placed: [] });
    expect(again.canvas.revision).toBe(revision);
    expect(s.changes()).toHaveLength(feedBefore);
  });

  it("placements ignore a stale revision and skip cards that are gone instead of failing", () => {
    const s = canvasSetup();
    const doc = s.makeDoc();
    const [a, b] = s.canvasOf(doc.documentId).cards;
    // The agent moves the revision on twice while the browser still holds the first one.
    s.ok(s.botDoes(doc.documentId, [{ op: "add_card", card: { content: note("one") } }]));
    s.ok(s.botDoes(doc.documentId, [{ op: "remove_card", id: b?.id }]));
    const out = s.t.services.canvas.savePlacements(s.she, doc.documentId, {
      expectedRevision: 1,
      placements: [
        { id: a?.id, x: 5, y: 6 },
        { id: b?.id, x: 7, y: 8 },
      ],
    });
    if ("ok" in out) throw new Error("refused");
    expect(out.placed).toEqual([a?.id]);
    expect(out.ignored).toEqual([b?.id]);
    expect(out.canvas.cards.find((c) => c.id === a?.id)?.position).toMatchObject({ x: 5, y: 6 });
  });

  it("the last placement for a card in one batch wins, and sizes are pinned with it", () => {
    const s = canvasSetup();
    const doc = s.makeDoc();
    const a = s.canvasOf(doc.documentId).cards[0];
    const out = s.t.services.canvas.savePlacements(s.she, doc.documentId, {
      placements: [
        { id: a?.id, x: 1, y: 1 },
        { id: a?.id, x: 9, y: 9, width: 300, height: 200 },
      ],
    });
    if ("ok" in out) throw new Error("refused");
    expect(out.canvas.cards.find((c) => c.id === a?.id)).toMatchObject({
      position: { x: 9, y: 9 },
      dimensions: { width: 300, height: 200 },
    });
  });

  it("validates placements with a path and example; agents cannot place", () => {
    const s = canvasSetup();
    const doc = s.makeDoc();
    const bad = s.t.services.canvas.savePlacements(s.she, doc.documentId, {
      placements: [{ id: "x", x: "a" }],
    });
    expect("ok" in bad && bad.ok === false).toBe(true);
    if ("ok" in bad) {
      expect(bad.problems[0]?.path).toMatch(/^\$\.placements\[0\]/);
      expect(bad.problems[0]?.example).toBeDefined();
    }
    expect(
      thrownOf(() => s.t.services.canvas.savePlacements(s.bot, doc.documentId, { placements: [] }))
        .code,
    ).toBe("forbidden");
  });

  it("release pins frees positions and sizes; arrange clears the layout cache", () => {
    const s = canvasSetup();
    const doc = s.makeDoc();
    const [a, b] = s.canvasOf(doc.documentId).cards;
    s.place(doc.documentId, [
      { id: a?.id as string, x: 1, y: 2 },
      { id: b?.id as string, x: 3, y: 4 },
    ]);
    s.ok(s.sheDoes(doc.documentId, [{ op: "release_pins", ids: [a?.id] }]));
    const c = s.canvasOf(doc.documentId);
    expect(c.cards.find((x) => x.id === a?.id)?.position).toBeNull();
    expect(c.cards.find((x) => x.id === b?.id)?.position).not.toBeNull();

    s.services.canvas.saveLayoutCache(s.she, doc.documentId, "wide", {
      [a?.id as string]: { x: 5, y: 5 },
      [b?.id as string]: { x: 6, y: 6 },
    });
    // The pinned card is not cached; the free one is.
    expect(s.services.canvas.getLayoutCache(s.she, doc.documentId, "wide")).toEqual({
      [a?.id as string]: { x: 5, y: 5 },
    });
    const arranged = s.ok(s.services.canvas.arrange(s.she, doc.documentId, { releasePins: true }));
    expect(arranged.canvas.cards.every((x) => x.position === null && x.dimensions === null)).toBe(
      true,
    );
    expect(s.services.canvas.getLayoutCache(s.she, doc.documentId, "wide")).toBeNull();
    expect(thrownOf(() => s.services.canvas.arrange(s.bot, doc.documentId)).code).toBe("forbidden");
  });

  it("unpinned cards never have stored coordinates, whatever happens", () => {
    const s = canvasSetup();
    const doc = s.makeDoc();
    s.ok(s.services.canvas.setStructure(s.bot, doc.documentId, structureFor(s, doc)));
    const [a] = s.canvasOf(doc.documentId).cards;
    s.place(doc.documentId, [{ id: a?.id as string, x: 1, y: 1 }]);
    s.services.canvas.saveLayoutCache(s.she, doc.documentId, "tall", {});
    const raw = JSON.parse(
      (s.db.prepare("SELECT data FROM canvases").get() as { data: string }).data,
    );
    for (const card of raw.cards) {
      if (card.id === a?.id) expect(card.position).toBeTruthy();
      else expect(card.position).toBeNull();
    }
  });

  it("validates the layout cache", () => {
    const s = canvasSetup();
    const doc = s.makeDoc();
    expect(
      thrownOf(() =>
        s.services.canvas.saveLayoutCache(s.she, doc.documentId, "wide", { a: { x: "no" } }),
      ).code,
    ).toBe("invalid_input");
    expect(
      thrownOf(() => s.services.canvas.saveLayoutCache(s.she, doc.documentId, "wide", [])).code,
    ).toBe("invalid_input");
    expect(s.services.canvas.getLayoutCache(s.she, doc.documentId, "wide")).toBeNull();
    expect(
      thrownOf(() => s.services.canvas.getLayoutCache(s.bobUser, doc.documentId, "wide")).code,
    ).toBe("not_found");
  });
});

describe("canvas: the activity log and the change feed", () => {
  it("an agent's arranging is in the activity log in plain words, and every change is in the feed", () => {
    const s = canvasSetup();
    const doc = s.makeDoc(GUIDE, { title: "Beta blockers" });
    s.ok(s.services.canvas.setStructure(s.bot, doc.documentId, structureFor(s, doc)));
    s.ok(s.botDoes(doc.documentId, [{ op: "add_card", card: { content: note("x") } }]));
    const log = s.activity().map((e) => e.summary);
    expect(log).toContain("Arranged the study map for Beta blockers into 2 frames");
    expect(log.some((x) => /^Changed the study map for Beta blockers: added 1 card/.test(x))).toBe(
      true,
    );
    const entry = s.activity().find((e) => e.action === "canvas.structure_set");
    expect(entry?.links[0]).toMatchObject({ type: "document", id: doc.documentId });

    const [a] = s.canvasOf(doc.documentId).cards;
    s.place(doc.documentId, [{ id: a?.id as string, x: 3, y: 3 }]);
    const feed = s.changes().filter((e) => e.objectType === "canvas");
    expect(feed.map((e) => e.action)).toEqual([
      "canvas.structure_set",
      "canvas.changed",
      "canvas.placed",
    ]);
    expect(feed[0]).toMatchObject({
      documentId: doc.documentId,
      objectIds: [doc.documentId],
      revision: 2,
    });
    expect(feed[0]?.actor).toMatchObject({ type: "agent" });
    expect(feed[2]?.actor).toMatchObject({ type: "user" });
    // Her own placement is not agent activity; a refused or unchanged call leaves no trace.
    expect(s.activity().some((e) => e.action === "canvas.placed")).toBe(false);
    const count = s.changes().length;
    s.services.canvas.setStructure(s.bot, doc.documentId, {
      documentId: doc.documentId,
      cards: [{ content: { kind: "bad" } }],
    });
    expect(s.changes()).toHaveLength(count);
  });

  it("records the request an agent answered", () => {
    const s = canvasSetup();
    const doc = s.makeDoc();
    const [a] = s.canvasOf(doc.documentId).cards;
    s.place(doc.documentId, [{ id: a?.id as string, x: 3, y: 3 }]);
    const requestId = s.claimedRequest(doc.documentId);
    s.ok(s.botDoes(doc.documentId, [{ op: "remove_card", id: a?.id }], { requestId }));
    const last = s
      .changes()
      .filter((e) => e.objectType === "canvas")
      .at(-1);
    expect(last?.requestId).toBe(requestId);
    expect(s.activity()[0]?.links).toContainEqual({ type: "request", id: requestId });
  });
});

describe("canvas: the port for the MCP layer", () => {
  it("renders frames with card previews and connectors as 'A -[label]-> B', without coordinates", () => {
    const s = canvasSetup();
    const doc = s.makeDoc();
    s.ok(s.services.canvas.setStructure(s.bot, doc.documentId, structureFor(s, doc)));
    const [a] = s.canvasOf(doc.documentId).cards;
    s.place(doc.documentId, [{ id: a?.id as string, x: 3, y: 3 }]);
    const view = s.services.canvasPort.get(s.bot, doc.documentId);
    expect(view.frames.map((f) => f.title)).toEqual(["Mechanism", "Effects"]);
    expect(view.frames[0]?.cards[0]).toMatchObject({
      kind: "block",
      text: "They block beta receptors and lower heart rate.",
      pinned: true,
    });
    expect(view.connectors[0]?.text).toBe(
      "They block beta receptors and lower hea… -[lowers heart rate]-> Lower blood pressure and cardiac output.",
    );
    expect(JSON.stringify(view)).not.toMatch(/"x":|"position"|"width"/);
    const full = s.services.canvasPort.get(s.bot, doc.documentId, { include: "full" });
    expect(JSON.stringify(full.structure)).not.toMatch(/"position"/);
  });

  it("returns problems instead of throwing, and needs a document id", () => {
    const s = canvasSetup();
    const doc = s.makeDoc();
    const port = s.services.canvasPort;
    expect(port.setStructure(s.bot, { cards: [] })).toMatchObject({ ok: false, kind: "invalid" });
    const bad = port.change(s.bot, {
      documentId: doc.documentId,
      ops: [{ op: "add_card", card: { content: { kind: "note" } } }],
    });
    expect(bad.ok).toBe(false);
    if (!bad.ok)
      expect(bad.problems[0]).toMatchObject({
        path: expect.stringContaining("$.ops[0]"),
        example: expect.anything(),
      });
    const good = port.change(s.bot, {
      documentId: doc.documentId,
      ops: [{ op: "add_card", card: { content: note("hi") } }],
    });
    expect(good).toMatchObject({ ok: true, changed: true, revision: 2 });
    expect(
      thrownOf(() => port.change(s.bobUser, { documentId: doc.documentId, ops: [] })).code,
    ).toBe("not_found");
  });
});
