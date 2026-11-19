import { newId, normalizeName } from "@notes/schema";
import { beforeAll, describe, expect, it } from "vitest";
import {
  type Concepts,
  type Dataset,
  seedDataset,
  setupConcepts,
  thrown,
} from "./concepts-helpers.js";

/** One seeded database for the read-only tests below. */
let t: Concepts;
let d: Dataset;
beforeAll(() => {
  t = setupConcepts();
  d = seedDataset(t);
});

const names = (rows: Array<{ concept: { name: string } }>) => rows.map((r) => r.concept.name);

describe("the dataset", () => {
  it("has about forty concepts across two courses, and their relations", () => {
    expect(d.conceptCount).toBe(42);
    expect(d.relationCount).toBe(49);
    const quotes = new Set(
      t.service.page(t.she, d.id.verapamil as string).sources.map((s) => s.citation.quote),
    );
    expect(quotes).toEqual(new Set([d.pages.B.quote]));
    const metoprolol = t.service.page(t.she, d.id.metoprolol as string).sources;
    expect(metoprolol[0]?.citation.quote).toBe(d.pages.A.quote);
    // its interaction with verapamil is sourced from the second course
    expect(metoprolol.some((s) => s.citation.quote === d.pages.B.quote)).toBe(true);
  });
});

describe("search", () => {
  it("matches by prefix on names, aliases, generics and brands, best match first", () => {
    expect(t.service.search(t.she, "metop").map((c) => c.name)).toEqual(["metoprolol"]);
    // "Lopressor" is both a concept (exact name) and a brand of metoprolol
    expect(t.service.search(t.she, "lopressor").map((c) => c.name)).toEqual([
      "Lopressor",
      "metoprolol",
    ]);
    // a brand finds its generic
    expect(t.service.search(t.she, "toprol").map((c) => c.name)).toEqual(["metoprolol"]);
    expect(t.service.search(t.she, "Zith").map((c) => c.name)).toEqual(["azithromycin"]);
    // several words all have to match, each as a prefix
    expect(t.service.search(t.she, "beta block").map((c) => c.name)).toEqual(
      expect.arrayContaining([
        "beta blockers",
        "cardioselective beta blockers",
        "non-selective beta blockers",
      ]),
    );
    expect(t.service.search(t.she, "beta block")[0]?.name).toBe("beta blockers");
    expect(t.service.search(t.she, "QT")[0]?.name).toBe("QT prolongation");
  });

  it("filters by type, caps the count and survives odd input", () => {
    expect(
      t.service.search(t.she, "beta", { type: "drug_class" }).every((c) => c.type === "drug_class"),
    ).toBe(true);
    expect(t.service.search(t.she, "beta", { limit: 2 })).toHaveLength(2);
    expect(t.service.search(t.she, 'meto*"()-: OR x')).toEqual([]);
    expect(t.service.search(t.she, 'metop*"(')[0]?.name).toBe("metoprolol");
    expect(t.service.search(t.she, "   ")).toEqual([]);
    expect(t.service.search(t.she, "zzzz")).toEqual([]);
  });

  it("tracks edits to names, aliases and brands", () => {
    const local = setupConcepts();
    const c = local.service.createConcept(local.she, { type: "drug", name: "atenolol" }).concept;
    expect(local.service.search(local.she, "tenormin")).toEqual([]);
    local.service.updateConcept(local.she, c.id, {
      drug: { brandNames: ["Tenormin"] },
      aliases: ["ATN"],
    });
    expect(local.service.search(local.she, "tenor")[0]?.name).toBe("atenolol");
    expect(local.service.search(local.she, "atn")[0]?.name).toBe("atenolol");
    local.service.updateConcept(local.she, c.id, { drug: { brandNames: [] }, aliases: [] });
    expect(local.service.search(local.she, "tenor")).toEqual([]);
    local.service.deleteConcept(local.she, c.id);
    expect(local.service.search(local.she, "atenolol")).toEqual([]);
  });

  it("lists alphabetically with cursors and a type filter", () => {
    const first = t.service.list(t.she, { limit: 10 });
    expect(first.items).toHaveLength(10);
    expect(first.nextCursor).not.toBeNull();
    const all: string[] = [];
    let cursor: string | undefined;
    do {
      const page = t.service.list(t.she, { limit: 15, ...(cursor ? { cursor } : {}) });
      all.push(...page.items.map((c) => c.name));
      cursor = page.nextCursor ?? undefined;
    } while (cursor);
    expect(all).toHaveLength(42);
    expect(new Set(all).size).toBe(42);
    const keys = all.map(normalizeName);
    expect(keys).toEqual([...keys].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0)));
    expect(t.service.list(t.she, { type: "adverse_effect" }).items).toHaveLength(7);
    expect(
      t.service
        .list(t.she, { q: "hyper" })
        .items.map((c) => c.name)
        .sort(),
    ).toEqual(["hyperkalemia", "hypertension"]);
    expect(thrown(() => t.service.list(t.she, { cursor: "garbage" })).code).toBe("invalid_input");
  });
});

