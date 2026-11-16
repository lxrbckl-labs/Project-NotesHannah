import { z } from "zod";
import { formatPath, type Problem } from "./blocks/index.js";
import { richText } from "./blocks/rich-text.js";
import { Citation, CitationStatus, citationKey } from "./citations.js";
import { Actor, Timestamp } from "./common.js";
import { ConceptId, DocumentId, NodeId, QuestionId, RelationId } from "./ids.js";
import { ReviewStatus } from "./sources.js";

/**
 * The structured layer (features F1 to F5, and the data behind G12): typed
 * concepts and typed relationships between them, each with its sources.
 * Agents extract them while transcribing; the app then answers "everything
 * that prolongs QT" across courses, builds comparison tables and drills
 * brand and generic names without calling a model.
 *
 * A concept is one thing in the world (a drug, a class, a mechanism…), once
 * per user, whichever course mentions it. Relations connect two concepts and
 * are only valid between the type pairs in `RELATION_RULES`.
 */

export const CONCEPT_LIMITS = {
  nameChars: 200,
  aliases: 30,
  brandNames: 30,
  summaryChars: 1000,
  /** Citations on one concept or relation. Generous so a merge keeps them all. */
  citations: 50,
  noteChars: 500,
  effectChars: 500,
  /** Concepts and relations in one bulk call. */
  bulkConcepts: 200,
  bulkRelations: 500,
  /** Graph and path limits. */
  graphMaxNodes: 200,
  graphDefaultNodes: 60,
  graphMaxHops: 4,
  pathMaxHops: 8,
  /** Drugs in one comparison table. */
  compareConcepts: 20,
  compareAttributes: 10,
} as const;

// ---- types --------------------------------------------------------------

export const CONCEPT_TYPES = [
  "drug",
  "drug_class",
  "mechanism",
  "target",
  "indication",
  "adverse_effect",
  "interaction",
  "contraindication",
  "monitoring_parameter",
  "counselling_point",
  "other",
] as const;
export const ConceptType = z.enum(CONCEPT_TYPES, {
  error: `A concept type is one of: ${CONCEPT_TYPES.join(", ")}.`,
});
export type ConceptType = z.infer<typeof ConceptType>;

export const CONCEPT_TYPE_INFO: Record<
  ConceptType,
  { label: string; meaning: string; example: string }
> = {
  drug: { label: "Drug", meaning: "A medicine, by its generic name.", example: "metoprolol" },
  drug_class: {
    label: "Drug class",
    meaning: "A group of drugs, named by what they have in common.",
    example: "beta blockers",
  },
  mechanism: {
    label: "Mechanism",
    meaning: "How a drug or class works.",
    example: "beta-1 receptor antagonism",
  },
  target: {
    label: "Target",
    meaning: "A receptor, enzyme, channel or transporter a drug acts on.",
    example: "beta-1 adrenergic receptor",
  },
  indication: {
    label: "Indication",
    meaning: "A condition a drug is used for.",
    example: "hypertension",
  },
  adverse_effect: {
    label: "Adverse effect",
    meaning: "A harm a drug can cause.",
    example: "bradycardia",
  },
  interaction: {
    label: "Interaction",
    meaning: "A named interaction mechanism or effect.",
    example: "CYP2D6 inhibition",
  },
  contraindication: {
    label: "Contraindication",
    meaning: "A condition in which a drug must not be used.",
    example: "severe bradycardia",
  },
  monitoring_parameter: {
    label: "Monitoring parameter",
    meaning: "Something to measure while on a drug.",
    example: "heart rate",
  },
  counselling_point: {
    label: "Counselling point",
    meaning: "Advice to give a patient.",
    example: "do not stop abruptly",
  },
  other: {
    label: "Other",
    meaning: "Anything that fits no other type.",
    example: "first-pass metabolism",
  },
};

// ---- names and de-duplication ---------------------------------------------

/**
 * The name with case, accents, punctuation and spacing flattened:
 * "Metoprolol  Tartrate®" and "metoprolol tartrate" give the same string.
 */
export function normalizeName(name: string): string {
  return name
    .normalize("NFKD")
    .replace(/\p{M}+/gu, "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

/** Identity of a concept: the same type and the same normalised name are the same concept. */
export function conceptKey(type: ConceptType, name: string): string {
  return `${type}:${normalizeName(name)}`;
}

/** Words that name a salt or a release form, not the drug: "metoprolol tartrate", "metoprolol succinate ER". */
export const SALT_WORDS: ReadonlySet<string> = new Set([
  "acetate",
  "besylate",
  "bitartrate",
  "bromide",
  "chloride",
  "citrate",
  "cr",
  "er",
  "extended",
  "fumarate",
  "gluconate",
  "hbr",
  "hcl",
  "hydrobromide",
  "hydrochloride",
  "ir",
  "la",
  "maleate",
  "mesylate",
  "nitrate",
  "phosphate",
  "release",
  "sr",
  "succinate",
  "sulfate",
  "sulphate",
  "tartrate",
  "xl",
  "xr",
]);

/** Names that are the drug when they come first: "potassium chloride" is not "potassium". */
const LEADING_ELEMENTS: ReadonlySet<string> = new Set([
  "calcium",
  "ferrous",
  "lithium",
  "magnesium",
  "potassium",
  "sodium",
  "zinc",
]);

/**
 * The normalised name without trailing salt and release words, so
 * "metoprolol tartrate" and "metoprolol succinate" both become "metoprolol".
 * A name that starts with a salt word ("potassium chloride") is left whole.
 */
export function saltlessName(name: string): string {
  const words = normalizeName(name).split(" ").filter(Boolean);
  if (
    words.length < 2 ||
    SALT_WORDS.has(words[0] as string) ||
    LEADING_ELEMENTS.has(words[0] as string)
  )
    return words.join(" ");
  let end = words.length;
  while (end > 1 && SALT_WORDS.has(words[end - 1] as string)) end--;
  return words.slice(0, end).join(" ");
}

/** Edit distance, for catching a typo between two names. */
export function editDistance(a: string, b: string): number {
  if (a === b) return 0;
  if (Math.abs(a.length - b.length) > 2) return Math.abs(a.length - b.length);
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const row = [i];
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      row[j] = Math.min(
        (prev[j] as number) + 1,
        (row[j - 1] as number) + 1,
        (prev[j - 1] as number) + cost,
      );
    }
    prev = row;
  }
  return prev[b.length] as number;
}

