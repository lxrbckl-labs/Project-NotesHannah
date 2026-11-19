import {
  CONCEPT_TYPES,
  type ConceptType,
  newId,
  RELATION_RULES,
  RELATION_TYPES,
  validateRelation,
} from "@notes/schema";
import { describe, expect, it } from "vitest";
import { type Concepts, seedDataset, setupConcepts, thrown } from "./concepts-helpers.js";

function cited(t: Concepts, name: string, extra: Record<string, unknown> = {}) {
  const p = t.page(t.alice, `Quote about ${name}.`);
  return {
    type: "drug" as const,
    name,
    citations: [{ fileId: p.fileId, pageId: p.pageId, quote: p.quote }],
    ...extra,
  };
}

describe("creating and editing a concept", () => {
  it("creates a drug with provenance, normalized aliases and an unchecked name", () => {
    const t = setupConcepts();
    const { concept, suggestions } = t.service.createConcept(
      t.bot,
      cited(t, "metoprolol", {
        aliases: ["Metoprolol  tartrate", "metoprolol", "METOPROLOL TARTRATE"],
        drug: { brandNames: ["Lopressor", "lopressor", "Toprol-XL"], rxcui: "6918" },
        summary: "Cardioselective beta blocker.",
      }),
    );
    expect(concept).toMatchObject({
      type: "drug",
      name: "metoprolol",
      aliases: ["Metoprolol  tartrate"],
      drug: {
        genericName: null,
        brandNames: ["Lopressor", "Toprol-XL"],
        rxcui: "6918",
        nameCheck: { status: "unchecked" },
      },
      summary: [{ text: "Cardioselective beta blocker." }],
      generalKnowledge: false,
      reviewStatus: "unverified",
      origin: "agent",
      provenance: { createdBy: t.bot.actor, lastEditedBy: t.bot.actor },
    });
    expect(concept.id).toMatch(/^con_/);
    expect(suggestions).toEqual([]);
    expect(t.service.getConcept(t.she, concept.id).concept).toEqual(concept);
  });

  it("holds an agent to the citation rule and exempts her", () => {
    const t = setupConcepts();
    const refused = thrown(() =>
      t.service.createConcept(t.bot, { type: "drug", name: "atenolol" }),
    );
    expect(refused).toMatchObject({ code: "invalid_input" });
    expect(refused.message).toMatch(/no citation/);
    expect((refused.example as { type: string }).type).toBe("drug");
    expect(
      t.service.createConcept(t.bot, { type: "drug", name: "atenolol", generalKnowledge: true })
        .concept.generalKnowledge,
    ).toBe(true);
    const hers = t.service.createConcept(t.she, { type: "drug", name: "propranolol" }).concept;
    expect(hers).toMatchObject({ origin: "user", reviewStatus: "reviewed" });
  });

  it("refuses a citation to a page that does not exist or a quote not on it", () => {
    const t = setupConcepts();
    const p = t.page(t.alice, "Real passage.");
    t.sources.purge(p.fileId);
    const gone = thrown(() =>
      t.service.createConcept(t.bot, {
        type: "drug",
        name: "x1",
        citations: [{ fileId: p.fileId, pageId: p.pageId, quote: "Real passage." }],
      }),
    );
    expect(gone.message).toMatch(/does not exist/);
    const q = t.page(t.alice, "Real passage.");
    const wrong = thrown(() =>
      t.service.createConcept(t.bot, {
        type: "drug",
        name: "x2",
        citations: [{ fileId: q.fileId, pageId: q.pageId, quote: "Invented passage." }],
      }),
    );
    expect(wrong.message).toMatch(/not in the current transcript/);
    // a page of another user's is "unknown" to this lookup, so cannot be validated, but the fake knows Bob's page
    const bobs = t.page(t.bob, "Bob's passage.");
    t.sources.trash(bobs.fileId);
    expect(() =>
      t.service.createConcept(t.bot, {
        type: "drug",
        name: "x3",
        citations: [{ fileId: q.fileId, pageId: q.pageId, quote: "Real passage." }],
      }),
    ).not.toThrow();
  });

  it("will not create the same concept twice, and says which one exists", () => {
    const t = setupConcepts();
    const first = t.service.createConcept(t.bot, cited(t, "Metoprolol")).concept;
    const clash = thrown(() => t.service.createConcept(t.bot, cited(t, " metoprolol ")));
    expect(clash.code).toBe("conflict");
    expect(clash.hint).toContain(first.id);
    // but the same name as another type is a different concept
    expect(() =>
      t.service.createConcept(t.bot, { ...cited(t, "metoprolol"), type: "other" }),
    ).not.toThrow();
  });

  it("rejects drug details on a non-drug, bad types and unknown fields, with examples", () => {
    const t = setupConcepts();
    for (const body of [
      { type: "mechanism", name: "m", drug: { brandNames: ["x"] }, generalKnowledge: true },
      { type: "vitamin", name: "v", generalKnowledge: true },
      { type: "drug", name: "d", id: newId("concept"), generalKnowledge: true },
    ]) {
      const error = thrown(() => t.service.createConcept(t.bot, body));
      expect(error.code).toBe("invalid_input");
      expect(error.example).toBeDefined();
    }
  });

  it("lets an agent change its own unreviewed concept and keeps it unverified", () => {
    const t = setupConcepts();
    const { concept } = t.service.createConcept(t.bot, cited(t, "atenolol"));
    const edited = t.service.updateConcept(t.otherBot, concept.id, {
      aliases: ["Tenormin"],
      summary: "New summary.",
      drug: { genericName: "atenolol", brandNames: ["Tenormin"] },
    });
    expect(edited).toMatchObject({
      aliases: ["Tenormin"],
      summary: [{ text: "New summary." }],
      origin: "agent",
      reviewStatus: "unverified",
      drug: { genericName: "atenolol", brandNames: ["Tenormin"] },
    });
    expect(edited.provenance.lastEditedBy).toEqual(t.otherBot.actor);
    expect(edited.provenance.createdBy).toEqual(t.bot.actor);
  });

  it("protects what she wrote or reviewed from agents, and makes her edits hers", () => {
    const t = setupConcepts();
    const { concept } = t.service.createConcept(t.bot, cited(t, "atenolol"));
    t.service.setReview(t.she, "concept", concept.id, "reviewed");
    const refused = thrown(() =>
      t.service.updateConcept(t.bot, concept.id, { summary: "Overwrite" }),
    );
    expect(refused.code).toBe("forbidden");
    expect(refused.hint).toMatch(/bulk/);
    // Reviewing changed only the review status.
    expect(t.service.getConcept(t.she, concept.id).concept).toMatchObject({
      origin: "agent",
      reviewStatus: "reviewed",
      provenance: { lastEditedBy: t.bot.actor },
    });
    const hers = t.service.updateConcept(t.she, concept.id, { summary: "My words." });
    expect(hers).toMatchObject({ origin: "user", reviewStatus: "reviewed" });
    expect(thrown(() => t.service.updateConcept(t.bot, concept.id, { summary: "No" })).code).toBe(
      "forbidden",
    );
    // and an agent edit of an unreviewed concept she has not touched flips nothing
    const other = t.service.createConcept(t.bot, cited(t, "bisoprolol")).concept;
    expect(t.service.updateConcept(t.bot, other.id, { summary: "ok" }).reviewStatus).toBe(
      "unverified",
    );
  });

  it("only she can review or delete, and deleting takes the relations with it", () => {
    const t = setupConcepts();
    const d = seedDataset(t);
    const id = d.id.metoprolol as string;
    expect(thrown(() => t.service.setReview(t.bot, "concept", id, "reviewed")).code).toBe(
      "forbidden",
    );
    expect(thrown(() => t.service.deleteConcept(t.bot, id)).code).toBe("forbidden");
    const before = t.service.listRelations(t.she, { from: id }).length;
    expect(before).toBeGreaterThan(2);
    t.service.deleteConcept(t.she, id);
    expect(thrown(() => t.service.getConcept(t.she, id)).code).toBe("not_found");
    expect(
      (
        t.db
          .prepare("SELECT COUNT(*) AS n FROM concept_relations WHERE from_id = ? OR to_id = ?")
          .get(id, id) as { n: number }
      ).n,
    ).toBe(0);
    // the other concepts are untouched
    expect(t.service.getConcept(t.she, d.id["beta blockers"] as string).concept.name).toBe(
      "beta blockers",
    );
    expect(t.service.getConcept(t.she, d.id.Lopressor as string)).toBeDefined();
  });

  it("refuses a rename onto another concept's name and points to merge", () => {
    const t = setupConcepts();
    const a = t.service.createConcept(t.bot, cited(t, "atenolol")).concept;
    const b = t.service.createConcept(t.bot, cited(t, "atenol")).concept;
    const error = thrown(() => t.service.updateConcept(t.bot, b.id, { name: "Atenolol" }));
    expect(error.code).toBe("conflict");
    expect(error.hint).toContain(a.id);
    expect(t.service.updateConcept(t.bot, b.id, { name: "atenolol XR" }).name).toBe("atenolol XR");
  });
});