describe("the concept page (F2)", () => {
  it("groups relations by type in both directions, with the other end", () => {
    const page = t.service.page(t.she, d.id.metoprolol as string);
    expect(page.concept.name).toBe("metoprolol");
    const groups = page.groups.map(
      (g) => `${g.type}:${g.direction}:${g.items.map((i) => i.concept.name).join(",")}`,
    );
    expect(groups).toEqual([
      "belongs_to_class:out:cardioselective beta blockers",
      "acts_on:out:beta-1 adrenergic receptor",
      "treats:out:heart failure",
      "interacts_with:out:verapamil",
      "brand_of:in:Lopressor",
    ]);
    expect(page.groups.find((g) => g.type === "brand_of")?.label).toBe("has brand");
    expect(
      page.groups.find((g) => g.type === "interacts_with")?.items[0]?.relation.interaction,
    ).toEqual({
      severity: "major",
      effect: "additive bradycardia and AV block",
    });
    // a class sees its members coming in, and symmetric relations are listed once, from either end
    const klass = t.service.page(t.she, d.id["cardioselective beta blockers"] as string);
    const incoming = klass.groups.find(
      (g) => g.type === "belongs_to_class" && g.direction === "in",
    );
    expect(incoming?.items.map((i) => i.concept.name)).toEqual([
      "atenolol",
      "bisoprolol",
      "metoprolol",
    ]);
    expect(incoming?.label).toBe("includes");
    const verapamil = t.service.page(t.she, d.id.verapamil as string);
    expect(verapamil.groups.find((g) => g.type === "interacts_with")).toMatchObject({
      direction: "out",
    });
    expect(
      verapamil.groups.find((g) => g.type === "interacts_with" && g.direction === "in"),
    ).toBeUndefined();
    expect(verapamil.groups.find((g) => g.type === "interacts_with")?.items[0]?.concept.name).toBe(
      "metoprolol",
    );
  });

  it("lists sources with a sentence for each relation they support", () => {
    const page = t.service.page(t.she, d.id.verapamil as string);
    expect(page.sources[0]).toMatchObject({
      supports: { kind: "concept" },
      status: "available",
      fileName: "Cardiology therapeutics, lecture 3.pdf",
      pageIndex: 1,
    });
    const sentences = page.sources.flatMap((s) =>
      s.supports.kind === "relation" ? [s.supports.sentence] : [],
    );
    expect(sentences).toContain("verapamil can cause bradycardia");
    expect(sentences).toContain(
      "verapamil belongs to class non-dihydropyridine calcium channel blockers",
    );
    expect(sentences).toContain("metoprolol interacts with verapamil");
  });

  it("shows trashed and deleted sources instead of breaking (K6)", () => {
    const local = setupConcepts();
    const ds = seedDataset(local);
    local.sources.trash(ds.pages.A.fileId);
    expect(local.service.page(local.she, ds.id.metoprolol as string).sources[0]).toMatchObject({
      status: "source_trashed",
    });
    local.sources.purge(ds.pages.B.fileId);
    expect(local.service.page(local.she, ds.id.verapamil as string).sources[0]).toMatchObject({
      status: "source_deleted",
      fileName: null,
      pageIndex: null,
    });
  });

  it("gathers mentions in documents and links from questions, including through a merged ID", () => {
    const local = setupConcepts();
    const a = local.service.createConcept(local.she, { type: "drug", name: "atenolol" }).concept;
    const b = local.service.createConcept(local.she, {
      type: "drug",
      name: "atenolol tartrate",
    }).concept;
    const doc1 = newId("document");
    const doc2 = newId("document");
    local.mentions.add(local.alice, a.id, {
      documentId: doc1,
      title: "Beta blockers",
      preview: "…atenolol…",
    });
    local.mentions.add(local.alice, b.id, { documentId: doc2, title: "Lecture 7" });
    local.mentions.add(local.bob, a.id, { documentId: newId("document"), title: "Bob's" });
    const q1 = newId("question");
    local.questions.add(local.alice, a.id, { questionId: q1, stem: "Which is β1-selective?" });
    expect(local.service.page(local.she, a.id).mentions.map((m) => m.documentId)).toEqual([doc1]);
    local.service.merge(local.she, a.id, b.id);
    const page = local.service.page(local.she, a.id);
    expect(page.mentions.map((m) => m.documentId).sort()).toEqual([doc1, doc2].sort());
    expect(page.questions).toEqual([
      { questionId: q1, stem: "Which is β1-selective?", nodeId: null },
    ]);
    // through the old ID it is the same page
    expect(local.service.page(local.she, b.id).mentions).toHaveLength(2);
    // another user sees none of it
    expect(thrown(() => local.service.page(local.herBob, a.id)).code).toBe("not_found");
  });

  it("finds mentions in real documents through the default adapter", async () => {
    const { createDbConceptMentions } = await import("../src/domains/concepts/index.js");
    const { createDocumentsService } = await import("../src/domains/documents/index.js");
    const { createLibraryService } = await import("../src/domains/library/index.js");
    const local = setupConcepts();
    const library = createLibraryService(local.db);
    const docs = createDocumentsService(local.deps, { library });
    const term = library.create(local.alice, { parentId: null, kind: "term", name: "Fall" });
    const course = library.create(local.alice, {
      parentId: term.id,
      kind: "course",
      name: "Pharm",
    });
    const sec = library
      .list(local.alice, { parentId: course.id })
      .items.find((n) => n.section === "study_guides");
    const drug = local.service.createConcept(local.she, { type: "drug", name: "atenolol" }).concept;
    const made = docs.createDocument(local.she, {
      parentId: sec?.id,
      kind: "study_guide",
      title: "Beta blockers",
      blocks: [
        {
          type: "paragraph",
          content: { text: [{ text: "Compare " }, { concept: drug.id, text: "atenolol" }] },
        },
        { type: "paragraph", content: { text: "No mention here." } },
      ],
    } as never);
    const found = createDbConceptMentions(local.db).mentions(local.alice, [drug.id]);
    expect(found).toHaveLength(1);
    expect(found[0]).toMatchObject({
      documentId: made.documentId,
      title: "Beta blockers",
      trashed: false,
    });
    expect(found[0]?.preview).toContain("Compare atenolol");
    expect(createDbConceptMentions(local.db).mentions(local.bob, [drug.id])).toEqual([]);
  });
});