/** Whether two strings are at most one edit apart (insert, delete or change a letter), in one linear pass. */
export function withinOneEdit(a: string, b: string): boolean {
  if (a === b) return true;
  const la = a.length;
  const lb = b.length;
  if (Math.abs(la - lb) > 1) return false;
  let i = 0;
  while (i < la && i < lb && a[i] === b[i]) i++;
  if (la === lb) return a.slice(i + 1) === b.slice(i + 1);
  return la > lb ? a.slice(i + 1) === b.slice(i) : a.slice(i) === b.slice(i + 1);
}

export type DuplicateReason = "alias_match" | "salt_variant" | "close_spelling";

/** Something that might be the same concept as a new one. Always a suggestion; nothing merges by itself. */
export interface DuplicateSuggestion {
  conceptId: string;
  name: string;
  type: ConceptType;
  reason: DuplicateReason;
  /** Plain words for the agent or the reviewer. */
  explanation: string;
}

export interface DuplicateCandidate {
  id: string;
  type: ConceptType;
  name: string;
  aliases: readonly string[];
  /** Generic and brand names of a drug, which count as aliases here. */
  extraNames?: readonly string[];
  /** `normalizeName(name)`, when the caller already has it (the database keeps it). */
  nameKey?: string;
}

/**
 * Concepts of the same type that look like `name` without being it: a name
 * that is another concept's alias, the same drug in another salt, or a
 * one-letter slip. Conservative on purpose: different salts of one drug can
 * differ clinically, so the answer is a suggestion for a person or agent to
 * confirm with a merge, never an automatic one.
 */
export function suggestDuplicates(
  subject: { type: ConceptType; name: string; aliases?: readonly string[]; selfId?: string },
  others: readonly DuplicateCandidate[],
): DuplicateSuggestion[] {
  const myKey = normalizeName(subject.name);
  const mine = new Set([myKey, ...(subject.aliases ?? []).map(normalizeName)]);
  const mySaltless = saltlessName(subject.name);
  const out: DuplicateSuggestion[] = [];
  for (const other of others) {
    if (other.id === subject.selfId || other.type !== subject.type) continue;
    const otherKey = other.nameKey ?? normalizeName(other.name);
    if (otherKey === myKey) continue; // the same concept, not a suggestion
    const names = [otherKey, ...[...other.aliases, ...(other.extraNames ?? [])].map(normalizeName)];
    let found: DuplicateSuggestion | null = null;
    if (names.some((n) => mine.has(n))) {
      found = {
        conceptId: other.id,
        name: other.name,
        type: other.type,
        reason: "alias_match",
        explanation: `"${subject.name}" is already a name or alias of "${other.name}".`,
      };
    } else if (
      // saltlessName only drops trailing words, so an equal one starts the name: test that first.
      mySaltless.length > 0 &&
      names.some((n) => n.startsWith(mySaltless) && saltlessName(n) === mySaltless)
    ) {
      found = {
        conceptId: other.id,
        name: other.name,
        type: other.type,
        reason: "salt_variant",
        explanation: `"${subject.name}" and "${other.name}" differ only by a salt or release form. They may be one drug; check before merging.`,
      };
    } else if (myKey.length >= 6 && names.some((n) => n.length >= 6 && withinOneEdit(n, myKey))) {
      found = {
        conceptId: other.id,
        name: other.name,
        type: other.type,
        reason: "close_spelling",
        explanation: `"${subject.name}" is one letter away from "${other.name}". It may be a typo.`,
      };
    }
    if (found) out.push(found);
  }
  return out;
}

// ---- drug details -----------------------------------------------------------

/** RxNorm concept unique identifier (RxCUI): digits only. */
export const Rxcui = z
  .string()
  .regex(/^[0-9]{1,10}$/, { error: 'An RxCUI is a number written as text, e.g. "6918".' });

/**
 * Where the drug-name check (F4) has got to. It is advisory: nothing waits on
 * it and an outage leaves the status "unchecked".
 */
export const NameCheck = z.discriminatedUnion("status", [
  z.strictObject({ status: z.literal("unchecked") }),
  z.strictObject({ status: z.literal("matched"), checkedAt: Timestamp, rxcui: Rxcui.optional() }),
  z.strictObject({
    status: z.literal("suggestion"),
    checkedAt: Timestamp,
    /** The spelling RxNorm suggests instead. */
    suggested: z.string().min(1).max(CONCEPT_LIMITS.nameChars),
    rxcui: Rxcui.optional(),
  }),
  z.strictObject({ status: z.literal("unknown"), checkedAt: Timestamp }),
]);
export type NameCheck = z.infer<typeof NameCheck>;