describe("relations", () => {
  function pair(t: Concepts) {
    const drug = t.service.createConcept(t.bot, cited(t, "metoprolol")).concept;
    const effect = t.service.createConcept(
      t.bot,
      cited(t, "bradycardia", { type: "adverse_effect" }),
    ).concept;
    return { drug, effect };
  }

  it("creates, reads, lists and updates a relation", () => {
    const t = setupConcepts();
    const { drug, effect } = pair(t);
    const rel = t.service.createRelation(t.bot, {
      from: { id: drug.id },
      to: { type: "adverse_effect", name: "bradycardia" },
      type: "causes_adverse_effect",
      note: "Dose related.",
      generalKnowledge: true,
    });
    expect(rel).toMatchObject({
      from: drug.id,
      to: effect.id,
      note: "Dose related.",
      origin: "agent",
    });
    expect(t.service.getRelation(t.she, rel.id)).toEqual(rel);
    expect(t.service.listRelations(t.she, { from: drug.id })).toHaveLength(1);
    expect(t.service.listRelations(t.she, { to: effect.id, type: "treats" })).toHaveLength(0);
    const changed = t.service.updateRelation(t.bot, rel.id, { note: "Mostly with IV doses." });
    expect(changed.note).toBe("Mostly with IV doses.");
    // a duplicate is a conflict naming the existing one
    const dup = thrown(() =>
      t.service.createRelation(t.bot, {
        from: { id: drug.id },
        to: { id: effect.id },
        type: "causes_adverse_effect",
        generalKnowledge: true,
      }),
    );
    expect(dup.code).toBe("conflict");
    expect(dup.hint).toContain(rel.id);
  });

  it("allows exactly the relation-type and concept-type combinations in the table", () => {
    const t = setupConcepts();
    // two concepts of each type, so a type can also be related to its own kind
    const first = new Map<ConceptType, string>();
    const second = new Map<ConceptType, string>();
    for (const type of CONCEPT_TYPES) {
      first.set(type, t.service.createConcept(t.she, { type, name: `first ${type}` }).concept.id);
      second.set(type, t.service.createConcept(t.she, { type, name: `second ${type}` }).concept.id);
    }
    let allowed = 0;
    let refused = 0;
    for (const type of RELATION_TYPES) {
      for (const fromType of CONCEPT_TYPES) {
        for (const toType of CONCEPT_TYPES) {
          const verdict = validateRelation(type, fromType, toType);
          const attempt = () =>
            t.service.createRelation(t.she, {
              from: { id: first.get(fromType) as string },
              to: { id: (fromType === toType ? second : first).get(toType) as string },
              type,
            });
          if (verdict.ok) {
            const rel = attempt();
            expect(rel.type).toBe(type);
            t.service.deleteRelation(t.she, rel.id);
            allowed++;
          } else {
            const error = thrown(attempt);
            expect(error.code, `${type}: ${fromType} -> ${toType}`).toBe("invalid_input");
            expect(error.message).toContain(`"${type}" links`);
            expect(error.example).toMatchObject({ type });
            refused++;
          }
        }
      }
    }
    expect(allowed + refused).toBe(RELATION_TYPES.length * CONCEPT_TYPES.length ** 2);
    expect(allowed).toBeGreaterThan(20);
    expect(refused).toBeGreaterThan(900);
    // the table and the service agree on what the symmetric types are
    expect(RELATION_TYPES.filter((r) => RELATION_RULES[r].symmetric)).toEqual([
      "interacts_with",
      "related_to",
    ]);
  });

  it("stores a symmetric relation once whichever way it is said", () => {
    const t = setupConcepts();
    const a = t.service.createConcept(t.bot, cited(t, "metoprolol")).concept;
    const b = t.service.createConcept(t.bot, cited(t, "verapamil")).concept;
    t.service.createRelation(t.bot, {
      from: { id: a.id },
      to: { id: b.id },
      type: "interacts_with",
      interaction: { severity: "major", effect: "bradycardia" },
      generalKnowledge: true,
    });
    const again = thrown(() =>
      t.service.createRelation(t.bot, {
        from: { id: b.id },
        to: { id: a.id },
        type: "interacts_with",
        generalKnowledge: true,
      }),
    );
    expect(again.code).toBe("conflict");
  });

  it("explains a wrong pairing with the rule, a hint and an example", () => {
    const t = setupConcepts();
    const { drug, effect } = pair(t);
    const error = thrown(() =>
      t.service.createRelation(t.bot, {
        from: { id: effect.id },
        to: { id: drug.id },
        type: "causes_adverse_effect",
        generalKnowledge: true,
      }),
    );
    expect(error.code).toBe("invalid_input");
    expect(error.message).toContain("links a drug or a drug class to an adverse effect");
    expect(error.hint).toMatch(/swapped/);
    expect(error.example).toMatchObject({
      type: "causes_adverse_effect",
      from: { type: "drug" },
      to: { type: "adverse_effect" },
    });
  });

  it("asks for a citation, a missing concept, and refuses loops and stray interaction details", () => {
    const t = setupConcepts();
    const { drug, effect } = pair(t);
    expect(
      thrown(() =>
        t.service.createRelation(t.bot, {
          from: { id: drug.id },
          to: { id: effect.id },
          type: "causes_adverse_effect",
        }),
      ).message,
    ).toMatch(/no citation/);
    const missing = thrown(() =>
      t.service.createRelation(t.bot, {
        from: { id: drug.id },
        to: { type: "adverse_effect", name: "nausea" },
        type: "causes_adverse_effect",
        generalKnowledge: true,
      }),
    );
    expect(missing.code).toBe("not_found");
    expect(missing.message).toMatch(/does not exist yet/);
    expect(
      thrown(() =>
        t.service.createRelation(t.bot, {
          from: { id: drug.id },
          to: { id: drug.id },
          type: "related_to",
          generalKnowledge: true,
        }),
      ).message,
    ).toMatch(/itself/);
    expect(
      thrown(() =>
        t.service.createRelation(t.bot, {
          from: { id: drug.id },
          to: { id: effect.id },
          type: "causes_adverse_effect",
          interaction: { severity: "major", effect: "x" },
          generalKnowledge: true,
        }),
      ).message,
    ).toMatch(/only belong on an "interacts_with"/);
  });

  it("protects her relations and reviews, deletes only by her", () => {
    const t = setupConcepts();
    const { drug, effect } = pair(t);
    const rel = t.service.createRelation(t.she, {
      from: { id: drug.id },
      to: { id: effect.id },
      type: "causes_adverse_effect",
    });
    expect(rel).toMatchObject({ origin: "user", reviewStatus: "reviewed" });
    expect(thrown(() => t.service.updateRelation(t.bot, rel.id, { note: "x" })).code).toBe(
      "forbidden",
    );
    expect(thrown(() => t.service.deleteRelation(t.bot, rel.id)).code).toBe("forbidden");
    t.service.deleteRelation(t.she, rel.id);
    expect(thrown(() => t.service.getRelation(t.she, rel.id)).code).toBe("not_found");
  });
});

