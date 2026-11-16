import {
  type BulkConceptResult,
  type BulkProblem,
  type BulkRelationResult,
  BulkUpsertInput,
  type BulkUpsertResult,
  type Citation,
  CONCEPT_EXAMPLES,
  CONCEPT_LIMITS,
  type Concept,
  type ConceptInput,
  type ConceptRef,
  type ConceptSummary,
  type ConceptType,
  canAgentOverwriteConcept,
  conceptProblems,
  type DrugInput,
  type DuplicateSuggestion,
  mergeCitations,
  newId,
  normalizeName,
  type Problem,
  RELATION_RULES,
  type Relation,
  type RelationInput,
  type RelationType,
  type RichText,
  relationTypesBetween,
  UpdateConceptInput,
  UpdateRelationInput,
  validateConceptInput,
  validateRelation,
  validateRelationInput,
} from "@notes/schema";
import type { AuthContext } from "../../http/auth-context.js";
import type { ServerDeps } from "../../http/deps.js";
import { AppError } from "../../http/errors.js";
import { leaveTrace, plural, type Trace } from "../activity/trace.js";
import type { DrugNameChecker } from "./namecheck.js";
import {
  type ConceptMentions,
  type ConceptQuestions,
  type ConceptSources,
  createDbConceptMentions,
  noConceptQuestions,
  unknownConceptSources,
} from "./ports.js";
import { createConceptQueries } from "./queries.js";
import { type ConceptsRepo, createConceptsRepo, summaryOf } from "./repo.js";

export interface ConceptsPorts extends Trace {
  /** Where cited pages are looked up. Default: every source unknown but allowed. */
  sources?: ConceptSources;
  /** Where concepts are mentioned in documents. Default: read the documents lane's blocks table. */
  mentions?: ConceptMentions;
  /** Practice questions linked to concepts. Default: none. */
  questions?: ConceptQuestions;
  /** The drug-name check (F4). Default: none, so names stay "unchecked". See `nameCheckerFromEnv`. */
  nameChecker?: DrugNameChecker;
}

export interface MergeResult {
  concept: Concept;
  /** The ID that now redirects. */
  mergedId: string;
  relationsMoved: number;
  /** Relations dropped because they became a loop or repeated one that already existed (their citations were kept on the survivor). */
  relationsDropped: number;
}

const iso = (ms: number) => new Date(ms).toISOString();

const exampleId = "con_01J9Z8Y7X6W5V4T3S2R1Q0P9N8";

export const notFoundConcept = () =>
  new AppError("not_found", "No such concept.", {
    hint: "Find concepts with GET /api/concepts/search?q=name. A merged concept's old ID still works and leads to the one that remains.",
  });

const notFoundRelation = () =>
  new AppError("not_found", "No such relation.", {
    hint: "List a concept's relations with GET /api/relations?from=<id> or read its page, GET /api/concepts/<id>/page.",
  });

/** The first problem as the error message, the rest in the hint, and its example. */
export function problemsError(problems: readonly Problem[]): AppError {
  const [first] = problems;
  if (!first) return new AppError("invalid_input", "The request is not valid.");
  const message =
    problems.length === 1
      ? `${first.path}: ${first.message}`
      : `${problems.length} problems. First, at ${first.path}: ${first.message}`;
  return new AppError("invalid_input", message, {
    hint:
      problems.length === 1
        ? "Fix the value at that path and send again."
        : problems.map((p) => `${p.path}: ${p.message}`).join("\n"),
    example: first.example,
  });
}

const uniqueNames = (list: readonly string[], excludeKey?: string): string[] => {
  const seen = new Set<string>(excludeKey ? [excludeKey] : []);
  const out: string[] = [];
  for (const name of list) {
    const key = normalizeName(name);
    if (key.length === 0 || seen.has(key)) continue;
    seen.add(key);
    out.push(name.trim());
  }
  return out;
};

const isEmptyRich = (text: RichText) => text.length === 0;
const sameJson = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