const ShortName = z.string().trim().min(1).max(CONCEPT_LIMITS.nameChars);

export const ConceptName = ShortName.refine((value) => normalizeName(value).length > 0, {
  error: "A name needs at least one letter or digit.",
});

/** What the server keeps about a drug beyond its concept name. */
export const DrugInfo = z.object({
  /** The generic name when the concept's name is something else (e.g. a class-style label). */
  genericName: ShortName.nullable(),
  brandNames: z.array(ShortName).max(CONCEPT_LIMITS.brandNames),
  rxcui: Rxcui.nullable(),
  nameCheck: NameCheck,
});
export type DrugInfo = z.infer<typeof DrugInfo>;

/** What a writer may say about a drug. `nameCheck` is the server's. */
export const DrugInput = z.strictObject({
  genericName: ShortName.optional(),
  brandNames: z.array(ShortName).max(CONCEPT_LIMITS.brandNames).optional(),
  rxcui: Rxcui.optional(),
});
export type DrugInput = z.infer<typeof DrugInput>;

// ---- the concept ---------------------------------------------------------------

export const ConceptProvenance = z.object({
  createdBy: Actor,
  createdAt: Timestamp,
  lastEditedBy: Actor,
  lastEditedAt: Timestamp,
});
export type ConceptProvenance = z.infer<typeof ConceptProvenance>;

export const Concept = z.object({
  id: ConceptId,
  type: ConceptType,
  name: ConceptName,
  /** Other names for the same thing: abbreviations, spellings, "ACEi". */
  aliases: z.array(ShortName).max(CONCEPT_LIMITS.aliases),
  /** Set when type is "drug". */
  drug: DrugInfo.nullable(),
  /** A short description in rich text (may mention other concepts). */
  summary: richText(CONCEPT_LIMITS.summaryChars),
  citations: z.array(Citation).max(CONCEPT_LIMITS.citations),
  /** True when nothing here is from her notes (shown as "not from your notes"). */
  generalKnowledge: z.boolean(),
  reviewStatus: ReviewStatus,
  /** "user" once she has edited it by hand: sticky, like blocks. Agents leave such a concept's text alone. */
  origin: z.enum(["agent", "user"]),
  provenance: ConceptProvenance,
});
export type Concept = z.infer<typeof Concept>;

/** A concept in a list, a graph or a table cell. */
export const ConceptSummary = z.object({
  id: ConceptId,
  type: ConceptType,
  name: z.string(),
  genericName: z.string().nullable(),
  reviewStatus: ReviewStatus,
});
export type ConceptSummary = z.infer<typeof ConceptSummary>;

/** Whether an agent may rewrite the concept's text: only its own, unreviewed work. */
export function canAgentOverwriteConcept(
  concept: Pick<Concept, "origin" | "reviewStatus">,
): boolean {
  return concept.origin === "agent" && concept.reviewStatus === "unverified";
}

// ---- relations ---------------------------------------------------------------------

export const RELATION_TYPES = [
  "belongs_to_class",
  "has_mechanism",
  "acts_on",
  "treats",
  "causes_adverse_effect",
  "interacts_with",
  "contraindicated_in",
  "monitored_by",
  "brand_of",
  "related_to",
] as const;
export const RelationType = z.enum(RELATION_TYPES, {
  error: `A relation type is one of: ${RELATION_TYPES.join(", ")}.`,
});
export type RelationType = z.infer<typeof RelationType>;

export interface RelationRule {
  from: readonly ConceptType[];
  to: readonly ConceptType[];
  /** The same relation read from either end (interacts_with, related_to). Stored once. */
  symmetric: boolean;
  /** "X <forward> Y". */
  forward: string;
  /** "Y <backward> X". */
  backward: string;
  /** Plain-language rule for error messages and docs. */
  rule: string;
  example: { from: { type: ConceptType; name: string }; to: { type: ConceptType; name: string } };
}

const ANY = CONCEPT_TYPES;

