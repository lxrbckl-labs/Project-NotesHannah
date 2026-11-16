import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  answerDone,
  attempt,
  isFinished,
  itemsFor,
  missedItems,
  pickRound,
  ROUND_SIZE,
  score,
  seededRng,
  startRound,
} from "../model/drill";
import { distances, filterGraph, neighbours, radialLayout } from "../model/graph";
import { relationSections } from "../model/relations";
import { createMockConceptsStore } from "../store/mock";
import { brandPairs, KEY } from "../store/seed";

const id = (key: string) => KEY[key] as string;

describe("relation sections", () => {
  it("groups both directions under readable titles, outgoing first", async () => {
    const store = createMockConceptsStore();
    const page = await store.page(id("lisinopril"));
    const titles = relationSections(page.groups).map((s) => s.title);
    expect(titles).toEqual(["Belongs to class", "Interactions"]);

    const cls = await store.page(id("acei"));
    const sections = relationSections(cls.groups);
    expect(sections.map((s) => s.title)).toEqual([
      "Mechanism",
      "Treats",
      "Adverse effects",
      "Interactions",
      "Contraindicated in",
      "Monitoring",
      "Members of this class",
    ]);
    expect(sections.find((s) => s.title === "Members of this class")?.group.items).toHaveLength(3);
  });

  it("drops empty groups", () => {
    expect(
      relationSections([{ type: "treats", direction: "out", label: "treats", items: [] }]),
    ).toEqual([]);
  });

  it("lists a symmetric interaction once, from either end", async () => {
    const store = createMockConceptsStore();
    const a = await store.page(id("propranolol"));
    const b = await store.page(id("verapamil"));
    const names = (p: typeof a) =>
      p.groups.find((g) => g.type === "interacts_with")?.items.map((i) => i.concept.name) ?? [];
    expect(names(a)).toContain("Verapamil HCl");
    expect(names(b)).toContain("Propranolol");
    expect(b.groups.filter((g) => g.type === "interacts_with")).toHaveLength(1);
  });
});

describe("graph helpers", () => {
  it("keeps only reachable concepts when a relation type is hidden", async () => {
    const store = createMockConceptsStore();
    const graph = await store.graph(id("bb"), { hops: 2 });
    const noClass = filterGraph(graph, new Set(["causes_adverse_effect", "treats"]));
    expect(noClass.edges.every((e) => ["causes_adverse_effect", "treats"].includes(e.type))).toBe(
      true,
    );
    expect(noClass.nodes.map((n) => n.id)).toContain(id("brady"));
    expect(noClass.nodes.map((n) => n.id)).not.toContain(id("bb1"));
    expect(filterGraph(graph, null)).toEqual(graph);
  });

  it("measures hops and places the centre at the origin on distinct rings", async () => {
    const store = createMockConceptsStore();
    const graph = await store.graph(id("bb"), { hops: 2 });
    const dist = distances(graph);
    expect(dist.get(id("bb"))).toBe(0);
    expect(dist.get(id("bb1"))).toBe(1);
    expect(dist.get(id("metoprolol"))).toBe(2);
    const placed = radialLayout(graph);
    expect(placed.find((p) => p.id === id("bb"))).toMatchObject({ x: 0, y: 0 });
    const radius = (p: { x: number; y: number }) => Math.hypot(p.x, p.y);
    const ring1 = placed.filter((p) => p.hop === 1).map(radius);
    const ring2 = placed.filter((p) => p.hop === 2).map(radius);
    expect(Math.min(...ring2)).toBeGreaterThan(Math.max(...ring1));
  });

  it("caps the neighbourhood at maxNodes and says so", async () => {
    const store = createMockConceptsStore();
    const graph = await store.graph(id("bb"), { hops: 2, maxNodes: 5 });
    expect(graph.nodes).toHaveLength(5);
    expect(graph.truncated).toBe(true);
  });

  it("groups direct neighbours by relation for the list view", async () => {
    const store = createMockConceptsStore();
    const graph = await store.graph(id("bb"), { hops: 1 });
    const groups = neighbours(graph);
    expect(
      groups.find((g) => g.type === "causes_adverse_effect")?.items.map((i) => i.name),
    ).toContain("Bradycardia");
  });
});

