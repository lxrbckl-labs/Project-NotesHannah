import {
  BrandGenericPair,
  ComparisonResult,
  Concept,
  ConceptPage,
  FilterResult,
  GraphResult,
  Relation,
} from "@notes/schema";
import { describe, expect, it } from "vitest";
import type { AppHttp } from "../../../lib/api";
import { createHttpConceptsStore } from "../store/http";
import { createMockConceptsStore } from "../store/mock";
import { CONCEPTS, KEY, RELATIONS } from "../store/seed";

const id = (key: string) => KEY[key] as string;

function fakeHttp(answer: (method: string, path: string) => unknown) {
  const calls: Array<{ method: string; path: string; query?: unknown; body?: unknown }> = [];
  const make = (method: string) => async (path: string, a?: unknown, b?: unknown) => {
    const isGet = method === "GET";
    calls.push({ method, path, ...(isGet ? { query: a } : { body: a ?? b }) });
    return answer(method, path);
  };
  const http = {
    get: make("GET"),
    post: make("POST"),
    patch: make("PATCH"),
    put: make("PUT"),
    del: make("DELETE"),
  } as unknown as AppHttp;
  return { http, calls };
}

describe("the demo dataset", () => {
  it("is valid against the shared schemas and big enough to be realistic", () => {
    expect(CONCEPTS.length).toBeGreaterThanOrEqual(40);
    for (const c of CONCEPTS) Concept.parse(c);
    for (const r of RELATIONS) Relation.parse(r);
    const rules = CONCEPTS.filter((c) => c.generalKnowledge && c.citations.length > 0);
    expect(rules).toEqual([]);
  });

  it("answers every route in the shape the schema documents", async () => {
    const store = createMockConceptsStore();
    for (const c of CONCEPTS) ConceptPage.parse(await store.page(c.id));
    GraphResult.parse(await store.graph(id("bb"), { hops: 2 }));
    FilterResult.parse(
      await store.query({
        kind: "in_class",
        class: { id: id("bb") },
        includeSubclasses: true,
        limit: 50,
      }),
    );
    ComparisonResult.parse(
      await store.compare({
        conceptIds: [id("metoprolol"), id("lisinopril")],
        attributes: ["belongs_to_class", "brand_names"],
        includeClass: true,
      }),
    );
    for (const p of await store.brandGeneric()) BrandGenericPair.parse(p);
  });
});

describe("mock store behaviour", () => {
  it("answers 'everything that causes bradycardia' through the class", async () => {
    const store = createMockConceptsStore();
    const { items } = await store.query({
      kind: "with_relation",
      relation: "causes_adverse_effect",
      target: { id: id("brady") },
      side: "from",
      viaClass: true,
      limit: 100,
    });
    const names = items.map((r) => r.concept.name);
    expect(names).toContain("Atenolol");
    expect(names).toContain("Verapamil HCl");
    const atenolol = items.find((r) => r.concept.name === "Atenolol");
    expect(atenolol?.via).toMatchObject({ kind: "class", class: { name: "Beta blockers" } });
    expect(atenolol?.citations.length).toBeGreaterThan(0);
  });

  it("finds drugs that share a mechanism, with the shared mechanism named", async () => {
    const store = createMockConceptsStore();
    const { items } = await store.query({
      kind: "sharing_mechanism",
      drug: { id: id("metoprolol") },
      limit: 50,
    });
    expect(items.map((r) => r.concept.name).sort()).toEqual([
      "Atenolol",
      "Bisoprolol",
      "Metoprolol succinate",
    ]);
    expect(items[0]?.sharedMechanisms?.[0]?.name).toBe("Beta-1 receptor antagonism");
  });

  it("marks values that come from the class when asked", async () => {
    const store = createMockConceptsStore();
    const result = await store.compare({
      conceptIds: [id("atenolol"), id("lisinopril")],
      attributes: ["causes_adverse_effect"],
      includeClass: true,
    });
    const atenolol = result.rows[0]?.cells[0]?.values ?? [];
    expect(atenolol.length).toBeGreaterThan(0);
    expect(atenolol.every((v) => v.inheritedFrom !== null)).toBe(true);
    const without = await store.compare({
      conceptIds: [id("atenolol"), id("lisinopril")],
      attributes: ["causes_adverse_effect"],
      includeClass: false,
    });
    expect(without.rows[0]?.cells[0]?.values).toEqual([]);
  });

  it("searches names, aliases and brands, and merges with a redirect", async () => {
    const store = createMockConceptsStore();
    expect((await store.search("lopress"))[0]?.name).toBe("Metoprolol");
    expect((await store.search("ACEi"))[0]?.name).toBe("ACE inhibitors");
    await store.merge(id("metoprolol"), id("metoprololS"));
    const page = await store.page(id("metoprololS"));
    expect(page.concept.id).toBe(id("metoprolol"));
    expect(page.redirectedFrom).toBe(id("metoprololS"));
    expect(page.concept.drug?.brandNames).toContain("Toprol-XL");
  });

  it("records requests it is asked to create", async () => {
    const store = createMockConceptsStore();
    const request = await store.createRequest({
      target: { type: "library" },
      kind: "other",
      message: "Add this",
    });
    expect(request.status).toBe("waiting");
    expect(store.requests).toHaveLength(1);
  });
});