describe("neighborhood (F3)", () => {
  it("returns the concepts and edges within one hop", () => {
    const g = t.service.neighbourhood(t.she, d.id.metoprolol as string, { hops: 1 });
    expect(g.center).toBe(d.id.metoprolol);
    expect(g.nodes.map((n) => n.name).sort()).toEqual(
      [
        "Lopressor",
        "beta-1 adrenergic receptor",
        "cardioselective beta blockers",
        "heart failure",
        "metoprolol",
        "verapamil",
      ].sort(),
    );
    expect(g.edges).toHaveLength(5);
    expect(g.truncated).toBe(false);
    for (const e of g.edges) {
      expect(g.nodes.some((n) => n.id === e.from)).toBe(true);
      expect(g.nodes.some((n) => n.id === e.to)).toBe(true);
    }
  });

  it("goes further with more hops and includes edges between the nodes it found", () => {
    const g1 = t.service.neighbourhood(t.she, d.id.metoprolol as string, { hops: 1 });
    const g2 = t.service.neighbourhood(t.she, d.id.metoprolol as string, { hops: 2 });
    expect(g2.nodes.length).toBeGreaterThan(g1.nodes.length);
    expect(g2.nodes.map((n) => n.name)).toEqual(
      expect.arrayContaining(["beta blockers", "bradycardia", "hypertension"]),
    );
    expect(g2.edges.length).toBeGreaterThan(g1.edges.length);
    // beta blockers -> bradycardia <- verapamil is drawn although it is two hops out
    expect(g2.edges.some((e) => e.from === d.id.verapamil && e.to === d.id.bradycardia)).toBe(true);
  });

  it("filters by relation type", () => {
    const only = t.service.neighbourhood(t.she, d.id.metoprolol as string, {
      hops: 3,
      relationTypes: ["belongs_to_class"],
    });
    expect(only.nodes.map((n) => n.name).sort()).toEqual(
      [
        "atenolol",
        "beta blockers",
        "bisoprolol",
        "cardioselective beta blockers",
        "metoprolol",
        "non-selective beta blockers",
      ].sort(),
    );
    expect(only.edges.every((e) => e.type === "belongs_to_class")).toBe(true);
    const two = t.service.neighbourhood(t.she, d.id.metoprolol as string, {
      hops: 2,
      relationTypes: ["belongs_to_class"],
    });
    expect(two.nodes).toHaveLength(5);
  });

  it("is capped, and says when it cut something off", () => {
    const g = t.service.neighbourhood(t.she, d.id.metoprolol as string, { hops: 4, maxNodes: 5 });
    expect(g.nodes).toHaveLength(5);
    expect(g.truncated).toBe(true);
    expect(g.nodes[0]?.id).toBe(d.id.metoprolol);
    // deterministic: asking again gives the same nodes
    expect(
      t.service.neighbourhood(t.she, d.id.metoprolol as string, { hops: 4, maxNodes: 5 }).nodes,
    ).toEqual(g.nodes);
    // the hard limits are enforced as errors that teach
    expect(
      thrown(() => t.service.neighbourhood(t.she, d.id.metoprolol as string, { hops: 9 })).code,
    ).toBe("invalid_input");
    expect(
      thrown(() => t.service.neighbourhood(t.she, d.id.metoprolol as string, { maxNodes: 5000 }))
        .code,
    ).toBe("invalid_input");
    const everything = t.service.neighbourhood(t.she, d.id.metoprolol as string, {
      hops: 4,
      maxNodes: 200,
    });
    expect(everything.truncated).toBe(false);
    // the isolated "counselling point" is reached only through its relation
    expect(everything.nodes.map((n) => n.name)).toContain("do not stop beta blockers abruptly");
  });

  it("works from a leaf and from a merged ID, and defaults sensibly", () => {
    const leaf = t.service.neighbourhood(t.she, d.id["serum potassium"] as string, {});
    expect(leaf.hops).toBe(1);
    expect(leaf.nodes.map((n) => n.name).sort()).toEqual(["ACE inhibitors", "serum potassium"]);
    expect(thrown(() => t.service.neighbourhood(t.she, newId("concept"), {})).code).toBe(
      "not_found",
    );
  });

  it("is served over HTTP with query parameters", async () => {
    const res = await t.call(
      t.asKey(t.readBot),
      "GET",
      `/api/concepts/${d.id.metoprolol}/graph?hops=2&maxNodes=8&relationTypes=belongs_to_class,treats`,
    );
    expect(res.status).toBe(200);
    expect(res.body.nodes.length).toBeLessThanOrEqual(8);
    expect(
      res.body.edges.every((e: { type: string }) =>
        ["belongs_to_class", "treats"].includes(e.type),
      ),
    ).toBe(true);
    const bad = await t.call(
      t.asKey(t.readBot),
      "GET",
      `/api/concepts/${d.id.metoprolol}/graph?relationTypes=likes`,
    );
    expect(bad.status).toBe(400);
  });
});

