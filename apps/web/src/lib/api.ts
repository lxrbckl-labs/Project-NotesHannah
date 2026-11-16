import {
  ApiError,
  ApiKey,
  type ApiKeyScope,
  type ChangePasswordInput,
  CreatedApiKey,
  type CreateNodeInput,
  type LoginInput,
  type MoveNodeInput,
  NodeWithLinks,
  pageOf,
  SourceFile,
  type UpdateNodeInput,
  User,
} from "@notes/schema";
import { z } from "zod";

/** Errors the client raises itself, beside the server's own codes. */
export type ClientErrorCode = ApiError["code"] | "network" | "bad_response";

/** A failed API call, carrying what the server said so screens can show message and hint. */
export class ApiClientError extends Error {
  readonly code: ClientErrorCode;
  readonly status: number;
  readonly hint?: string;
  readonly example?: unknown;
  readonly retryAfter?: number;

  constructor(
    status: number,
    error: Omit<Partial<ApiError>, "code"> & { code: ClientErrorCode; message: string },
  ) {
    super(error.message);
    this.name = "ApiClientError";
    this.status = status;
    this.code = error.code;
    this.hint = error.hint;
    this.example = error.example;
    this.retryAfter = error.retryAfter;
  }
}

export function isApiError(value: unknown): value is ApiClientError {
  return value instanceof ApiClientError;
}

/** Text for a toast or inline notice: the server's message, then its hint. */
export function describeError(error: unknown): { message: string; hint?: string } {
  if (isApiError(error)) return { message: error.message, hint: error.hint };
  if (error instanceof Error) return { message: error.message };
  return { message: "Something went wrong." };
}

type UnauthenticatedListener = () => void;
const listeners = new Set<UnauthenticatedListener>();

