import { type ApiError, ID_PREFIX, type IdKind, idKind } from "@notes/schema";
import type { z } from "zod";
import { AppError } from "../http/errors.js";

/** Example IDs of each kind, shown in descriptions and errors. Well-formed, not real. */
export function exampleId(kind: IdKind): string {
  return `${ID_PREFIX[kind]}_01J9Z8Y7X6W5V4T3S2R1Q0P9N8`;
}

/** Plain names of the ID kinds an agent meets, by prefix. */
const KIND_NAMES: Partial<Record<IdKind, string>> = {
  node: "library item (term, course, section, folder, lecture or document node)",
  file: "uploaded file",
  page: "page of an uploaded file",
  transcript: "page transcript",
  document: "document (study material)",
  block: "block inside a document",
  upload: "upload link",
  question: "practice question",
  concept: "concept",
  request: "request she left",
  exam: "exam",
  revision: "document revision",
  apiKey: "API key",
  user: "user",
  session: "browser session",
  marginNote: "side note of hers (read only)",
};

/** Where an agent should take an ID of a given kind. */
const KIND_ROUTES: Partial<Record<IdKind, string>> = {
  node: "Read it with get_item, list its children with browse_library, change it with edit_library.",
  file: "Read it with get_item; claim, file or move it with source_files.",
  page: "Read it with get_page (image and text) or get_item.",
  transcript:
    "Read it through its page with get_page; replace it with save_transcript (which takes the pageId).",
  document: "Read it with get_item; change its blocks with edit_blocks.",
  block: "Read it with get_item; change it with edit_blocks (which also needs its documentId).",
  marginNote:
    "Read it with side_notes (action list, with its documentId). Only she changes her side notes.",
};

export function describeIdKind(kind: IdKind): string {
  return KIND_NAMES[kind] ?? kind;
}

/** "a page", "an uploaded file". */
export function withArticle(text: string): string {
  return `${/^[aeiou]/i.test(text) ? "an" : "a"} ${text}`;
}

export function routeForKind(kind: IdKind): string {
  return KIND_ROUTES[kind] ?? "It cannot be used over MCP yet.";
}

/** One line listing the prefixes an agent can use. */
export function prefixList(kinds: IdKind[]): string {
  return kinds.map((k) => `${ID_PREFIX[k]}_ (${describeIdKind(k)})`).join(", ");
}

/** The ApiError body of any thrown value. Unknown errors never leak details. */
export function toApiError(error: unknown): ApiError {
  if (error instanceof AppError) return error.toApiError();
  return {
    code: "internal",
    message: "Something went wrong on the server. The call may be retried once.",
    hint: "If it keeps failing, report the tool name and input to the person running the app.",
  };
}

function valueAt(input: unknown, path: ReadonlyArray<PropertyKey>): unknown {
  let current: unknown = input;
  for (const key of path) {
    if (current === null || typeof current !== "object") return undefined;
    current = (current as Record<PropertyKey, unknown>)[key as string];
  }
  return current;
}

export function fieldPath(path: ReadonlyArray<PropertyKey>): string {
  if (path.length === 0) return "(input)";
  return path
    .map((p, i) => (typeof p === "number" ? `[${p}]` : i === 0 ? String(p) : `.${String(p)}`))
    .join("");
}

/**
 * Explain one zod issue in plain words. Adds a note when the value is an ID
 * of a different kind than the field wants (a file ID where a node ID goes).
 */
function explainIssue(issue: z.core.$ZodIssue, input: unknown): string {
  const where = fieldPath(issue.path);
  let message = issue.message;
  if (issue.code === "unrecognized_keys") {
    return `${where}: unknown field${issue.keys.length > 1 ? "s" : ""} ${issue.keys.map((k) => `"${k}"`).join(", ")}. Only the fields in the tool's input schema are accepted.`;
  }
  if (issue.code === "invalid_type" && valueAt(input, issue.path) === undefined) {
    message = `missing (required${issue.expected ? `, a ${issue.expected}` : ""})`;
  }
  const value = valueAt(input, issue.path);
  if (typeof value === "string" && /ID like/.test(message)) {
    const kind = idKind(value);
    if (kind) {
      message += `. You sent ${withArticle(describeIdKind(kind))} ID (${ID_PREFIX[kind]}_…). ${routeForKind(kind)}`;
    } else if (value.length > 0) {
      message += `. "${value.slice(0, 40)}" is not a well-formed ID: IDs are a prefix, an underscore and 26 characters, copied exactly from an earlier result.`;
    }
  }
  return `${where}: ${message}`;
}

