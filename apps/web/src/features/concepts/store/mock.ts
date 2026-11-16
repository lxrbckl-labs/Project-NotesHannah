import {
  type BrandGenericPair,
  COMPARISON_LABELS,
  type ComparisonCell,
  type ComparisonInput,
  type ComparisonValue,
  type Concept,
  type ConceptFilter,
  type ConceptPage,
  type ConceptSummary,
  type CreateRequestInput,
  citationKey,
  type FilterRow,
  type GraphResult,
  type PageSource,
  RELATION_RULES,
  type Relation,
  type RelationGroup,
  type StudyRequest,
} from "@notes/schema";
import type { ConceptsStore } from "../types";
import {
  brandPairs,
  CONCEPTS,
  FILE_NAME,
  KEY,
  MENTIONS,
  PAGE_NUMBER,
  QUESTIONS,
  RELATIONS,
  SUGGESTIONS,
} from "./seed";

export interface MockConceptsOptions {
  /** Delay every call by this many milliseconds (loading states in the demo). */
  delayMs?: number;
  /** Make every call fail with this message (error states in the demo). */
  failWith?: string;
  /** Start with no concepts. */
  empty?: boolean;
}

export interface MockConceptsStore extends ConceptsStore {
  /** Requests created through `createRequest`, newest last (the demo and e2e read this). */
  requests: StudyRequest[];
  /** Calls made, for tests: `[name, ...args]`. */
  calls: unknown[][];
}

const summary = (c: Concept): ConceptSummary => ({
  id: c.id,
  type: c.type,
  name: c.name,
  genericName: c.drug?.genericName ?? null,
  reviewStatus: c.reviewStatus,
});

const sortByName = (a: { name: string }, b: { name: string }) => a.name.localeCompare(b.name);