/** Which relation types are valid between which concept types. The one table everything checks. */
export const RELATION_RULES: Record<RelationType, RelationRule> = {
  belongs_to_class: {
    from: ["drug", "drug_class"],
    to: ["drug_class"],
    symmetric: false,
    forward: "belongs to class",
    backward: "includes",
    rule: "a drug (or a narrower class) belongs to a drug class",
    example: {
      from: { type: "drug", name: "metoprolol" },
      to: { type: "drug_class", name: "beta blockers" },
    },
  },
  has_mechanism: {
    from: ["drug", "drug_class"],
    to: ["mechanism"],
    symmetric: false,
    forward: "works by",
    backward: "is the mechanism of",
    rule: "a drug or drug class has a mechanism",
    example: {
      from: { type: "drug_class", name: "beta blockers" },
      to: { type: "mechanism", name: "beta-adrenergic receptor antagonism" },
    },
  },
  acts_on: {
    from: ["drug", "drug_class", "mechanism"],
    to: ["target"],
    symmetric: false,
    forward: "acts on",
    backward: "is acted on by",
    rule: "a drug, drug class or mechanism acts on a target (receptor, enzyme, channel)",
    example: {
      from: { type: "drug", name: "metoprolol" },
      to: { type: "target", name: "beta-1 adrenergic receptor" },
    },
  },
  treats: {
    from: ["drug", "drug_class"],
    to: ["indication"],
    symmetric: false,
    forward: "treats",
    backward: "is treated by",
    rule: "a drug or drug class treats an indication",
    example: {
      from: { type: "drug", name: "metoprolol" },
      to: { type: "indication", name: "hypertension" },
    },
  },
  causes_adverse_effect: {
    from: ["drug", "drug_class"],
    to: ["adverse_effect"],
    symmetric: false,
    forward: "can cause",
    backward: "is caused by",
    rule: "a drug or drug class can cause an adverse effect",
    example: {
      from: { type: "drug", name: "metoprolol" },
      to: { type: "adverse_effect", name: "bradycardia" },
    },
  },
  interacts_with: {
    from: ["drug", "drug_class", "interaction"],
    to: ["drug", "drug_class", "interaction"],
    symmetric: true,
    forward: "interacts with",
    backward: "interacts with",
    rule: "a drug, drug class or named interaction interacts with another of those; it reads the same from either end",
    example: {
      from: { type: "drug", name: "metoprolol" },
      to: { type: "drug", name: "verapamil" },
    },
  },
  contraindicated_in: {
    from: ["drug", "drug_class"],
    to: ["contraindication"],
    symmetric: false,
    forward: "is contraindicated in",
    backward: "is a contraindication for",
    rule: "a drug or drug class is contraindicated in a condition (a contraindication concept)",
    example: {
      from: { type: "drug", name: "metoprolol" },
      to: { type: "contraindication", name: "severe bradycardia" },
    },
  },
  monitored_by: {
    from: ["drug", "drug_class"],
    to: ["monitoring_parameter"],
    symmetric: false,
    forward: "is monitored by",
    backward: "is monitored for",
    rule: "a drug or drug class is monitored by a monitoring parameter",
    example: {
      from: { type: "drug", name: "metoprolol" },
      to: { type: "monitoring_parameter", name: "heart rate" },
    },
  },
  brand_of: {
    from: ["drug"],
    to: ["drug"],
    symmetric: false,
    forward: "is a brand of",
    backward: "has brand",
    rule: "a brand-name drug concept points at its generic drug concept",
    example: {
      from: { type: "drug", name: "Lopressor" },
      to: { type: "drug", name: "metoprolol" },
    },
  },
  related_to: {
    from: ANY,
    to: ANY,
    symmetric: true,
    forward: "is related to",
    backward: "is related to",
    rule: "anything may be related to anything else; use a specific type when one fits",
    example: {
      from: { type: "counselling_point", name: "do not stop abruptly" },
      to: { type: "drug_class", name: "beta blockers" },
    },
  },
};

const article = (type: ConceptType) => (/^[aeiou]/.test(type) ? "an" : "a");
const typeWords = (type: ConceptType) => type.replaceAll("_", " ");
const listTypes = (types: readonly ConceptType[]) =>
  types.length === ANY.length
    ? "any concept"
    : types.map((t) => `${article(t)} ${typeWords(t)}`).join(" or ");

/** Relation types that may run from one concept type to another. */
export function relationTypesBetween(from: ConceptType, to: ConceptType): RelationType[] {
  return RELATION_TYPES.filter((type) => {
    const rule = RELATION_RULES[type];
    return rule.from.includes(from) && rule.to.includes(to);
  });
}

export type RelationCheck =
  | { ok: true }
  | { ok: false; message: string; hint: string; example: unknown };

/**
 * Whether a relation of `type` may run from a concept of one type to a concept
 * of another. A refusal explains the rule, says what would fit instead and
 * shows a valid example.
 */
export function validateRelation(
  type: RelationType,
  fromType: ConceptType,
  toType: ConceptType,
): RelationCheck {
  const rule = RELATION_RULES[type];
  if (rule.from.includes(fromType) && rule.to.includes(toType)) return { ok: true };
  const message = `"${type}" links ${listTypes(rule.from)} to ${listTypes(rule.to)} (${rule.rule}), but this one links ${article(fromType)} ${typeWords(fromType)} to ${article(toType)} ${typeWords(toType)}.`;
  const hints: string[] = [];
  if (rule.from.includes(toType) && rule.to.includes(fromType)) {
    hints.push('The two ends look swapped: put the other concept in "from".');
  }
  const fits = relationTypesBetween(fromType, toType).filter((t) => t !== "related_to");
  if (fits.length > 0) {
    hints.push(
      `Between ${article(fromType)} ${typeWords(fromType)} and ${article(toType)} ${typeWords(toType)} you can use: ${fits.join(", ")}.`,
    );
  } else {
    hints.push('When no specific type fits, use "related_to".');
  }
  return {
    ok: false,
    message,
    hint: hints.join(" "),
    example: { type, ...rule.example },
  };
}

/** The sentence a relation reads as: "metoprolol can cause bradycardia". */
export function relationSentence(type: RelationType, fromName: string, toName: string): string {
  return `${fromName} ${RELATION_RULES[type].forward} ${toName}`;
}

export const InteractionSeverity = z.enum(["minor", "moderate", "major", "contraindicated"]);
export type InteractionSeverity = z.infer<typeof InteractionSeverity>;

/** Detail on an interacts_with relation. */
export const RelationInteraction = z.strictObject({
  severity: InteractionSeverity,
  /** What happens, e.g. "additive bradycardia and AV block". */
  effect: z.string().trim().min(1).max(CONCEPT_LIMITS.effectChars),
});
export type RelationInteraction = z.infer<typeof RelationInteraction>;

export const Relation = z.object({
  id: RelationId,
  from: ConceptId,
  to: ConceptId,
  type: RelationType,
  note: z.string().max(CONCEPT_LIMITS.noteChars),
  /** Only on interacts_with. */
  interaction: RelationInteraction.nullable(),
  citations: z.array(Citation).max(CONCEPT_LIMITS.citations),
  generalKnowledge: z.boolean(),
  reviewStatus: ReviewStatus,
  origin: z.enum(["agent", "user"]),
  provenance: ConceptProvenance,
});
export type Relation = z.infer<typeof Relation>;