/** A zod failure as an `invalid_input` error naming every offending field. */
export function invalidInput(
  tool: string,
  error: z.ZodError,
  input: unknown,
  example: unknown,
  context?: string,
): AppError {
  const problems = error.issues.slice(0, 8).map((issue) => explainIssue(issue, input));
  const more = error.issues.length > 8 ? ` (and ${error.issues.length - 8} more)` : "";
  return new AppError(
    "invalid_input",
    `Invalid input for ${tool}${context ? ` (${context})` : ""}: ${problems.join("; ")}${more}.`,
    {
      hint: "Fix the named field(s) and call again. The example below is a minimal valid input; IDs in it are placeholders, use real IDs from earlier results.",
      example,
    },
  );
}

/** Check an ID's kind before dispatching on it. */
export function checkIdShape(id: string, allowed: IdKind[]): IdKind {
  const kind = idKind(id);
  if (kind === null) {
    const prefix = id.includes("_") ? id.slice(0, id.indexOf("_")) : null;
    const known = prefix !== null && (Object.values(ID_PREFIX) as string[]).includes(prefix);
    throw new AppError(
      "invalid_input",
      known
        ? `"${id.slice(0, 60)}" has a known prefix but is malformed: the part after "${prefix}_" must be exactly 26 characters (0-9, A-Z without I, L, O, U).`
        : `"${id.slice(0, 60)}" is not an ID this app uses.`,
      {
        hint: `IDs look like ${exampleId("node")}. Usable prefixes: ${prefixList(allowed)}. Copy IDs exactly from earlier results; browse_library with no arguments lists the top of the library.`,
        example: { id: exampleId("node") },
      },
    );
  }
  return kind;
}

const NODE_ROUTE = /(POST|GET|DELETE|PATCH) (\/api\/[^\s,.)]+(?:\?[^\s,)]+)?)/g;

function translateRoute(method: string, path: string): string {
  if (method === "DELETE") return "a permanent delete, which only she can do in the browser";
  const rq = /^\/api\/requests\/([^/\s]+)\/(claim|release|complete|decline)$/.exec(path);
  if (rq) {
    const id = rq[1]?.startsWith(":") ? "req_…" : rq[1];
    return `requests {"action":"${rq[2]}","requestId":"${id}"}`;
  }
  if (path.startsWith("/api/requests")) return 'requests {"action":"list"}';
  const pq = /^\/api\/practice\/questions\/([^/\s]+)\/(trash|restore)$/.exec(path);
  if (pq) return `practice_questions {"action":"${pq[2]}","questionId":"${pq[1]}"}`;
  if (path.startsWith("/api/practice/questions")) return 'practice_questions {"action":"list"}';
  if (path.startsWith("/api/practice")) return 'study_progress {"action":"sessions"}';
  if (path.startsWith("/api/calendar"))
    return 'study_progress {"action":"calendar","from":"YYYY-MM-DD","to":"YYYY-MM-DD"}';
  if (path.startsWith("/api/exams")) return 'exams {"action":"list"}';
  if (/^\/api\/concepts\/[^/\s]+\/merge$/.test(path)) return 'concepts {"action":"merge",...}';
  if (/^\/api\/concepts\/[^/\s]+\/page$/.test(path))
    return 'concepts {"action":"page","conceptId":"con_…"}';
  if (path.startsWith("/api/concepts/search")) return 'concepts {"action":"search","query":"…"}';
  if (path.startsWith("/api/concepts") || path.startsWith("/api/relations")) {
    return method === "GET"
      ? 'concepts {"action":"search","query":"…"}'
      : 'concepts {"action":"upsert",...}';
  }
  const m = /^\/api\/nodes\/([^/\s]+)\/(restore|trash|duplicate|move)$/.exec(path);
  if (m) return `edit_library {"action":"${m[2]}","id":"${m[1]}"}`;
  const f = /^\/api\/files\/([^/\s]+)\/file$/.exec(path);
  if (f)
    return `source_files {"action":"move","fileId":"${f[1]}","nodeId":"<lecture or folder id, or null for the inbox>"}`;
  const r = /^\/api\/files\/([^/\s]+)\/(retry|restore|claim|release)$/.exec(path);
  if (r && r[2] !== "restore") return `source_files {"action":"${r[2]}","fileId":"${r[1]}"}`;
  if (r) return "a restore, which she can do from the trash in the app";
  const fileGet = /^\/api\/files\/([^/\s?]+)$/.exec(path);
  if (fileGet && !fileGet[1]?.startsWith(":")) return `get_item {"id":"${fileGet[1]}"}`;
  if (path.startsWith("/api/files")) return `source_files {"action":"list"}`;
  if (path.startsWith("/api/converter"))
    return `source_files {"action":"list"} (it shows the converter's state)`;
  const revs = /^\/api\/(documents|pages)\/([^/\s]+)\/(?:transcript\/)?revisions$/.exec(path);
  if (revs) {
    const id = revs[2]?.startsWith(":") ? (revs[1] === "pages" ? "pag_…" : "doc_…") : revs[2];
    return `get_item {"id":"${id}","history":true}`;
  }
  const page = /^\/api\/pages\/([^/\s]+)\/(transcript|image|image-url)/.exec(path);
  if (page && !page[1]?.startsWith(":")) return `get_page {"pageId":"${page[1]}"}`;
  if (page) return "get_page";
  const nodeDoc = /^\/api\/nodes\/([^/\s]+)\/document$/.exec(path);
  if (nodeDoc && !nodeDoc[1]?.startsWith(":")) return `get_item {"id":"${nodeDoc[1]}"}`;
  if (nodeDoc) return "get_item on the node";
  const nodeGet = /^\/api\/nodes\/([^/\s?]+)$/.exec(path);
  if (nodeGet && !nodeGet[1]?.startsWith(":")) return `get_item {"id":"${nodeGet[1]}"}`;
  if (path.startsWith("/api/trash")) return `browse_library {"view":"trash"}`;
  if (path.startsWith("/api/nodes?parentId")) return `browse_library {"parentId":"<id>"}`;
  if (path === "/api/nodes") return "browse_library {}";
  return `${method} ${path}`;
}