describe("HTTP store", () => {
  const mock = createMockConceptsStore();

  it("lists with the documented query and follows the page shape", async () => {
    const { http, calls } = fakeHttp(() => ({ items: [], nextCursor: null }));
    const store = createHttpConceptsStore(http);
    await store.list({ type: "drug", q: "meto", cursor: "50" });
    expect(calls[0]).toEqual({
      method: "GET",
      path: "/concepts",
      query: { type: "drug", q: "meto", cursor: "50", limit: 200 },
    });
  });

  it("searches, reads the page and the graph with comma-separated relation types", async () => {
    const summaries = (await mock.search("beta")).slice(0, 2);
    const { http, calls } = fakeHttp((_m, path) => {
      if (path.endsWith("/search")) return { items: summaries };
      if (path.endsWith("/page")) return mock.page(id("bb"));
      return mock.graph(id("bb"), { hops: 1 });
    });
    const store = createHttpConceptsStore(http);
    expect(await store.search("beta", { type: "drug_class", limit: 5 })).toEqual(summaries);
    await store.page(id("bb"));
    await store.graph(id("bb"), {
      hops: 2,
      maxNodes: 30,
      relationTypes: ["treats", "causes_adverse_effect"],
    });
    expect(calls.map((c) => `${c.method} ${c.path}`)).toEqual([
      "GET /concepts/search",
      `GET /concepts/${id("bb")}/page`,
      `GET /concepts/${id("bb")}/graph`,
    ]);
    expect(calls[0]?.query).toEqual({ q: "beta", type: "drug_class", limit: 5 });
    expect(calls[2]?.query).toEqual({
      hops: 2,
      maxNodes: 30,
      relationTypes: "treats,causes_adverse_effect",
    });
  });

  it("posts filters, comparisons, reviews, merges and requests to their routes", async () => {
    const concept = CONCEPTS[0];
    const { http, calls } = fakeHttp((_m, path) => {
      if (path === "/concepts/query") return { items: [], truncated: false };
      if (path === "/concepts/compare") return { columns: [], rows: [] };
      if (path.endsWith("/review")) return { concept };
      if (path.endsWith("/merge"))
        return { concept, mergedId: id("atenolol"), relationsMoved: 1, relationsDropped: 0 };
      return { request: { ...mock.requests[0] } };
    });
    const store = createHttpConceptsStore(http);
    const filter = {
      kind: "in_class",
      class: { id: id("bb") },
      includeSubclasses: true,
      limit: 10,
    } as const;
    await store.query(filter);
    await store.compare({
      conceptIds: [id("atenolol"), id("metoprolol")],
      attributes: ["brand_names"],
      includeClass: false,
    });
    await store.review(id("bb"), "reviewed");
    await store.merge(id("metoprolol"), id("metoprololS"));
    expect(calls.map((c) => `${c.method} ${c.path}`)).toEqual([
      "POST /concepts/query",
      "POST /concepts/compare",
      `POST /concepts/${id("bb")}/review`,
      `POST /concepts/${id("metoprolol")}/merge`,
    ]);
    expect(calls[0]?.body).toEqual(filter);
    expect(calls[2]?.body).toEqual({ status: "reviewed" });
    expect(calls[3]?.body).toEqual({ mergeId: id("metoprololS") });
  });

  it("creates a request with POST /requests and reads brand pairs", async () => {
    const made = await mock.createRequest({
      target: { type: "library" },
      kind: "other",
      message: "Hello",
    });
    const { http, calls } = fakeHttp((_m, path) =>
      path === "/requests" ? { request: made } : { items: [] },
    );
    const store = createHttpConceptsStore(http);
    const input = {
      target: { type: "library" as const },
      kind: "other" as const,
      message: "Hello",
    };
    expect((await store.createRequest(input)).id).toBe(made.id);
    expect(await store.brandGeneric({ classId: id("bb"), limit: 20 })).toEqual([]);
    expect(calls[0]).toMatchObject({ method: "POST", path: "/requests", body: input });
    expect(calls[1]).toMatchObject({
      path: "/concepts/brand-generic",
      query: { classId: id("bb"), limit: 20 },
    });
  });

  it("raises a readable error when the server answers with something unexpected", async () => {
    const { http } = fakeHttp(() => ({ nonsense: true }));
    await expect(createHttpConceptsStore(http).page(id("bb"))).rejects.toMatchObject({
      code: "bad_response",
    });
  });
});