describe("bulk upsert", () => {
  it("creates, updates and skips, reporting each", () => {
    const t = setupConcepts();
    const first = t.service.bulkUpsert(t.bot, {
      concepts: [
        {
          type: "drug",
          name: "metoprolol",
          drug: { brandNames: ["Lopressor"] },
          generalKnowledge: true,
        },
        { type: "adverse_effect", name: "bradycardia", generalKnowledge: true },
      ],
      relations: [
        {
          from: { type: "drug", name: "metoprolol" },
          to: { type: "adverse_effect", name: "bradycardia" },
          type: "causes_adverse_effect",
          generalKnowledge: true,
        },
      ],
    });
    expect(first).toMatchObject({
      applied: true,
      created: 3,
      updated: 0,
      skipped: 0,
      problems: [],
    });
    expect(first.concepts.map((c) => c.action)).toEqual(["created", "created"]);

    const p = t.page(t.alice, "New passage about metoprolol.");
    const second = t.service.bulkUpsert(t.otherBot, {
      concepts: [
        // same name in other case and spacing: an update, not a new concept
        {
          type: "drug",
          name: " Metoprolol ",
          aliases: ["Toprol"],
          drug: { brandNames: ["Lopressor", "Toprol-XL"] },
          citations: [{ fileId: p.fileId, pageId: p.pageId, quote: p.quote }],
        },
        { type: "adverse_effect", name: "bradycardia", generalKnowledge: true },
        { type: "adverse_effect", name: "fatigue", generalKnowledge: true },
      ],
      relations: [
        {
          from: { type: "drug", name: "metoprolol" },
          to: { type: "adverse_effect", name: "bradycardia" },
          type: "causes_adverse_effect",
          generalKnowledge: true,
        },
      ],
    });
    expect(second).toMatchObject({ applied: true, created: 1, updated: 1, skipped: 2 });
    expect(second.concepts.map((c) => c.action)).toEqual(["updated", "unchanged", "created"]);
    expect(second.relations.map((r) => r.action)).toEqual(["unchanged"]);
    expect(second.concepts[0]?.id).toBe(first.concepts[0]?.id);
    const merged = t.service.getConcept(t.she, first.concepts[0]?.id as string).concept;
    expect(merged.aliases).toEqual(["Toprol"]);
    expect(merged.drug?.brandNames).toEqual(["Lopressor", "Toprol-XL"]);
    expect(merged.citations).toHaveLength(1);
    expect(merged.generalKnowledge).toBe(false);
    // same call again changes nothing
    const third = t.service.bulkUpsert(t.otherBot, {
      concepts: [{ type: "drug", name: "metoprolol", aliases: ["Toprol"] }],
    });
    expect(third).toMatchObject({ created: 0, updated: 0, skipped: 1 });
  });

  it("is atomic by default: one problem means nothing is written, with path, message and example", () => {
    const t = setupConcepts();
    const result = t.service.bulkUpsert(t.bot, {
      concepts: [
        { type: "drug", name: "metoprolol", generalKnowledge: true },
        { type: "drug", name: "atenolol" },
        { type: "banana", name: "x", generalKnowledge: true },
      ],
      relations: [
        {
          from: { type: "drug", name: "metoprolol" },
          to: { type: "drug", name: "nowhere" },
          type: "interacts_with",
          generalKnowledge: true,
        },
        {
          from: { type: "drug", name: "metoprolol" },
          to: { type: "drug", name: "metoprolol" },
          type: "related_to",
          generalKnowledge: true,
        },
      ],
    });
    expect(result).toMatchObject({ applied: false, created: 0, updated: 0, skipped: 0 });
    expect(result.concepts.map((c) => c.action)).toEqual(["not_applied", "rejected", "rejected"]);
    expect(result.relations.map((r) => r.action)).toEqual(["rejected", "rejected"]);
    const paths = result.problems.map((p) => p.path);
    expect(paths).toContain("$.concepts[1].citations");
    expect(paths).toContain("$.concepts[2].type");
    expect(paths).toContain("$.relations[0].to");
    expect(paths).toContain("$.relations[1].to");
    for (const problem of result.problems) {
      expect(problem.message.length).toBeGreaterThan(10);
      expect(problem.example).toBeDefined();
    }
    expect(result.problems.find((p) => p.path === "$.relations[0].to")?.message).toMatch(
      /does not exist, and this call does not create it/,
    );
    expect((t.db.prepare("SELECT COUNT(*) AS n FROM concepts").get() as { n: number }).n).toBe(0);
  });

  it("with partial: true writes what is fine and reports the rest", () => {
    const t = setupConcepts();
    const result = t.service.bulkUpsert(t.bot, {
      partial: true,
      concepts: [
        { type: "drug", name: "metoprolol", generalKnowledge: true },
        { type: "drug", name: "atenolol" },
        { type: "adverse_effect", name: "bradycardia", generalKnowledge: true },
      ],
      relations: [
        {
          from: { type: "drug", name: "metoprolol" },
          to: { type: "adverse_effect", name: "bradycardia" },
          type: "causes_adverse_effect",
          generalKnowledge: true,
        },
        // atenolol was rejected, so this relation cannot be made
        {
          from: { type: "drug", name: "atenolol" },
          to: { type: "adverse_effect", name: "bradycardia" },
          type: "causes_adverse_effect",
          generalKnowledge: true,
        },
        // wrong types
        {
          from: { type: "adverse_effect", name: "bradycardia" },
          to: { type: "drug", name: "metoprolol" },
          type: "causes_adverse_effect",
          generalKnowledge: true,
        },
      ],
    });
    expect(result).toMatchObject({
      applied: true,
      partial: true,
      created: 3,
      updated: 0,
      skipped: 3,
    });
    expect(result.concepts.map((c) => c.action)).toEqual(["created", "rejected", "created"]);
    expect(result.relations.map((r) => r.action)).toEqual(["created", "rejected", "rejected"]);
    expect(result.problems).toHaveLength(3);
    expect(result.problems.at(-1)?.message).toMatch(/swapped/);
    expect((t.db.prepare("SELECT COUNT(*) AS n FROM concepts").get() as { n: number }).n).toBe(2);
  });

  it("checks a relation against the table using concepts made in the same call", () => {
    const t = setupConcepts();
    const result = t.service.bulkUpsert(t.bot, {
      concepts: [
        { type: "mechanism", name: "m", generalKnowledge: true },
        { type: "drug", name: "d", generalKnowledge: true },
      ],
      relations: [
        {
          from: { type: "mechanism", name: "m" },
          to: { type: "drug", name: "d" },
          type: "causes_adverse_effect",
          generalKnowledge: true,
        },
      ],
    });
    expect(result.applied).toBe(false);
    expect(result.problems[0]?.path).toBe("$.relations[0].type");
    expect(result.problems[0]?.message).toMatch(
      /links a drug or a drug class to an adverse effect/,
    );
  });

  it("refuses badly shaped bodies with an example", () => {
    const t = setupConcepts();
    const error = thrown(() => t.service.bulkUpsert(t.bot, { concepts: "nope" }));
    expect(error.code).toBe("invalid_input");
    expect(error.example).toBeDefined();
    expect(
      thrown(() => t.service.bulkUpsert(t.bot, { concepts: new Array(201).fill({}) })).code,
    ).toBe("invalid_input");
  });

  it("leaves what she wrote or reviewed alone, adding only", () => {
    const t = setupConcepts();
    const hers = t.service.createConcept(t.she, {
      type: "drug",
      name: "metoprolol",
      summary: "My own summary.",
      drug: { genericName: "metoprolol", brandNames: ["Lopressor"] },
    }).concept;
    const p = t.page(t.alice, "A passage.");
    const result = t.service.bulkUpsert(t.bot, {
      concepts: [
        {
          type: "drug",
          name: "metoprolol",
          summary: "Agent summary.",
          aliases: ["metoprolol tartrate"],
          drug: { genericName: "metoprolol tartrate", brandNames: ["Toprol-XL"] },
          citations: [{ fileId: p.fileId, pageId: p.pageId, quote: p.quote }],
        },
      ],
    });
    expect(result.concepts[0]).toMatchObject({
      action: "updated",
      protectedFields: ["drug.genericName", "summary"],
    });
    const after = t.service.getConcept(t.she, hers.id).concept;
    expect(after.summary).toEqual([{ text: "My own summary." }]);
    expect(after.drug?.genericName).toBe("metoprolol");
    expect(after.aliases).toEqual(["metoprolol tartrate"]);
    expect(after.drug?.brandNames).toEqual(["Lopressor", "Toprol-XL"]);
    expect(after.citations).toHaveLength(1);
    // still hers and reviewed: additive changes do not flip review
    expect(after).toMatchObject({ origin: "user", reviewStatus: "reviewed" });
  });

  it("overwrites an unreviewed agent concept's summary", () => {
    const t = setupConcepts();
    t.service.bulkUpsert(t.bot, {
      concepts: [{ type: "drug", name: "metoprolol", summary: "First.", generalKnowledge: true }],
    });
    const result = t.service.bulkUpsert(t.otherBot, {
      concepts: [{ type: "drug", name: "metoprolol", summary: "Second." }],
    });
    expect(result.concepts[0]).toMatchObject({ action: "updated", protectedFields: [] });
    const listed = t.service.search(t.she, "metoprolol");
    expect(t.service.getConcept(t.she, listed[0]?.id as string).concept.summary).toEqual([
      { text: "Second." },
    ]);
  });

  it("holds the whole batch to the source check", () => {
    const t = setupConcepts();
    const p = t.page(t.alice, "Real.");
    const result = t.service.bulkUpsert(t.bot, {
      concepts: [
        {
          type: "drug",
          name: "x",
          citations: [{ fileId: p.fileId, pageId: p.pageId, quote: "Not on the page." }],
        },
      ],
    });
    expect(result.applied).toBe(false);
    expect(result.problems[0]?.path).toBe("$.concepts[0].citations[0].quote");
  });

  it("works over HTTP: success, atomic refusal as an error, partial, and read-only keys", async () => {
    const t = setupConcepts();
    const body = { concepts: [{ type: "drug", name: "metoprolol", generalKnowledge: true }] };
    const ok = await t.call(t.asKey(t.bot), "POST", "/api/concepts/bulk", body);
    expect(ok.status).toBe(200);
    expect(ok.body).toMatchObject({ applied: true, created: 1 });
    const bad = await t.call(t.asKey(t.bot), "POST", "/api/concepts/bulk", {
      concepts: [{ type: "drug", name: "atenolol" }],
    });
    expect(bad.status).toBe(400);
    expect(bad.body.error.message).toMatch(/Nothing was written/);
    expect(bad.body.error.hint).toMatch(/partial/);
    const part = await t.call(t.asKey(t.bot), "POST", "/api/concepts/bulk", {
      partial: true,
      concepts: [
        { type: "drug", name: "atenolol" },
        { type: "drug", name: "bisoprolol", generalKnowledge: true },
      ],
    });
    expect(part.status).toBe(200);
    expect(part.body).toMatchObject({ created: 1, skipped: 1 });
    const read = await t.call(t.asKey(t.readBot), "POST", "/api/concepts/bulk", body);
    expect(read.status).toBe(403);
    expect(read.body.error.code).toBe("read_only_key");
  });
});