describe("path", () => {
  it("finds the shortest way between two concepts, with directions", () => {
    const p = t.service.path(t.she, d.id.metoprolol as string, d.id["QT prolongation"] as string);
    expect(p.found).toBe(true);
    expect(p.steps.map((s) => `${s.from.name} ${s.direction} ${s.to.name}`)).toEqual([
      "metoprolol forward cardioselective beta blockers",
      "cardioselective beta blockers forward beta blockers",
      "beta blockers backward non-selective beta blockers",
      "non-selective beta blockers backward sotalol",
      "sotalol forward QT prolongation",
    ]);
    expect(p.steps.map((s) => s.relation.type)).toEqual([
      "belongs_to_class",
      "belongs_to_class",
      "belongs_to_class",
      "belongs_to_class",
      "causes_adverse_effect",
    ]);
  });

  it("takes the one-step path when there is one, and none for the same concept", () => {
    const direct = t.service.path(t.she, d.id.azithromycin as string, d.id.ondansetron as string);
    expect(direct.steps).toHaveLength(1);
    expect(direct.steps[0]?.relation.type).toBe("interacts_with");
    const same = t.service.path(t.she, d.id.metoprolol as string, d.id.metoprolol as string);
    expect(same).toMatchObject({ found: true, steps: [] });
  });

  it("respects the hop limit and the relation-type filter", () => {
    expect(
      t.service.path(t.she, d.id.metoprolol as string, d.id["QT prolongation"] as string, {
        maxHops: 4,
      }).found,
    ).toBe(false);
    expect(
      t.service.path(t.she, d.id.metoprolol as string, d.id["QT prolongation"] as string, {
        maxHops: 5,
      }).found,
    ).toBe(true);
    expect(
      t.service.path(t.she, d.id.metoprolol as string, d.id["QT prolongation"] as string, {
        relationTypes: ["belongs_to_class"],
      }).found,
    ).toBe(false);
    // two concepts with nothing between them
    const local = setupConcepts();
    const a = local.service.createConcept(local.she, { type: "drug", name: "a" }).concept;
    const b = local.service.createConcept(local.she, { type: "drug", name: "b" }).concept;
    expect(local.service.path(local.she, a.id, b.id)).toMatchObject({ found: false, steps: [] });
  });

  it("works over HTTP", async () => {
    const res = await t.call(
      t.asKey(t.readBot),
      "GET",
      `/api/concepts/path?from=${d.id.azithromycin}&to=${d.id.ondansetron}`,
    );
    expect(res.status).toBe(200);
    expect(res.body.found).toBe(true);
    expect((await t.call(t.asKey(t.readBot), "GET", "/api/concepts/path?from=x&to=y")).status).toBe(
      404,
    );
  });
});

