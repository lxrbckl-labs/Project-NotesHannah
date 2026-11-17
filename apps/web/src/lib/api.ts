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
  Page as PageSchema,
  type PreferencesPatch,
  PreferencesResponse,
  pageOf,
  SearchHit,
  SourceFile,
  Transcript,
  type UpdateNodeInput,
  User,
} from "@notes/schema";
import { z } from "zod";

/** Errors the client raises itself, beside the server's own codes. */
export type ClientErrorCode = ApiError["code"] | "network" | "bad_response" | "cancelled";

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

export type { SearchHit };

const SearchPage = pageOf(SearchHit);
const FilePage = pageOf(SourceFile);
const PagesBody = z.object({ items: z.array(PageSchema) });
const TranscriptBody = z.object({ transcript: Transcript.nullable() });
const TranscriptList = pageOf(Transcript);

export const ConverterStatus = z.object({
  state: z.enum(["online", "stale", "offline"]),
  lastSeenAt: z.string().nullable(),
  ageSeconds: z.number().nullable(),
  queued: z.number(),
  processing: z.number(),
  heartbeat: z.record(z.string(), z.unknown()).nullable(),
});
export type ConverterStatus = z.infer<typeof ConverterStatus>;

export const ActivityLink = z.object({
  type: z.string(),
  id: z.string(),
  documentId: z.string().optional(),
  nodeId: z.string().optional(),
  label: z.string().optional(),
});
export type ActivityLink = z.infer<typeof ActivityLink>;
export const ActivityEntry = z.object({
  id: z.number(),
  at: z.string(),
  keyId: z.string(),
  keyLabel: z.string().nullable(),
  action: z.string(),
  summary: z.string(),
  links: z.array(ActivityLink),
});
export type ActivityEntry = z.infer<typeof ActivityEntry>;
const ActivityPageBody = pageOf(ActivityEntry);