describe("de-duplication", () => {
  it("suggests look-alikes and never merges them by itself", () => {
    const t = setupConcepts();
    t.service.bulkUpsert(t.bot, {
      concepts: [
        { type: "drug", name: "metoprolol", generalKnowledge: true },
        { type: "drug", name: "atenolol", generalKnowledge: true },
      ],
    });
    const result = t.service.bulkUpsert(t.otherBot, {
      concepts: [
        { type: "drug", name: "metoprolol tartrate", generalKnowledge: true },
        { type: "drug", name: "atenolal", generalKnowledge: true },
        { type: "drug", name: "propranolol", generalKnowledge: true },
      ],
    });
    // all three were created: nothing was matched or merged
    expect(result.concepts.map((c) => c.action)).toEqual(["created", "created", "created"]);
    expect(result.concepts[0]?.suggestions).toEqual([
      expect.objectContaining({ name: "metoprolol", reason: "salt_variant" }),
    ]);
    expect(result.concepts[1]?.suggestions).toEqual([
      expect.objectContaining({ name: "atenolol", reason: "close_spelling" }),
    ]);
    expect(result.concepts[2]?.suggestions).toEqual([]);
    expect((t.db.prepare("SELECT COUNT(*) AS n FROM concepts").get() as { n: number }).n).toBe(5);
  });

  it("suggests an alias match and shows suggestions on the concept page and the single create", () => {
    const t = setupConcepts();
    const first = t.service.createConcept(t.bot, {
      type: "drug",
      name: "metoprolol",
      aliases: ["Lopressor"],
      generalKnowledge: true,
    }).concept;
    const second = t.service.createConcept(t.bot, {
      type: "drug",
      name: "Lopressor",
      generalKnowledge: true,
    });
    expect(second.suggestions[0]).toMatchObject({ conceptId: first.id, reason: "alias_match" });
    expect(t.service.page(t.she, second.concept.id).suggestions[0]).toMatchObject({
      conceptId: first.id,
    });
    expect(t.service.suggestionsFor(t.she, first.id)[0]).toMatchObject({
      conceptId: second.concept.id,
    });
  });
});