/** Called when any request (other than sign-in itself) answers `unauthenticated`. */
export function onUnauthenticated(listener: UnauthenticatedListener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

const ErrorBody = z.object({ error: ApiError });

interface RequestOptions<T> {
  body?: unknown;
  query?: Record<string, string | number | undefined | null>;
  schema?: z.ZodType<T>;
  /** Do not treat `unauthenticated` as "the session ended" (sign-in, password check). */
  keepSession?: boolean;
}

async function request<T = void>(
  method: string,
  path: string,
  options: RequestOptions<T> = {},
): Promise<T> {
  const url = new URL(`/api${path}`, window.location.origin);
  for (const [key, value] of Object.entries(options.query ?? {})) {
    if (value !== undefined && value !== null) url.searchParams.set(key, String(value));
  }
  let response: Response;
  try {
    response = await fetch(url, {
      method,
      credentials: "same-origin",
      headers: options.body === undefined ? undefined : { "Content-Type": "application/json" },
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
    });
  } catch {
    throw new ApiClientError(0, {
      code: "network",
      message: "Could not reach the server.",
      hint: "Check your connection and try again.",
    });
  }

  if (!response.ok) {
    let parsed: z.infer<typeof ErrorBody> | null = null;
    try {
      const result = ErrorBody.safeParse(await response.json());
      parsed = result.success ? result.data : null;
    } catch {
      parsed = null;
    }
    const error = parsed?.error ?? {
      code: "internal" as const,
      message: "The server sent a response the app could not read.",
    };
    if (error.code === "rate_limited" && error.retryAfter === undefined) {
      const header = Number(response.headers.get("Retry-After"));
      if (Number.isInteger(header) && header > 0) error.retryAfter = header;
    }
    if (error.code === "unauthenticated" && !options.keepSession) {
      for (const listener of listeners) listener();
    }
    throw new ApiClientError(response.status, error);
  }

  if (response.status === 204 || !options.schema) return undefined as T;
  let json: unknown;
  try {
    json = await response.json();
  } catch {
    throw new ApiClientError(response.status, {
      code: "bad_response",
      message: "The server sent a response the app could not read.",
    });
  }
  const result = options.schema.safeParse(json);
  if (!result.success) {
    throw new ApiClientError(response.status, {
      code: "bad_response",
      message: "The server sent a response the app did not expect.",
      hint: result.error.issues[0]?.message,
    });
  }
  return result.data;
}

export const NodeList = pageOf(NodeWithLinks);
export type NodeList = z.infer<typeof NodeList>;
const NodeEnvelope = z.object({ node: NodeWithLinks });

export const SearchHit = z.object({
  kind: z.literal("node"),
  node: NodeWithLinks,
  snippet: z.string(),
});
export type SearchHit = z.infer<typeof SearchHit>;
const SearchPage = pageOf(SearchHit);
const FilePage = pageOf(SourceFile);

async function listFiles(query: Record<string, string>) {
  const items: SourceFile[] = [];
  let cursor: string | undefined;
  for (let guard = 0; guard < 20; guard++) {
    const page = await request("GET", "/files", {
      query: { ...query, cursor, limit: 200 },
      schema: FilePage,
    });
    items.push(...page.items);
    if (!page.nextCursor) break;
    cursor = page.nextCursor;
  }
  return items;
}

/** Follow cursors until a listing is complete (libraries are small; pages are 200). */
async function listAll(path: string, query: Record<string, string | undefined> = {}) {
  const items: NodeWithLinks[] = [];
  let cursor: string | undefined;
  for (let guard = 0; guard < 20; guard++) {
    const page = await request("GET", path, {
      query: { ...query, cursor, limit: 200 },
      schema: NodeList,
    });
    items.push(...page.items);
    if (!page.nextCursor) break;
    cursor = page.nextCursor;
  }
  return items;
}

export const api = {
  login: (input: LoginInput) =>
    request("POST", "/auth/login", {
      body: input,
      schema: z.object({ user: User }),
      keepSession: true,
    }).then((r) => r.user),
  logout: () => request("POST", "/auth/logout"),
  logoutAll: () => request("POST", "/auth/logout-all"),
  me: () =>
    request("GET", "/me", { schema: z.object({ user: User }), keepSession: true }).then(
      (r) => r.user,
    ),
  changePassword: (input: ChangePasswordInput) =>
    request("POST", "/me/password", { body: input, keepSession: true }),

  listKeys: () =>
    request("GET", "/keys", { schema: z.object({ items: z.array(ApiKey) }) }).then((r) => r.items),
  createKey: (input: { name: string; scope: ApiKeyScope }) =>
    request("POST", "/keys", { body: input, schema: CreatedApiKey }),
  revokeKey: (id: string) => request("DELETE", `/keys/${id}`),

  children: (parentId: string | null) => listAll("/nodes", parentId ? { parentId } : {}),
  node: (id: string) =>
    request("GET", `/nodes/${id}`, { schema: NodeEnvelope }).then((r) => r.node),
  createNode: (input: CreateNodeInput) =>
    request("POST", "/nodes", { body: input, schema: NodeEnvelope }).then((r) => r.node),
  updateNode: (id: string, input: UpdateNodeInput) =>
    request("PATCH", `/nodes/${id}`, { body: input, schema: NodeEnvelope }).then((r) => r.node),
  moveNode: (id: string, input: MoveNodeInput) =>
    request("POST", `/nodes/${id}/move`, { body: input, schema: NodeEnvelope }).then((r) => r.node),
  duplicateNode: (id: string) =>
    request("POST", `/nodes/${id}/duplicate`, { schema: NodeEnvelope }).then((r) => r.node),
  trashNode: (id: string) =>
    request("POST", `/nodes/${id}/trash`, { schema: NodeEnvelope }).then((r) => r.node),
  restoreNode: (id: string) =>
    request("POST", `/nodes/${id}/restore`, { schema: NodeEnvelope }).then((r) => r.node),
  deleteForever: (id: string) => request("DELETE", `/nodes/${id}`),
  trash: () => listAll("/trash"),
  recents: () =>
    request("GET", "/recents", { query: { limit: 8 }, schema: NodeList }).then((r) => r.items),
  favourites: () => listAll("/favourites"),
  /** Source files filed under a lecture or folder. */
  filesOf: (nodeId: string) => listFiles({ nodeId }),
  /** Uploaded files not filed anywhere yet. */
  inboxFiles: () => listFiles({ inbox: "true" }),
  file: (id: string) =>
    request("GET", `/files/${id}`, { schema: z.object({ file: SourceFile }) }).then((r) => r.file),
  search: (q: string) =>
    request("GET", "/search", { query: { q, limit: 20 }, schema: SearchPage }).then((r) => r.items),
};