// ---- writer input ---------------------------------------------------------------------

const InputCitations = z
  .array(Citation)
  .max(CONCEPT_LIMITS.citations, { error: `At most ${CONCEPT_LIMITS.citations} citations here.` });

const Aliases = z.array(ShortName).max(CONCEPT_LIMITS.aliases);

/** Create a concept, or (in a bulk call) say what a concept is so it is created or updated. */
export const ConceptInput = z.strictObject({
  type: ConceptType,
  name: ConceptName,
  aliases: Aliases.optional(),
  drug: DrugInput.optional(),
  summary: richText(CONCEPT_LIMITS.summaryChars).optional(),
  citations: InputCitations.optional(),
  generalKnowledge: z.boolean().optional(),
});
export type ConceptInput = z.infer<typeof ConceptInput>;

/** Change a concept. The type never changes (make a new concept and merge); lists are replaced whole. */
export const UpdateConceptInput = z
  .strictObject({
    name: ConceptName.optional(),
    aliases: Aliases.optional(),
    drug: DrugInput.optional(),
    summary: richText(CONCEPT_LIMITS.summaryChars).optional(),
    citations: InputCitations.optional(),
    generalKnowledge: z.boolean().optional(),
  })
  .refine((input) => Object.keys(input).length > 0, {
    error: "Send at least one field to change.",
  });
export type UpdateConceptInput = z.infer<typeof UpdateConceptInput>;

/** A concept named by ID, or by type and name (which finds it, or one made earlier in the same bulk call). */
export const ConceptRef = z.union(
  [z.strictObject({ id: ConceptId }), z.strictObject({ type: ConceptType, name: ConceptName })],
  {
    error:
      'Name a concept by ID, {"id": "con_…"}, or by type and name, {"type": "drug", "name": "metoprolol"}.',
  },
);
export type ConceptRef = z.infer<typeof ConceptRef>;

/** Create a relation between two existing concepts, or (in bulk) between refs. */
export const RelationInput = z.strictObject({
  from: ConceptRef,
  to: ConceptRef,
  type: RelationType,
  note: z.string().trim().max(CONCEPT_LIMITS.noteChars).optional(),
  interaction: RelationInteraction.optional(),
  citations: InputCitations.optional(),
  generalKnowledge: z.boolean().optional(),
});
export type RelationInput = z.infer<typeof RelationInput>;

export const UpdateRelationInput = z
  .strictObject({
    note: z.string().trim().max(CONCEPT_LIMITS.noteChars).optional(),
    interaction: RelationInteraction.nullable().optional(),
    citations: InputCitations.optional(),
    generalKnowledge: z.boolean().optional(),
  })
  .refine((input) => Object.keys(input).length > 0, {
    error: "Send at least one field to change.",
  });
export type UpdateRelationInput = z.infer<typeof UpdateRelationInput>;

/** Many concepts and relations in one call, matched by type and normalised name. */
export const BulkUpsertInput = z.strictObject({
  concepts: z.array(z.unknown()).max(CONCEPT_LIMITS.bulkConcepts).default([]),
  relations: z.array(z.unknown()).max(CONCEPT_LIMITS.bulkRelations).default([]),
  /** Apply what is valid and report the rest. Default false: any problem means nothing is written. */
  partial: z.boolean().default(false),
});
export type BulkUpsertInput = z.infer<typeof BulkUpsertInput>;

export const MergeConceptsInput = z.strictObject({
  /** The concept that goes away; its ID then redirects to the one in the URL. */
  mergeId: ConceptId,
});
export type MergeConceptsInput = z.infer<typeof MergeConceptsInput>;

export const ReviewInput = z.strictObject({ status: ReviewStatus });
export type ReviewInput = z.infer<typeof ReviewInput>;

// ---- citation rule for agents ---------------------------------------------------------------

export const CONCEPT_CITATION_RULE_TEXT =
  'A concept or relation written by an agent needs at least one citation (fileId, pageId and the exact quoted passage), or "generalKnowledge": true, which the app labels "not from your notes". It cannot have both.';

/** The citation rule for a new concept or relation. Her own are exempt. */
export function conceptCitationIssue(
  value: { citations?: readonly unknown[] | undefined; generalKnowledge?: boolean | undefined },
  noun: "concept" | "relation",
): string | null {
  const count = value.citations?.length ?? 0;
  if (value.generalKnowledge === true && count > 0) {
    return `This ${noun} says it is general knowledge and also cites her notes. Pick one: remove "generalKnowledge" if it is from her notes, or remove the citations if it is not.`;
  }
  if (count === 0 && value.generalKnowledge !== true) {
    return `This ${noun} has no citation. ${CONCEPT_CITATION_RULE_TEXT}`;
  }
  return null;
}

export const CONCEPT_EXAMPLE_CITATION = {
  fileId: "fil_01J9Z8Y7X6W5V4T3S2R1Q0P9N8",
  pageId: "pag_01J9Z8Y7X6W5V4T3S2R1Q0P9N8",
  quote: "Metoprolol is a cardioselective beta-1 blocker.",
  label: "Slide 4",
} as const;

