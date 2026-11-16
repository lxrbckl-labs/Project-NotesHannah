import {
  type BrandGenericPair,
  type Citation,
  COMPARISON_LABELS,
  CONCEPT_EXAMPLES,
  type ComparisonAttribute,
  ComparisonInput,
  type ComparisonResult,
  type ComparisonValue,
  type Concept,
  ConceptFilter,
  type ConceptListQuery,
  type ConceptPage,
  type ConceptRef,
  type ConceptSummary,
  type ConceptType,
  type DuplicateSuggestion,
  type FilterResult,
  type FilterRow,
  GraphQuery,
  type GraphResult,
  mergeCitations,
  normalizeName,
  type PageSource,
  type PathResult,
  type PathStep,
  RELATION_RULES,
  RELATION_TYPES,
  type Relation,
  type RelationGroup,
  type RelationType,
  relationSentence,
  suggestDuplicates,
} from "@notes/schema";
import type { Db } from "../../db/client.js";
import { AppError } from "../../http/errors.js";
import type { ConceptMentions, ConceptQuestions, ConceptSources } from "./ports.js";
import {
  type ConceptRow,
  type ConceptsRepo,
  type RelationRow,
  summaryOf,
  toConcept,
  toRelation,
} from "./repo.js";

export interface QueryDeps {
  db: Db;
  repo: ConceptsRepo;
  sources: ConceptSources;
  mentions: ConceptMentions;
  questions: ConceptQuestions;
}

const MAX_CLASS_DEPTH = 6;
const MAX_WALK = 5000;

const notFound = (what = "concept") =>
  new AppError("not_found", `No such ${what}.`, {
    hint: "Find concepts with GET /api/concepts/search?q=name. A merged concept's old ID still works.",
  });

function parseOrThrow<T>(
  schema: {
    safeParse(
      input: unknown,
    ):
      | { success: true; data: T }
      | { success: false; error: { issues: Array<{ path: PropertyKey[]; message: string }> } };
  },
  input: unknown,
  example: unknown,
): T {
  const result = schema.safeParse(input);
  if (result.success) return result.data;
  throw new AppError(
    "invalid_input",
    result.error.issues
      .map((i) => `${i.path.map(String).join(".") || "body"}: ${i.message}`)
      .join("; "),
    { hint: "Fix the field named above and send again.", example },
  );
}

/** Evidence for an answer: the citations of the relations it rests on, each once. */
function evidence(rels: readonly Relation[]) {
  return {
    citations: mergeCitations(...rels.map((r) => r.citations)),
    generalKnowledge:
      rels.length > 0 && rels.every((r) => r.generalKnowledge && r.citations.length === 0),
  };
}

const chunk = <T>(list: readonly T[], size = 400): T[][] => {
  const out: T[][] = [];
  for (let i = 0; i < list.length; i += size) out.push(list.slice(i, i + size));
  return out;
};