describe("brand and generic drill", () => {
  const pairs = brandPairs();

  it("builds one question per prompt for each mode", () => {
    const b2g = itemsFor(pairs, "brand_to_generic");
    expect(b2g.find((i) => i.prompt === "Lopressor")?.answer).toBe("Metoprolol");
    expect(itemsFor(pairs, "generic_to_brand").find((i) => i.prompt === "Atenolol")?.answer).toBe(
      "Tenormin",
    );
    expect(itemsFor(pairs, "drug_to_class").find((i) => i.prompt === "Losartan")?.answer).toBe(
      "Angiotensin II receptor blockers",
    );
  });

  it("picks a short round with distinct answers, the same every time for a seed", () => {
    const items = itemsFor(pairs, "brand_to_generic");
    const a = pickRound(items, ROUND_SIZE, seededRng(7));
    const b = pickRound(items, ROUND_SIZE, seededRng(7));
    expect(a.map((i) => i.id)).toEqual(b.map((i) => i.id));
    expect(a).toHaveLength(ROUND_SIZE);
    expect(new Set(a.map((i) => i.answer)).size).toBe(ROUND_SIZE);
  });

  it("scores first-try matches, tracks misses and offers only the missed ones again", () => {
    const items = pickRound(itemsFor(pairs, "brand_to_generic"), 3, seededRng(1));
    let round = startRound(items, seededRng(1));
    const [first, second, third] = items as [
      (typeof items)[0],
      (typeof items)[0],
      (typeof items)[0],
    ];

    const wrong = attempt(round, first.id, second.answer);
    expect(wrong.correct).toBe(false);
    round = wrong.round;
    expect(round.matched).toEqual([]);
    expect(round.missed).toEqual([first.id]);

    for (const item of [first, second, third]) {
      const r = attempt(round, item.id, item.answer);
      expect(r.correct).toBe(true);
      round = r.round;
    }
    expect(isFinished(round)).toBe(true);
    expect(score(round)).toEqual({ firstTry: 2, total: 3 });
    expect(missedItems(round).map((i) => i.id)).toEqual([first.id]);
    expect(answerDone(round, first.answer)).toBe(true);
    // matching again changes nothing
    expect(attempt(round, first.id, first.answer).round).toBe(round);
  });

  it("lets a class tile serve several drugs in drug-to-class mode", () => {
    const items = itemsFor(pairs, "drug_to_class")
      .filter((i) => i.answer === "Beta blockers" || i.answer === "Cardioselective beta blockers")
      .slice(0, 3);
    const round = startRound(items, seededRng(2));
    const first = items[0];
    if (!first) throw new Error("seed has no drugs");
    const once = attempt(round, first.id, first.answer).round;
    const sameAnswer = items.filter((i) => i.answer === first.answer);
    expect(answerDone(once, first.answer)).toBe(sameAnswer.length === 1);
  });
});

describe("token colours", () => {
  const css = readFileSync(resolve(process.cwd(), "src/features/concepts/concepts.css"), "utf8");
  const block = (start: string) => {
    const from = css.indexOf(start);
    return css.slice(from, css.indexOf("}", from));
  };
  const luminance = (hex: string) => {
    const n = Number.parseInt(hex.slice(1), 16);
    const [r, g, b] = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => {
      const c = v / 255;
      return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
    }) as [number, number, number];
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  };
  const ratio = (a: string, b: string) => {
    const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
    return (hi + 0.05) / (lo + 0.05);
  };

  for (const [theme, start] of [
    ["light", ":root {"],
    ["dark", ':root[data-theme="dark"] {'],
  ] as const) {
    it(`every tone passes AA in ${theme}`, () => {
      const text = block(start);
      const tones = ["green", "blue", "violet", "teal", "red", "amber", "grey"];
      for (const tone of tones) {
        const bg = text.match(new RegExp(`--cx-${tone}-bg:\\s*(#[0-9a-f]{6})`))?.[1];
        const fg = text.match(new RegExp(`--cx-${tone}-fg:\\s*(#[0-9a-f]{6})`))?.[1];
        expect(bg && fg, `${tone} defined`).toBeTruthy();
        expect(ratio(fg as string, bg as string), `${tone} ${theme}`).toBeGreaterThanOrEqual(4.5);
      }
    });
  }
});