describe("merge", () => {
  it("keeps aliases, brand names, citations and relations, and redirects the old ID", () => {
    const t = setupConcepts();
    const pa = t.page(t.alice, "From the first course.");
    const pb = t.page(t.alice, "From the second course.");
    const keep = t.service.createConcept(t.bot, {
      type: "drug",
      name: "metoprolol",
      aliases: ["Beta-1 blocker"],
      drug: { brandNames: ["Lopressor"] },
      citations: [{ fileId: pa.fileId, pageId: pa.pageId, quote: pa.quote }],
    }).concept;
    const gone = t.service.createConcept(t.bot, {
      type: "drug",
      name: "metoprolol tartrate",
      aliases: ["MT"],
      drug: { brandNames: ["Toprol-XL"], rxcui: "203191", genericName: "metoprolol tartrate" },
      summary: "Tartrate salt.",
      citations: [
        { fileId: pb.fileId, pageId: pb.pageId, quote: pb.quote },
        { fileId: pa.fileId, pageId: pa.pageId, quote: pa.quote },
      ],
    }).concept;
    const effect = t.service.createConcept(t.bot, {
      type: "adverse_effect",
      name: "bradycardia",
      generalKnowledge: true,
    }).concept;
    const klass = t.service.createConcept(t.bot, {
      type: "drug_class",
      name: "beta blockers",
      generalKnowledge: true,
    }).concept;
    // relations on the old concept: one new, one both have, one that would become a loop
    const onlyGone = t.service.createRelation(t.bot, {
      from: { id: gone.id },
      to: { id: klass.id },
      type: "belongs_to_class",
      generalKnowledge: true,
    });
    t.service.createRelation(t.bot, {
      from: { id: keep.id },
      to: { id: effect.id },
      type: "causes_adverse_effect",
      generalKnowledge: true,
    });
    const dupOfGone = t.service.createRelation(t.bot, {
      from: { id: gone.id },
      to: { id: effect.id },
      type: "causes_adverse_effect",
      citations: [{ fileId: pb.fileId, pageId: pb.pageId, quote: pb.quote }],
    });
    const loop = t.service.createRelation(t.bot, {
      from: { id: keep.id },
      to: { id: gone.id },
      type: "related_to",
      generalKnowledge: true,
    });

    const result = t.service.merge(t.bot, keep.id, gone.id);
    expect(result).toMatchObject({ mergedId: gone.id, relationsMoved: 1, relationsDropped: 2 });
    expect(result.concept).toMatchObject({
      id: keep.id,
      aliases: ["Beta-1 blocker", "metoprolol tartrate", "MT"],
      drug: {
        brandNames: ["Lopressor", "Toprol-XL"],
        rxcui: "203191",
        genericName: "metoprolol tartrate",
      },
      summary: [{ text: "Tartrate salt." }],
    });
    expect(result.concept.citations).toHaveLength(2);
    // the old ID leads to the survivor
    const via = t.service.getConcept(t.she, gone.id);
    expect(via.redirectedFrom).toBe(gone.id);
    expect(via.concept.id).toBe(keep.id);
    // relations: moved one points at the survivor; the duplicate's citation was kept; the loop is gone
    expect(t.service.getRelation(t.she, onlyGone.id)).toMatchObject({
      from: keep.id,
      to: klass.id,
    });
    expect(thrown(() => t.service.getRelation(t.she, loop.id)).code).toBe("not_found");
    expect(thrown(() => t.service.getRelation(t.she, dupOfGone.id)).code).toBe("not_found");
    const effectRels = t.service.listRelations(t.she, {
      from: keep.id,
      type: "causes_adverse_effect",
    });
    expect(effectRels).toHaveLength(1);
    expect(effectRels[0]?.citations).toHaveLength(1);
    expect(effectRels[0]?.generalKnowledge).toBe(false);
    // searching finds the survivor under the old name
    expect(t.service.search(t.she, "tartrate")[0]?.id).toBe(keep.id);
    expect(t.service.search(t.she, "toprol")[0]?.id).toBe(keep.id);
  });

  it("keeps redirects working through a second merge", () => {
    const t = setupConcepts();
    const [a, b, c] = ["alpha drug", "beta drug", "gamma drug"].map(
      (name) =>
        t.service.createConcept(t.bot, { type: "drug", name, generalKnowledge: true }).concept,
    ) as unknown as [{ id: string }, { id: string }, { id: string }];
    t.service.merge(t.bot, b.id, c.id);
    t.service.merge(t.bot, a.id, b.id);
    expect(t.service.getConcept(t.she, c.id).concept.id).toBe(a.id);
    expect(t.service.getConcept(t.she, b.id).concept.id).toBe(a.id);
    // asking for relations or pages through an old ID works too
    expect(t.service.page(t.she, c.id)).toMatchObject({
      redirectedFrom: c.id,
      concept: { id: a.id },
    });
  });

  it("refuses sensible nonsense with advice", () => {
    const t = setupConcepts();
    const a = t.service.createConcept(t.bot, {
      type: "drug",
      name: "a1",
      generalKnowledge: true,
    }).concept;
    const m = t.service.createConcept(t.bot, {
      type: "mechanism",
      name: "m1",
      generalKnowledge: true,
    }).concept;
    expect(thrown(() => t.service.merge(t.bot, a.id, a.id)).message).toMatch(
      /same concept already/,
    );
    const types = thrown(() => t.service.merge(t.bot, a.id, m.id));
    expect(types.code).toBe("invalid_input");
    expect(types.hint).toMatch(/related_to/);
    expect(thrown(() => t.service.merge(t.bot, a.id, newId("concept"))).code).toBe("not_found");
  });

  it("lets an agent merge only unreviewed agent concepts; she can merge anything", () => {
    const t = setupConcepts();
    const a = t.service.createConcept(t.bot, {
      type: "drug",
      name: "a2",
      generalKnowledge: true,
    }).concept;
    const b = t.service.createConcept(t.bot, {
      type: "drug",
      name: "b2",
      generalKnowledge: true,
    }).concept;
    t.service.setReview(t.she, "concept", b.id, "reviewed");
    const refused = thrown(() => t.service.merge(t.bot, a.id, b.id));
    expect(refused.code).toBe("forbidden");
    expect(refused.message).toMatch(/only she can merge/);
    const merged = t.service.merge(t.she, a.id, b.id);
    expect(merged.concept.reviewStatus).toBe("unverified");
  });

  it("works over HTTP", async () => {
    const t = setupConcepts();
    const a = t.service.createConcept(t.bot, {
      type: "drug",
      name: "a3",
      generalKnowledge: true,
    }).concept;
    const b = t.service.createConcept(t.bot, {
      type: "drug",
      name: "b3",
      generalKnowledge: true,
    }).concept;
    const res = await t.call(t.asKey(t.bot), "POST", `/api/concepts/${a.id}/merge`, {
      mergeId: b.id,
    });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ mergedId: b.id });
    const old = await t.call(t.asUser(t.alice), "GET", `/api/concepts/${b.id}`);
    expect(old.body).toMatchObject({ redirectedFrom: b.id, concept: { id: a.id } });
    const read = await t.call(t.asKey(t.readBot), "POST", `/api/concepts/${a.id}/merge`, {
      mergeId: b.id,
    });
    expect(read.status).toBe(403);
  });
});

