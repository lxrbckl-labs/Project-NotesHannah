import { describe, expect, it } from "vitest";
import {
  BulkUpsertInput,
  CONCEPT_EXAMPLES,
  CONCEPT_TYPES,
  ComparisonInput,
  Concept,
  ConceptFilter,
  ConceptInput,
  ConceptRef,
  canAgentOverwriteConcept,
  conceptCitationIssue,
  conceptKey,
  editDistance,
  mergeCitations,
  NameCheck,
  normalizeName,
  RELATION_RULES,
  RELATION_TYPES,
  Relation,
  RelationInput,
  relationSentence,
  relationTypesBetween,
  saltlessName,
  suggestDuplicates,
  UpdateConceptInput,
  validateConceptInput,
  validateRelation,
  validateRelationInput,
} from "../src/concepts.js";
import { newId } from "../src/ids.js";

const citation = {
  fileId: newId("file"),
  pageId: newId("page"),
  quote: "Metoprolol is a cardioselective beta-1 blocker.",
};
const actor = { type: "agent", keyId: newId("apiKey"), label: "Claude Code" } as const;
const stamp = "2026-11-15T12:00:00.000Z";
const provenance = { createdBy: actor, createdAt: stamp, lastEditedBy: actor, lastEditedAt: stamp };

describe("names", () => {
  it("flattens case, accents, punctuation and spacing", () => {
    expect(normalizeName("  Metoprolol   TARTRATE® ")).toBe("metoprolol tartrate");
    expect(normalizeName("Épinéphrine")).toBe("epinephrine");
    expect(normalizeName("Toprol-XL")).toBe("toprol xl");
    expect(normalizeName("β1-blocker")).toBe("β1 blocker");
    expect(normalizeName("!!!")).toBe("");
  });

  it("keys a concept by type and normalised name", () => {
    expect(conceptKey("drug", "Metoprolol")).toBe(conceptKey("drug", " metoprolol "));
    expect(conceptKey("drug", "Metoprolol")).not.toBe(conceptKey("drug_class", "Metoprolol"));
  });

  it("strips trailing salt and release words, conservatively", () => {
    expect(saltlessName("Metoprolol tartrate")).toBe("metoprolol");
    expect(saltlessName("metoprolol succinate ER")).toBe("metoprolol");
    expect(saltlessName("amlodipine besylate")).toBe("amlodipine");
    // a name that starts with a salt word is left whole
    expect(saltlessName("potassium chloride")).toBe("potassium chloride");
    expect(saltlessName("sodium bicarbonate")).toBe("sodium bicarbonate");
    // a single word is never emptied
    expect(saltlessName("tartrate")).toBe("tartrate");
    expect(saltlessName("metoprolol")).toBe("metoprolol");
  });

  it("measures small edit distances", () => {
    expect(editDistance("atenolol", "atenolol")).toBe(0);
    expect(editDistance("atenolol", "atenolal")).toBe(1);
    expect(editDistance("atenolol", "atenolols")).toBe(1);
    expect(editDistance("atenolol", "propranolol")).toBeGreaterThan(2);
  });
});

describe("duplicate suggestions", () => {
  const existing = [
    { id: newId("concept"), type: "drug" as const, name: "metoprolol", aliases: ["Lopressor"] },
    { id: newId("concept"), type: "drug" as const, name: "atenolol", aliases: [] },
    { id: newId("concept"), type: "drug_class" as const, name: "metoprolol", aliases: [] },
  ];

  it("suggests the same drug in another salt, never silently equal", () => {
    const out = suggestDuplicates({ type: "drug", name: "metoprolol tartrate" }, existing);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ reason: "salt_variant", name: "metoprolol" });
    expect(out[0]?.explanation).toMatch(/check before merging/);
  });

  it("suggests when the new name is another concept's alias", () => {
    const out = suggestDuplicates({ type: "drug", name: "Lopressor" }, existing);
    expect(out[0]?.reason).toBe("alias_match");
  });

  it("catches a one-letter slip on a long name only", () => {
    expect(suggestDuplicates({ type: "drug", name: "atenolal" }, existing)[0]?.reason).toBe(
      "close_spelling",
    );
    // too short to guess: "abc" vs "abd" is not a suggestion
    expect(
      suggestDuplicates({ type: "drug", name: "abd" }, [
        { id: newId("concept"), type: "drug", name: "abc", aliases: [] },
      ]),
    ).toEqual([]);
  });

  it("does not report the exact same concept, other types, or itself", () => {
    expect(suggestDuplicates({ type: "drug", name: "Metoprolol" }, existing)).toEqual([]);
    const self = existing[0] as (typeof existing)[number];
    expect(
      suggestDuplicates({ type: "drug", name: "metoprolol tartrate", selfId: self.id }, [self]),
    ).toEqual([]);
  });
});