export function createConceptsService(
  deps: Pick<ServerDeps, "db" | "now">,
  ports: ConceptsPorts = {},
) {
  const { db, now } = deps;
  const repo: ConceptsRepo = createConceptsRepo(db);
  const sources = ports.sources ?? unknownConceptSources;
  const checker = ports.nameChecker;
  const queries = createConceptQueries({
    db,
    repo,
    sources,
    mentions: ports.mentions ?? createDbConceptMentions(db),
    questions: ports.questions ?? noConceptQuestions,
  });
  const pendingChecks = new Set<Promise<unknown>>();

  const writerOf = (auth: AuthContext): "user" | "agent" =>
    auth.via === "session" ? "user" : "agent";
  const originOf = (auth: AuthContext): "user" | "agent" =>
    auth.actor.type === "user" ? "user" : "agent";

  // ---- identity -----------------------------------------------------------

  /** The concept an ID leads to: itself, or the concept it was merged into. */
  function resolve(
    userId: string,
    id: string,
  ): { concept: Concept; redirectedFrom: string | null } {
    const own = repo.concept(userId, id);
    if (own) return { concept: own, redirectedFrom: null };
    const to = repo.redirect(userId, id);
    const target = to ? repo.concept(userId, to) : undefined;
    if (!target) throw notFoundConcept();
    return { concept: target, redirectedFrom: id };
  }

  const need = (userId: string, id: string): Concept => resolve(userId, id).concept;

  function needRelation(userId: string, id: string): Relation {
    const found = repo.relation(userId, id);
    if (!found) throw notFoundRelation();
    return found;
  }

  function lookupRef(userId: string, ref: ConceptRef): Concept | undefined {
    if ("id" in ref) {
      try {
        return need(userId, ref.id);
      } catch {
        return undefined;
      }
    }
    return repo.conceptByKey(userId, ref.type, ref.name);
  }

  const describeRef = (ref: ConceptRef) =>
    "id" in ref ? `the concept ${ref.id}` : `${ref.type.replaceAll("_", " ")} "${ref.name}"`;

  // ---- checks shared by every write -----------------------------------------

  /** Problems with a list of citations: pages that do not exist, quotes that are not in the transcript. */
  function citationProblems(
    userId: string,
    citations: readonly Citation[],
    path: string,
  ): Problem[] {
    if (citations.length === 0) return [];
    const infos = sources.resolve(
      userId,
      citations.map((c) => ({ fileId: c.fileId, pageId: c.pageId, quote: c.quote })),
    );
    const out: Problem[] = [];
    citations.forEach((citation, index) => {
      const info = infos[index];
      if (!info?.known) return;
      if (!info.exists) {
        out.push({
          path: `${path}[${index}]`,
          message: `The page ${citation.pageId} of file ${citation.fileId} does not exist, so it cannot be cited. Copy fileId and pageId from the source page you read.`,
          example: CONCEPT_EXAMPLES.concept.citations[0],
        });
      } else if (info.trashed) {
        out.push({
          path: `${path}[${index}]`,
          message: "The cited file is in the trash. Restore it, or cite another page.",
          example: CONCEPT_EXAMPLES.concept.citations[0],
        });
      } else if (info.quoteFound === false) {
        out.push({
          path: `${path}[${index}].quote`,
          message:
            "This quote is not in the current transcript of that page. Copy the passage character for character from the transcript.",
          example: CONCEPT_EXAMPLES.concept.citations[0],
        });
      }
    });
    return out;
  }

  function makeDrug(input: DrugInput | undefined): Concept["drug"] {
    return {
      genericName: input?.genericName ?? null,
      brandNames: uniqueNames(input?.brandNames ?? []),
      rxcui: input?.rxcui ?? null,
      nameCheck: { status: "unchecked" },
    };
  }

  function scheduleNameCheck(userId: string, conceptId: string): void {
    if (!checker) return;
    const run = checkName(userId, conceptId)
      .catch(() => undefined)
      .finally(() => pendingChecks.delete(run));
    pendingChecks.add(run);
  }

  /**
   * Ask the checker about a drug and record its answer. Never throws for a
   * failed check: the concept simply stays as it was. Never changes a name.
   */
  async function checkName(userId: string, id: string): Promise<Concept> {
    const concept = need(userId, id);
    if (!checker || concept.type !== "drug" || !concept.drug) return concept;
    const asked = concept.drug.genericName ?? concept.name;
    const outcome = await checker.check(asked);
    if (outcome.status === "failed") return concept;
    const fresh = repo.concept(userId, concept.id);
    if (!fresh?.drug || (fresh.drug.genericName ?? fresh.name) !== asked) return fresh ?? concept;
    const checkedAt = iso(now());
    const drug = { ...fresh.drug };
    if (outcome.status === "matched") {
      drug.nameCheck = {
        status: "matched",
        checkedAt,
        ...(outcome.rxcui ? { rxcui: outcome.rxcui } : {}),
      };
      if (outcome.rxcui && drug.rxcui === null) drug.rxcui = outcome.rxcui;
    } else if (outcome.status === "suggestion") {
      drug.nameCheck = {
        status: "suggestion",
        checkedAt,
        suggested: outcome.suggested,
        ...(outcome.rxcui ? { rxcui: outcome.rxcui } : {}),
      };
    } else {
      drug.nameCheck = { status: "unknown", checkedAt };
    }
    // Not an edit: provenance and review status are left as they were.
    const next = { ...fresh, drug };
    repo.updateConcept(userId, next);
    return next;
  }

  /** Check up to `limit` drugs whose names have not been checked yet. */
  async function checkPending(
    userId: string,
    limit = 20,
  ): Promise<{ checked: number; remaining: number }> {
    const rows = db
      .prepare(
        `SELECT id FROM concepts WHERE user_id = ? AND type = 'drug'
           AND (drug IS NULL OR drug LIKE '%"status":"unchecked"%') ORDER BY seq`,
      )
      .all(userId) as Array<{ id: string }>;
    let checked = 0;
    for (const row of rows.slice(0, limit)) {
      const before = repo.concept(userId, row.id);
      const after = await checkName(userId, row.id);
      if (before && after.drug?.nameCheck.status !== "unchecked") checked++;
    }
    return { checked, remaining: Math.max(0, rows.length - limit) };
  }

  /** Wait for name checks started in the background (tests, shutdown). */
  async function idle(): Promise<void> {
    while (pendingChecks.size > 0) await Promise.allSettled([...pendingChecks]);
  }

  // ---- concepts ----------------------------------------------------------------

  function suggestionsFor(userId: string, subject: Concept, limit = 5): DuplicateSuggestion[] {
    return queries.suggestionsFor(userId, subject, limit);
  }

  function buildConcept(auth: AuthContext, input: ConceptInput): Concept {
    const at = iso(now());
    const user = originOf(auth) === "user";
    return {
      id: newId("concept", now()),
      type: input.type,
      name: input.name,
      aliases: uniqueNames(input.aliases ?? [], normalizeName(input.name)),
      drug: input.type === "drug" ? makeDrug(input.drug) : null,
      summary: input.summary ?? [],
      citations: mergeCitations(input.citations),
      generalKnowledge: input.generalKnowledge === true,
      reviewStatus: user ? "reviewed" : "unverified",
      origin: originOf(auth),
      provenance: {
        createdBy: auth.actor,
        createdAt: at,
        lastEditedBy: auth.actor,
        lastEditedAt: at,
      },
    };
  }

  function createConceptRaw(
    auth: AuthContext,
    raw: unknown,
  ): { concept: Concept; suggestions: DuplicateSuggestion[] } {
    const valid = validateConceptInput(raw, { writer: writerOf(auth) });
    if (!valid.ok) throw problemsError(valid.problems);
    const input = valid.value;
    const problems = citationProblems(auth.userId, input.citations ?? [], "$.citations");
    if (problems.length > 0) throw problemsError(problems);
    const existing = repo.conceptByKey(auth.userId, input.type, input.name);
    if (existing) {
      throw new AppError(
        "conflict",
        `There is already a ${input.type.replaceAll("_", " ")} called "${existing.name}".`,
        {
          hint: `Use it (${existing.id}) instead of creating another: add aliases or citations with PATCH /api/concepts/${existing.id}, or send it through POST /api/concepts/bulk, which updates a concept that already exists.`,
          example: { id: existing.id },
        },
      );
    }
    const concept = db.transaction(() => {
      const made = buildConcept(auth, input);
      repo.insertConcept(auth.userId, made);
      return made;
    })();
    if (concept.type === "drug") scheduleNameCheck(auth.userId, concept.id);
    return { concept, suggestions: suggestionsFor(auth.userId, concept) };
  }

  function getConcept(auth: AuthContext, id: string) {
    return resolve(auth.userId, id);
  }

  function forbiddenProtected(what: string): AppError {
    return new AppError(
      "forbidden",
      `She wrote or reviewed this ${what}, so agents leave its text alone.`,
      {
        hint: "You can still add to it: send aliases, brand names, citations or relations through POST /api/concepts/bulk, which only adds when she has reviewed it. Or leave her a note in the request you are answering.",
      },
    );
  }

  function updateConceptRaw(auth: AuthContext, id: string, raw: unknown): Concept {
    const current = need(auth.userId, id);
    const parsed = UpdateConceptInput.safeParse(raw);
    if (!parsed.success) {
      throw problemsError(
        conceptProblems(parsed.error.issues, "$", { aliases: ["metoprolol tartrate"] }),
      );
    }
    const input = parsed.data;
    if (originOf(auth) === "agent" && !canAgentOverwriteConcept(current))
      throw forbiddenProtected("concept");
    if (input.drug !== undefined && current.type !== "drug") {
      throw new AppError(
        "invalid_input",
        `"drug" details only belong on a concept of type "drug", not "${current.type}".`,
        {
          hint: 'Remove "drug", or create a concept of type "drug".',
          example: CONCEPT_EXAMPLES.concept,
        },
      );
    }
    const name = input.name ?? current.name;
    if (normalizeName(name) !== normalizeName(current.name)) {
      const clash = repo.conceptByKey(auth.userId, current.type, name);
      if (clash && clash.id !== current.id) {
        throw new AppError(
          "conflict",
          `There is already a ${current.type.replaceAll("_", " ")} called "${clash.name}".`,
          {
            hint: `Merge them instead: POST /api/concepts/${clash.id}/merge with {"mergeId": "${current.id}"}.`,
            example: { mergeId: current.id },
          },
        );
      }
    }
    const citations = input.citations ?? current.citations;
    const generalKnowledge =
      input.generalKnowledge ?? (citations.length > 0 ? false : current.generalKnowledge);
    if (generalKnowledge && citations.length > 0) {
      throw new AppError(
        "invalid_input",
        "A concept cannot be general knowledge and cite her notes at once.",
        {
          hint: 'Remove "generalKnowledge", or send "citations": [] with it.',
        },
      );
    }
    if (originOf(auth) === "agent" && citations.length === 0 && !generalKnowledge) {
      throw new AppError("invalid_input", "This change would leave the concept with no citation.", {
        hint: 'Keep at least one citation, or set "generalKnowledge": true.',
        example: CONCEPT_EXAMPLES.concept,
      });
    }
    const problems = citationProblems(auth.userId, input.citations ?? [], "$.citations");
    if (problems.length > 0) throw problemsError(problems);
    const drug =
      current.drug === null
        ? null
        : {
            ...current.drug,
            ...(input.drug?.genericName !== undefined
              ? { genericName: input.drug.genericName }
              : {}),
            ...(input.drug?.brandNames !== undefined
              ? { brandNames: uniqueNames(input.drug.brandNames) }
              : {}),
            ...(input.drug?.rxcui !== undefined ? { rxcui: input.drug.rxcui } : {}),
          };
    const renamed =
      drug !== null &&
      (normalizeName(name) !== normalizeName(current.name) ||
        input.drug?.genericName !== undefined);
    const next: Concept = {
      ...current,
      name,
      aliases: input.aliases
        ? uniqueNames(input.aliases, normalizeName(name))
        : uniqueNames(current.aliases, normalizeName(name)),
      drug: drug && renamed ? { ...drug, nameCheck: { status: "unchecked" } } : drug,
      summary: input.summary ?? current.summary,
      citations: mergeCitations(citations),
      generalKnowledge,
      // Her own edit is her own words: it becomes hers and reviewed. An agent's edit leaves it unverified.
      origin: originOf(auth) === "user" ? "user" : current.origin,
      reviewStatus: originOf(auth) === "user" ? "reviewed" : "unverified",
      provenance: { ...current.provenance, lastEditedBy: auth.actor, lastEditedAt: iso(now()) },
    };
    db.transaction(() => repo.updateConcept(auth.userId, next))();
    if (next.type === "drug" && next.drug?.nameCheck.status === "unchecked")
      scheduleNameCheck(auth.userId, next.id);
    return next;
  }

  function deleteConceptRaw(auth: AuthContext, id: string): void {
    if (auth.via !== "session") {
      throw new AppError("forbidden", "Only she can delete a concept.", {
        hint: "To fold a duplicate into another concept, merge it: POST /api/concepts/<keepId>/merge.",
      });
    }
    const current = need(auth.userId, id);
    db.transaction(() => {
      for (const rel of repo.relationsOf(auth.userId, current.id))
        repo.deleteRelation(auth.userId, rel.id);
      repo.deleteConcept(auth.userId, current.id);
      db.prepare(
        "DELETE FROM concept_redirects WHERE user_id = ? AND (to_id = ? OR from_id = ?)",
      ).run(auth.userId, current.id, current.id);
    })();
  }

  function setReview(
    auth: AuthContext,
    kind: "concept" | "relation",
    id: string,
    status: "reviewed" | "unverified",
  ) {
    if (auth.via !== "session") {
      throw new AppError("forbidden", "Only she can mark a concept or relation reviewed.", {
        hint: "Reviewing is her check against the original pages; agents cannot do it for her.",
      });
    }
    if (kind === "concept") {
      const current = need(auth.userId, id);
      // Only the review status changes: not the origin, not the edit history.
      const next = { ...current, reviewStatus: status };
      repo.updateConcept(auth.userId, next);
      return next;
    }
    const current = needRelation(auth.userId, id);
    const next = { ...current, reviewStatus: status };
    repo.updateRelation(auth.userId, next);
    return next;
  }

  // ---- relations ------------------------------------------------------------------------

  function relationCheckError(type: RelationType, from: Concept, to: Concept): AppError | null {
    const check = validateRelation(type, from.type, to.type);
    if (check.ok) return null;
    return new AppError("invalid_input", check.message, {
      hint: check.hint,
      example: check.example,
    });
  }

  function buildRelation(
    auth: AuthContext,
    from: Concept,
    to: Concept,
    input: RelationInput,
  ): Relation {
    const at = iso(now());
    return {
      id: newId("relation", now()),
      from: from.id,
      to: to.id,
      type: input.type,
      note: input.note ?? "",
      interaction: input.interaction ?? null,
      citations: mergeCitations(input.citations),
      generalKnowledge: input.generalKnowledge === true,
      reviewStatus: originOf(auth) === "user" ? "reviewed" : "unverified",
      origin: originOf(auth),
      provenance: {
        createdBy: auth.actor,
        createdAt: at,
        lastEditedBy: auth.actor,
        lastEditedAt: at,
      },
    };
  }

  function createRelationRaw(auth: AuthContext, raw: unknown): Relation {
    const valid = validateRelationInput(raw, { writer: writerOf(auth) });
    if (!valid.ok) throw problemsError(valid.problems);
    const input = valid.value;
    const from = lookupRef(auth.userId, input.from);
    const to = lookupRef(auth.userId, input.to);
    for (const [ref, found, field] of [
      [input.from, from, "from"],
      [input.to, to, "to"],
    ] as const) {
      if (!found) {
        throw new AppError("not_found", `$.${field}: ${describeRef(ref)} does not exist yet.`, {
          hint: "Create the concept first (POST /api/concepts), or use POST /api/concepts/bulk to create concepts and their relations in one call.",
          example: CONCEPT_EXAMPLES.concept,
        });
      }
    }
    const [f, t] = [from as Concept, to as Concept];
    if (f.id === t.id) {
      throw new AppError("invalid_input", "A concept cannot be related to itself.", {
        hint: 'Pick a different concept for "to".',
        example: CONCEPT_EXAMPLES.relation,
      });
    }
    const wrong = relationCheckError(input.type, f, t);
    if (wrong) throw wrong;
    const problems = citationProblems(auth.userId, input.citations ?? [], "$.citations");
    if (problems.length > 0) throw problemsError(problems);
    const existing = repo.relationByPair(auth.userId, input.type, f.id, t.id);
    if (existing) {
      throw new AppError("conflict", "These two concepts are already related this way.", {
        hint: `Change it with PATCH /api/relations/${existing.id}, or send it through POST /api/concepts/bulk, which updates an existing relation.`,
        example: { id: existing.id },
      });
    }
    return db.transaction(() => {
      const made = buildRelation(auth, f, t, input);
      repo.insertRelation(auth.userId, made);
      return made;
    })();
  }

  function updateRelation(auth: AuthContext, id: string, raw: unknown): Relation {
    const current = needRelation(auth.userId, id);
    const parsed = UpdateRelationInput.safeParse(raw);
    if (!parsed.success) {
      throw problemsError(conceptProblems(parsed.error.issues, "$", { note: "Dose related." }));
    }
    const input = parsed.data;
    if (
      originOf(auth) === "agent" &&
      !(current.origin === "agent" && current.reviewStatus === "unverified")
    ) {
      throw forbiddenProtected("relation");
    }
    if (input.interaction && current.type !== "interacts_with") {
      throw new AppError(
        "invalid_input",
        `Severity and effect only belong on an "interacts_with" relation, not "${current.type}".`,
        {
          example: CONCEPT_EXAMPLES.interaction,
        },
      );
    }
    const citations = input.citations ?? current.citations;
    const generalKnowledge =
      input.generalKnowledge ?? (citations.length > 0 ? false : current.generalKnowledge);
    if (generalKnowledge && citations.length > 0) {
      throw new AppError(
        "invalid_input",
        "A relation cannot be general knowledge and cite her notes at once.",
        {
          hint: 'Remove "generalKnowledge", or send "citations": [] with it.',
        },
      );
    }
    if (originOf(auth) === "agent" && citations.length === 0 && !generalKnowledge) {
      throw new AppError(
        "invalid_input",
        "This change would leave the relation with no citation.",
        {
          hint: 'Keep at least one citation, or set "generalKnowledge": true.',
          example: CONCEPT_EXAMPLES.relation,
        },
      );
    }
    const problems = citationProblems(auth.userId, input.citations ?? [], "$.citations");
    if (problems.length > 0) throw problemsError(problems);
    const next: Relation = {
      ...current,
      note: input.note ?? current.note,
      interaction: input.interaction === undefined ? current.interaction : input.interaction,
      citations: mergeCitations(citations),
      generalKnowledge,
      origin: originOf(auth) === "user" ? "user" : current.origin,
      reviewStatus: originOf(auth) === "user" ? "reviewed" : "unverified",
      provenance: { ...current.provenance, lastEditedBy: auth.actor, lastEditedAt: iso(now()) },
    };
    repo.updateRelation(auth.userId, next);
    return next;
  }

  function deleteRelation(auth: AuthContext, id: string): void {
    if (auth.via !== "session") {
      throw new AppError("forbidden", "Only she can delete a relation.", {
        hint: "If a relation is wrong, say so in your reply to the request you are answering.",
      });
    }
    needRelation(auth.userId, id);
    repo.deleteRelation(auth.userId, id);
  }

  function getRelation(auth: AuthContext, id: string): Relation {
    return needRelation(auth.userId, id);
  }

  function listRelations(
    auth: AuthContext,
    filter: { from?: string | undefined; to?: string | undefined; type?: RelationType | undefined },
  ): Relation[] {
    const anchor = filter.from ?? filter.to;
    if (!anchor) {
      throw new AppError("invalid_input", "Say which concept to list relations for.", {
        hint: "Pass from=<conceptId> (relations that start there) or to=<conceptId>.",
        example: { from: exampleId },
      });
    }
    const id = need(auth.userId, anchor).id;
    return repo
      .relationsOf(auth.userId, id)
      .filter((r) => (filter.from ? r.from === id : true))
      .filter((r) => (filter.to ? r.to === id : true))
      .filter((r) => (filter.type ? r.type === filter.type : true));
  }

  // ---- bulk upsert -------------------------------------------------------------------------------

  /** Does the agent's version change anything, and what may it change on a concept she has taken over? */
  function mergeIntoConcept(
    auth: AuthContext,
    current: Concept,
    input: ConceptInput,
  ): { next: Concept; protectedFields: string[] } {
    const free = originOf(auth) === "user" || canAgentOverwriteConcept(current);
    const protectedFields: string[] = [];
    const fill = <T>(
      field: string,
      existing: T,
      incoming: T | undefined,
      empty: (v: T) => boolean,
    ): T => {
      if (incoming === undefined || empty(incoming) || sameJson(existing, incoming))
        return existing;
      if (free || empty(existing)) return incoming;
      protectedFields.push(field);
      return existing;
    };
    const nameKey = normalizeName(current.name);
    const aliases = uniqueNames([...current.aliases, ...(input.aliases ?? [])], nameKey).slice(
      0,
      CONCEPT_LIMITS.aliases,
    );
    let drug = current.drug;
    if (drug && input.drug) {
      const brandNames = uniqueNames([...drug.brandNames, ...(input.drug.brandNames ?? [])]).slice(
        0,
        CONCEPT_LIMITS.brandNames,
      );
      const genericName = fill<string | null>(
        "drug.genericName",
        drug.genericName,
        input.drug.genericName,
        (v) => v === null,
      );
      const rxcui = fill<string | null>(
        "drug.rxcui",
        drug.rxcui,
        input.drug.rxcui,
        (v) => v === null,
      );
      drug = {
        ...drug,
        brandNames,
        genericName,
        rxcui,
        nameCheck: genericName !== drug.genericName ? { status: "unchecked" } : drug.nameCheck,
      };
    }
    const citations = mergeCitations(current.citations, input.citations).slice(
      0,
      CONCEPT_LIMITS.citations,
    );
    const summary = fill<RichText>("summary", current.summary, input.summary, isEmptyRich);
    const next: Concept = {
      ...current,
      aliases,
      drug,
      summary,
      citations,
      generalKnowledge:
        citations.length > 0 ? false : current.generalKnowledge || input.generalKnowledge === true,
    };
    return { next, protectedFields };
  }

  function bulkUpsertRaw(auth: AuthContext, raw: unknown): BulkUpsertResult {
    const parsed = BulkUpsertInput.safeParse(raw);
    if (!parsed.success) {
      throw new AppError(
        "invalid_input",
        parsed.error.issues.map((i) => `${i.path.join(".") || "body"}: ${i.message}`).join("; "),
        {
          hint: "Send {concepts: [...], relations: [...], partial?: boolean}.",
          example: CONCEPT_EXAMPLES.bulk,
        },
      );
    }
    const { concepts: rawConcepts, relations: rawRelations, partial } = parsed.data;
    const writer = writerOf(auth);
    const userId = auth.userId;
    const problems: BulkProblem[] = [];
    const addProblems = (list: readonly Problem[]) => {
      for (const p of list) problems.push({ path: p.path, message: p.message, example: p.example });
    };

    // Phase 1: check everything without writing anything.
    const conceptItems: Array<
      { index: number; input: ConceptInput } | { index: number; rejected: true }
    > = [];
    const batchTypes = new Map<string, ConceptType>();
    rawConcepts.forEach((item, index) => {
      const prefix = `$.concepts[${index}]`;
      const valid = validateConceptInput(item, { writer: "user", pathPrefix: prefix });
      if (
        valid.ok &&
        writer === "agent" &&
        !repo.conceptByKey(userId, valid.value.type, valid.value.name)
      ) {
        // The citation rule is for concepts the agent is adding; one that exists already has its sources.
        const again = validateConceptInput(item, { writer: "agent", pathPrefix: prefix });
        if (!again.ok) {
          addProblems(again.problems);
          conceptItems.push({ index, rejected: true });
          return;
        }
      }
      if (!valid.ok) {
        addProblems(valid.problems);
        conceptItems.push({ index, rejected: true });
        return;
      }
      const bad = citationProblems(userId, valid.value.citations ?? [], `${prefix}.citations`);
      if (bad.length > 0) {
        addProblems(bad);
        conceptItems.push({ index, rejected: true });
        return;
      }
      batchTypes.set(`${valid.value.type}:${normalizeName(valid.value.name)}`, valid.value.type);
      conceptItems.push({ index, input: valid.value });
    });

    const refType = (ref: ConceptRef): ConceptType | undefined => {
      if ("id" in ref) return lookupRef(userId, ref)?.type;
      return (
        batchTypes.get(`${ref.type}:${normalizeName(ref.name)}`) ??
        repo.conceptByKey(userId, ref.type, ref.name)?.type
      );
    };
    const refKey = (ref: ConceptRef): string => {
      if ("id" in ref) return lookupRef(userId, ref)?.id ?? ref.id;
      return `${ref.type}:${normalizeName(ref.name)}`;
    };

    const relationItems: Array<
      { index: number; input: RelationInput } | { index: number; rejected: true }
    > = [];
    rawRelations.forEach((item, index) => {
      const prefix = `$.relations[${index}]`;
      const valid = validateRelationInput(item, { writer: "user", pathPrefix: prefix });
      if (!valid.ok) {
        addProblems(valid.problems);
        relationItems.push({ index, rejected: true });
        return;
      }
      if (writer === "agent") {
        // Only a relation the agent is adding needs a source; an existing one has its own.
        const a = lookupRef(userId, valid.value.from);
        const b = lookupRef(userId, valid.value.to);
        const exists = a && b && repo.relationByPair(userId, valid.value.type, a.id, b.id);
        if (!exists) {
          const again = validateRelationInput(item, { writer: "agent", pathPrefix: prefix });
          if (!again.ok) {
            addProblems(again.problems);
            relationItems.push({ index, rejected: true });
            return;
          }
        }
      }
      const input = valid.value;
      const local: Problem[] = [];
      const ends: Array<ConceptType | undefined> = [];
      for (const field of ["from", "to"] as const) {
        const type = refType(input[field]);
        ends.push(type);
        if (!type) {
          local.push({
            path: `${prefix}.${field}`,
            message: `${describeRef(input[field])} does not exist, and this call does not create it. Add it to "concepts" in the same call, or create it first.`,
            example: CONCEPT_EXAMPLES.bulk.concepts[0],
          });
        }
      }
      const [fromType, toType] = ends;
      if (fromType && toType) {
        if (refKey(input.from) === refKey(input.to)) {
          local.push({
            path: `${prefix}.to`,
            message: 'A concept cannot be related to itself. Pick a different concept for "to".',
            example: CONCEPT_EXAMPLES.relation,
          });
        }
        const check = validateRelation(input.type, fromType, toType);
        if (!check.ok) {
          local.push({
            path: `${prefix}.type`,
            message: `${check.message} ${check.hint}`,
            example: check.example,
          });
        }
      }
      local.push(...citationProblems(userId, input.citations ?? [], `${prefix}.citations`));
      if (local.length > 0) {
        addProblems(local);
        relationItems.push({ index, rejected: true });
        return;
      }
      relationItems.push({ index, input });
    });

    const refused = problems.length > 0;
    const conceptResults: BulkConceptResult[] = [];
    const relationResults: BulkRelationResult[] = [];
    const skipApply = refused && !partial;

    const rejectedConcept = (index: number, name: string): BulkConceptResult => ({
      index,
      action: "rejected",
      id: null,
      name,
      suggestions: [],
      protectedFields: [],
    });

    if (skipApply) {
      for (const item of conceptItems) {
        const name = nameOfRaw(rawConcepts[item.index]);
        conceptResults.push(
          "rejected" in item
            ? rejectedConcept(item.index, name)
            : {
                index: item.index,
                action: "not_applied",
                id: null,
                name: item.input.name,
                suggestions: [],
                protectedFields: [],
              },
        );
      }
      for (const item of relationItems) {
        relationResults.push({
          index: item.index,
          action: "rejected" in item ? "rejected" : "not_applied",
          id: null,
        });
      }
      return {
        applied: false,
        partial,
        created: 0,
        updated: 0,
        skipped: 0,
        concepts: conceptResults,
        relations: relationResults,
        problems,
      };
    }

    // Phase 2: write, all or nothing.
    const created: Concept[] = [];
    let createdN = 0;
    let updatedN = 0;
    let skippedN = 0;
    db.transaction(() => {
      for (const item of conceptItems) {
        if ("rejected" in item) {
          conceptResults.push(rejectedConcept(item.index, nameOfRaw(rawConcepts[item.index])));
          skippedN++;
          continue;
        }
        const input = item.input;
        const existing = repo.conceptByKey(userId, input.type, input.name);
        if (!existing) {
          const made = buildConcept(auth, input);
          repo.insertConcept(userId, made);
          created.push(made);
          createdN++;
          conceptResults.push({
            index: item.index,
            action: "created",
            id: made.id,
            name: made.name,
            suggestions: [],
            protectedFields: [],
          });
          continue;
        }
        const { next, protectedFields } = mergeIntoConcept(auth, existing, input);
        if (
          sameJson(
            [
              existing.aliases,
              existing.drug,
              existing.summary,
              existing.citations,
              existing.generalKnowledge,
            ],
            [next.aliases, next.drug, next.summary, next.citations, next.generalKnowledge],
          )
        ) {
          skippedN++;
          conceptResults.push({
            index: item.index,
            action: "unchanged",
            id: existing.id,
            name: existing.name,
            suggestions: [],
            protectedFields,
          });
          continue;
        }
        const saved: Concept = {
          ...next,
          provenance: { ...next.provenance, lastEditedBy: auth.actor, lastEditedAt: iso(now()) },
        };
        repo.updateConcept(userId, saved);
        if (
          saved.drug &&
          existing.drug &&
          saved.drug.nameCheck.status === "unchecked" &&
          existing.drug.nameCheck.status !== "unchecked"
        ) {
          created.push(saved);
        }
        updatedN++;
        conceptResults.push({
          index: item.index,
          action: "updated",
          id: existing.id,
          name: existing.name,
          suggestions: [],
          protectedFields,
        });
      }

      for (const item of relationItems) {
        if ("rejected" in item) {
          relationResults.push({ index: item.index, action: "rejected", id: null });
          skippedN++;
          continue;
        }
        const input = item.input;
        const from = lookupRef(userId, input.from) as Concept;
        const to = lookupRef(userId, input.to) as Concept;
        const existing = repo.relationByPair(userId, input.type, from.id, to.id);
        if (!existing) {
          const made = buildRelation(auth, from, to, input);
          repo.insertRelation(userId, made);
          createdN++;
          relationResults.push({ index: item.index, action: "created", id: made.id });
          continue;
        }
        const free =
          originOf(auth) === "user" ||
          (existing.origin === "agent" && existing.reviewStatus === "unverified");
        const citations = mergeCitations(existing.citations, input.citations).slice(
          0,
          CONCEPT_LIMITS.citations,
        );
        const next: Relation = {
          ...existing,
          note:
            input.note !== undefined && (free || existing.note === "") ? input.note : existing.note,
          interaction:
            input.interaction !== undefined && (free || existing.interaction === null)
              ? input.interaction
              : existing.interaction,
          citations,
          generalKnowledge:
            citations.length > 0
              ? false
              : existing.generalKnowledge || input.generalKnowledge === true,
        };
        if (
          sameJson(
            [existing.note, existing.interaction, existing.citations, existing.generalKnowledge],
            [next.note, next.interaction, next.citations, next.generalKnowledge],
          )
        ) {
          skippedN++;
          relationResults.push({ index: item.index, action: "unchanged", id: existing.id });
          continue;
        }
        repo.updateRelation(userId, {
          ...next,
          provenance: { ...next.provenance, lastEditedBy: auth.actor, lastEditedAt: iso(now()) },
        });
        updatedN++;
        relationResults.push({ index: item.index, action: "updated", id: existing.id });
      }
    })();

    // Look-alikes of what was just created: told to the agent, never merged.
    for (const made of created) {
      const result = conceptResults.find((r) => r.id === made.id && r.action === "created");
      if (result) {
        result.suggestions = suggestionsFor(userId, made).map((s) => ({
          conceptId: s.conceptId,
          name: s.name,
          reason: s.reason,
          explanation: s.explanation,
        }));
      }
    }
    for (const made of created) if (made.type === "drug") scheduleNameCheck(userId, made.id);

    return {
      applied: true,
      partial,
      created: createdN,
      updated: updatedN,
      skipped: skippedN,
      concepts: conceptResults,
      relations: relationResults,
      problems,
    };
  }

  function nameOfRaw(raw: unknown): string {
    const name = (raw as { name?: unknown } | null)?.name;
    return typeof name === "string" ? name : "";
  }

  // ---- merge --------------------------------------------------------------------------------------------

  function mergeRaw(auth: AuthContext, keepId: string, mergeId: string): MergeResult {
    const keep = need(auth.userId, keepId);
    const gone = need(auth.userId, mergeId);
    if (keep.id === gone.id) {
      throw new AppError("invalid_input", "These are the same concept already.", {
        hint: "Merge two different concepts: the one that stays goes in the URL, the one that goes away in mergeId.",
      });
    }
    if (keep.type !== gone.type) {
      throw new AppError(
        "invalid_input",
        `A ${keep.type.replaceAll("_", " ")} and a ${gone.type.replaceAll("_", " ")} are not the same thing, so they cannot be merged.`,
        {
          hint: "Merge only concepts of one type. If they are linked, add a relation instead (related_to fits anything).",
        },
      );
    }
    if (
      originOf(auth) === "agent" &&
      !(canAgentOverwriteConcept(keep) && canAgentOverwriteConcept(gone))
    ) {
      throw new AppError(
        "forbidden",
        "She wrote or reviewed one of these, so only she can merge them.",
        {
          hint: "Tell her in your reply that these look like duplicates; the app shows her the suggestion on the concept page.",
        },
      );
    }
    return db.transaction((): MergeResult => {
      const userId = auth.userId;
      const aliases = uniqueNames(
        [...keep.aliases, gone.name, ...gone.aliases],
        normalizeName(keep.name),
      ).slice(0, CONCEPT_LIMITS.aliases);
      let drug = keep.drug;
      if (drug && gone.drug) {
        drug = {
          ...drug,
          genericName: drug.genericName ?? gone.drug.genericName,
          brandNames: uniqueNames([...drug.brandNames, ...gone.drug.brandNames]).slice(
            0,
            CONCEPT_LIMITS.brandNames,
          ),
          rxcui: drug.rxcui ?? gone.drug.rxcui,
        };
      }
      const citations = mergeCitations(keep.citations, gone.citations).slice(
        0,
        CONCEPT_LIMITS.citations,
      );
      const survivor: Concept = {
        ...keep,
        aliases,
        drug,
        summary: isEmptyRich(keep.summary) ? gone.summary : keep.summary,
        citations,
        generalKnowledge:
          citations.length > 0 ? false : keep.generalKnowledge && gone.generalKnowledge,
        reviewStatus:
          keep.reviewStatus === "reviewed" && gone.reviewStatus === "reviewed"
            ? "reviewed"
            : keep.reviewStatus,
        origin: keep.origin === "user" || gone.origin === "user" ? "user" : "agent",
        provenance: { ...keep.provenance, lastEditedBy: auth.actor, lastEditedAt: iso(now()) },
      };
      // The old concept goes first so its name no longer clashes with the survivor's search row.
      repo.deleteConcept(userId, gone.id);
      repo.updateConcept(userId, survivor);

      let moved = 0;
      let dropped = 0;
      for (const rel of repo.relationsOf(userId, gone.id)) {
        const from = rel.from === gone.id ? keep.id : rel.from;
        const to = rel.to === gone.id ? keep.id : rel.to;
        if (from === to) {
          repo.deleteRelation(userId, rel.id);
          dropped++;
          continue;
        }
        const twin = repo.relationByPair(userId, rel.type, from, to);
        if (twin && twin.id !== rel.id) {
          const merged = mergeCitations(twin.citations, rel.citations).slice(
            0,
            CONCEPT_LIMITS.citations,
          );
          repo.updateRelation(userId, {
            ...twin,
            citations: merged,
            note: twin.note || rel.note,
            interaction: twin.interaction ?? rel.interaction,
            generalKnowledge:
              merged.length > 0 ? false : twin.generalKnowledge && rel.generalKnowledge,
          });
          repo.deleteRelation(userId, rel.id);
          dropped++;
          continue;
        }
        repo.updateRelation(userId, { ...rel, from, to });
        moved++;
      }
      db.prepare("UPDATE concept_redirects SET to_id = ? WHERE user_id = ? AND to_id = ?").run(
        keep.id,
        userId,
        gone.id,
      );
      db.prepare(
        "INSERT OR REPLACE INTO concept_redirects (from_id, user_id, to_id, merged_at) VALUES (?, ?, ?, ?)",
      ).run(gone.id, userId, keep.id, iso(now()));
      return {
        concept: survivor,
        mergedId: gone.id,
        relationsMoved: moved,
        relationsDropped: dropped,
      };
    })();
  }

  // ---- traces: what each change leaves in the feed and (for agents) the activity log --------------

  const nameOf = (userId: string, id: string): string =>
    repo.concept(userId, id)?.name ?? "a concept";
  const kindWords = (type: string) => type.replaceAll("_", " ");

  function createConcept(auth: AuthContext, raw: unknown) {
    const made = createConceptRaw(auth, raw);
    leaveTrace(ports, auth.userId, auth.actor, {
      action: "concept.created",
      objectType: "concept",
      objectIds: [made.concept.id],
      summary: `Added the ${kindWords(made.concept.type)} "${made.concept.name}"`,
    });
    return made;
  }

  function updateConcept(auth: AuthContext, id: string, raw: unknown): Concept {
    const next = updateConceptRaw(auth, id, raw);
    leaveTrace(ports, auth.userId, auth.actor, {
      action: "concept.updated",
      objectType: "concept",
      objectIds: [next.id],
      summary: `Changed the ${kindWords(next.type)} "${next.name}"`,
    });
    return next;
  }

  function deleteConcept(auth: AuthContext, id: string): void {
    const before = need(auth.userId, id);
    deleteConceptRaw(auth, id);
    leaveTrace(ports, auth.userId, auth.actor, {
      action: "concept.deleted",
      objectType: "concept",
      objectIds: [before.id],
      summary: `Deleted the ${kindWords(before.type)} "${before.name}"`,
    });
  }

  function createRelation(auth: AuthContext, raw: unknown): Relation {
    const made = createRelationRaw(auth, raw);
    leaveTrace(ports, auth.userId, auth.actor, {
      action: "concept.related",
      objectType: "concept",
      objectIds: [made.from, made.to, made.id],
      summary: `Linked "${nameOf(auth.userId, made.from)}" to "${nameOf(auth.userId, made.to)}" (${kindWords(made.type)})`,
    });
    return made;
  }

  function merge(auth: AuthContext, keepId: string, mergeId: string): MergeResult {
    const folded = nameOf(auth.userId, mergeId);
    const done = mergeRaw(auth, keepId, mergeId);
    leaveTrace(ports, auth.userId, auth.actor, {
      action: "concept.merged",
      objectType: "concept",
      objectIds: [done.concept.id, done.mergedId],
      summary: `Merged "${folded}" into "${done.concept.name}" (${plural(done.relationsMoved, "relation")} moved)`,
    });
    return done;
  }

  /** One entry for the whole call, with the counts, however many concepts and relations it carried. */
  function bulkUpsert(auth: AuthContext, raw: unknown): BulkUpsertResult {
    const result = bulkUpsertRaw(auth, raw);
    if (result.applied) {
      const count = (list: ReadonlyArray<{ action: string }>, action: string) =>
        list.filter((r) => r.action === action).length;
      const parts = [
        `${plural(count(result.concepts, "created"), "concept")} added`,
        `${count(result.concepts, "updated")} updated`,
        `${plural(count(result.relations, "created"), "relation")} added`,
        `${count(result.relations, "updated")} updated`,
      ];
      const unchanged = count(result.concepts, "unchanged") + count(result.relations, "unchanged");
      if (unchanged > 0) parts.push(`${unchanged} unchanged`);
      if (result.problems.length > 0)
        parts.push(`${plural(result.problems.length, "problem")} reported`);
      const touched = [
        ...result.concepts.flatMap((c) => (c.id && c.action !== "unchanged" ? [c.id] : [])),
        ...result.relations.flatMap((r) => (r.id && r.action !== "unchanged" ? [r.id] : [])),
      ];
      if (touched.length > 0) {
        leaveTrace(ports, auth.userId, auth.actor, {
          action: "concept.upserted",
          objectType: "concept",
          objectIds: touched,
          summary: `Updated the concept map: ${parts.join(", ")}`,
          links: touched
            .slice(0, 15)
            .map((id) => ({ type: id.startsWith("rel_") ? "relation" : "concept", id })),
        });
      }
    }
    return result;
  }

  // ---- hooks -----------------------------------------------------------------------------------------------

  const hooks = {
    /**
     * Source files were permanently deleted. Citations are never rewritten
     * (the quote is what remains, K6), so nothing changes here; the concepts
     * and relations whose citations pointed at them are returned so the caller
     * can report or log them.
     */
    onSourceDeleted(
      userId: string,
      fileIds: readonly string[],
    ): { concepts: string[]; relations: string[] } {
      const out = { concepts: [] as string[], relations: [] as string[] };
      for (const fileId of fileIds) {
        const rows = db
          .prepare(
            "SELECT DISTINCT owner_kind, owner_id FROM concept_citations WHERE user_id = ? AND file_id = ?",
          )
          .all(userId, fileId) as Array<{ owner_kind: "concept" | "relation"; owner_id: string }>;
        for (const row of rows) {
          (row.owner_kind === "concept" ? out.concepts : out.relations).push(row.owner_id);
        }
      }
      return { concepts: [...new Set(out.concepts)], relations: [...new Set(out.relations)] };
    },
    /** What cites this page: the concepts and relations (K5, the reverse view of a source page). */
    citingPage(
      userId: string,
      pageId: string,
    ): { concepts: ConceptSummary[]; relations: Relation[] } {
      const rows = db
        .prepare(
          "SELECT DISTINCT owner_kind, owner_id FROM concept_citations WHERE user_id = ? AND page_id = ?",
        )
        .all(userId, pageId) as Array<{ owner_kind: "concept" | "relation"; owner_id: string }>;
      const concepts: ConceptSummary[] = [];
      const relations: Relation[] = [];
      for (const row of rows) {
        if (row.owner_kind === "concept") {
          const c = repo.concept(userId, row.owner_id);
          if (c) concepts.push(summaryOf(c));
        } else {
          const r = repo.relation(userId, row.owner_id);
          if (r) relations.push(r);
        }
      }
      return { concepts, relations };
    },
  };

  return {
    createConcept,
    getConcept,
    updateConcept,
    deleteConcept,
    setReview,
    createRelation,
    getRelation,
    updateRelation,
    deleteRelation,
    listRelations,
    bulkUpsert,
    merge,
    checkName: (auth: AuthContext, id: string) => {
      if (!checker) {
        throw new AppError("conflict", "The drug-name check is switched off on this server.", {
          hint: "Set RXNORM_CHECK=1 to turn it on. It sends drug names (never notes or user data) to the US National Library of Medicine's RxNav service.",
        });
      }
      return checkName(auth.userId, id);
    },
    checkPending: (auth: AuthContext, limit?: number) => checkPending(auth.userId, limit),
    idle,
    ...hooks,
    ...bindQueries(queries),
    /** The same search for a user ID instead of a caller, with `offset` (the unified search pages with it). */
    searchConcepts: queries.search,
    suggestionsFor: (auth: AuthContext, id: string) =>
      suggestionsFor(auth.userId, need(auth.userId, id)),
    relationTypesBetween,
    ruleFor: (type: RelationType) => RELATION_RULES[type],
  };
}

