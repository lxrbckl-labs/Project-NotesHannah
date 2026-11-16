import { RequestCounts, StudyRequestWithContext } from "@notes/schema";
import { z } from "zod";
import type { AppHttp } from "../../../lib/api";
import { ApiClientError } from "../../../lib/api";
import type { RequestsStore } from "../types";

const Page = z.object({
  items: z.array(StudyRequestWithContext),
  nextCursor: z.string().nullable(),
});
const Body = z.object({ request: StudyRequestWithContext });
const CountsBody = z.object({ counts: RequestCounts });

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

/** The request routes of docs/api.md ("Requests"), validated with the shared schemas. */
export function createHttpRequestsStore(http: AppHttp): RequestsStore {
  return {
    async list(query = {}) {
      return parse(
        Page,
        await http.get("/requests", {
          status: query.status?.join(","),
          targetType: query.targetType,
          order: query.order ?? "newest",
          cursor: query.cursor,
          limit: query.limit ?? 100,
        }),
      );
    },
    async counts() {
      return parse(CountsBody, await http.get("/requests/counts")).counts;
    },
    async get(id) {
      return parse(Body, await http.get(`/requests/${id}`)).request;
    },
    async create(input) {
      return parse(Body, await http.post("/requests", input)).request;
    },
    async update(id, input) {
      return parse(Body, await http.patch(`/requests/${id}`, input)).request;
    },
    async cancel(id) {
      return parse(Body, await http.post(`/requests/${id}/cancel`)).request;
    },
    async reopen(id, note) {
      return parse(Body, await http.post(`/requests/${id}/reopen`, { note: note ?? "" })).request;
    },
  };
}