describe("concept shapes", () => {
  it("accepts the published example and fills nothing the server owns", () => {
    expect(ConceptInput.safeParse(CONCEPT_EXAMPLES.concept).success).toBe(true);
    const sent = ConceptInput.safeParse({ ...CONCEPT_EXAMPLES.concept, id: newId("concept") });
    expect(sent.success).toBe(false);
  });

  it("knows every concept type", () => {
    expect(CONCEPT_TYPES).toHaveLength(11);
    expect(ConceptInput.safeParse({ type: "vitamin", name: "x" }).success).toBe(false);
  });

  it("normalises a plain-string summary to rich text", () => {
    const parsed = ConceptInput.parse({
      type: "drug",
      name: "atenolol",
      summary: "A beta blocker",
    });
    expect(parsed.summary).toEqual([{ text: "A beta blocker" }]);
  });

  it("rejects an RxCUI that is not digits and a name without letters", () => {
    expect(
      ConceptInput.safeParse({ type: "drug", name: "x", drug: { rxcui: "abc" } }).success,
    ).toBe(false);
    expect(ConceptInput.safeParse({ type: "drug", name: "***" }).success).toBe(false);
    expect(
      ConceptInput.safeParse({ type: "drug", name: "x", drug: { rxcui: "6918" } }).success,
    ).toBe(true);
  });

  it("describes a full concept", () => {
    const concept = {
      id: newId("concept"),
      type: "drug",
      name: "metoprolol",
      aliases: [],
      drug: {
        genericName: null,
        brandNames: ["Lopressor"],
        rxcui: "6918",
        nameCheck: { status: "matched", checkedAt: stamp, rxcui: "6918" },
      },
      summary: [{ text: "A beta blocker" }],
      citations: [citation],
      generalKnowledge: false,
      reviewStatus: "unverified",
      origin: "agent",
      provenance,
    };
    expect(Concept.safeParse(concept).success).toBe(true);
    expect(Concept.safeParse({ ...concept, type: "nonsense" }).success).toBe(false);
  });

  it("models every name-check status", () => {
    expect(NameCheck.safeParse({ status: "unchecked" }).success).toBe(true);
    expect(NameCheck.safeParse({ status: "matched", checkedAt: stamp }).success).toBe(true);
    expect(NameCheck.safeParse({ status: "unknown", checkedAt: stamp }).success).toBe(true);
    expect(
      NameCheck.safeParse({ status: "suggestion", checkedAt: stamp, suggested: "metoprolol" })
        .success,
    ).toBe(true);
    // a suggestion must say what it suggests
    expect(NameCheck.safeParse({ status: "suggestion", checkedAt: stamp }).success).toBe(false);
  });

  it("protects what she wrote or reviewed", () => {
    expect(canAgentOverwriteConcept({ origin: "agent", reviewStatus: "unverified" })).toBe(true);
    expect(canAgentOverwriteConcept({ origin: "user", reviewStatus: "unverified" })).toBe(false);
    expect(canAgentOverwriteConcept({ origin: "agent", reviewStatus: "reviewed" })).toBe(false);
  });

  it("update needs a field and never changes the type", () => {
    expect(UpdateConceptInput.safeParse({}).success).toBe(false);
    expect(UpdateConceptInput.safeParse({ type: "drug_class" }).success).toBe(false);
    expect(UpdateConceptInput.safeParse({ aliases: ["x"] }).success).toBe(true);
  });
});