describe("filter queries (F5)", () => {
  const query = (filter: unknown) => t.service.filter(t.she, filter);

  it("every drug that prolongs QT, directly or through its class, across both courses", () => {
    const result = query({
      kind: "with_relation",
      relation: "causes_adverse_effect",
      target: { type: "adverse_effect", name: "QT prolongation" },
      types: ["drug"],
    });
    expect(names(result.items)).toEqual([
      "azithromycin",
      "clarithromycin",
      "ondansetron",
      "sotalol",
    ]);
    const byName = Object.fromEntries(result.items.map((r) => [r.concept.name, r]));
    expect(byName.sotalol?.via).toEqual({ kind: "direct" });
    expect(byName.ondansetron?.via).toEqual({ kind: "direct" });
    expect(byName.azithromycin?.via).toMatchObject({
      kind: "class",
      class: { name: "macrolide antibiotics" },
    });
    // the evidence is cited: the class's relation plus the belongs-to-class link
    expect(byName.azithromycin?.relationIds).toHaveLength(2);
    expect(byName.azithromycin?.citations.map((c) => c.quote)).toEqual([d.pages.B.quote]);
    expect(byName.sotalol?.relationIds).toEqual([
      d.rel["causes_adverse_effect|sotalol|QT prolongation"],
    ]);
    expect(byName.sotalol?.generalKnowledge).toBe(false);
    // without the class step, only the direct ones
    expect(
      names(
        query({
          kind: "with_relation",
          relation: "causes_adverse_effect",
          target: { type: "adverse_effect", name: "QT prolongation" },
          viaClass: false,
        }).items,
      ),
    ).toEqual(["macrolide antibiotics", "ondansetron", "sotalol"]);
    // and with classes included but not filtered, the class itself is a row
    expect(
      names(
        query({
          kind: "with_relation",
          relation: "causes_adverse_effect",
          target: { type: "adverse_effect", name: "QT prolongation" },
        }).items,
      ),
    ).toEqual([
      "azithromycin",
      "clarithromycin",
      "macrolide antibiotics",
      "ondansetron",
      "sotalol",
    ]);
  });

  it("bradycardia reaches beta blockers down two levels and verapamil from the other course", () => {
    const result = query({
      kind: "with_relation",
      relation: "causes_adverse_effect",
      target: { id: d.id.bradycardia },
      types: ["drug"],
    });
    expect(names(result.items)).toEqual([
      "atenolol",
      "bisoprolol",
      "carvedilol",
      "metoprolol",
      "propranolol",
      "sotalol",
      "verapamil",
    ]);
    const metoprolol = result.items.find((r) => r.concept.name === "metoprolol");
    expect(metoprolol?.via).toMatchObject({ kind: "class", class: { name: "beta blockers" } });
    // belongs to cardioselective, which belongs to beta blockers, which causes it: three relations
    expect(metoprolol?.relationIds).toHaveLength(3);
    const quotes = new Set(result.items.flatMap((r) => r.citations.map((c) => c.quote)));
    expect(quotes).toEqual(new Set([d.pages.A.quote, d.pages.B.quote]));
    expect(result.items.find((r) => r.concept.name === "verapamil")?.citations[0]?.quote).toBe(
      d.pages.B.quote,
    );
  });

  it("works for ACE inhibitors, and for a leaf with nothing", () => {
    expect(
      names(
        query({
          kind: "with_relation",
          relation: "causes_adverse_effect",
          target: { type: "adverse_effect", name: "dry cough" },
          types: ["drug"],
        }).items,
      ),
    ).toEqual(["enalapril", "lisinopril", "ramipril"]);
    expect(
      query({
        kind: "with_relation",
        relation: "causes_adverse_effect",
        target: { type: "adverse_effect", name: "dry cough" },
        types: ["drug"],
      }).items[0]?.via,
    ).toMatchObject({ kind: "class", class: { name: "ACE inhibitors" } });
    expect(
      query({
        kind: "with_relation",
        relation: "treats",
        target: { type: "indication", name: "migraine prophylaxis" },
      }).items.map((r) => r.concept.name),
    ).toEqual(["propranolol"]);
  });

  it("reads the other way: what a drug causes, including through its classes", () => {
    const result = query({
      kind: "with_relation",
      relation: "causes_adverse_effect",
      target: { id: d.id.metoprolol },
      side: "to",
    });
    expect(names(result.items)).toEqual(["bradycardia"]);
    expect(result.items[0]?.via).toMatchObject({ kind: "class", class: { name: "beta blockers" } });
    const propranolol = query({
      kind: "with_relation",
      relation: "causes_adverse_effect",
      target: { type: "drug", name: "propranolol" },
      side: "to",
    });
    expect(names(propranolol.items)).toEqual(["bradycardia", "bronchospasm"]);
    const sotalol = query({
      kind: "with_relation",
      relation: "causes_adverse_effect",
      target: { type: "drug", name: "sotalol" },
      side: "to",
    });
    expect(sotalol.items.find((r) => r.concept.name === "QT prolongation")?.via).toEqual({
      kind: "direct",
    });
    expect(names(sotalol.items)).toEqual(["bradycardia", "bronchospasm", "QT prolongation"]);
  });

  it("treats a symmetric relation as readable from both ends", () => {
    const result = query({
      kind: "with_relation",
      relation: "interacts_with",
      target: { type: "drug", name: "verapamil" },
      viaClass: false,
    });
    expect(names(result.items)).toEqual(["metoprolol"]);
    expect(
      names(
        query({
          kind: "with_relation",
          relation: "interacts_with",
          target: { type: "drug", name: "metoprolol" },
          viaClass: false,
        }).items,
      ),
    ).toEqual(["verapamil"]);
  });

  it("lists the drugs in a class, with subclasses by default", () => {
    const all = query({ kind: "in_class", class: { type: "drug_class", name: "beta blockers" } });
    expect(names(all.items)).toEqual([
      "atenolol",
      "bisoprolol",
      "carvedilol",
      "metoprolol",
      "propranolol",
      "sotalol",
    ]);
    expect(all.items.find((r) => r.concept.name === "atenolol")?.via).toMatchObject({
      kind: "class",
      class: { name: "cardioselective beta blockers" },
    });
    expect(
      query({
        kind: "in_class",
        class: { type: "drug_class", name: "beta blockers" },
        includeSubclasses: false,
      }).items,
    ).toEqual([]);
    const sub = query({
      kind: "in_class",
      class: { id: d.id["cardioselective beta blockers"] },
      includeSubclasses: false,
    });
    expect(names(sub.items)).toEqual(["atenolol", "bisoprolol", "metoprolol"]);
    expect(sub.items[0]?.via).toEqual({ kind: "direct" });
    expect(sub.items[0]?.citations[0]?.quote).toBe(d.pages.A.quote);
    expect(
      names(
        query({ kind: "in_class", class: { type: "drug_class", name: "ACE inhibitors" } }).items,
      ),
    ).toEqual(["enalapril", "lisinopril", "ramipril"]);
  });

  it("finds drugs that share a mechanism, directly or through a class", () => {
    const result = query({ kind: "sharing_mechanism", drug: { type: "drug", name: "metoprolol" } });
    expect(names(result.items)).toEqual(["atenolol", "bisoprolol"]);
    expect(result.items[0]?.sharedMechanisms?.map((m) => m.name)).toEqual([
      "beta-1 receptor antagonism",
    ]);
    expect(result.items[0]?.via).toMatchObject({
      kind: "class",
      class: { name: "cardioselective beta blockers" },
    });
    const ace = query({ kind: "sharing_mechanism", drug: { type: "drug", name: "ramipril" } });
    expect(names(ace.items)).toEqual(["enalapril", "lisinopril"]);
    // a drug with no mechanism recorded shares none
    expect(
      query({ kind: "sharing_mechanism", drug: { type: "drug", name: "ondansetron" } }).items,
    ).toEqual([]);
  });

  it("caps results and reports truncation", () => {
    const result = query({
      kind: "in_class",
      class: { type: "drug_class", name: "beta blockers" },
      limit: 2,
    });
    expect(result.items).toHaveLength(2);
    expect(result.truncated).toBe(true);
  });

  it("explains a bad filter or an unknown concept, with an example", () => {
    const bad = thrown(() => query({ kind: "everything" }));
    expect(bad.code).toBe("invalid_input");
    expect(bad.example).toBeDefined();
    const unknown = thrown(() =>
      query({ kind: "in_class", class: { type: "drug_class", name: "nonsense" } }),
    );
    expect(unknown).toMatchObject({
      code: "not_found",
      message: expect.stringContaining('"nonsense"'),
    });
  });

  it("is available over HTTP to a read-only key", async () => {
    const res = await t.call(t.asKey(t.readBot), "POST", "/api/concepts/query", {
      kind: "with_relation",
      relation: "causes_adverse_effect",
      target: { type: "adverse_effect", name: "QT prolongation" },
      types: ["drug"],
    });
    expect(res.status).toBe(200);
    expect(res.body.items.map((r: { concept: { name: string } }) => r.concept.name)).toEqual([
      "azithromycin",
      "clarithromycin",
      "ondansetron",
      "sotalol",
    ]);
    expect(
      (await t.call(t.asKey(t.readBot), "POST", "/api/concepts/query", { kind: "x" })).status,
    ).toBe(400);
  });
});