export const CONCEPT_EXAMPLES = {
  concept: {
    type: "drug",
    name: "metoprolol",
    aliases: ["metoprolol tartrate"],
    drug: { brandNames: ["Lopressor", "Toprol-XL"] },
    summary: "Cardioselective (beta-1) beta blocker.",
    citations: [CONCEPT_EXAMPLE_CITATION],
  },
  relation: {
    from: { type: "drug", name: "metoprolol" },
    to: { type: "adverse_effect", name: "bradycardia" },
    type: "causes_adverse_effect",
    citations: [CONCEPT_EXAMPLE_CITATION],
  },
  interaction: {
    from: { type: "drug", name: "metoprolol" },
    to: { type: "drug", name: "verapamil" },
    type: "interacts_with",
    interaction: { severity: "major", effect: "additive bradycardia and AV block" },
    citations: [CONCEPT_EXAMPLE_CITATION],
  },
  bulk: {
    concepts: [
      {
        type: "drug",
        name: "metoprolol",
        drug: { brandNames: ["Lopressor"] },
        citations: [CONCEPT_EXAMPLE_CITATION],
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
    partial: false,
  },
} as const;

// ---- problems ----------------------------------------------------------------------------------

/** Zod issues as problems an agent can act on: a path, plain words and a valid example. */
export function conceptProblems(
  issues: readonly z.core.$ZodIssue[],
  prefix: string,
  example: unknown,
): Problem[] {
  const out: Problem[] = [];
  for (const issue of issues) {
    let message = issue.message;
    const path = formatPath(issue.path, prefix);
    if (issue.code === "unrecognized_keys") {
      message = `Unknown field${issue.keys.length === 1 ? "" : "s"}: ${issue.keys.join(", ")}. Remove ${issue.keys.length === 1 ? "it" : "them"}; the server sets its own fields.`;
    } else if (issue.code === "invalid_type" && /received undefined/.test(issue.message)) {
      message = `Missing required field "${String(issue.path[issue.path.length - 1])}".`;
    }
    out.push({ path, message, example });
  }
  return out;
}

export type Validated<T> = { ok: true; value: T } | { ok: false; problems: Problem[] };

export type Writer = "agent" | "user";

function writerOf(writer: Writer | Actor): Writer {
  return typeof writer === "string" ? writer : writer.type === "user" ? "user" : "agent";
}

/** Validate one concept as an agent or she would send it. Agents are held to the citation rule. */
export function validateConceptInput(
  raw: unknown,
  options: { writer?: Writer | Actor; pathPrefix?: string } = {},
): Validated<ConceptInput> {
  const prefix = options.pathPrefix ?? "$";
  const parsed = ConceptInput.safeParse(raw);
  if (!parsed.success) {
    return {
      ok: false,
      problems: conceptProblems(parsed.error.issues, prefix, CONCEPT_EXAMPLES.concept),
    };
  }
  const problems: Problem[] = [];
  const value = parsed.data;
  if (value.drug !== undefined && value.type !== "drug") {
    problems.push({
      path: formatPath(["drug"], prefix),
      message: `"drug" details (brand names, RxCUI) only belong on a concept of type "drug", not "${value.type}". Remove "drug" or change the type.`,
      example: CONCEPT_EXAMPLES.concept,
    });
  }
  if (writerOf(options.writer ?? "agent") === "agent") {
    const issue = conceptCitationIssue(value, "concept");
    if (issue) {
      problems.push({
        path: formatPath(["citations"], prefix),
        message: issue,
        example: CONCEPT_EXAMPLES.concept,
      });
    }
  }
  return problems.length > 0 ? { ok: false, problems } : { ok: true, value };
}

/** Validate one relation's own fields (types of the ends are checked once the concepts are known). */
export function validateRelationInput(
  raw: unknown,
  options: { writer?: Writer | Actor; pathPrefix?: string } = {},
): Validated<RelationInput> {
  const prefix = options.pathPrefix ?? "$";
  const parsed = RelationInput.safeParse(raw);
  if (!parsed.success) {
    return {
      ok: false,
      problems: conceptProblems(parsed.error.issues, prefix, CONCEPT_EXAMPLES.relation),
    };
  }
  const value = parsed.data;
  const problems: Problem[] = [];
  if (value.interaction !== undefined && value.type !== "interacts_with") {
    problems.push({
      path: formatPath(["interaction"], prefix),
      message: `Severity and effect only belong on an "interacts_with" relation, not "${value.type}". Remove "interaction", or use type "interacts_with".`,
      example: CONCEPT_EXAMPLES.interaction,
    });
  }
  if ("id" in value.from && "id" in value.to && value.from.id === value.to.id) {
    problems.push({
      path: formatPath(["to"], prefix),
      message: 'A concept cannot be related to itself. Pick a different concept for "to".',
      example: CONCEPT_EXAMPLES.relation,
    });
  }
  if (writerOf(options.writer ?? "agent") === "agent") {
    const issue = conceptCitationIssue(value, "relation");
    if (issue) {
      problems.push({
        path: formatPath(["citations"], prefix),
        message: issue,
        example: CONCEPT_EXAMPLES.relation,
      });
    }
  }
  return problems.length > 0 ? { ok: false, problems } : { ok: true, value };
}

/** Keep each distinct cited passage once, in first-seen order. */
export function mergeCitations(
  ...lists: ReadonlyArray<readonly Citation[] | undefined>
): Citation[] {
  const seen = new Set<string>();
  const out: Citation[] = [];
  for (const list of lists) {
    for (const citation of list ?? []) {
      const key = citationKey(citation);
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(citation);
    }
  }
  return out;
}

// ---- bulk results ----------------------------------------------------------------------------------

/**
 * What happened to one item: created or updated, unchanged (already said),
 * rejected (a problem, see `problems`), or not_applied (fine, but atomic mode
 * wrote nothing because another item had a problem).
 */
export const BulkItemAction = z.enum([
  "created",
  "updated",
  "unchanged",
  "rejected",
  "not_applied",
]);
export type BulkItemAction = z.infer<typeof BulkItemAction>;

export const BulkProblem = z.object({
  path: z.string(),
  message: z.string(),
  example: z.unknown().optional(),
});
export type BulkProblem = z.infer<typeof BulkProblem>;

export const BulkConceptResult = z.object({
  index: z.number().int().min(0),
  action: BulkItemAction,
  id: ConceptId.nullable(),
  name: z.string(),
  /** Look-alikes found among existing concepts. Never merged for you. */
  suggestions: z.array(
    z.object({
      conceptId: ConceptId,
      name: z.string(),
      reason: z.enum(["alias_match", "salt_variant", "close_spelling"]),
      explanation: z.string(),
    }),
  ),
  /** Fields left alone because she wrote or reviewed them. */
  protectedFields: z.array(z.string()),
});
export type BulkConceptResult = z.infer<typeof BulkConceptResult>;

export const BulkRelationResult = z.object({
  index: z.number().int().min(0),
  action: BulkItemAction,
  id: RelationId.nullable(),
});
export type BulkRelationResult = z.infer<typeof BulkRelationResult>;

export const BulkUpsertResult = z.object({
  /** False when atomic mode refused the whole call because of a problem: nothing was written. */
  applied: z.boolean(),
  partial: z.boolean(),
  created: z.number().int().min(0),
  updated: z.number().int().min(0),
  /** Unchanged plus rejected. */
  skipped: z.number().int().min(0),
  concepts: z.array(BulkConceptResult),
  relations: z.array(BulkRelationResult),
  problems: z.array(BulkProblem),
});
export type BulkUpsertResult = z.infer<typeof BulkUpsertResult>;

// ---- reading: page, graph, path, filters, comparison, drill --------------------------------------------

export const RelationGroupItem = z.object({
  relation: Relation,
  /** The concept at the other end. */
  concept: ConceptSummary,
});
export type RelationGroupItem = z.infer<typeof RelationGroupItem>;

export const RelationGroup = z.object({
  type: RelationType,
  /** "out": this concept is the "from" end; "in": it is the "to" end. Symmetric relations are listed once as "out". */
  direction: z.enum(["out", "in"]),
  /** How to read it: "can cause" or "is caused by". */
  label: z.string(),
  items: z.array(RelationGroupItem),
});
export type RelationGroup = z.infer<typeof RelationGroup>;

export const MentionedIn = z.object({
  documentId: DocumentId,
  blockId: z.string().nullable(),
  nodeId: NodeId.nullable(),
  title: z.string(),
  preview: z.string(),
  trashed: z.boolean(),
});
export type MentionedIn = z.infer<typeof MentionedIn>;

export const QuestionLink = z.object({
  questionId: QuestionId,
  stem: z.string(),
  nodeId: NodeId.nullable(),
});
export type QuestionLink = z.infer<typeof QuestionLink>;

export const PageSource = z.object({
  citation: Citation,
  status: CitationStatus,
  fileName: z.string().nullable(),
  pageIndex: z.number().int().min(1).nullable(),
  /** What the citation supports: the concept itself or one of its relations. */
  supports: z.discriminatedUnion("kind", [
    z.object({ kind: z.literal("concept") }),
    z.object({ kind: z.literal("relation"), relationId: RelationId, sentence: z.string() }),
  ]),
});
export type PageSource = z.infer<typeof PageSource>;

/** Everything about one concept (F2). */
export const ConceptPage = z.object({
  concept: Concept,
  /** Set when the ID asked for had been merged into this concept. */
  redirectedFrom: ConceptId.nullable(),
  groups: z.array(RelationGroup),
  mentions: z.array(MentionedIn),
  questions: z.array(QuestionLink),
  sources: z.array(PageSource),
  /** Look-alikes that might be the same concept; for a person to review. */
  suggestions: z.array(
    z.object({
      conceptId: ConceptId,
      name: z.string(),
      reason: z.string(),
      explanation: z.string(),
    }),
  ),
});
export type ConceptPage = z.infer<typeof ConceptPage>;

export const GraphEdge = z.object({
  id: RelationId,
  from: ConceptId,
  to: ConceptId,
  type: RelationType,
  note: z.string(),
});
export type GraphEdge = z.infer<typeof GraphEdge>;

export const GraphQuery = z.strictObject({
  hops: z.number().int().min(1).max(CONCEPT_LIMITS.graphMaxHops).default(1),
  maxNodes: z
    .number()
    .int()
    .min(2)
    .max(CONCEPT_LIMITS.graphMaxNodes)
    .default(CONCEPT_LIMITS.graphDefaultNodes),
  relationTypes: z.array(RelationType).max(RELATION_TYPES.length).optional(),
});
export type GraphQuery = z.infer<typeof GraphQuery>;

/** The concepts and relations within a few steps of one concept (F3). */
export const GraphResult = z.object({
  center: ConceptId,
  hops: z.number().int(),
  nodes: z.array(ConceptSummary),
  edges: z.array(GraphEdge),
  /** True when more concepts lay within reach than `maxNodes` allowed. */
  truncated: z.boolean(),
});
export type GraphResult = z.infer<typeof GraphResult>;

export const PathStep = z.object({
  relation: GraphEdge,
  /** "forward": walked from the relation's "from" to its "to". */
  direction: z.enum(["forward", "backward"]),
  from: ConceptSummary,
  to: ConceptSummary,
});
export type PathStep = z.infer<typeof PathStep>;

export const PathResult = z.object({
  found: z.boolean(),
  from: ConceptId,
  to: ConceptId,
  steps: z.array(PathStep),
});
export type PathResult = z.infer<typeof PathResult>;

/** How a concept came to match a filter: the relation is its own, or its class's. */
export const FilterVia = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("direct") }),
  z.object({ kind: z.literal("class"), class: ConceptSummary }),
]);
export type FilterVia = z.infer<typeof FilterVia>;

