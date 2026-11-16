import { SEARCH_KINDS, type SearchHit, type SearchKind, type SearchPage } from "@notes/schema";
import { AppError } from "../../http/errors.js";
import type { ConceptsService } from "../concepts/index.js";
import type { DocumentsService } from "../documents/index.js";
import type { FilesService } from "../files/index.js";
import type { LibraryService } from "../library/index.js";
import type { PracticeService } from "../practice/index.js";
import type { ReferencesService } from "../references/index.js";

/** What the search needs from each domain: its own ranked, user-scoped, paged text search. */
export interface SearchSources {
  library: Pick<LibraryService, "search">;
  files: Pick<FilesService, "searchTranscripts">;
  documents: Pick<DocumentsService, "searchDocuments">;
  practice: Pick<PracticeService, "searchQuestions">;
  concepts: Pick<ConceptsService, "searchConcepts">;
  /** Optional so a search over the library alone (tests) still works. */
  references?: Pick<ReferencesService, "searchReferences"> | undefined;
}

export interface SearchRequest {
  q: string;
  /** Restrict to these kinds. Default: all. */
  kinds?: readonly SearchKind[] | undefined;
  cursor?: string | undefined;
  limit?: number | undefined;
}

const DEFAULT_LIMIT = 50;

/**
 * How the kinds compete. Each domain ranks its own hits (FTS5 rank), and those scores
 * cannot be compared across tables, so the lists are merged by reciprocal rank:
 * a hit at position `r` of its kind scores `weight / (K + r)`. A name match outranks
 * a concept (a thing she studies, found by name), which outranks a block (curated study
 * material), a question, and a raw transcript page, in that order; within a kind the
 * domain's own order is kept. Ties go to the earlier kind in `ORDER`.
 */
const WEIGHT: Record<SearchKind, number> = {
  node: 1.5,
  concept: 1.3,
  // Her saved references are things she chose to keep, found by their title: near a concept.
  reference: 1.2,
  block: 1,
  question: 0.95,
  page: 0.9,
};
const RANK_OFFSET = 3;
const ORDER: readonly SearchKind[] = ["node", "concept", "reference", "block", "question", "page"];

type Taken = Record<SearchKind, number>;

function invalidCursor(): AppError {
  return new AppError("invalid_input", "The cursor is not valid.", {
    hint: "Pass the nextCursor value from the previous page unchanged, or omit cursor for the first page.",
    example: { q: "beta", limit: 50 },
  });
}

/** The cursor is how many hits of each kind earlier pages already used. */
function decode(cursor: string | undefined): Taken {
  if (!cursor) return { node: 0, concept: 0, reference: 0, block: 0, question: 0, page: 0 };
  try {
    const value = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8")) as Record<
      string,
      unknown
    >;
    // A cursor from before concepts, questions and references were searched lacks `c`, `q` or `r`: they start at 0.
    const taken = {
      node: value.n,
      concept: value.c ?? 0,
      reference: value.r ?? 0,
      block: value.b,
      question: value.q ?? 0,
      page: value.p,
    };
    if (Object.values(taken).every((n) => Number.isInteger(n) && (n as number) >= 0)) {
      return taken as Taken;
    }
  } catch {
    // fall through
  }
  throw invalidCursor();
}

function encode(taken: Taken): string {
  return Buffer.from(
    JSON.stringify({
      n: taken.node,
      c: taken.concept,
      r: taken.reference,
      b: taken.block,
      q: taken.question,
      p: taken.page,
    }),
  ).toString("base64url");
}

/**
 * One search over names, transcripts and document blocks, with one cursor.
 *
 * Because scores fall with position inside each kind, the best `limit` merged hits are always
 * a prefix of every kind's list. The cursor therefore only has to count how many of each kind
 * were used, and the next page asks each domain to skip that many.
 */
export function createSearchService(sources: SearchSources) {
  function search(userId: string, request: SearchRequest): SearchPage {
    const limit = request.limit ?? DEFAULT_LIMIT;
    const kinds = new Set<SearchKind>(request.kinds ?? SEARCH_KINDS);
    const skip = decode(request.cursor);
    const ask = { limit: limit + 1 };

    const lists: Record<SearchKind, SearchHit[]> = {
      node: kinds.has("node")
        ? sources.library.search(userId, { q: request.q, ...ask, offset: skip.node }).items
        : [],
      concept: kinds.has("concept")
        ? sources.concepts
            .searchConcepts(userId, request.q, { limit: limit + 1, offset: skip.concept })
            .map(
              (c): SearchHit => ({
                kind: "concept",
                conceptId: c.id,
                name: c.name,
                conceptType: c.type,
                genericName: c.genericName,
                snippet: c.genericName ? `${c.name} (${c.genericName})` : c.name,
              }),
            )
        : [],
      reference:
        kinds.has("reference") && sources.references
          ? sources.references
              .searchReferences(userId, request.q, { limit: limit + 1, offset: skip.reference })
              .map((h): SearchHit => ({ kind: "reference", ...h }))
          : [],
      question: kinds.has("question")
        ? sources.practice
            .searchQuestions(userId, request.q, { ...ask, offset: skip.question })
            .map((h): SearchHit => ({ kind: "question", ...h }))
        : [],
      block: kinds.has("block")
        ? sources.documents.searchDocuments(userId, request.q, { ...ask, offset: skip.block }).items
        : [],
      page: kinds.has("page")
        ? sources.files
            .searchTranscripts(userId, request.q, { ...ask, offset: skip.page })
            .items.map(
              (hit): SearchHit => ({
                kind: "page",
                pageId: hit.pageId,
                pageIndex: hit.pageIndex,
                fileId: hit.fileId,
                fileName: hit.fileName,
                nodeId: hit.nodeId,
                transcriptId: hit.transcriptId,
                snippet: hit.snippet,
              }),
            )
        : [],
    };

    const merged = ORDER.flatMap((kind) =>
      lists[kind].map((hit, position) => ({
        hit,
        kind,
        score: WEIGHT[kind] / (RANK_OFFSET + skip[kind] + position),
      })),
    ).sort((a, b) => b.score - a.score || ORDER.indexOf(a.kind) - ORDER.indexOf(b.kind));

    const page = merged.slice(0, limit);
    const used: Taken = { ...skip };
    for (const entry of page) used[entry.kind]++;
    return {
      items: page.map((entry) => entry.hit),
      nextCursor: merged.length > limit ? encode(used) : null,
    };
  }

  return { search };
}

export type SearchService = ReturnType<typeof createSearchService>;