describe("comparison table (D5)", () => {
  const compare = (input: unknown) => t.service.compare(t.she, input);

  it("builds rows and cells with citations", () => {
    const table = compare({
      conceptIds: [d.id.metoprolol, d.id.atenolol, d.id.verapamil],
      attributes: ["belongs_to_class", "causes_adverse_effect", "brand_names", "interacts_with"],
    });
    expect(table.columns).toEqual([
      { attribute: "belongs_to_class", label: "Class" },
      { attribute: "causes_adverse_effect", label: "Adverse effects" },
      { attribute: "brand_names", label: "Brand names" },
      { attribute: "interacts_with", label: "Interactions" },
    ]);
    expect(table.rows.map((r) => r.concept.name)).toEqual(["metoprolol", "atenolol", "verapamil"]);
    const cell = (row: number, col: number) => table.rows[row]?.cells[col];
    expect(cell(0, 0)?.values.map((v) => v.text)).toEqual(["cardioselective beta blockers"]);
    expect(cell(0, 0)?.values[0]?.relationId).toBe(
      d.rel["belongs_to_class|metoprolol|cardioselective beta blockers"],
    );
    expect(cell(0, 0)?.citations[0]?.quote).toBe(d.pages.A.quote);
    // her own brand list, plus the brand concept that points at it, once each
    expect(cell(0, 2)?.values.map((v) => v.text)).toEqual(["Lopressor", "Toprol-XL"]);
    expect(cell(1, 2)?.values.map((v) => v.text)).toEqual(["Tenormin"]);
    // interactions read from either end, with severity and effect
    expect(cell(0, 3)?.values.map((v) => v.text)).toEqual([
      "verapamil (major: additive bradycardia and AV block)",
    ]);
    expect(cell(2, 3)?.values.map((v) => v.text)).toEqual([
      "metoprolol (major: additive bradycardia and AV block)",
    ]);
    // verapamil's own adverse effects are cited from the other course
    expect(cell(2, 1)?.values.map((v) => v.text)).toEqual(["bradycardia", "hypotension"]);
    expect(cell(2, 1)?.citations.map((c) => c.quote)).toEqual([d.pages.B.quote]);
    // a drug with nothing recorded gets an empty cell, not a missing one
    expect(cell(0, 1)?.values).toEqual([]);
    expect(table.rows.every((r) => r.cells.length === 4)).toBe(true);
  });

  it("can fill from the class, marked as inherited", () => {
    const table = compare({
      conceptIds: [d.id.metoprolol, d.id.propranolol],
      attributes: ["causes_adverse_effect", "monitored_by"],
      includeClass: true,
    });
    const meto = table.rows[0]?.cells[0]?.values;
    expect(meto?.map((v) => v.text)).toEqual(["bradycardia"]);
    expect(meto?.[0]?.inheritedFrom?.name).toBe("beta blockers");
    expect(meto?.[0]?.citations[0]?.quote).toBe(d.pages.A.quote);
    const prop = table.rows[1]?.cells[0]?.values;
    expect(prop?.map((v) => `${v.text} from ${v.inheritedFrom?.name}`)).toEqual([
      "bradycardia from beta blockers",
      "bronchospasm from non-selective beta blockers",
    ]);
    expect(table.rows[0]?.cells[1]?.values.map((v) => v.text)).toEqual(["heart rate"]);
    // without it nothing is inherited
    const plain = compare({
      conceptIds: [d.id.metoprolol, d.id.propranolol],
      attributes: ["causes_adverse_effect"],
    });
    expect(plain.rows[0]?.cells[0]?.values).toEqual([]);
  });

  it("refuses too few drugs, unknown attributes and unknown concepts with an example", () => {
    expect(
      thrown(() => compare({ conceptIds: [d.id.metoprolol], attributes: ["treats"] })).code,
    ).toBe("invalid_input");
    const bad = thrown(() =>
      compare({ conceptIds: [d.id.metoprolol, d.id.atenolol], attributes: ["colour"] }),
    );
    expect(bad.code).toBe("invalid_input");
    expect(bad.example).toBeDefined();
    expect(
      thrown(() =>
        compare({ conceptIds: [d.id.metoprolol, newId("concept")], attributes: ["treats"] }),
      ).code,
    ).toBe("not_found");
  });

  it("is available over HTTP", async () => {
    const res = await t.call(t.asKey(t.readBot), "POST", "/api/concepts/compare", {
      conceptIds: [d.id.lisinopril, d.id.enalapril],
      attributes: ["brand_names"],
    });
    expect(res.status).toBe(200);
    expect(res.body.rows[0].cells[0].values.map((v: { text: string }) => v.text)).toEqual([
      "Zestril",
      "Prinivil",
    ]);
  });
});