describe("the citation rule for concepts", () => {
  it("makes agents cite or say general knowledge, with a teaching error", () => {
    const bare = validateConceptInput({ type: "drug", name: "atenolol" });
    expect(bare.ok).toBe(false);
    if (!bare.ok) {
      expect(bare.problems[0]?.path).toBe("$.citations");
      expect(bare.problems[0]?.message).toMatch(/no citation/);
      expect(bare.problems[0]?.message).toMatch(/generalKnowledge/);
      expect(ConceptInput.safeParse(bare.problems[0]?.example).success).toBe(true);
    }
  });

  it("accepts a citation or general knowledge, never both", () => {
    expect(validateConceptInput({ type: "drug", name: "a1", citations: [citation] }).ok).toBe(true);
    expect(validateConceptInput({ type: "drug", name: "a1", generalKnowledge: true }).ok).toBe(
      true,
    );
    const both = validateConceptInput({
      type: "drug",
      name: "a1",
      citations: [citation],
      generalKnowledge: true,
    });
    expect(both.ok).toBe(false);
    if (!both.ok) expect(both.problems[0]?.message).toMatch(/Pick one/);
  });

  it("exempts her", () => {
    expect(validateConceptInput({ type: "drug", name: "atenolol" }, { writer: "user" }).ok).toBe(
      true,
    );
    expect(
      validateConceptInput(
        { type: "drug", name: "atenolol" },
        { writer: { type: "user", userId: newId("user") } },
      ).ok,
    ).toBe(true);
  });

  it("prefixes paths for bulk items", () => {
    const result = validateConceptInput(
      { type: "drug", name: "atenolol" },
      { pathPrefix: "$.concepts[3]" },
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.problems[0]?.path).toBe("$.concepts[3].citations");
  });

  it("refuses drug details on a non-drug", () => {
    const result = validateConceptInput({
      type: "mechanism",
      name: "x",
      drug: { brandNames: ["a"] },
      generalKnowledge: true,
    });
    expect(result.ok).toBe(false);
    if (!result.ok)
      expect(result.problems[0]?.message).toMatch(/only belong on a concept of type "drug"/);
  });

  it("reports unknown fields and missing fields in plain words", () => {
    const unknown = validateConceptInput({
      type: "drug",
      name: "a",
      id: "x",
      generalKnowledge: true,
    });
    expect(unknown.ok).toBe(false);
    if (!unknown.ok) expect(unknown.problems[0]?.message).toMatch(/Unknown field: id/);
    const missing = validateConceptInput({ type: "drug", generalKnowledge: true });
    expect(missing.ok).toBe(false);
    if (!missing.ok) expect(missing.problems[0]?.message).toMatch(/Missing required field "name"/);
  });

  it("exposes the rule for reuse", () => {
    expect(conceptCitationIssue({ citations: [citation] }, "relation")).toBeNull();
    expect(conceptCitationIssue({}, "relation")).toMatch(/This relation has no citation/);
  });
});

