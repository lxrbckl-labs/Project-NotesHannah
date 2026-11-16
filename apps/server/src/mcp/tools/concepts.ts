import {
  CONCEPT_EXAMPLES,
  ComparisonInput,
  ConceptId,
  ConceptInput,
  type ConceptPage,
  type ConceptSummary,
  ConceptType,
  GraphQuery,
  RelationInput,
  RelationType,
  RequestId,
} from "@notes/schema";
import { z } from "zod";
import { AppError } from "../../http/errors.js";
import { PublishedCitation } from "../citation.js";
import { exampleId } from "../errors.js";
import { clip, json } from "../format.js";
import type { ConceptsToolPort } from "../ports.js";
import { checkQuotes } from "../quotes.js";
import { describe, flattenActions, jsonOf } from "../schema.js";
import { defineTool, parseAction, type ToolContext } from "../tool.js";

const CON = exampleId("concept");

function port(ctx: ToolContext): ConceptsToolPort {
  const p = ctx.backend.concepts;
  if (!p) throw new AppError("internal", "Concepts are not available.");
  return p;
}

const summary = (c: ConceptSummary) =>
  `${c.id} ${c.type} "${c.name}"${c.genericName && c.genericName !== c.name ? ` (${c.genericName})` : ""}${c.reviewStatus === "reviewed" ? ", reviewed" : ""}`;

export function pageText(page: ConceptPage): string {
  const c = page.concept;
  const lines = [
    `Concept ${c.id}: ${c.type} "${c.name}"${c.aliases.length ? `, also ${c.aliases.join(", ")}` : ""}${c.drug?.brandNames?.length ? `, brands ${c.drug.brandNames.join(", ")}` : ""}.`,
  ];
  if (page.redirectedFrom) lines.push(`(${page.redirectedFrom} was merged into it.)`);
  if (c.summary) lines.push(`Summary: ${clip(JSON.stringify(c.summary), 300).text}`);
  for (const g of page.groups) {
    lines.push(
      `${g.label}: ${g.items.map((i) => `${i.concept.name} (${i.concept.id})`).join(", ")}`,
    );
  }
  lines.push(
    `Mentioned in ${page.mentions.length} document block(s); tested by ${page.questions.length} question(s); ${page.sources.length} source page(s).`,
  );
  if (page.suggestions.length) {
    lines.push(
      `Look-alikes (maybe the same concept; merging is hers unless she asks): ${page.suggestions.map((s) => `${s.name} (${s.conceptId}, ${s.reason})`).join(", ")}`,
    );
  }
  return lines.join("\n");
}

/**
 * Concept and relation items are published and parsed loosely (their key
 * fields only): the concepts domain checks each item against ConceptInput and
 * RelationInput and answers every problem with its path, the rule and an
 * example, which teaches better than a schema error and keeps this schema small.
 */
const LooseRef = z.record(z.string(), z.unknown());
const ConceptItem = z.looseObject({
  type: ConceptInput.shape.type,
  name: z.string(),
  citations: z.array(PublishedCitation).optional(),
  generalKnowledge: z.boolean().optional(),
});
const RelationItem = z.looseObject({
  from: LooseRef,
  to: LooseRef,
  type: RelationInput.shape.type,
  citations: z.array(PublishedCitation).optional(),
  generalKnowledge: z.boolean().optional(),
});

const BRANCHES = {
  upsert: z.strictObject({
    concepts: z.array(ConceptItem).max(200).default([]),
    relations: z.array(RelationItem).max(500).default([]),
    partial: z.boolean().default(false),
  }),
  search: z.strictObject({
    query: z.string().trim().min(1).max(200),
    type: ConceptType.optional(),
    limit: z.number().int().min(1).max(50).default(20),
  }),
  page: z.strictObject({ conceptId: ConceptId }),
  neighbourhood: z.strictObject({ conceptId: ConceptId, ...GraphQuery.shape }),
  path: z.strictObject({
    from: ConceptId,
    to: ConceptId,
    maxHops: z.number().int().min(1).max(8).optional(),
    relationTypes: z.array(RelationType).optional(),
  }),
  filter: z.strictObject({ filter: z.record(z.string(), z.unknown()) }),
  compare: z.strictObject({ ...ComparisonInput.shape }),
  suggestions: z.strictObject({ conceptId: ConceptId }),
  merge: z.strictObject({ keepId: ConceptId, mergeId: ConceptId, requestId: RequestId }),
};
type Action = keyof typeof BRANCHES;