/** Cross-course questions over the relation graph (F5). */
export const ConceptFilter = z.discriminatedUnion(
  "kind",
  [
    /** Concepts that have `relation` pointing at `target`: every drug that causes bradycardia, treats hypertension… */
    z.strictObject({
      kind: z.literal("with_relation"),
      relation: RelationType,
      target: ConceptRef,
      /** Which end is wanted. "from" (default): concepts that point at the target. */
      side: z.enum(["from", "to"]).default("from"),
      /** Count a drug when its class has the relation (default true); the row says so. */
      viaClass: z.boolean().default(true),
      /** Only concepts of these types (default: any). */
      types: z.array(ConceptType).max(CONCEPT_TYPES.length).optional(),
      limit: z.number().int().min(1).max(500).default(200),
    }),
    /** Drugs in a class, including narrower classes by default. */
    z.strictObject({
      kind: z.literal("in_class"),
      class: ConceptRef,
      includeSubclasses: z.boolean().default(true),
      limit: z.number().int().min(1).max(500).default(200),
    }),
    /** Other drugs that share a mechanism with this one (its own or its class's). */
    z.strictObject({
      kind: z.literal("sharing_mechanism"),
      drug: ConceptRef,
      limit: z.number().int().min(1).max(500).default(200),
    }),
  ],
  {
    error:
      'A filter has a "kind": "with_relation" (relation, target), "in_class" (class) or "sharing_mechanism" (drug).',
  },
);
export type ConceptFilter = z.infer<typeof ConceptFilter>;