describe("relation rules", () => {
  const concepts = CONCEPT_TYPES;

  it("has a rule, an example and sentences for every relation type", () => {
    for (const type of RELATION_TYPES) {
      const rule = RELATION_RULES[type];
      expect(rule.from.length).toBeGreaterThan(0);
      expect(rule.to.length).toBeGreaterThan(0);
      expect(rule.forward.length).toBeGreaterThan(0);
      // the example is valid by its own table
      expect(validateRelation(type, rule.example.from.type, rule.example.to.type).ok).toBe(true);
    }
  });

  it("allows exactly the combinations in the table, for every pair of concept types", () => {
    for (const type of RELATION_TYPES) {
      for (const from of concepts) {
        for (const to of concepts) {
          const rule = RELATION_RULES[type];
          const expected = rule.from.includes(from) && rule.to.includes(to);
          expect(validateRelation(type, from, to).ok, `${type}: ${from} -> ${to}`).toBe(expected);
        }
      }
    }
  });

  it("is symmetric exactly where declared", () => {
    for (const type of RELATION_TYPES) {
      const rule = RELATION_RULES[type];
      if (!rule.symmetric) continue;
      for (const from of concepts) {
        for (const to of concepts) {
          expect(validateRelation(type, from, to).ok).toBe(validateRelation(type, to, from).ok);
        }
      }
    }
    expect(RELATION_TYPES.filter((t) => RELATION_RULES[t].symmetric)).toEqual([
      "interacts_with",
      "related_to",
    ]);
  });

  it("explains a refusal with the rule, what fits and a valid example", () => {
    const check = validateRelation("causes_adverse_effect", "mechanism", "drug");
    expect(check.ok).toBe(false);
    if (!check.ok) {
      expect(check.message).toContain(
        '"causes_adverse_effect" links a drug or a drug class to an adverse effect',
      );
      expect(check.message).toContain("a mechanism to a drug");
      expect(check.hint).toContain("related_to");
      expect(check.example).toMatchObject({ type: "causes_adverse_effect" });
    }
  });

  it("notices swapped ends", () => {
    const check = validateRelation("causes_adverse_effect", "adverse_effect", "drug");
    expect(check.ok).toBe(false);
    if (!check.ok) expect(check.hint).toMatch(/swapped/);
  });

  it("suggests the types that do fit", () => {
    expect(relationTypesBetween("drug", "adverse_effect")).toEqual([
      "causes_adverse_effect",
      "related_to",
    ]);
    expect(relationTypesBetween("drug", "drug_class")).toEqual([
      "belongs_to_class",
      "interacts_with",
      "related_to",
    ]);
    const check = validateRelation("treats", "drug", "adverse_effect");
    expect(check.ok).toBe(false);
    if (!check.ok) expect(check.hint).toMatch(/causes_adverse_effect/);
  });

  it("reads as a sentence", () => {
    expect(relationSentence("causes_adverse_effect", "metoprolol", "bradycardia")).toBe(
      "metoprolol can cause bradycardia",
    );
    expect(relationSentence("belongs_to_class", "metoprolol", "beta blockers")).toBe(
      "metoprolol belongs to class beta blockers",
    );
  });
});