type Queries = ReturnType<typeof createConceptQueries>;

/** The read side takes a user ID; the service takes the caller. */
function bindQueries(q: Queries) {
  return {
    list: (auth: AuthContext, query: Parameters<Queries["list"]>[1]) => q.list(auth.userId, query),
    search: (auth: AuthContext, text: string, options?: Parameters<Queries["search"]>[2]) =>
      q.search(auth.userId, text, options),
    page: (auth: AuthContext, id: string) => q.page(auth.userId, id),
    neighbourhood: (
      auth: AuthContext,
      id: string,
      query: Parameters<Queries["neighbourhood"]>[2],
    ) => q.neighbourhood(auth.userId, id, query),
    path: (auth: AuthContext, from: string, to: string, options?: Parameters<Queries["path"]>[3]) =>
      q.path(auth.userId, from, to, options),
    filter: (auth: AuthContext, filter: unknown) => q.filter(auth.userId, filter),
    compare: (auth: AuthContext, input: unknown) => q.compare(auth.userId, input),
    brandGenericPairs: (auth: AuthContext, options?: Parameters<Queries["brandGenericPairs"]>[1]) =>
      q.brandGenericPairs(auth.userId, options),
  };
}

export type ConceptsService = ReturnType<typeof createConceptsService>;

/**
 * The narrow surface for the MCP layer: bulk upsert, read, search, graph,
 * filter queries and merge, plus the hooks other domains call.
 */
export type ConceptsPort = Pick<
  ConceptsService,
  | "bulkUpsert"
  | "getConcept"
  | "page"
  | "search"
  | "list"
  | "neighbourhood"
  | "path"
  | "filter"
  | "compare"
  | "brandGenericPairs"
  | "merge"
  | "onSourceDeleted"
  | "citingPage"
>;