export const FilterRow = z.object({
  concept: ConceptSummary,
  via: FilterVia,
  /** The relations that put it in the result. */
  relationIds: z.array(RelationId),
  /** What the answer rests on: citations of those relations, each once. */
  citations: z.array(Citation),
  generalKnowledge: z.boolean(),
  /** For sharing_mechanism: the mechanisms they share. */
  sharedMechanisms: z.array(ConceptSummary).optional(),
});
export type FilterRow = z.infer<typeof FilterRow>;

export const FilterResult = z.object({
  items: z.array(FilterRow),
  truncated: z.boolean(),
});
export type FilterResult = z.infer<typeof FilterResult>;

/** A column of a comparison table: a relation type, or the brand names. */
export const ComparisonAttribute = z.union([RelationType, z.literal("brand_names")], {
  error: `An attribute is a relation type (${RELATION_TYPES.join(", ")}) or "brand_names".`,
});
export type ComparisonAttribute = z.infer<typeof ComparisonAttribute>;

export const COMPARISON_LABELS: Record<ComparisonAttribute, string> = {
  belongs_to_class: "Class",
  has_mechanism: "Mechanism",
  acts_on: "Acts on",
  treats: "Indications",
  causes_adverse_effect: "Adverse effects",
  interacts_with: "Interactions",
  contraindicated_in: "Contraindications",
  monitored_by: "Monitoring",
  brand_of: "Brand of",
  related_to: "Related",
  brand_names: "Brand names",
};

/** Build the data for a comparison table (D5): drugs down the side, attributes across. */
export const ComparisonInput = z.strictObject({
  conceptIds: z.array(ConceptId).min(2).max(CONCEPT_LIMITS.compareConcepts),
  attributes: z.array(ComparisonAttribute).min(1).max(CONCEPT_LIMITS.compareAttributes),
  /** Also list what the drug's classes have, marked as inherited (default false). */
  includeClass: z.boolean().default(false),
});
export type ComparisonInput = z.infer<typeof ComparisonInput>;

export const ComparisonValue = z.object({
  text: z.string(),
  concept: ConceptSummary.nullable(),
  relationId: RelationId.nullable(),
  /** Set when the value comes from the drug's class. */
  inheritedFrom: ConceptSummary.nullable(),
  citations: z.array(Citation),
});
export type ComparisonValue = z.infer<typeof ComparisonValue>;

export const ComparisonCell = z.object({
  attribute: ComparisonAttribute,
  values: z.array(ComparisonValue),
  /** The citations of every value in the cell, each once. */
  citations: z.array(Citation),
});
export type ComparisonCell = z.infer<typeof ComparisonCell>;

export const ComparisonResult = z.object({
  columns: z.array(z.object({ attribute: ComparisonAttribute, label: z.string() })),
  rows: z.array(z.object({ concept: ConceptSummary, cells: z.array(ComparisonCell) })),
});
export type ComparisonResult = z.infer<typeof ComparisonResult>;

/** One brand and its generic, for the matching drill (G12). */
export const BrandGenericPair = z.object({
  conceptId: ConceptId,
  generic: z.string(),
  brand: z.string(),
  /** The drug's class, for the third column of the drill. */
  drugClass: z.string().nullable(),
  citations: z.array(Citation),
});
export type BrandGenericPair = z.infer<typeof BrandGenericPair>;

export const ConceptListQuery = z.object({
  type: ConceptType.optional(),
  q: z.string().trim().min(1).max(200).optional(),
  cursor: z.string().max(200).optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
});
export type ConceptListQuery = z.infer<typeof ConceptListQuery>;