const EXAMPLES: Record<Action, Record<string, unknown>> = {
  upsert: { action: "upsert", ...CONCEPT_EXAMPLES.bulk },
  search: { action: "search", query: "metoprolol" },
  page: { action: "page", conceptId: CON },
  neighbourhood: { action: "neighbourhood", conceptId: CON, hops: 1 },
  path: { action: "path", from: CON, to: exampleId("concept") },
  filter: {
    action: "filter",
    filter: {
      kind: "with_relation",
      relation: "causes_adverse_effect",
      target: { type: "adverse_effect", name: "bradycardia" },
    },
  },
  compare: {
    action: "compare",
    conceptIds: [CON, "con_01J9Z8Y7X6W5V4T3S2R1Q0P9N9"],
    attributes: ["belongs_to_class", "causes_adverse_effect", "brand_names"],
  },
  suggestions: { action: "suggestions", conceptId: CON },
  merge: {
    action: "merge",
    keepId: CON,
    mergeId: "con_01J9Z8Y7X6W5V4T3S2R1Q0P9N9",
    requestId: exampleId("request"),
  },
};

const CITE = {
  fileId: "The source file.",
  pageId: "The source page.",
  quote: "The supporting passage, copied character for character from that page's transcript.",
  label: 'Optional chip label, e.g. "Slide 4".',
};
const cite = (prefix: string) =>
  Object.fromEntries(Object.entries(CITE).map(([k, v]) => [`${prefix}.${k}`, v]));

