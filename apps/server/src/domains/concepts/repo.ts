import {
  type Actor,
  type Citation,
  type Concept,
  type ConceptSummary,
  type ConceptType,
  type DrugInfo,
  normalizeName,
  RELATION_RULES,
  type Relation,
  type RelationInteraction,
  type RelationType,
  type RichText,
} from "@notes/schema";
import type { Db } from "../../db/client.js";

export interface ConceptRow {
  seq: number;
  id: string;
  user_id: string;
  type: ConceptType;
  name: string;
  name_key: string;
  aliases: string;
  drug: string | null;
  summary: string;
  citations: string;
  general_knowledge: number;
  review_status: Concept["reviewStatus"];
  origin: Concept["origin"];
  created_by: string;
  created_at: string;
  last_edited_by: string;
  last_edited_at: string;
  search_text: string;
}

export interface RelationRow {
  seq: number;
  id: string;
  user_id: string;
  from_id: string;
  to_id: string;
  type: RelationType;
  pair_key: string;
  note: string;
  interaction: string | null;
  citations: string;
  general_knowledge: number;
  review_status: Relation["reviewStatus"];
  origin: Relation["origin"];
  created_by: string;
  created_at: string;
  last_edited_by: string;
  last_edited_at: string;
}

export const toConcept = (r: ConceptRow): Concept => ({
  id: r.id,
  type: r.type,
  name: r.name,
  aliases: JSON.parse(r.aliases) as string[],
  drug: r.drug === null ? null : (JSON.parse(r.drug) as DrugInfo),
  summary: JSON.parse(r.summary) as RichText,
  citations: JSON.parse(r.citations) as Citation[],
  generalKnowledge: r.general_knowledge === 1,
  reviewStatus: r.review_status,
  origin: r.origin,
  provenance: {
    createdBy: JSON.parse(r.created_by) as Actor,
    createdAt: r.created_at,
    lastEditedBy: JSON.parse(r.last_edited_by) as Actor,
    lastEditedAt: r.last_edited_at,
  },
});

export const toRelation = (r: RelationRow): Relation => ({
  id: r.id,
  from: r.from_id,
  to: r.to_id,
  type: r.type,
  note: r.note,
  interaction: r.interaction === null ? null : (JSON.parse(r.interaction) as RelationInteraction),
  citations: JSON.parse(r.citations) as Citation[],
  generalKnowledge: r.general_knowledge === 1,
  reviewStatus: r.review_status,
  origin: r.origin,
  provenance: {
    createdBy: JSON.parse(r.created_by) as Actor,
    createdAt: r.created_at,
    lastEditedBy: JSON.parse(r.last_edited_by) as Actor,
    lastEditedAt: r.last_edited_at,
  },
});

export const summaryOf = (c: Concept): ConceptSummary => ({
  id: c.id,
  type: c.type,
  name: c.name,
  genericName: c.drug?.genericName ?? null,
  reviewStatus: c.reviewStatus,
});

/** The words the search index holds for a concept. */
export function searchText(c: Pick<Concept, "name" | "aliases" | "drug">): string {
  const words = [c.name, ...c.aliases];
  if (c.drug) words.push(...(c.drug.genericName ? [c.drug.genericName] : []), ...c.drug.brandNames);
  return [...new Set(words.map(normalizeName).filter(Boolean))].join(" ");
}

/** One row per fact: the type and both ends (put in order when the relation reads the same both ways). */
export function pairKey(type: RelationType, from: string, to: string): string {
  const ends = RELATION_RULES[type].symmetric && from > to ? [to, from] : [from, to];
  return `${type}|${ends[0]}|${ends[1]}`;
}

export type CitationOwner = "concept" | "relation";

