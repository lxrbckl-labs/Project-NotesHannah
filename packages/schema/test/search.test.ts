import { describe, expect, it } from "vitest";
import { SEARCH_KINDS, SearchHit, SearchQuery } from "../src/index.js";

describe("search", () => {
  it("parses the kinds list", () => {
    expect(SearchQuery.parse({ q: " beta " })).toEqual({ q: "beta", limit: 50 });
    expect(SearchQuery.parse({ q: "x", kinds: "node, page,node" }).kinds).toEqual(["node", "page"]);
    expect(SearchQuery.parse({ q: "x", kinds: SEARCH_KINDS.join(",") }).kinds).toEqual([
      ...SEARCH_KINDS,
    ]);
  });

  it("refuses an unknown kind, an empty list and an oversized page, saying what is allowed", () => {
    const bad = SearchQuery.safeParse({ q: "x", kinds: "node,banana" });
    expect(bad.success).toBe(false);
    expect(JSON.stringify(bad.error?.issues)).toContain("banana");
    expect(JSON.stringify(bad.error?.issues)).toContain("node, page, block");
    expect(SearchQuery.safeParse({ q: "x", kinds: ",," }).success).toBe(false);
    expect(SearchQuery.safeParse({ q: "x", limit: 101 }).success).toBe(false);
    expect(SearchQuery.safeParse({ q: "  " }).success).toBe(false);
  });

  it("is a union tagged by kind", () => {
    const hit = {
      kind: "page",
      pageId: "pag_01HZX3K9Q2V7M4N8P6R5T0W1YB",
      pageIndex: 3,
      fileId: "fil_01HZX3K9Q2V7M4N8P6R5T0W1YB",
      fileName: "beta-blockers.pptx",
      nodeId: null,
      transcriptId: "trn_01HZX3K9Q2V7M4N8P6R5T0W1YB",
      snippet: "…beta blockers…",
    };
    expect(SearchHit.parse(hit)).toEqual(hit);
    expect(SearchHit.safeParse({ ...hit, kind: "banana" }).success).toBe(false);
    expect(SearchHit.safeParse({ ...hit, pageIndex: 0 }).success).toBe(false);
  });
});