describe("review, hooks and citations index", () => {
  it("marks concepts and relations reviewed by her only, leaving origin alone", async () => {
    const t = setupConcepts();
    const d = seedDataset(t);
    const id = d.id.metoprolol as string;
    const res = await t.call(t.asUser(t.alice), "POST", `/api/concepts/${id}/review`, {
      status: "reviewed",
    });
    expect(res.body.concept).toMatchObject({ reviewStatus: "reviewed", origin: "agent" });
    const relId = Object.values(d.rel)[0] as string;
    const rel = await t.call(t.asUser(t.alice), "POST", `/api/relations/${relId}/review`, {
      status: "reviewed",
    });
    expect(rel.body.relation.reviewStatus).toBe("reviewed");
    const agent = await t.call(t.asKey(t.bot), "POST", `/api/concepts/${id}/review`, {
      status: "reviewed",
    });
    expect(agent.status).toBe(403);
    expect(agent.body.error.code).toBe("forbidden");
    const undo = await t.call(t.asUser(t.alice), "POST", `/api/concepts/${id}/review`, {
      status: "unverified",
    });
    expect(undo.body.concept.reviewStatus).toBe("unverified");
  });

  it("finds what cites a page and what a deleted source leaves behind", () => {
    const t = setupConcepts();
    const d = seedDataset(t);
    const onB = t.service.citingPage(t.alice, d.pages.B.pageId);
    expect(onB.concepts.map((c) => c.name)).toContain("verapamil");
    expect(onB.concepts.map((c) => c.name)).not.toContain("metoprolol");
    expect(onB.relations.length).toBeGreaterThan(5);
    const left = t.service.onSourceDeleted(t.alice, [d.pages.B.fileId]);
    expect(left.concepts).toContain(d.id.verapamil);
    expect(left.relations.length).toBe(onB.relations.length);
    // nothing was rewritten: the citation and its quote remain
    expect(t.service.getConcept(t.she, d.id.verapamil as string).concept.citations[0]?.quote).toBe(
      d.pages.B.quote,
    );
    expect(t.service.onSourceDeleted(t.bob, [d.pages.B.fileId])).toEqual({
      concepts: [],
      relations: [],
    });
  });
});

