import {
  BrandGenericPair,
  ComparisonResult,
  Concept,
  ConceptPage,
  ConceptSummary,
  type CreateRequestInput,
  FilterResult,
  GraphResult,
  pageOf,
  StudyRequest,
} from "@notes/schema";
import { z } from "zod";
import type { AppHttp } from "../../../lib/api";
import { ApiClientError } from "../../../lib/api";
import type { ConceptsStore } from "../types";

const ConceptList = pageOf(ConceptSummary);
const Items = <T extends z.ZodType>(item: T) => z.object({ items: z.array(item) });
const ConceptBody = z.object({ concept: Concept });
const MergeBody = z.object({ concept: Concept, mergedId: z.string() });
const RequestBody = z.object({ request: StudyRequest });

function parse<T>(schema: z.ZodType<T>, value: unknown): T {
  const result = schema.safeParse(value);
  if (!result.success) {
    throw new ApiClientError(200, {
      code: "bad_response",
      message: "The server sent a response the app did not expect.",
      hint: result.error.issues[0]?.message,
    });
  }
  return result.data;
}

/** The concept routes of docs/api.md ("Concepts" and "Requests"), validated with the shared schemas. */
export function createHttpConceptsStore(http: AppHttp): ConceptsStore {
  return {
    async list(query = {}) {
      return parse(
        ConceptList,
        await http.get("/concepts", {
          type: query.type,
          q: query.q,
          cursor: query.cursor,
          limit: query.limit ?? 200,
        }),
      );
    },
    async search(q, options = {}) {
      const body = await http.get("/concepts/search", {
        q,
        type: options.type,
        limit: options.limit,
      });
      return parse(Items(ConceptSummary), body).items;
    },
    async page(id) {
      return parse(ConceptPage, await http.get(`/concepts/${id}/page`));
    },
    async graph(id, options) {
      return parse(
        GraphResult,
        await http.get(`/concepts/${id}/graph`, {
          hops: options.hops,
          maxNodes: options.maxNodes,
          relationTypes: options.relationTypes?.join(","),
        }),
      );
    },
    async query(filter) {
      return parse(FilterResult, await http.post("/concepts/query", filter));
    },
    async compare(input) {
      return parse(ComparisonResult, await http.post("/concepts/compare", input));
    },
    async brandGeneric(options = {}) {
      const body = await http.get("/concepts/brand-generic", {
        classId: options.classId,
        limit: options.limit,
      });
      return parse(Items(BrandGenericPair), body).items;
    },
    async review(id, status) {
      return parse(ConceptBody, await http.post(`/concepts/${id}/review`, { status })).concept;
    },
    async merge(keepId, mergeId) {
      return parse(MergeBody, await http.post(`/concepts/${keepId}/merge`, { mergeId }));
    },
    async createRequest(input: CreateRequestInput) {
      return parse(RequestBody, await http.post("/requests", input)).request;
    },
  };
}