export const conceptsTool = defineTool({
  name: "concepts",
  title: "The concept map: drugs, classes, mechanisms and how they relate",
  description:
    'Her structured layer: typed concepts (drug, drug_class, mechanism, target, indication, adverse_effect, interaction, contraindication, monitoring_parameter, counselling_point, other) and typed relations between them (belongs_to_class, has_mechanism, acts_on, treats, causes_adverse_effect, interacts_with, contraindicated_in, monitored_by, brand_of, related_to), each citing the page it came from. "upsert" up to 200 concepts and 500 relations in one call, matched by type and name (relations name their ends by {"type","name"} or {"id"}; atomic unless partial; each problem has a path, the rule and an example; a relation only fits certain type pairs, see start_here {"topic":"concepts"}). Reads: "search", "page" (everything known about one concept), "neighbourhood" (the graph around it), "path" between two, "filter" (every drug that causes X, drugs in a class, drugs sharing a mechanism), "compare" (comparison-table data for drugs), "suggestions" (look-alikes that may be duplicates). "merge" is hers: only with the requestId of her request asking for it, claimed by you.',
  annotations: {
    readOnlyHint: false,
    destructiveHint: true,
    idempotentHint: false,
    openWorldHint: false,
  },
  inputSchema: describe(
    flattenActions(
      "action",
      Object.fromEntries(Object.entries(BRANCHES).map(([k, v]) => [k, jsonOf(v)])),
      "What to do; see the tool description.",
    ),
    {
      concepts:
        'upsert: concepts to create or update, matched by type and normalised name. Optional fields: "aliases" (other names), "drug" ({"brandNames": ["Lopressor"]}), "summary" (a sentence or two).',
      "concepts[].type": "The concept type.",
      "concepts[].name": 'The name; for a drug its generic name, e.g. "metoprolol".',
      "concepts[].citations": "Where it is stated in her notes (or set generalKnowledge).",
      ...cite("concepts[].citations[]"),
      "concepts[].generalKnowledge": "True when not from her notes; never with citations.",
      relations:
        'upsert: relations; their ends may be concepts created in the same call. Optional: "note", and for interacts_with "interaction": {"severity": "minor|moderate|major|contraindicated", "effect": "…"}.',
      "relations[].from": 'The "from" end: {"id":"con_…"} or {"type":"drug","name":"metoprolol"}.',
      "relations[].to": "The other end, the same way.",
      "relations[].type": "The relation type; only certain concept type pairs fit.",
      "relations[].citations": "Where it is stated (or set generalKnowledge).",
      ...cite("relations[].citations[]"),
      "relations[].generalKnowledge": "True when not from her notes.",
      partial: "upsert: write the valid items and report the rest (default: all or nothing).",
      query: "search: words in a name, alias or brand.",
      type: "search: only this concept type.",
      limit: "search: 1 to 50 (default 20).",
      conceptId: `The concept, e.g. "${CON}".`,
      hops: "neighbourhood: steps out, 1 to 4 (default 1).",
      maxNodes: "neighbourhood: most concepts returned (default 60).",
      relationTypes: "neighbourhood, path: only these relation types.",
      from: "path: the start concept.",
      to: "path: the end concept.",
      maxHops: "path: longest path, 1 to 8 (default 6).",
      filter:
        'filter: {"kind":"with_relation","relation":"causes_adverse_effect","target":{"type":"adverse_effect","name":"bradycardia"}}, {"kind":"in_class","class":{…}} or {"kind":"sharing_mechanism","drug":{…}}.',
      conceptIds: "compare: 2 to 20 drugs (con_ IDs).",
      attributes:
        'compare: up to 10 relation types to tabulate, or "brand_names", e.g. ["belongs_to_class","causes_adverse_effect"].',
      includeClass: "compare: also show what each drug's classes have, marked inherited.",
      keepId: "merge: the concept that stays.",
      mergeId: "merge: the concept folded into it (its ID then redirects).",
      requestId: "merge: her request asking for this merge, claimed by you.",
    },
  ),
  parse: (raw) => parseAction("concepts", "action", BRANCHES, EXAMPLES, raw),
  writes: (input) => ["upsert", "merge"].includes((input as { action: string }).action),
  action: (input) => (input as { action: string }).action,
  run(ctx, input) {
    const p = port(ctx);
    const { action, value } = input as unknown as {
      action: Action;
      value: Record<string, unknown>;
    };
    switch (action) {
      case "upsert": {
        if (!value.partial) checkQuotes(ctx, value);
        const r = p.bulkUpsert(ctx.auth, value);
        if (!r.applied) {
          // Nothing was written: an error, so an agent cannot mistake it for success.
          throw new AppError(
            "invalid_input",
            `Nothing was written: ${r.problems.length} problem(s). ${r.problems
              .slice(0, 8)
              .map((pr) => `${pr.path}: ${pr.message}`)
              .join(" | ")}`,
            {
              hint: 'Fix each named item and send the call again, or send "partial": true to write the valid ones.',
              example: r.problems[0]?.example,
            },
          );
        }
        const lines = [
          r.applied
            ? `Applied: ${r.created} created, ${r.updated} updated, ${r.skipped} unchanged or rejected.`
            : `Nothing was written (${r.problems.length} problem(s); fix them, or send "partial": true).`,
          ...r.concepts.map(
            (c) =>
              `- concepts[${c.index}] ${c.action} ${c.id ?? ""} "${c.name}"${c.suggestions.length ? `; look-alikes: ${c.suggestions.map((s) => `${s.name} (${s.conceptId})`).join(", ")}` : ""}${c.protectedFields.length ? `; left alone (hers): ${c.protectedFields.join(", ")}` : ""}`,
          ),
          ...r.relations.map((x) => `- relations[${x.index}] ${x.action} ${x.id ?? ""}`),
          ...r.problems.map(
            (pr) => `- problem at ${pr.path}: ${pr.message} Example: ${json(pr.example)}`,
          ),
        ];
        return { text: lines.join("\n"), structured: { ...r } };
      }
      case "search": {
        const items = p.search(ctx.auth, value.query as string, {
          type: value.type as ConceptType | undefined,
          limit: value.limit as number,
        });
        const list = Array.isArray(items) ? items : (items as { items: ConceptSummary[] }).items;
        return {
          text: [`${list.length} concept(s).`, ...list.map((c) => `- ${summary(c)}`)].join("\n"),
          structured: { items: list },
        };
      }
      case "page":
        return conceptPage(ctx, value.conceptId as string);
      case "neighbourhood": {
        const { conceptId, ...q } = value;
        const g = p.neighbourhood(ctx.auth, conceptId as string, q);
        const names = new Map(g.nodes.map((n) => [n.id, n.name]));
        const lines = [
          `${g.nodes.length} concept(s) within ${g.hops} step(s)${g.truncated ? " (cut at maxNodes)" : ""}:`,
          ...g.edges.map(
            (e) => `- ${names.get(e.from) ?? e.from} ${e.type} ${names.get(e.to) ?? e.to}`,
          ),
        ];
        return { text: lines.join("\n"), structured: { ...g } };
      }
      case "path": {
        const r = p.path(ctx.auth, value.from as string, value.to as string, {
          maxHops: value.maxHops as number | undefined,
          relationTypes: value.relationTypes as never,
        });
        return { text: `Path: ${json(r)}`, structured: { ...r } };
      }
      case "filter": {
        const r = p.filter(ctx.auth, value.filter);
        const lines = [
          `${r.items.length} match(es)${r.truncated ? " (more exist)" : ""}:`,
          ...r.items.map(
            (row) =>
              `- ${summary(row.concept)}${row.via.kind === "class" ? ` via class ${row.via.class.name}` : ""}; ${row.citations.length} citation(s)${row.generalKnowledge ? ", general knowledge" : ""}`,
          ),
        ];
        return { text: lines.join("\n"), structured: { ...r } };
      }
      case "compare": {
        const r = p.compare(ctx.auth, value);
        const lines = [
          `Comparison (${r.columns.map((c) => c.label).join(" | ")}):`,
          ...r.rows.map(
            (row) =>
              `- ${row.concept.name}: ${row.cells.map((c) => c.values.map((v) => v.text).join(", ") || "-").join(" | ")}`,
          ),
          "Each cell's citations are in the structured result: cite them when you write the table (comparison_table block).",
        ];
        return { text: lines.join("\n"), structured: { ...r } };
      }
      case "suggestions": {
        const s = p.suggestionsFor(ctx.auth, value.conceptId as string);
        return {
          text: `Possible duplicates (for her to decide): ${json(s)}`,
          structured: { suggestions: s },
        };
      }
      default: {
        const requestId = value.requestId as string;
        const req = ctx.backend.requests?.get(ctx.auth, requestId);
        const mine =
          req &&
          req.status === "in_progress" &&
          req.claimedBy?.type === "agent" &&
          req.claimedBy.keyId === ctx.keyId;
        if (!mine) {
          throw new AppError(
            "forbidden",
            "Merging concepts is her decision: an agent may merge only when her request asks for it and you hold its claim.",
            {
              hint: 'Report look-alikes in your reply (or a request reply) instead. If she asked: claim it first with requests {"action":"claim","requestId":"…"}.',
            },
          );
        }
        const r = p.merge(ctx.auth, value.keepId as string, value.mergeId as string);
        return { text: `Merged: ${json(r)}`, structured: { ...r } };
      }
    }
  },
});

/** get_item on a con_ ID, and concepts {"action":"page"}. */
export function conceptPage(ctx: ToolContext, id: string) {
  const page = port(ctx).page(ctx.auth, id);
  return { text: pageText(page), structured: { kind: "concept", page } };
}