export function createConceptQueries(deps: QueryDeps) {
  const { db, repo, sources, mentions, questions } = deps;

  const need = (
    userId: string,
    id: string,
  ): { concept: Concept; redirectedFrom: string | null } => {
    const own = repo.concept(userId, id);
    if (own) return { concept: own, redirectedFrom: null };
    const to = repo.redirect(userId, id);
    const target = to ? repo.concept(userId, to) : undefined;
    if (!target) throw notFound();
    return { concept: target, redirectedFrom: id };
  };

  function byIds(userId: string, ids: readonly string[]): Map<string, Concept> {
    const out = new Map<string, Concept>();
    for (const part of chunk([...new Set(ids)])) {
      const rows = db
        .prepare(
          `SELECT * FROM concepts WHERE user_id = ? AND id IN (${part.map(() => "?").join(", ")})`,
        )
        .all(userId, ...part) as ConceptRow[];
      for (const row of rows) out.set(row.id, toConcept(row));
    }
    return out;
  }

  /** Relations touching any of these concepts, oldest first. */
  function touching(
    userId: string,
    ids: readonly string[],
    types?: readonly RelationType[],
  ): Relation[] {
    const seen = new Map<string, Relation>();
    const typeSql =
      types && types.length > 0 ? ` AND type IN (${types.map(() => "?").join(", ")})` : "";
    for (const part of chunk(ids, 200)) {
      const marks = part.map(() => "?").join(", ");
      const rows = db
        .prepare(
          `SELECT * FROM concept_relations WHERE user_id = ? AND (from_id IN (${marks}) OR to_id IN (${marks}))${typeSql} ORDER BY seq`,
        )
        .all(userId, ...part, ...part, ...(types ?? [])) as RelationRow[];
      for (const row of rows) seen.set(row.id, toRelation(row));
    }
    return [...seen.values()].sort(
      (a, b) =>
        a.provenance.createdAt.localeCompare(b.provenance.createdAt) || a.id.localeCompare(b.id),
    );
  }

  const refConcept = (userId: string, ref: ConceptRef): Concept => {
    if ("id" in ref) return need(userId, ref.id).concept;
    const found = repo.conceptByKey(userId, ref.type, ref.name);
    if (!found) {
      throw new AppError("not_found", `No ${ref.type.replaceAll("_", " ")} called "${ref.name}".`, {
        hint: "Check the spelling with GET /api/concepts/search?q=, or pass the concept's ID.",
        example: { id: "con_01J9Z8Y7X6W5V4T3S2R1Q0P9N8" },
      });
    }
    return found;
  };

  // ---- classes -----------------------------------------------------------------------------

  /** Classes above a concept (belongs_to_class, repeatedly), nearest first, with the relations that lead there. */
  function ancestors(userId: string, id: string): Array<{ concept: Concept; chain: Relation[] }> {
    const out: Array<{ id: string; chain: Relation[] }> = [];
    const seen = new Set<string>([id]);
    let frontier: Array<{ id: string; chain: Relation[] }> = [{ id, chain: [] }];
    for (let depth = 0; depth < MAX_CLASS_DEPTH && frontier.length > 0; depth++) {
      const next: Array<{ id: string; chain: Relation[] }> = [];
      for (const node of frontier) {
        for (const rel of repo.relationsOf(userId, node.id)) {
          if (rel.type !== "belongs_to_class" || rel.from !== node.id || seen.has(rel.to)) continue;
          seen.add(rel.to);
          const step = { id: rel.to, chain: [...node.chain, rel] };
          out.push(step);
          next.push(step);
        }
      }
      frontier = next;
    }
    const found = byIds(
      userId,
      out.map((o) => o.id),
    );
    return out.flatMap((o) => {
      const concept = found.get(o.id);
      return concept ? [{ concept, chain: o.chain }] : [];
    });
  }

  /** Everything under a class (members and narrower classes' members), nearest first. */
  function descendants(
    userId: string,
    classId: string,
  ): Array<{ concept: Concept; chain: Relation[]; parent: Concept | null }> {
    const out: Array<{ id: string; chain: Relation[]; parentId: string }> = [];
    const seen = new Set<string>([classId]);
    let frontier: Array<{ id: string; chain: Relation[] }> = [{ id: classId, chain: [] }];
    for (
      let depth = 0;
      depth < MAX_CLASS_DEPTH && frontier.length > 0 && out.length < MAX_WALK;
      depth++
    ) {
      const next: Array<{ id: string; chain: Relation[] }> = [];
      for (const node of frontier) {
        for (const rel of repo.relationsOf(userId, node.id)) {
          if (rel.type !== "belongs_to_class" || rel.to !== node.id || seen.has(rel.from)) continue;
          seen.add(rel.from);
          const step = { id: rel.from, chain: [...node.chain, rel] };
          out.push({ ...step, parentId: node.id });
          next.push(step);
        }
      }
      frontier = next;
    }
    const found = byIds(
      userId,
      out.flatMap((o) => [o.id, o.parentId]),
    );
    return out.flatMap((o) => {
      const concept = found.get(o.id);
      return concept ? [{ concept, chain: o.chain, parent: found.get(o.parentId) ?? null }] : [];
    });
  }

  // ---- search and lists -------------------------------------------------------------------------

  function suggestionsFor(userId: string, subject: Concept, limit = 5): DuplicateSuggestion[] {
    return suggestDuplicates(
      { type: subject.type, name: subject.name, aliases: subject.aliases, selfId: subject.id },
      repo.conceptsOfType(userId, subject.type).map((c) => ({
        id: c.id,
        type: c.type,
        name: c.name,
        aliases: c.aliases,
        extraNames: [
          ...(c.drug?.genericName ? [c.drug.genericName] : []),
          ...(c.drug?.brandNames ?? []),
        ],
      })),
    ).slice(0, limit);
  }

  /** Name, alias, generic and brand search, with prefix matching: "metop" finds metoprolol and Lopressor's generic. */
  function search(
    userId: string,
    text: string,
    options: { type?: ConceptType | undefined; limit?: number | undefined } = {},
  ): ConceptSummary[] {
    const key = normalizeName(text);
    const tokens = key.split(" ").filter(Boolean).slice(0, 8);
    if (tokens.length === 0) return [];
    const limit = Math.min(Math.max(options.limit ?? 20, 1), 100);
    const match = tokens.map((t) => `"${t.replaceAll('"', '""')}"*`).join(" ");
    const rows = db
      .prepare(
        `SELECT c.*, bm25(concepts_fts) AS rank FROM concepts_fts
         JOIN concepts c ON c.seq = concepts_fts.rowid
         WHERE concepts_fts MATCH ? AND c.user_id = ?${options.type ? " AND c.type = ?" : ""}
         ORDER BY rank LIMIT ?`,
      )
      .all(match, userId, ...(options.type ? [options.type] : []), limit * 3) as Array<
      ConceptRow & { rank: number }
    >;
    const score = (row: ConceptRow): number => {
      if (row.name_key === key) return 0;
      if (row.name_key.startsWith(key)) return 1;
      if (toConcept(row).aliases.some((a) => normalizeName(a) === key)) return 2;
      return 3;
    };
    return rows
      .map((row, index) => ({ row, index, score: score(row) }))
      .sort((a, b) => a.score - b.score || a.index - b.index)
      .slice(0, limit)
      .map(({ row }) => summaryOf(toConcept(row)));
  }

  function list(
    userId: string,
    query: Partial<ConceptListQuery>,
  ): { items: ConceptSummary[]; nextCursor: string | null } {
    const limit = Math.min(Math.max(query.limit ?? 50, 1), 200);
    if (query.q) {
      return { items: search(userId, query.q, { type: query.type, limit }), nextCursor: null };
    }
    let after: [string, number] | null = null;
    if (query.cursor) {
      try {
        const parsed = JSON.parse(Buffer.from(query.cursor, "base64url").toString("utf8"));
        if (
          Array.isArray(parsed) &&
          typeof parsed[0] === "string" &&
          typeof parsed[1] === "number"
        ) {
          after = [parsed[0], parsed[1]];
        }
      } catch {
        // falls through to the error below
      }
      if (!after) {
        throw new AppError("invalid_input", "That cursor is not one this list gave out.", {
          hint: 'Use the "nextCursor" of a previous response.',
        });
      }
    }
    const where = ["user_id = ?"];
    const args: unknown[] = [userId];
    if (query.type) {
      where.push("type = ?");
      args.push(query.type);
    }
    if (after) {
      where.push("(name_key > ? OR (name_key = ? AND seq > ?))");
      args.push(after[0], after[0], after[1]);
    }
    const rows = db
      .prepare(`SELECT * FROM concepts WHERE ${where.join(" AND ")} ORDER BY name_key, seq LIMIT ?`)
      .all(...args, limit + 1) as ConceptRow[];
    const page = rows.slice(0, limit);
    const last = page[page.length - 1];
    return {
      items: page.map((r) => summaryOf(toConcept(r))),
      nextCursor:
        rows.length > limit && last
          ? Buffer.from(JSON.stringify([last.name_key, last.seq])).toString("base64url")
          : null,
    };
  }

  // ---- the concept page (F2) ----------------------------------------------------------------------

  function page(userId: string, id: string): ConceptPage {
    const { concept, redirectedFrom } = need(userId, id);
    const rels = repo.relationsOf(userId, concept.id);
    const others = byIds(
      userId,
      rels.map((r) => (r.from === concept.id ? r.to : r.from)),
    );
    const nameOf = (cid: string) =>
      others.get(cid)?.name ?? (cid === concept.id ? concept.name : cid);

    const groups: RelationGroup[] = [];
    for (const type of RELATION_TYPES) {
      const rule = RELATION_RULES[type];
      for (const direction of ["out", "in"] as const) {
        const items = rels
          .filter((r) => r.type === type)
          .filter((r) =>
            direction === "out"
              ? r.from === concept.id || rule.symmetric
              : r.to === concept.id && !rule.symmetric,
          )
          .flatMap((relation) => {
            const otherId = relation.from === concept.id ? relation.to : relation.from;
            const other = others.get(otherId);
            return other ? [{ relation, concept: summaryOf(other) }] : [];
          })
          .sort((a, b) => a.concept.name.localeCompare(b.concept.name));
        if (items.length > 0) {
          groups.push({
            type,
            direction,
            label: direction === "out" ? rule.forward : rule.backward,
            items,
          });
        }
      }
    }

    const ids = [concept.id, ...repo.mergedInto(userId, concept.id)];
    const wanted: Array<{ citation: Citation; supports: PageSource["supports"] }> = [
      ...concept.citations.map((citation) => ({
        citation,
        supports: { kind: "concept" } as const,
      })),
      ...rels.flatMap((rel) =>
        rel.citations.map((citation) => ({
          citation,
          supports: {
            kind: "relation" as const,
            relationId: rel.id,
            sentence: relationSentence(rel.type, nameOf(rel.from), nameOf(rel.to)),
          },
        })),
      ),
    ];
    const infos = sources.resolve(
      userId,
      wanted.map((w) => ({
        fileId: w.citation.fileId,
        pageId: w.citation.pageId,
        quote: w.citation.quote,
      })),
    );
    const sourcesOut: PageSource[] = wanted.map((w, index) => {
      const info = infos[index];
      const gone = info?.known && !info.exists;
      return {
        citation: w.citation,
        status: gone ? "source_deleted" : info?.trashed ? "source_trashed" : "available",
        fileName: gone ? null : (info?.fileName ?? null),
        pageIndex: gone ? null : (info?.pageIndex ?? null),
        supports: w.supports,
      };
    });

    return {
      concept,
      redirectedFrom,
      groups,
      mentions: mentions.mentions(userId, ids),
      questions: questions.questions(userId, ids),
      sources: sourcesOut,
      suggestions: suggestionsFor(userId, concept).map((s) => ({
        conceptId: s.conceptId,
        name: s.name,
        reason: s.reason,
        explanation: s.explanation,
      })),
    };
  }

  // ---- graph and path (F3) ----------------------------------------------------------------------------

  function neighbourhood(userId: string, id: string, rawQuery: unknown = {}): GraphResult {
    const query = parseOrThrow(GraphQuery, rawQuery ?? {}, {
      hops: 2,
      maxNodes: 60,
      relationTypes: ["causes_adverse_effect"],
    });
    const center = need(userId, id).concept;
    const visited = new Map<string, Concept>([[center.id, center]]);
    let frontier = [center.id];
    let truncated = false;
    for (let hop = 0; hop < query.hops && frontier.length > 0; hop++) {
      const rels = touching(userId, frontier, query.relationTypes);
      const wanted = new Set<string>();
      for (const rel of rels) {
        for (const end of [rel.from, rel.to]) if (!visited.has(end)) wanted.add(end);
      }
      const found = byIds(userId, [...wanted]);
      const candidates = [...found.values()].sort(
        (a, b) =>
          normalizeName(a.name).localeCompare(normalizeName(b.name)) || a.id.localeCompare(b.id),
      );
      const added: string[] = [];
      for (const concept of candidates) {
        if (visited.size >= query.maxNodes) {
          truncated = true;
          break;
        }
        visited.set(concept.id, concept);
        added.push(concept.id);
      }
      frontier = added;
    }
    const edges = touching(userId, [...visited.keys()], query.relationTypes).filter(
      (r) => visited.has(r.from) && visited.has(r.to),
    );
    return {
      center: center.id,
      hops: query.hops,
      nodes: [...visited.values()].map(summaryOf),
      edges: edges.map((r) => ({ id: r.id, from: r.from, to: r.to, type: r.type, note: r.note })),
      truncated,
    };
  }

  function path(
    userId: string,
    fromId: string,
    toId: string,
    options: {
      maxHops?: number | undefined;
      relationTypes?: readonly RelationType[] | undefined;
    } = {},
  ): PathResult {
    const from = need(userId, fromId).concept;
    const to = need(userId, toId).concept;
    const maxHops = Math.min(Math.max(options.maxHops ?? 6, 1), 8);
    if (from.id === to.id) return { found: true, from: from.id, to: to.id, steps: [] };
    const parent = new Map<string, { prev: string; rel: Relation }>();
    const seen = new Set<string>([from.id]);
    let frontier = [from.id];
    let reached = false;
    for (
      let hop = 0;
      hop < maxHops && frontier.length > 0 && !reached && seen.size < MAX_WALK;
      hop++
    ) {
      const next: string[] = [];
      for (const rel of touching(userId, frontier, options.relationTypes)) {
        for (const [a, b] of [
          [rel.from, rel.to],
          [rel.to, rel.from],
        ] as const) {
          if (!frontier.includes(a) || seen.has(b)) continue;
          seen.add(b);
          parent.set(b, { prev: a, rel });
          next.push(b);
          if (b === to.id) reached = true;
        }
      }
      frontier = next;
    }
    if (!reached) return { found: false, from: from.id, to: to.id, steps: [] };
    const chainIds: string[] = [to.id];
    const links: Array<{ prev: string; rel: Relation; at: string }> = [];
    for (let at = to.id; at !== from.id; ) {
      const link = parent.get(at) as { prev: string; rel: Relation };
      links.unshift({ ...link, at });
      chainIds.push(link.prev);
      at = link.prev;
    }
    const concepts = byIds(userId, chainIds);
    const steps: PathStep[] = links.map((link) => ({
      relation: {
        id: link.rel.id,
        from: link.rel.from,
        to: link.rel.to,
        type: link.rel.type,
        note: link.rel.note,
      },
      direction: link.rel.from === link.prev ? "forward" : "backward",
      from: summaryOf(concepts.get(link.prev) as Concept),
      to: summaryOf(concepts.get(link.at) as Concept),
    }));
    return { found: true, from: from.id, to: to.id, steps };
  }

  // ---- filter queries (F5) -----------------------------------------------------------------------------

  function filter(userId: string, rawFilter: unknown): FilterResult {
    const spec = parseOrThrow(ConceptFilter, rawFilter, {
      kind: "with_relation",
      relation: "causes_adverse_effect",
      target: { type: "adverse_effect", name: "bradycardia" },
    });
    const rows = new Map<
      string,
      { concept: Concept; via: FilterRow["via"]; rels: Relation[]; shared?: Map<string, Concept> }
    >();
    const put = (concept: Concept, via: FilterRow["via"], rels: Relation[]) => {
      const existing = rows.get(concept.id);
      if (existing && (existing.via.kind === "direct" || via.kind === "class")) return;
      rows.set(concept.id, { concept, via, rels });
    };

    if (spec.kind === "with_relation") {
      const target = refConcept(userId, spec.target);
      const rule = RELATION_RULES[spec.relation];
      const wantFrom = spec.side === "from";
      const all = repo.relationsOf(userId, target.id).filter((r) => r.type === spec.relation);
      const direct = all.filter((r) =>
        rule.symmetric ? true : wantFrom ? r.to === target.id : r.from === target.id,
      );
      const holders = byIds(
        userId,
        direct.map((r) => (r.from === target.id ? r.to : r.from)),
      );
      for (const rel of direct) {
        const holder = holders.get(rel.from === target.id ? rel.to : rel.from);
        if (holder) put(holder, { kind: "direct" }, [rel]);
      }
      if (spec.viaClass) {
        if (wantFrom || rule.symmetric) {
          // A class that has the relation: its members have it too.
          for (const rel of direct) {
            const holder = holders.get(rel.from === target.id ? rel.to : rel.from);
            if (holder?.type !== "drug_class") continue;
            for (const member of descendants(userId, holder.id)) {
              put(member.concept, { kind: "class", class: summaryOf(holder) }, [
                rel,
                ...member.chain,
              ]);
            }
          }
        }
        if (!wantFrom || rule.symmetric) {
          // The target is a drug: its classes may carry the relation.
          for (const above of ancestors(userId, target.id)) {
            for (const rel of repo.relationsOf(userId, above.concept.id)) {
              if (rel.type !== spec.relation) continue;
              if (!rule.symmetric && rel.from !== above.concept.id) continue;
              const otherId = rel.from === above.concept.id ? rel.to : rel.from;
              const other = repo.concept(userId, otherId);
              if (other)
                put(other, { kind: "class", class: summaryOf(above.concept) }, [
                  ...above.chain,
                  rel,
                ]);
            }
          }
        }
      }
      rows.delete(target.id);
    } else if (spec.kind === "in_class") {
      const klass = refConcept(userId, spec.class);
      for (const member of descendants(userId, klass.id)) {
        if (member.concept.type !== "drug") continue;
        const direct = member.chain.length === 1;
        if (!direct && !spec.includeSubclasses) continue;
        put(
          member.concept,
          direct || !member.parent
            ? { kind: "direct" }
            : { kind: "class", class: summaryOf(member.parent) },
          member.chain,
        );
      }
    } else {
      const drug = refConcept(userId, spec.drug);
      const mechanismsOf = (id: string) => {
        const out = new Map<
          string,
          { mechanism: Concept; rels: Relation[]; via: FilterRow["via"] }
        >();
        const add = (rel: Relation, chain: Relation[], via: FilterRow["via"]) => {
          if (rel.type !== "has_mechanism") return;
          out.set(rel.to, {
            mechanism: undefined as unknown as Concept,
            rels: [...chain, rel],
            via,
          });
        };
        for (const rel of repo.relationsOf(userId, id))
          if (rel.from === id) add(rel, [], { kind: "direct" });
        for (const above of ancestors(userId, id)) {
          for (const rel of repo.relationsOf(userId, above.concept.id)) {
            if (rel.from === above.concept.id)
              add(rel, above.chain, { kind: "class", class: summaryOf(above.concept) });
          }
        }
        const found = byIds(userId, [...out.keys()]);
        for (const [mid, entry] of out) {
          const mechanism = found.get(mid);
          if (mechanism) entry.mechanism = mechanism;
          else out.delete(mid);
        }
        return out;
      };
      const mine = mechanismsOf(drug.id);
      for (const [mid, own] of mine) {
        // Everyone who has this mechanism: drugs directly, and the members of classes that have it.
        const incoming = repo
          .relationsOf(userId, mid)
          .filter((r) => r.type === "has_mechanism" && r.to === mid);
        const holders = byIds(
          userId,
          incoming.map((r) => r.from),
        );
        for (const rel of incoming) {
          const holder = holders.get(rel.from);
          if (!holder) continue;
          const candidates =
            holder.type === "drug_class"
              ? descendants(userId, holder.id).map((m) => ({
                  concept: m.concept,
                  rels: [rel, ...m.chain],
                  via: { kind: "class", class: summaryOf(holder) } as FilterRow["via"],
                }))
              : [{ concept: holder, rels: [rel], via: { kind: "direct" } as FilterRow["via"] }];
          for (const c of candidates) {
            if (c.concept.id === drug.id || c.concept.type !== "drug") continue;
            const existing = rows.get(c.concept.id);
            const shared = existing?.shared ?? new Map<string, Concept>();
            shared.set(mid, own.mechanism);
            if (!existing || (existing.via.kind === "class" && c.via.kind === "direct")) {
              rows.set(c.concept.id, { concept: c.concept, via: c.via, rels: c.rels, shared });
            } else {
              existing.shared = shared;
              existing.rels = [
                ...existing.rels,
                ...c.rels.filter((r) => !existing.rels.some((e) => e.id === r.id)),
              ];
            }
          }
        }
      }
    }

    const wantedTypes = spec.kind === "with_relation" ? spec.types : undefined;
    const sorted = [...rows.values()]
      .filter((r) => !wantedTypes || wantedTypes.includes(r.concept.type))
      .sort((a, b) => normalizeName(a.concept.name).localeCompare(normalizeName(b.concept.name)));
    const items: FilterRow[] = sorted.slice(0, spec.limit).map((r) => {
      const ev = evidence(r.rels);
      return {
        concept: summaryOf(r.concept),
        via: r.via,
        relationIds: [...new Set(r.rels.map((rel) => rel.id))],
        citations: ev.citations,
        generalKnowledge: ev.generalKnowledge,
        ...(r.shared ? { sharedMechanisms: [...r.shared.values()].map(summaryOf) } : {}),
      };
    });
    return { items, truncated: sorted.length > spec.limit };
  }

  // ---- comparison table (D5) ------------------------------------------------------------------------------

  function compare(userId: string, rawInput: unknown): ComparisonResult {
    const input = parseOrThrow(ComparisonInput, rawInput, {
      conceptIds: ["con_01J9Z8Y7X6W5V4T3S2R1Q0P9N8", "con_01J9Z8Y7X6W5V4T3S2R1Q0P9N9"],
      attributes: ["belongs_to_class", "causes_adverse_effect", "brand_names"],
    });
    const concepts = input.conceptIds.map((id) => need(userId, id).concept);
    const columns = input.attributes.map((attribute) => ({
      attribute,
      label: COMPARISON_LABELS[attribute],
    }));
    const rows = concepts.map((concept) => {
      const rels = repo.relationsOf(userId, concept.id);
      const classes = input.includeClass ? ancestors(userId, concept.id) : [];
      const classRels = new Map<string, Relation[]>();
      for (const above of classes)
        classRels.set(above.concept.id, repo.relationsOf(userId, above.concept.id));
      const otherIds = [...rels, ...[...classRels.values()].flat()].flatMap((r) => [r.from, r.to]);
      const others = byIds(userId, otherIds);

      const cells = input.attributes.map((attribute) => {
        const values: ComparisonValue[] = [];
        if (attribute === "brand_names") {
          const brands = concept.drug?.brandNames ?? [];
          for (const brand of brands) {
            values.push({
              text: brand,
              concept: null,
              relationId: null,
              inheritedFrom: null,
              citations: concept.citations,
            });
          }
          for (const rel of rels) {
            if (rel.type !== "brand_of" || rel.to !== concept.id) continue;
            const brand = others.get(rel.from);
            if (brand && !values.some((v) => normalizeName(v.text) === normalizeName(brand.name))) {
              values.push({
                text: brand.name,
                concept: summaryOf(brand),
                relationId: rel.id,
                inheritedFrom: null,
                citations: rel.citations,
              });
            }
          }
        } else {
          const collect = (source: Relation[], holder: Concept, inheritedFrom: Concept | null) => {
            const rule = RELATION_RULES[attribute];
            for (const rel of source) {
              if (rel.type !== attribute) continue;
              const reads =
                rel.from === holder.id
                  ? "out"
                  : rule.symmetric && rel.to === holder.id
                    ? "out"
                    : null;
              if (!reads) continue;
              const other = others.get(rel.from === holder.id ? rel.to : rel.from);
              if (!other) continue;
              const detail = rel.interaction
                ? ` (${rel.interaction.severity}: ${rel.interaction.effect})`
                : "";
              values.push({
                text: `${other.name}${detail}`,
                concept: summaryOf(other),
                relationId: rel.id,
                inheritedFrom: inheritedFrom ? summaryOf(inheritedFrom) : null,
                citations: rel.citations,
              });
            }
          };
          collect(rels, concept, null);
          if (input.includeClass) {
            // What its classes have too, marked as inherited. Its own value wins when both say the same thing.
            const own = new Set(values.map((v) => v.concept?.id));
            for (const above of classes) {
              const before = values.length;
              collect(classRels.get(above.concept.id) ?? [], above.concept, above.concept);
              const fresh = values.splice(before).filter((v) => !own.has(v.concept?.id));
              for (const v of fresh) own.add(v.concept?.id);
              values.push(...fresh);
            }
          }
          values.sort((a, b) => a.text.localeCompare(b.text));
        }
        return {
          attribute: attribute as ComparisonAttribute,
          values,
          citations: mergeCitations(...values.map((v) => v.citations)),
        };
      });
      return { concept: summaryOf(concept), cells };
    });
    return { columns, rows };
  }

  // ---- brand and generic drill (G12) --------------------------------------------------------------------------

  function brandGenericPairs(
    userId: string,
    options: { classId?: string | undefined; limit?: number | undefined } = {},
  ): BrandGenericPair[] {
    const limit = Math.min(Math.max(options.limit ?? 500, 1), 2000);
    const drugs = repo.conceptsOfType(userId, "drug");
    const links = db
      .prepare(
        "SELECT from_id, to_id, type, id FROM concept_relations WHERE user_id = ? AND type IN ('belongs_to_class', 'brand_of')",
      )
      .all(userId) as Array<{ from_id: string; to_id: string; type: string; id: string }>;
    const classIds = new Set(
      links.filter((l) => l.type === "belongs_to_class").map((l) => l.to_id),
    );
    const classes = byIds(userId, [...classIds]);
    const classNameOf = (drugId: string): string | null => {
      const names = links
        .filter((l) => l.type === "belongs_to_class" && l.from_id === drugId)
        .map((l) => classes.get(l.to_id)?.name)
        .filter((n): n is string => Boolean(n))
        .sort((a, b) => a.localeCompare(b));
      return names[0] ?? null;
    };
    let allowed: Set<string> | null = null;
    if (options.classId) {
      const klass = need(userId, options.classId).concept;
      allowed = new Set(descendants(userId, klass.id).map((d) => d.concept.id));
    }
    const out = new Map<string, BrandGenericPair>();
    const add = (concept: Concept, generic: string, brand: string, citations: Citation[]) => {
      if (allowed && !allowed.has(concept.id)) return;
      const key = `${normalizeName(generic)}|${normalizeName(brand)}`;
      if (normalizeName(generic) === normalizeName(brand) || out.has(key)) return;
      out.set(key, {
        conceptId: concept.id,
        generic,
        brand,
        drugClass: classNameOf(concept.id),
        citations,
      });
    };
    for (const drug of drugs) {
      for (const brand of drug.drug?.brandNames ?? []) {
        add(drug, drug.drug?.genericName ?? drug.name, brand, drug.citations);
      }
    }
    const byId = new Map(drugs.map((d) => [d.id, d]));
    for (const link of links.filter((l) => l.type === "brand_of")) {
      const brand = byId.get(link.from_id);
      const generic = byId.get(link.to_id);
      const rel = repo.relation(userId, link.id);
      if (brand && generic)
        add(generic, generic.drug?.genericName ?? generic.name, brand.name, rel?.citations ?? []);
    }
    return [...out.values()]
      .sort((a, b) => a.generic.localeCompare(b.generic) || a.brand.localeCompare(b.brand))
      .slice(0, limit);
  }

  return {
    list,
    search,
    page,
    neighbourhood,
    path,
    filter,
    compare,
    brandGenericPairs,
    suggestionsFor,
    examples: CONCEPT_EXAMPLES,
  };
}