describe("relation input", () => {
  it("accepts the published examples", () => {
    expect(validateRelationInput(CONCEPT_EXAMPLES.relation).ok).toBe(true);
    expect(validateRelationInput(CONCEPT_EXAMPLES.interaction).ok).toBe(true);
  });

  it("takes concepts by ID or by type and name", () => {
    const id = newId("concept");
    expect(ConceptRef.safeParse({ id }).success).toBe(true);
    expect(ConceptRef.safeParse({ type: "drug", name: "x" }).success).toBe(true);
    const bad = ConceptRef.safeParse({ name: "x" });
    expect(bad.success).toBe(false);
    expect(bad.error?.issues[0]?.message).toMatch(/Name a concept by ID/);
    expect(
      RelationInput.safeParse({
        from: { id },
        to: { id: newId("concept") },
        type: "treats",
        citations: [citation],
      }).success,
    ).toBe(true);
  });

  it("needs severity and effect for an interaction, and only on interacts_with", () => {
    const missing = validateRelationInput({
      from: { type: "drug", name: "a" },
      to: { type: "drug", name: "b" },
      type: "interacts_with",
      interaction: { severity: "major" },
      generalKnowledge: true,
    });
    expect(missing.ok).toBe(false);
    const wrongType = validateRelationInput({
      from: { type: "drug", name: "a" },
      to: { type: "adverse_effect", name: "b" },
      type: "causes_adverse_effect",
      interaction: { severity: "major", effect: "x" },
      generalKnowledge: true,
    });
    expect(wrongType.ok).toBe(false);
    if (!wrongType.ok)
      expect(wrongType.problems[0]?.message).toMatch(/only belong on an "interacts_with"/);
    const badSeverity = validateRelationInput({
      from: { type: "drug", name: "a" },
      to: { type: "drug", name: "b" },
      type: "interacts_with",
      interaction: { severity: "scary", effect: "x" },
      generalKnowledge: true,
    });
    expect(badSeverity.ok).toBe(false);
  });

  it("refuses a relation from a concept to itself and holds agents to the citation rule", () => {
    const id = newId("concept");
    const self = validateRelationInput({
      from: { id },
      to: { id },
      type: "related_to",
      generalKnowledge: true,
    });
    expect(self.ok).toBe(false);
    if (!self.ok) expect(self.problems[0]?.message).toMatch(/itself/);
    const bare = validateRelationInput(
      {
        from: { type: "drug", name: "a" },
        to: { type: "drug_class", name: "b" },
        type: "belongs_to_class",
      },
      { pathPrefix: "$.relations[2]" },
    );
    expect(bare.ok).toBe(false);
    if (!bare.ok) expect(bare.problems[0]?.path).toBe("$.relations[2].citations");
    expect(
      validateRelationInput(
        {
          from: { type: "drug", name: "a" },
          to: { type: "drug_class", name: "b" },
          type: "belongs_to_class",
        },
        { writer: "user" },
      ).ok,
    ).toBe(true);
  });

  it("describes a stored relation", () => {
    const relation = {
      id: newId("relation"),
      from: newId("concept"),
      to: newId("concept"),
      type: "interacts_with",
      note: "",
      interaction: { severity: "major", effect: "bradycardia" },
      citations: [citation],
      generalKnowledge: false,
      reviewStatus: "unverified",
      origin: "agent",
      provenance,
    };
    expect(Relation.safeParse(relation).success).toBe(true);
  });
});

describe("bulk and read inputs", () => {
  it("defaults to atomic and caps the batch", () => {
    expect(BulkUpsertInput.parse({})).toEqual({ concepts: [], relations: [], partial: false });
    expect(BulkUpsertInput.safeParse(CONCEPT_EXAMPLES.bulk).success).toBe(true);
    expect(BulkUpsertInput.safeParse({ concepts: new Array(201).fill({}) }).success).toBe(false);
  });

  it("parses the three filters with defaults", () => {
    const withRelation = ConceptFilter.parse({
      kind: "with_relation",
      relation: "causes_adverse_effect",
      target: { type: "adverse_effect", name: "bradycardia" },
    });
    expect(withRelation).toMatchObject({ side: "from", viaClass: true, limit: 200 });
    expect(
      ConceptFilter.parse({
        kind: "in_class",
        class: { type: "drug_class", name: "beta blockers" },
      }),
    ).toMatchObject({ includeSubclasses: true });
    expect(
      ConceptFilter.safeParse({ kind: "sharing_mechanism", drug: { id: newId("concept") } })
        .success,
    ).toBe(true);
    const bad = ConceptFilter.safeParse({ kind: "everything" });
    expect(bad.success).toBe(false);
  });

  it("comparison needs two drugs, an attribute and known attributes", () => {
    const a = newId("concept");
    const b = newId("concept");
    expect(ComparisonInput.safeParse({ conceptIds: [a], attributes: ["treats"] }).success).toBe(
      false,
    );
    expect(ComparisonInput.safeParse({ conceptIds: [a, b], attributes: [] }).success).toBe(false);
    expect(
      ComparisonInput.safeParse({ conceptIds: [a, b], attributes: ["brand_names", "treats"] })
        .success,
    ).toBe(true);
    expect(ComparisonInput.safeParse({ conceptIds: [a, b], attributes: ["colour"] }).success).toBe(
      false,
    );
  });

  it("merges citation lists keeping each passage once", () => {
    const other = { ...citation, quote: "Another passage." };
    expect(mergeCitations([citation], [citation, other], undefined)).toEqual([citation, other]);
    expect(conceptKey("drug", "x")).toBe("drug:x");
  });
});