describe("brand and generic pairs (G12)", () => {
  it("lists every brand with its generic and class, each pair once", () => {
    const pairs = t.service.brandGenericPairs(t.she);
    expect(pairs).toHaveLength(13);
    const key = (p: { generic: string; brand: string }) => `${p.generic}/${p.brand}`;
    expect(pairs.map(key)).toEqual([
      "atenolol/Tenormin",
      "azithromycin/Zithromax",
      "bisoprolol/Zebeta",
      "carvedilol/Coreg",
      "enalapril/Vasotec",
      "lisinopril/Prinivil",
      "lisinopril/Zestril",
      "metoprolol/Lopressor",
      "metoprolol/Toprol-XL",
      "ondansetron/Zofran",
      "propranolol/Inderal",
      "ramipril/Altace",
      "verapamil/Calan",
    ]);
    const meto = pairs.find((p) => p.brand === "Lopressor");
    expect(meto).toMatchObject({
      conceptId: d.id.metoprolol,
      drugClass: "cardioselective beta blockers",
    });
    expect(pairs.find((p) => p.generic === "ondansetron")?.drugClass).toBeNull();
    expect(pairs.find((p) => p.generic === "verapamil")?.citations[0]?.quote).toBe(d.pages.B.quote);
  });

  it("restricts to a class and its subclasses, and honors the limit", () => {
    const pairs = t.service.brandGenericPairs(t.she, { classId: d.id["beta blockers"] as string });
    expect(pairs.map((p) => p.generic)).toEqual([
      "atenolol",
      "bisoprolol",
      "carvedilol",
      "metoprolol",
      "metoprolol",
      "propranolol",
    ]);
    expect(t.service.brandGenericPairs(t.she, { limit: 3 })).toHaveLength(3);
  });

  it("uses a brand_of relation and a generic name when there is one", () => {
    const local = setupConcepts();
    const generic = local.service.createConcept(local.she, {
      type: "drug",
      name: "metoprolol succinate",
      drug: { genericName: "metoprolol" },
    }).concept;
    const brand = local.service.createConcept(local.she, {
      type: "drug",
      name: "Toprol-XL",
    }).concept;
    local.service.createRelation(local.she, {
      from: { id: brand.id },
      to: { id: generic.id },
      type: "brand_of",
    });
    expect(
      local.service.brandGenericPairs(local.she).map((p) => `${p.generic}/${p.brand}`),
    ).toEqual(["metoprolol/Toprol-XL"]);
    expect(local.service.brandGenericPairs(local.herBob)).toEqual([]);
  });

  it("is served over HTTP", async () => {
    const res = await t.call(
      t.asKey(t.readBot),
      "GET",
      `/api/concepts/brand-generic?classId=${d.id["ACE inhibitors"]}`,
    );
    expect(res.status).toBe(200);
    expect(res.body.items.map((p: { brand: string }) => p.brand)).toEqual([
      "Vasotec",
      "Prinivil",
      "Zestril",
      "Altace",
    ]);
  });
});