/**
 * The library service writes hints for the web API ("POST /api/nodes/…/restore").
 * Rewrite them, and its examples, into edit_library and browse_library calls.
 */
export function translateLibraryError(
  error: unknown,
  action: string | null,
  id: string | undefined,
): unknown {
  if (!(error instanceof AppError)) return error;
  const hint = error.hint?.replace(NODE_ROUTE, (_all, method: string, path: string) =>
    translateRoute(method, path),
  );
  let example = error.example;
  if (example && typeof example === "object" && !Array.isArray(example)) {
    const ex = example as Record<string, unknown>;
    if (typeof ex.method === "string" && typeof ex.path === "string") {
      const m = /^\/api\/nodes\/([^/]+)\/(restore|trash|duplicate)$/.exec(ex.path);
      if (m) example = { action: m[2], id: m[1] };
      else if (ex.path.startsWith("/api/trash")) example = { view: "trash" };
    } else if ("kind" in ex && "name" in ex) {
      example = { action: "create", ...ex };
    } else if ("parentId" in ex) {
      example = { action: "move", id: id ?? exampleId("node"), ...ex };
    } else if (action === "update") {
      example = { action: "update", id: id ?? exampleId("node"), ...ex };
    }
  }
  return new AppError(error.code, error.message, {
    ...(hint !== undefined ? { hint } : {}),
    ...(example !== undefined ? { example } : {}),
    ...(error.retryAfter !== undefined ? { retryAfter: error.retryAfter } : {}),
  });
}

/**
 * Any domain error, with web API routes in its hint rewritten into the MCP
 * tool to call. Domains write hints for the browser API; agents need tools.
 */
export function agentFacing(error: unknown): unknown {
  if (!(error instanceof AppError)) return error;
  const rewrite = (text: string) =>
    text.replace(NODE_ROUTE, (_all, method: string, path: string) => translateRoute(method, path));
  let example = error.example;
  if (example && typeof example === "object" && "method" in example && "path" in example) {
    // A web-API call shown as the example; the hint carries the tool call instead.
    example = undefined;
  }
  if (!`${error.message}${error.hint ?? ""}`.includes("/api/") && example === error.example) {
    return error;
  }
  return new AppError(error.code, rewrite(error.message), {
    ...(error.hint !== undefined ? { hint: rewrite(error.hint) } : {}),
    ...(example !== undefined ? { example } : {}),
    ...(error.retryAfter !== undefined ? { retryAfter: error.retryAfter } : {}),
  });
}