/** The SQL behind the concepts domain. Nothing here decides policy. */
export function createConceptsRepo(db: Db) {
  const q = {
    byId: db.prepare("SELECT * FROM concepts WHERE id = ? AND user_id = ?"),
    byKey: db.prepare("SELECT * FROM concepts WHERE user_id = ? AND type = ? AND name_key = ?"),
    ofType: db.prepare(
      "SELECT * FROM concepts WHERE user_id = ? AND type = ? ORDER BY name_key, seq",
    ),
    redirect: db.prepare("SELECT to_id FROM concept_redirects WHERE from_id = ? AND user_id = ?"),
    redirectsTo: db.prepare(
      "SELECT from_id FROM concept_redirects WHERE to_id = ? AND user_id = ?",
    ),
    insertConcept: db.prepare(
      `INSERT INTO concepts (id, user_id, type, name, name_key, aliases, drug, summary, citations,
         general_knowledge, review_status, origin, created_by, created_at, last_edited_by,
         last_edited_at, search_text)
       VALUES (@id, @user_id, @type, @name, @name_key, @aliases, @drug, @summary, @citations,
         @general_knowledge, @review_status, @origin, @created_by, @created_at, @last_edited_by,
         @last_edited_at, @search_text)`,
    ),
    updateConcept: db.prepare(
      `UPDATE concepts SET name = @name, name_key = @name_key, aliases = @aliases, drug = @drug,
         summary = @summary, citations = @citations, general_knowledge = @general_knowledge,
         review_status = @review_status, origin = @origin, last_edited_by = @last_edited_by,
         last_edited_at = @last_edited_at, search_text = @search_text
       WHERE id = @id AND user_id = @user_id`,
    ),
    deleteConcept: db.prepare("DELETE FROM concepts WHERE id = ? AND user_id = ?"),
    relById: db.prepare("SELECT * FROM concept_relations WHERE id = ? AND user_id = ?"),
    relByPair: db.prepare("SELECT * FROM concept_relations WHERE user_id = ? AND pair_key = ?"),
    relsOf: db.prepare(
      "SELECT * FROM concept_relations WHERE user_id = ? AND (from_id = ? OR to_id = ?) ORDER BY seq",
    ),
    insertRel: db.prepare(
      `INSERT INTO concept_relations (id, user_id, from_id, to_id, type, pair_key, note, interaction,
         citations, general_knowledge, review_status, origin, created_by, created_at, last_edited_by,
         last_edited_at)
       VALUES (@id, @user_id, @from_id, @to_id, @type, @pair_key, @note, @interaction, @citations,
         @general_knowledge, @review_status, @origin, @created_by, @created_at, @last_edited_by,
         @last_edited_at)`,
    ),
    updateRel: db.prepare(
      `UPDATE concept_relations SET from_id = @from_id, to_id = @to_id, pair_key = @pair_key,
         note = @note, interaction = @interaction, citations = @citations,
         general_knowledge = @general_knowledge, review_status = @review_status, origin = @origin,
         last_edited_by = @last_edited_by, last_edited_at = @last_edited_at
       WHERE id = @id AND user_id = @user_id`,
    ),
    deleteRel: db.prepare("DELETE FROM concept_relations WHERE id = ? AND user_id = ?"),
    clearCitations: db.prepare(
      "DELETE FROM concept_citations WHERE owner_kind = ? AND owner_id = ?",
    ),
    addCitation: db.prepare(
      "INSERT INTO concept_citations (user_id, owner_kind, owner_id, file_id, page_id) VALUES (?, ?, ?, ?, ?)",
    ),
  };

  const conceptParams = (userId: string, c: Concept) => ({
    id: c.id,
    user_id: userId,
    type: c.type,
    name: c.name,
    name_key: normalizeName(c.name),
    aliases: JSON.stringify(c.aliases),
    drug: c.drug === null ? null : JSON.stringify(c.drug),
    summary: JSON.stringify(c.summary),
    citations: JSON.stringify(c.citations),
    general_knowledge: c.generalKnowledge ? 1 : 0,
    review_status: c.reviewStatus,
    origin: c.origin,
    created_by: JSON.stringify(c.provenance.createdBy),
    created_at: c.provenance.createdAt,
    last_edited_by: JSON.stringify(c.provenance.lastEditedBy),
    last_edited_at: c.provenance.lastEditedAt,
    search_text: searchText(c),
  });

  const relParams = (userId: string, r: Relation) => ({
    id: r.id,
    user_id: userId,
    from_id: r.from,
    to_id: r.to,
    type: r.type,
    pair_key: pairKey(r.type, r.from, r.to),
    note: r.note,
    interaction: r.interaction === null ? null : JSON.stringify(r.interaction),
    citations: JSON.stringify(r.citations),
    general_knowledge: r.generalKnowledge ? 1 : 0,
    review_status: r.reviewStatus,
    origin: r.origin,
    created_by: JSON.stringify(r.provenance.createdBy),
    created_at: r.provenance.createdAt,
    last_edited_by: JSON.stringify(r.provenance.lastEditedBy),
    last_edited_at: r.provenance.lastEditedAt,
  });

  function indexCitations(
    userId: string,
    kind: CitationOwner,
    id: string,
    citations: readonly Citation[],
  ) {
    q.clearCitations.run(kind, id);
    const seen = new Set<string>();
    for (const c of citations) {
      const key = `${c.fileId}|${c.pageId}`;
      if (seen.has(key)) continue;
      seen.add(key);
      q.addCitation.run(userId, kind, id, c.fileId, c.pageId);
    }
  }

  const one = <T>(row: unknown, map: (r: never) => T): T | undefined =>
    row === undefined ? undefined : map(row as never);

  return {
    concept: (userId: string, id: string) => one(q.byId.get(id, userId), toConcept),
    conceptByKey: (userId: string, type: ConceptType, name: string) =>
      one(q.byKey.get(userId, type, normalizeName(name)), toConcept),
    conceptsOfType: (userId: string, type: ConceptType) =>
      (q.ofType.all(userId, type) as ConceptRow[]).map(toConcept),
    /** The ID a merged-away ID now leads to, if any. */
    redirect: (userId: string, id: string): string | undefined =>
      (q.redirect.get(id, userId) as { to_id: string } | undefined)?.to_id,
    /** IDs that were merged into this one. */
    mergedInto: (userId: string, id: string): string[] =>
      (q.redirectsTo.all(id, userId) as Array<{ from_id: string }>).map((r) => r.from_id),
    insertConcept(userId: string, c: Concept) {
      q.insertConcept.run(conceptParams(userId, c));
      indexCitations(userId, "concept", c.id, c.citations);
    },
    updateConcept(userId: string, c: Concept) {
      q.updateConcept.run(conceptParams(userId, c));
      indexCitations(userId, "concept", c.id, c.citations);
    },
    deleteConcept(userId: string, id: string) {
      q.deleteConcept.run(id, userId);
      q.clearCitations.run("concept", id);
    },
    relation: (userId: string, id: string) => one(q.relById.get(id, userId), toRelation),
    relationByPair: (userId: string, type: RelationType, from: string, to: string) =>
      one(q.relByPair.get(userId, pairKey(type, from, to)), toRelation),
    relationsOf: (userId: string, conceptId: string) =>
      (q.relsOf.all(userId, conceptId, conceptId) as RelationRow[]).map(toRelation),
    insertRelation(userId: string, r: Relation) {
      q.insertRel.run(relParams(userId, r));
      indexCitations(userId, "relation", r.id, r.citations);
    },
    updateRelation(userId: string, r: Relation) {
      q.updateRel.run(relParams(userId, r));
      indexCitations(userId, "relation", r.id, r.citations);
    },
    deleteRelation(userId: string, id: string) {
      q.deleteRel.run(id, userId);
      q.clearCitations.run("relation", id);
    },
  };
}

export type ConceptsRepo = ReturnType<typeof createConceptsRepo>;