describe("isolation and access", () => {
  it("keeps two users' concepts, relations and searches apart", async () => {
    const t = setupConcepts();
    const d = seedDataset(t);
    const bobs = t.service.createConcept(t.herBob, { type: "drug", name: "metoprolol" }).concept;
    expect(bobs.id).not.toBe(d.id.metoprolol);
    expect(t.service.search(t.herBob, "atenolol")).toEqual([]);
    expect(t.service.search(t.herBob, "metoprolol").map((c) => c.id)).toEqual([bobs.id]);
    expect(t.service.list(t.herBob, {}).items).toHaveLength(1);
    expect(thrown(() => t.service.getConcept(t.herBob, d.id.metoprolol as string)).code).toBe(
      "not_found",
    );
    expect(
      thrown(() => t.service.updateConcept(t.herBob, d.id.metoprolol as string, { summary: "x" }))
        .code,
    ).toBe("not_found");
    expect(thrown(() => t.service.merge(t.herBob, bobs.id, d.id.metoprolol as string)).code).toBe(
      "not_found",
    );
    expect(
      thrown(() => t.service.neighbourhood(t.herBob, d.id.metoprolol as string, {})).code,
    ).toBe("not_found");
    expect(
      thrown(() => t.service.getRelation(t.herBob, Object.values(d.rel)[0] as string)).code,
    ).toBe("not_found");
    // relating across users is impossible
    const cross = thrown(() =>
      t.service.createRelation(t.herBob, {
        from: { id: bobs.id },
        to: { id: d.id.bradycardia as string },
        type: "causes_adverse_effect",
      }),
    );
    expect(cross.code).toBe("not_found");
    const http = await t.call(t.asUser(t.bob), "GET", `/api/concepts/${d.id.metoprolol}`);
    expect(http.status).toBe(404);
    // an agent of Bob's sees only Bob's
    expect(t.service.list(t.bobBot, {}).items).toHaveLength(1);
    // same name in another user's account is not a conflict, and each has its own graph
    expect(t.service.neighbourhood(t.herBob, bobs.id, {}).nodes).toHaveLength(1);
  });

  it("needs a sign-in, lets a read-only key read, and refuses it every change", async () => {
    const t = setupConcepts();
    const d = seedDataset(t);
    const id = d.id.metoprolol as string;
    const relId = Object.values(d.rel)[0] as string;
    expect((await t.call(null, "GET", "/api/concepts")).status).toBe(401);
    const read = t.asKey(t.readBot);
    for (const path of [
      "/api/concepts",
      "/api/concepts/search?q=meto",
      `/api/concepts/${id}`,
      `/api/concepts/${id}/page`,
      `/api/concepts/${id}/graph`,
      `/api/concepts/path?from=${id}&to=${d.id.bradycardia}`,
      "/api/concepts/brand-generic",
      "/api/concepts/types",
      `/api/relations?from=${id}`,
      `/api/relations/${relId}`,
    ]) {
      expect((await t.call(read, "GET", path)).status, path).toBe(200);
    }
    // the query and compare routes are POSTs but only read
    const filter = await t.call(read, "POST", "/api/concepts/query", {
      kind: "in_class",
      class: { id: d.id["beta blockers"] },
    });
    expect(filter.status).toBe(200);
    const compare = await t.call(read, "POST", "/api/concepts/compare", {
      conceptIds: [id, d.id.atenolol],
      attributes: ["brand_names"],
    });
    expect(compare.status).toBe(200);
    const changes: Array<[string, string, unknown]> = [
      ["POST", "/api/concepts", { type: "drug", name: "x", generalKnowledge: true }],
      ["PATCH", `/api/concepts/${id}`, { aliases: ["x"] }],
      ["DELETE", `/api/concepts/${id}`, undefined],
      ["POST", `/api/concepts/${id}/merge`, { mergeId: d.id.atenolol }],
      ["POST", `/api/concepts/${id}/review`, { status: "reviewed" }],
      ["POST", `/api/concepts/${id}/name-check`, undefined],
      ["POST", "/api/concepts/name-checks", {}],
      ["POST", "/api/concepts/bulk", { concepts: [] }],
      [
        "POST",
        "/api/relations",
        { from: { id }, to: { id: d.id.bradycardia }, type: "related_to" },
      ],
      ["PATCH", `/api/relations/${relId}`, { note: "x" }],
      ["DELETE", `/api/relations/${relId}`, undefined],
      ["POST", `/api/relations/${relId}/review`, { status: "reviewed" }],
    ];
    for (const [method, path, body] of changes) {
      const res = await t.call(read, method, path, body);
      expect(res.status, `${method} ${path}`).toBe(403);
      expect(res.body.error.code).toBe("read_only_key");
    }
    expect(t.service.getConcept(t.she, id).concept.aliases).toEqual([]);
  });

  it("serves CRUD over HTTP for her", async () => {
    const t = setupConcepts();
    const made = await t.call(t.asUser(t.alice), "POST", "/api/concepts", {
      type: "drug",
      name: "propranolol",
      aliases: ["Inderal"],
    });
    expect(made.status).toBe(201);
    const id = made.body.concept.id as string;
    const patched = await t.call(t.asUser(t.alice), "PATCH", `/api/concepts/${id}`, {
      summary: "Non-selective.",
    });
    expect(patched.body.concept.summary).toEqual([{ text: "Non-selective." }]);
    const related = await t.call(t.asUser(t.alice), "POST", "/api/relations", {
      from: { id },
      to: { type: "drug", name: "propranolol" },
      type: "related_to",
    });
    expect(related.status).toBe(400);
    const types = await t.call(t.asUser(t.alice), "GET", "/api/concepts/types");
    expect(types.body.concepts).toHaveLength(11);
    expect(types.body.relations).toHaveLength(10);
    const gone = await t.call(t.asUser(t.alice), "DELETE", `/api/concepts/${id}`);
    expect(gone.status).toBe(204);
    expect((await t.call(t.asUser(t.alice), "GET", `/api/concepts/${id}`)).status).toBe(404);
    expect((await t.call(t.asUser(t.alice), "GET", "/api/concepts/nope")).status).toBe(404);
  });
});