async function listFiles(query: Record<string, string | undefined>) {
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
  preferences: () =>
    request("GET", "/me/preferences", { schema: PreferencesResponse }).then((r) => r.preferences),
  updatePreferences: (patch: PreferencesPatch) =>
    request("PATCH", "/me/preferences", { body: patch, schema: PreferencesResponse }).then(
      (r) => r.preferences,
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
    // Five, no more (Alex, 2026-11-16): opening a sixth thing pushes the oldest off the list.
    request("GET", "/recents", { query: { limit: 5 }, schema: NodeList }).then((r) => r.items),
  favourites: () => listAll("/favourites"),
  /** Source files filed under a lecture or folder. */
  filesOf: (nodeId: string) => listFiles({ nodeId }),
  /** Uploaded files not filed anywhere yet. */
  inboxFiles: () => listFiles({ inbox: "true" }),
  file: (id: string) =>
    request("GET", `/files/${id}`, { schema: z.object({ file: SourceFile }) }).then((r) => r.file),
  trashedFiles: () => listFiles({ trashed: "true" }),
  allFiles: (status?: string) => listFiles({ status }),
  retryFile: (id: string) =>
    request("POST", `/files/${id}/retry`, { schema: z.object({ file: SourceFile }) }).then(
      (r) => r.file,
    ),
  fileTo: (id: string, nodeId: string | null) =>
    request("POST", `/files/${id}/file`, {
      body: { nodeId },
      schema: z.object({ file: SourceFile }),
    }).then((r) => r.file),
  renameFile: (id: string, originalName: string) =>
    request("PATCH", `/files/${id}`, {
      body: { originalName },
      schema: z.object({ file: SourceFile }),
    }).then((r) => r.file),
  trashFile: (id: string) =>
    request("POST", `/files/${id}/trash`, { schema: z.object({ file: SourceFile }) }).then(
      (r) => r.file,
    ),
  restoreFile: (id: string) =>
    request("POST", `/files/${id}/restore`, { schema: z.object({ file: SourceFile }) }).then(
      (r) => r.file,
    ),
  deleteFileForever: (id: string) => request("DELETE", `/files/${id}`),
  pagesOf: (fileId: string) =>
    request("GET", `/files/${fileId}/pages`, { schema: PagesBody }).then((r) => r.items),
  transcriptOf: (pageId: string) =>
    request("GET", `/pages/${pageId}/transcript`, { schema: TranscriptBody }).then(
      (r) => r.transcript,
    ),
  revisionsOf: (pageId: string) =>
    request("GET", `/pages/${pageId}/transcript/revisions`, {
      query: { limit: 50 },
      schema: TranscriptList,
    }).then((r) => r.items),
  restoreRevision: (pageId: string, revision: number) =>
    request("POST", `/pages/${pageId}/transcript/revisions/${revision}/restore`, {
      schema: z.object({ transcript: Transcript }),
    }).then((r) => r.transcript),
  reviewTranscript: (pageId: string, reviewed: boolean) =>
    request("POST", `/pages/${pageId}/transcript/review`, {
      body: { reviewed },
      schema: z.object({ transcript: Transcript }),
    }).then((r) => r.transcript),
  converterStatus: () =>
    request("GET", "/converter/status", {
      schema: z.object({ converter: ConverterStatus }),
    }).then((r) => r.converter),
  activity: (cursor?: string) =>
    request("GET", "/activity", { query: { limit: 30, cursor }, schema: ActivityPageBody }),
  search: (q: string) =>
    request("GET", "/search", { query: { q, limit: 30 }, schema: SearchPage }).then((r) => r.items),
};

/** Address of a page image. The mock (dev and tests only) answers with an inline picture instead. */
export function pageImageUrl(pageId: string, size: "page" | "thumb" = "page"): string {
  const mock = (window as unknown as { __mockPageImage?: (id: string, size: string) => string })
    .__mockPageImage;
  return mock ? mock(pageId, size) : `/api/pages/${pageId}/image?size=${size}`;
}

export function originalUrl(fileId: string, download = false): string {
  return `/api/files/${fileId}/original${download ? "?download=true" : ""}`;
}

export interface UploadHandle {
  promise: Promise<SourceFile>;
  cancel: () => void;
}
export type UploadTransport = (
  file: File,
  nodeId: string | null,
  onProgress: (fraction: number) => void,
) => UploadHandle;

const UploadBody = z.object({ file: SourceFile });

/** One multipart upload with byte progress (fetch cannot report upload progress). */
export const xhrUpload: UploadTransport = (file, nodeId, onProgress) => {
  const xhr = new XMLHttpRequest();
  const promise = new Promise<SourceFile>((resolve, reject) => {
    xhr.open("POST", "/api/uploads");
    xhr.responseType = "text";
    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable) onProgress(event.loaded / event.total);
    };
    xhr.onerror = () =>
      reject(
        new ApiClientError(0, {
          code: "network",
          message: "Could not reach the server.",
          hint: "Check your connection and try again.",
        }),
      );
    xhr.onabort = () =>
      reject(new ApiClientError(0, { code: "cancelled", message: "Upload cancelled." }));
    xhr.onload = () => {
      let json: unknown;
      try {
        json = JSON.parse(xhr.responseText);
      } catch {
        json = null;
      }
      if (xhr.status >= 200 && xhr.status < 300) {
        const parsed = UploadBody.safeParse(json);
        if (parsed.success) {
          onProgress(1);
          resolve(parsed.data.file);
        } else {
          reject(
            new ApiClientError(xhr.status, {
              code: "bad_response",
              message: "The server sent a response the app did not expect.",
            }),
          );
        }
        return;
      }
      const parsed = ErrorBody.safeParse(json);
      const error = parsed.success
        ? parsed.data.error
        : {
            code: xhr.status === 413 ? ("too_large" as const) : ("internal" as const),
            message: "The upload failed.",
          };
      if (error.code === "unauthenticated") for (const listener of listeners) listener();
      reject(new ApiClientError(xhr.status, error));
    };
    const form = new FormData();
    if (nodeId) form.append("nodeId", nodeId);
    form.append("file", file, file.name);
    xhr.send(form);
  });
  return { promise, cancel: () => xhr.abort() };
};

let transport: UploadTransport = xhrUpload;
/** The mock replaces this with a simulated upload. */
export function setUploadTransport(next: UploadTransport): void {
  transport = next;
}
export const startUpload: UploadTransport = (file, nodeId, onProgress) =>
  transport(file, nodeId, onProgress);

/**
 * A small untyped HTTP client for feature modules (documents, practice, canvas ...) that build
 * their own store: same base path, same cookie, same typed errors, no response parsing (the
 * module validates with its own schemas).
 */
export interface AppHttp {
  get: <T = unknown>(
    path: string,
    query?: Record<string, string | number | undefined>,
  ) => Promise<T>;
  post: <T = unknown>(path: string, body?: unknown) => Promise<T>;
  patch: <T = unknown>(path: string, body?: unknown) => Promise<T>;
  put: <T = unknown>(path: string, body?: unknown) => Promise<T>;
  del: <T = unknown>(path: string) => Promise<T>;
}

/** `path` is below /api, like "/documents/doc_..." */
export const appHttp: AppHttp = {
  get: (path, query) => request("GET", path, { query, schema: z.unknown() as never }) as never,
  post: (path, body) => request("POST", path, { body, schema: z.unknown() as never }) as never,
  patch: (path, body) => request("PATCH", path, { body, schema: z.unknown() as never }) as never,
  put: (path, body) => request("PUT", path, { body, schema: z.unknown() as never }) as never,
  del: (path) => request("DELETE", path) as never,
};