export function createMockConceptsStore(options: MockConceptsOptions = {}): MockConceptsStore {
  const concepts = new Map<string, Concept>(
    (options.empty ? [] : structuredClone(CONCEPTS)).map((c) => [c.id, c]),
  );
  const relations: Relation[] = options.empty ? [] : structuredClone(RELATIONS);
  const redirects = new Map<string, string>();
  const requests: StudyRequest[] = [];
  const calls: unknown[][] = [];

  const get = (id: string) => {
    const real = redirects.get(id) ?? id;
    const c = concepts.get(real);
    if (!c) throw notFound();
    return c;
  };
  const sum = (id: string) => summary(get(id));

  /** The concept's classes, nearest first, up to six levels. */
  function classesOf(id: string): string[] {
    const out: string[] = [];
    let frontier = [id];
    for (let depth = 0; depth < 6 && frontier.length > 0; depth++) {
      const next: string[] = [];
      for (const r of relations)
        if (r.type === "belongs_to_class" && frontier.includes(r.from) && !out.includes(r.to)) {
          out.push(r.to);
          next.push(r.to);
        }
      frontier = next;
    }
    return out;
  }
  function membersOf(classId: string, subclasses = true): string[] {
    const out: string[] = [];
    let frontier = [classId];
    for (let depth = 0; depth < 6 && frontier.length > 0; depth++) {
      const next: string[] = [];
      for (const r of relations)
        if (r.type === "belongs_to_class" && frontier.includes(r.to) && !out.includes(r.from)) {
          out.push(r.from);
          if (subclasses) next.push(r.from);
        }
      frontier = next;
    }
    return out.filter((id) => get(id).type === "drug" || !subclasses === false);
  }

  const guard = async <T>(name: string, args: unknown[], run: () => T): Promise<T> => {
    calls.push([name, ...args]);
    if (options.delayMs) await new Promise((r) => setTimeout(r, options.delayMs));
    if (options.failWith) throw new Error(options.failWith);
    return structuredClone(run());
  };

  function matches(c: Concept, q: string): boolean {
    const needle = q.trim().toLowerCase();
    const names = [c.name, ...c.aliases, c.drug?.genericName ?? "", ...(c.drug?.brandNames ?? [])];
    return names.some((n) => n.toLowerCase().includes(needle));
  }

  function page(id: string): ConceptPage {
    const c = get(id);
    const touching = relations.filter((r) => r.from === c.id || r.to === c.id);
    const groups: RelationGroup[] = [];
    for (const r of touching) {
      const rule = RELATION_RULES[r.type];
      const out = r.from === c.id;
      const direction = rule.symmetric || out ? "out" : "in";
      let group = groups.find((g) => g.type === r.type && g.direction === direction);
      if (!group) {
        group = {
          type: r.type,
          direction,
          label: direction === "out" ? rule.forward : rule.backward,
          items: [],
        };
        groups.push(group);
      }
      group.items.push({ relation: r, concept: sum(out ? r.to : r.from) });
    }
    for (const g of groups) g.items.sort((a, b) => a.concept.name.localeCompare(b.concept.name));
    const sources: PageSource[] = [
      ...c.citations.map((citation) => ({ citation, supports: { kind: "concept" as const } })),
      ...touching.flatMap((r) =>
        r.citations.map((citation) => ({
          citation,
          supports: {
            kind: "relation" as const,
            relationId: r.id,
            sentence: `${get(r.from).name} ${RELATION_RULES[r.type].forward} ${get(r.to).name}`,
          },
        })),
      ),
    ].map((s) => ({
      ...s,
      status: "available" as const,
      fileName: FILE_NAME(s.citation.fileId),
      pageIndex: PAGE_NUMBER(s.citation),
    }));
    const key = Object.entries(KEY).find(([, v]) => v === c.id)?.[0] ?? "";
    return {
      concept: c,
      redirectedFrom: redirects.has(id) ? id : null,
      groups,
      mentions: MENTIONS[key] ?? [],
      questions: QUESTIONS[key] ?? [],
      sources,
      suggestions: (SUGGESTIONS[key] ?? [])
        .filter((s) => concepts.has(KEY[s.other] as string))
        .map((s) => ({
          conceptId: KEY[s.other] as string,
          name: get(KEY[s.other] as string).name,
          reason: s.reason,
          explanation: s.explanation,
        })),
    };
  }

  function graph(
    id: string,
    o: { hops: number; maxNodes?: number; relationTypes?: string[] },
  ): GraphResult {
    const max = o.maxNodes ?? 60;
    const reached = new Set([id]);
    const edges = new Map<string, Relation>();
    let frontier = [id];
    let truncated = false;
    for (let hop = 0; hop < o.hops; hop++) {
      const next: string[] = [];
      for (const node of frontier)
        for (const r of relations) {
          if (o.relationTypes && !o.relationTypes.includes(r.type)) continue;
          if (r.from !== node && r.to !== node) continue;
          const other = r.from === node ? r.to : r.from;
          if (!reached.has(other)) {
            if (reached.size >= max) {
              truncated = true;
              continue;
            }
            reached.add(other);
            next.push(other);
          }
          edges.set(r.id, r);
        }
      frontier = next;
    }
    return {
      center: id,
      hops: o.hops,
      nodes: [...reached].map(sum),
      edges: [...edges.values()]
        .filter((r) => reached.has(r.from) && reached.has(r.to))
        .map((r) => ({ id: r.id, from: r.from, to: r.to, type: r.type, note: r.note })),
      truncated,
    };
  }

  function resolveRef(ref: { id: string } | { type: string; name: string }): string {
    if ("id" in ref) return get(ref.id).id;
    const found = [...concepts.values()].find(
      (c) => c.type === ref.type && c.name.toLowerCase() === ref.name.toLowerCase(),
    );
    if (!found) throw notFound();
    return found.id;
  }

  function query(
    filter: ConceptFilter,
  ): ReturnType<ConceptsStore["query"]> extends Promise<infer R> ? R : never {
    const rows: FilterRow[] = [];
    const limit = filter.limit ?? 200;
    if (filter.kind === "in_class") {
      const cls = resolveRef(filter.class);
      for (const id of membersOf(cls, filter.includeSubclasses !== false)) {
        const c = get(id);
        if (c.type !== "drug") continue;
        const rel = relations.find((r) => r.from === id && r.type === "belongs_to_class");
        const direct = rel?.to === cls;
        rows.push({
          concept: summary(c),
          via: direct ? { kind: "direct" } : { kind: "class", class: sum(rel?.to ?? cls) },
          relationIds: rel ? [rel.id] : [],
          citations: rel?.citations ?? [],
          generalKnowledge: rel?.generalKnowledge ?? true,
        });
      }
    } else if (filter.kind === "with_relation") {
      const target = resolveRef(filter.target);
      const side = filter.side ?? "from";
      const hits = relations.filter(
        (r) => r.type === filter.relation && (side === "from" ? r.to : r.from) === target,
      );
      const seen = new Set<string>();
      for (const r of hits) {
        const holder = side === "from" ? r.from : r.to;
        const holderConcept = get(holder);
        const addRow = (id: string, via: FilterRow["via"]) => {
          const c = get(id);
          if (seen.has(id) || (filter.types && !filter.types.includes(c.type))) return;
          seen.add(id);
          rows.push({
            concept: summary(c),
            via,
            relationIds: [r.id],
            citations: r.citations,
            generalKnowledge: r.generalKnowledge,
          });
        };
        if (holderConcept.type === "drug") addRow(holder, { kind: "direct" });
        else if (filter.viaClass !== false) {
          addRow(holder, { kind: "direct" });
          for (const m of membersOf(holder))
            if (get(m).type === "drug") addRow(m, { kind: "class", class: summary(holderConcept) });
        } else addRow(holder, { kind: "direct" });
      }
    } else {
      const drug = resolveRef(filter.drug);
      const mechOf = (id: string) =>
        [id, ...classesOf(id)].flatMap((x) =>
          relations.filter((r) => r.from === x && r.type === "has_mechanism").map((r) => r.to),
        );
      const mine = new Set(mechOf(drug));
      for (const c of concepts.values()) {
        if (c.type !== "drug" || c.id === drug) continue;
        const shared = mechOf(c.id).filter((m) => mine.has(m));
        if (shared.length === 0) continue;
        const through = classesOf(c.id).find((cl) =>
          relations.some(
            (r) => r.from === cl && r.type === "has_mechanism" && shared.includes(r.to),
          ),
        );
        rows.push({
          concept: summary(c),
          via: through ? { kind: "class", class: sum(through) } : { kind: "direct" },
          relationIds: [],
          citations: relations
            .filter((r) => r.type === "has_mechanism" && shared.includes(r.to))
            .flatMap((r) => r.citations)
            .slice(0, 2),
          generalKnowledge: false,
          sharedMechanisms: [...new Set(shared)].map(sum),
        });
      }
    }
    rows.sort((a, b) => a.concept.name.localeCompare(b.concept.name));
    return { items: rows.slice(0, limit), truncated: rows.length > limit };
  }

  function compare(input: ComparisonInput) {
    return {
      columns: input.attributes.map((attribute) => ({
        attribute,
        label: COMPARISON_LABELS[attribute],
      })),
      rows: input.conceptIds.map((id) => {
        const c = get(id);
        const cells: ComparisonCell[] = input.attributes.map((attribute) => {
          const values: ComparisonValue[] = [];
          if (attribute === "brand_names") {
            for (const b of c.drug?.brandNames ?? [])
              values.push({
                text: b,
                concept: null,
                relationId: null,
                inheritedFrom: null,
                citations: [],
              });
          } else {
            const owners = input.includeClass ? [c.id, ...classesOf(c.id)] : [c.id];
            for (const owner of owners)
              for (const r of relations) {
                const forward = r.from === owner;
                if (
                  r.type !== attribute ||
                  !(forward || (RELATION_RULES[r.type].symmetric && r.to === owner))
                )
                  continue;
                const other = forward ? r.to : r.from;
                values.push({
                  text: r.interaction
                    ? `${get(other).name} (${r.interaction.severity})`
                    : get(other).name,
                  concept: sum(other),
                  relationId: r.id,
                  inheritedFrom: owner === c.id ? null : sum(owner),
                  citations: r.citations,
                });
              }
          }
          const seen = new Set<string>();
          const citations = values
            .flatMap((v) => v.citations)
            .filter((x) => (seen.has(citationKey(x)) ? false : seen.add(citationKey(x))));
          return { attribute, values, citations };
        });
        return { concept: summary(c), cells };
      }),
    };
  }

  return {
    requests,
    calls,
    list: (q = {}) =>
      guard("list", [q], () => {
        let items = [...concepts.values()].sort(sortByName);
        if (q.type) items = items.filter((c) => c.type === q.type);
        if (q.q) items = items.filter((c) => matches(c, q.q as string));
        const start = q.cursor ? Number(q.cursor) : 0;
        const limit = q.limit ?? 200;
        const slice = items.slice(start, start + limit);
        return {
          items: slice.map(summary),
          nextCursor: start + limit < items.length ? String(start + limit) : null,
        };
      }),
    search: (q, o = {}) =>
      guard("search", [q, o], () =>
        [...concepts.values()]
          .filter((c) => (!o.type || c.type === o.type) && matches(c, q))
          .sort((a, b) => {
            const rank = (c: Concept) => (c.name.toLowerCase().startsWith(q.toLowerCase()) ? 0 : 1);
            return rank(a) - rank(b) || a.name.localeCompare(b.name);
          })
          .slice(0, o.limit ?? 20)
          .map(summary),
      ),
    page: (id) => guard("page", [id], () => page(id)),
    graph: (id, o) => guard("graph", [id, o], () => graph(id, o)),
    query: (f) => guard("query", [f], () => query(f)),
    compare: (i) => guard("compare", [i], () => compare(i)),
    brandGeneric: (o = {}) =>
      guard("brandGeneric", [o], (): BrandGenericPair[] => {
        const all = options.empty ? [] : brandPairs();
        if (!o.classId) return all.slice(0, o.limit ?? 200);
        const members = new Set(membersOf(o.classId));
        return all.filter((p) => members.has(p.conceptId)).slice(0, o.limit ?? 200);
      }),
    review: (id, status) =>
      guard("review", [id, status], () => {
        const c = get(id);
        c.reviewStatus = status;
        return c;
      }),
    merge: (keepId, mergeId) =>
      guard("merge", [keepId, mergeId], () => {
        const keep = get(keepId);
        const gone = get(mergeId);
        keep.aliases = [...new Set([...keep.aliases, gone.name])];
        if (keep.drug && gone.drug)
          keep.drug.brandNames = [...new Set([...keep.drug.brandNames, ...gone.drug.brandNames])];
        for (const r of relations) {
          if (r.from === gone.id) r.from = keep.id;
          if (r.to === gone.id) r.to = keep.id;
        }
        concepts.delete(gone.id);
        redirects.set(gone.id, keep.id);
        return { concept: keep, mergedId: gone.id };
      }),
    createRequest: (input: CreateRequestInput) =>
      guard("createRequest", [input], () => {
        const now = new Date().toISOString();
        const n = requests.length + 1;
        const request: StudyRequest = {
          id: `req_${"0".repeat(22)}${String(n).padStart(4, "0")}`,
          userId: `usr_${"0".repeat(22)}0001`,
          target: input.target,
          kind: input.kind ?? "other",
          message: input.message ?? "",
          status: "waiting",
          createdBy: { type: "user", userId: `usr_${"0".repeat(22)}0001` },
          claimedBy: null,
          claimedAt: null,
          claimExpiresAt: null,
          reply: null,
          reopens: [],
          createdAt: now,
          updatedAt: now,
          closedAt: null,
        };
        requests.push(request);
        return request;
      }),
  };
}

function notFound(): Error {
  return Object.assign(new Error("That concept does not exist."), { code: "not_found" });
}
