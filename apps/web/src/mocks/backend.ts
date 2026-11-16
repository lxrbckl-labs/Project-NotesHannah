import {
  type ApiError,
  type ApiKey,
  ChangePasswordInput,
  COURSE_SECTIONS,
  CreateApiKeyInput,
  CreateNodeInput,
  canContain,
  isFixed,
  type LibraryNode,
  LoginInput,
  MAX_FOLDER_DEPTH,
  MoveNodeInput,
  type NodeWithLinks,
  newId,
  type SourceFile,
  UpdateNodeInput,
  type User,
} from "@notes/schema";
import { MOCK_PASSWORD, MOCK_USERNAME, seedLibrary } from "./seed";

export interface MockSnapshot {
  nodes: LibraryNode[];
  files: SourceFile[];
  recents: string[];
  keys: Array<{ key: ApiKey; secret: string }>;
  signedIn: boolean;
  password: string;
}

export interface MockOptions {
  /** Pause before every answer, to make loading states visible in dev. */
  latencyMs?: number;
  /** Called after every request that changed state (the browser install saves a snapshot). */
  onChange?: (snapshot: MockSnapshot) => void;
  snapshot?: MockSnapshot;
  /** Clock, for tests. */
  now?: () => number;
}

const STATUS: Record<string, number> = {
  unauthenticated: 401,
  forbidden: 403,
  read_only_key: 403,
  not_found: 404,
  invalid_input: 400,
  conflict: 409,
  rate_limited: 429,
  too_large: 413,
  storage_unavailable: 503,
  internal: 500,
};

class Fail extends Error {
  constructor(readonly error: ApiError) {
    super(error.message);
  }
}

function fail(code: ApiError["code"], message: string, hint?: string, example?: unknown): never {
  throw new Fail({ code, message, hint, example });
}

const KIND_LABEL: Record<string, string> = {
  root: "The top of the library",
  term: "A term",
  course: "A course",
  section: "A section",
  folder: "A folder",
  lecture: "A lecture",
  document: "A document",
};

const ALLOWED_IN: Record<string, string> = {
  root: "terms",
  term: "courses",
  course: "sections",
  section: "folders, lectures and documents",
  folder: "folders, lectures and documents",
  lecture: "documents",
  document: "nothing",
};

function secretFor(scope: string): string {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789_-";
  const bytes = crypto.getRandomValues(new Uint8Array(43));
  let body = "";
  for (const byte of bytes) body += alphabet[byte % alphabet.length];
  return `nh_${scope}_${body}`;
}

/** The server contract from docs/api.md, in memory. Used for dev, unit tests and Playwright. */
export function createMockBackend(options: MockOptions = {}) {
  const now = options.now ?? Date.now;
  const iso = () => new Date(now()).toISOString();
  const user: User = {
    id: "",
    username: MOCK_USERNAME,
    displayName: "Hannah",
    createdAt: "2026-08-20T14:00:00.000Z",
    disabledAt: null,
  };

  let nodes: LibraryNode[];
  let files: SourceFile[];
  let recents: string[];
  let keys: Array<{ key: ApiKey; secret: string }>;
  let signedIn = false;
  let password = MOCK_PASSWORD;
  let failedLogins = 0;
  let lockedUntil = 0;

  function load(snapshot?: MockSnapshot) {
    if (snapshot) {
      nodes = snapshot.nodes;
      files = snapshot.files ?? [];
      recents = snapshot.recents;
      keys = snapshot.keys;
      signedIn = snapshot.signedIn;
      password = snapshot.password;
      user.id = nodes[0]?.userId ?? newId("user");
      return;
    }
    user.id = newId("user");
    const seed = seedLibrary(user.id);
    nodes = seed.nodes;
    files = seed.files;
    recents = seed.recents;
    signedIn = false;
    password = MOCK_PASSWORD;
    keys = [
      {
        key: {
          id: newId("apiKey"),
          userId: user.id,
          name: "Claude Code",
          scope: "write",
          preview: "nh_write_Qm7",
          createdAt: "2026-10-02T16:30:00.000Z",
          lastUsedAt: "2026-11-14T21:05:00.000Z",
          revokedAt: null,
        },
        secret: "",
      },
      {
        key: {
          id: newId("apiKey"),
          userId: user.id,
          name: "Old laptop",
          scope: "read",
          preview: "nh_read_x2K",
          createdAt: "2026-09-01T09:00:00.000Z",
          lastUsedAt: null,
          revokedAt: "2026-09-20T12:00:00.000Z",
        },
        secret: "",
      },
    ];
  }
  load(options.snapshot);

  const byId = (id: string) => nodes.find((n) => n.id === id);
  const siblings = (parentId: string | null) =>
    nodes
      .filter((n) => n.parentId === parentId && !n.trashedAt)
      .sort((a, b) => a.sortKey.localeCompare(b.sortKey));
  const childrenOf = (id: string) => nodes.filter((n) => n.parentId === id);

  function ancestorsOf(node: LibraryNode): LibraryNode[] {
    const chain: LibraryNode[] = [];
    let cursor = node.parentId ? byId(node.parentId) : undefined;
    while (cursor) {
      chain.unshift(cursor);
      cursor = cursor.parentId ? byId(cursor.parentId) : undefined;
    }
    return chain;
  }

  function withLinks(node: LibraryNode): NodeWithLinks {
    const chain = ancestorsOf(node);
    return {
      ...node,
      path: [...chain, node].map((n) => n.name).join(" / "),
      ancestors: chain.map((n) => n.id),
      childCount: childrenOf(node.id).filter((c) => !c.trashedAt).length,
    };
  }

  function folderDepth(node: LibraryNode | null): number {
    let depth = 0;
    let cursor = node;
    while (cursor && (cursor.kind === "folder" || cursor.kind === "section")) {
      if (cursor.kind === "folder") depth++;
      cursor = cursor.parentId ? (byId(cursor.parentId) ?? null) : null;
    }
    return depth;
  }

  /** Folder levels at and below this node (a folder is 1 + its deepest folder child). */
  function folderHeight(node: LibraryNode): number {
    const below = Math.max(0, ...childrenOf(node.id).map((c) => folderHeight(c)));
    return node.kind === "folder" ? 1 + below : below;
  }

  function descendantsOf(id: string): LibraryNode[] {
    const out: LibraryNode[] = [];
    for (const child of childrenOf(id)) out.push(child, ...descendantsOf(child.id));
    return out;
  }

  function needNode(id: string): LibraryNode {
    const node = byId(id);
    if (!node) fail("not_found", "That item does not exist.", "It may have been deleted.");
    return node;
  }

  function needLive(id: string): LibraryNode {
    const node = needNode(id);
    if (node.trashedAt) {
      fail("conflict", `"${node.name}" is in the trash.`, "Restore it first.");
    }
    return node;
  }

  function checkPlacement(
    child: { kind: LibraryNode["kind"]; height?: number },
    parent: LibraryNode | null,
  ) {
    const where = parent?.kind ?? "root";
    if (!canContain(parent?.kind ?? null, child.kind)) {
      fail(
        "invalid_input",
        `${KIND_LABEL[child.kind]} cannot go ${
          parent ? `inside ${KIND_LABEL[parent.kind]?.toLowerCase()}` : "at the top of the library"
        }.`,
        `${KIND_LABEL[where]} holds ${ALLOWED_IN[where]}.`,
        { parentId: parent?.id ?? null },
      );
    }
    if (child.kind === "folder" || child.height) {
      const total = folderDepth(parent) + (child.height ?? 1);
      if (total > MAX_FOLDER_DEPTH) {
        fail(
          "invalid_input",
          `Folders can only be nested ${MAX_FOLDER_DEPTH} levels deep.`,
          "Pick a shallower place, or put it in the section itself.",
        );
      }
    }
  }

  function nextSortKey(parentId: string | null): string {
    const last = siblings(parentId).at(-1);
    return String(Number(last?.sortKey ?? 0) + 1).padStart(12, "0");
  }

  function renumber(ordered: LibraryNode[]) {
    ordered.forEach((n, i) => {
      n.sortKey = String(i + 1).padStart(12, "0");
    });
  }

  function touch(id: string) {
    recents = [id, ...recents.filter((r) => r !== id)].slice(0, 20);
  }

  function cloneTree(source: LibraryNode, parentId: string | null, sortKey: string, name: string) {
    const copy: LibraryNode = {
      ...structuredClone(source),
      id: newId("node"),
      parentId,
      name,
      sortKey,
      favourite: false,
      createdAt: iso(),
      updatedAt: iso(),
    };
    nodes.push(copy);
    for (const child of siblings(source.id)) cloneTree(child, copy.id, child.sortKey, child.name);
    return copy;
  }

  function list(items: NodeWithLinks[]) {
    return { items, nextCursor: null };
  }

  function body<T>(
    schema: {
      safeParse(v: unknown): {
        success: boolean;
        data?: T;
        error?: { issues: Array<{ path: PropertyKey[]; message: string }> };
      };
    },
    value: unknown,
  ): T {
    const result = schema.safeParse(value);
    if (!result.success || result.data === undefined) {
      const issue = result.error?.issues[0];
      const where = issue?.path.length ? ` (${issue.path.map(String).join(".")})` : "";
      fail(
        "invalid_input",
        `${issue?.message ?? "Invalid input"}${where}`,
        "Check the request body against the API contract.",
      );
    }
    return result.data;
  }

  type Json = unknown;
  type Result = { status: number; json?: Json; headers?: Record<string, string> };
  const ok = (json: Json, status = 200): Result => ({ status, json });
  const noContent = (): Result => ({ status: 204 });

  function route(method: string, path: string, query: URLSearchParams, payload: unknown): Result {
    if (method === "POST" && path === "/auth/login") {
      const input = body(LoginInput, payload);
      if (now() < lockedUntil) {
        const retryAfter = Math.ceil((lockedUntil - now()) / 1000);
        throw new Fail({
          code: "rate_limited",
          message: "Too many sign-in attempts.",
          hint: "Wait a little before trying again.",
          retryAfter,
        });
      }
      if (input.username !== MOCK_USERNAME || input.password !== password) {
        failedLogins++;
        if (failedLogins >= 5) {
          failedLogins = 0;
          lockedUntil = now() + 30_000;
          throw new Fail({
            code: "rate_limited",
            message: "Too many sign-in attempts.",
            hint: "Wait a little before trying again.",
            retryAfter: 30,
          });
        }
        fail("unauthenticated", "Wrong username or password.");
      }
      failedLogins = 0;
      signedIn = true;
      return ok({ user });
    }

    if (!signedIn) fail("unauthenticated", "Sign in to continue.");

    if (method === "POST" && path === "/auth/logout") {
      signedIn = false;
      return noContent();
    }
    if (method === "POST" && path === "/auth/logout-all") {
      signedIn = false;
      return noContent();
    }
    if (method === "GET" && path === "/me") return ok({ user });
    if (method === "POST" && path === "/me/password") {
      const input = body(ChangePasswordInput, payload);
      if (input.currentPassword !== password) {
        fail(
          "invalid_input",
          "The current password is not right.",
          "Type the password you sign in with now.",
        );
      }
      password = input.newPassword;
      return noContent();
    }

    if (path === "/keys") {
      if (method === "GET") {
        return ok({ items: [...keys].reverse().map((k) => k.key) });
      }
      if (method === "POST") {
        const input = body(CreateApiKeyInput, payload);
        const secret = secretFor(input.scope);
        const key: ApiKey = {
          id: newId("apiKey"),
          userId: user.id,
          name: input.name,
          scope: input.scope,
          preview: secret.slice(0, 12),
          createdAt: iso(),
          lastUsedAt: null,
          revokedAt: null,
        };
        keys.push({ key, secret });
        return ok({ key, secret }, 201);
      }
    }
    const keyMatch = path.match(/^\/keys\/([^/]+)$/);
    if (keyMatch && method === "DELETE") {
      const found = keys.find((k) => k.key.id === keyMatch[1]);
      if (!found) fail("not_found", "That key does not exist.");
      found.key.revokedAt ??= iso();
      return noContent();
    }

    if (path === "/nodes" && method === "GET") {
      const parentId = query.get("parentId");
      if (parentId) needLive(parentId);
      return ok(list(siblings(parentId).map(withLinks)));
    }
    if (path === "/nodes" && method === "POST") {
      const input = body(CreateNodeInput, payload);
      const parent = input.parentId ? needLive(input.parentId) : null;
      checkPlacement({ kind: input.kind }, parent);
      const node: LibraryNode = {
        id: newId("node"),
        userId: user.id,
        parentId: parent?.id ?? null,
        kind: input.kind,
        name: input.name,
        section: null,
        course: input.kind === "course" ? (input.course ?? { code: null }) : null,
        lecture: input.kind === "lecture" ? (input.lecture ?? { number: null, date: null }) : null,
        sortKey: nextSortKey(parent?.id ?? null),
        favourite: false,
        createdAt: iso(),
        updatedAt: iso(),
        trashedAt: null,
      };
      nodes.push(node);
      if (node.kind === "course") {
        COURSE_SECTIONS.forEach(({ section, name }, i) => {
          nodes.push({
            ...node,
            id: newId("node"),
            parentId: node.id,
            kind: "section",
            name,
            section,
            course: null,
            lecture: null,
            sortKey: String(i + 1).padStart(12, "0"),
          });
        });
      }
      touch(node.id);
      return ok({ node: withLinks(node) }, 201);
    }

    if (path === "/files" && method === "GET") {
      const nodeId = query.get("nodeId");
      if (nodeId) needLive(nodeId);
      const inbox = query.get("inbox") === "true";
      const status = query.get("status");
      const items = files.filter(
        (f) =>
          !f.trashedAt &&
          (inbox ? f.nodeId === null : nodeId ? f.nodeId === nodeId : true) &&
          (!status || f.status === status),
      );
      return ok({ items, nextCursor: null });
    }
    const fileMatch = path.match(/^\/files\/([^/]+)$/);
    if (fileMatch && method === "GET") {
      const found = files.find((f) => f.id === fileMatch[1]);
      if (!found) fail("not_found", "That file does not exist.");
      return ok({ file: found });
    }

    if (path === "/trash" && method === "GET") {
      const top = nodes.filter((n) => {
        if (!n.trashedAt) return false;
        const parent = n.parentId ? byId(n.parentId) : undefined;
        return !parent || parent.trashedAt !== n.trashedAt;
      });
      top.sort((a, b) => (b.trashedAt ?? "").localeCompare(a.trashedAt ?? ""));
      return ok(list(top.map(withLinks)));
    }
    if (path === "/recents" && method === "GET") {
      const limit = Number(query.get("limit") ?? 10);
      const items = recents
        .map(byId)
        .filter((n): n is LibraryNode => !!n && !n.trashedAt && n.kind !== "section")
        .slice(0, limit);
      return ok(list(items.map(withLinks)));
    }
    if (path === "/favourites" && method === "GET") {
      return ok(list(nodes.filter((n) => n.favourite && !n.trashedAt).map(withLinks)));
    }
    if (path === "/search" && method === "GET") {
      const q = (query.get("q") ?? "").trim().toLowerCase();
      if (!q)
        fail("invalid_input", "Type something to search for.", "Pass a non-empty q parameter.", {
          q: "beta",
        });
      const hits = nodes
        .filter((n) => !n.trashedAt && n.name.toLowerCase().includes(q))
        .slice(0, Number(query.get("limit") ?? 20))
        .map((n) => {
          const node = withLinks(n);
          return { kind: "node" as const, node, snippet: node.path };
        });
      return ok({ items: hits, nextCursor: null });
    }

    const nodeMatch = path.match(/^\/nodes\/([^/]+)(?:\/(move|duplicate|trash|restore))?$/);
    if (nodeMatch) {
      const id = nodeMatch[1] as string;
      const action = nodeMatch[2];
      const node = needNode(id);

      if (!action && method === "GET") {
        if (!node.trashedAt) touch(id);
        return ok({ node: withLinks(node) });
      }
      if (!action && method === "PATCH") {
        const input = body(UpdateNodeInput, payload);
        if (input.name !== undefined && isFixed(node.kind)) {
          fail(
            "invalid_input",
            "Sections cannot be renamed.",
            "Every course keeps the same five sections.",
          );
        }
        if (node.trashedAt)
          fail("conflict", `"${node.name}" is in the trash.`, "Restore it first.");
        if (input.name !== undefined) node.name = input.name;
        if (input.favourite !== undefined) node.favourite = input.favourite;
        if (input.course !== undefined && node.kind === "course") node.course = input.course;
        if (input.lecture !== undefined && node.kind === "lecture") node.lecture = input.lecture;
        node.updatedAt = iso();
        touch(id);
        return ok({ node: withLinks(node) });
      }
      if (!action && method === "DELETE") {
        if (!node.trashedAt) {
          fail(
            "conflict",
            `"${node.name}" is not in the trash.`,
            "Move it to the trash first; only trashed items can be deleted for good.",
          );
        }
        const doomed = new Set([node.id, ...descendantsOf(node.id).map((n) => n.id)]);
        nodes = nodes.filter((n) => !doomed.has(n.id));
        recents = recents.filter((r) => !doomed.has(r));
        return noContent();
      }
      if (action === "move" && method === "POST") {
        const input = body(MoveNodeInput, payload);
        if (isFixed(node.kind))
          fail(
            "invalid_input",
            "Sections cannot be moved.",
            "Every course keeps the same five sections.",
          );
        needLive(id);
        const parent = input.parentId ? needLive(input.parentId) : null;
        if (
          parent &&
          (parent.id === node.id || descendantsOf(node.id).some((d) => d.id === parent.id))
        ) {
          fail(
            "invalid_input",
            "An item cannot be moved into itself.",
            "Choose a destination outside of it.",
          );
        }
        checkPlacement({ kind: node.kind, height: folderHeight(node) || undefined }, parent);
        const targetParent = parent?.id ?? null;
        const others = siblings(targetParent).filter((n) => n.id !== node.id);
        let index = others.length;
        if (input.afterId === null) index = 0;
        else if (input.afterId) {
          const at = others.findIndex((n) => n.id === input.afterId);
          if (at < 0)
            fail(
              "invalid_input",
              "That sibling is not in the destination.",
              "afterId must be an item inside the new parent.",
            );
          index = at + 1;
        }
        node.parentId = targetParent;
        others.splice(index, 0, node);
        renumber(others);
        node.updatedAt = iso();
        touch(id);
        return ok({ node: withLinks(node) });
      }
      if (action === "duplicate" && method === "POST") {
        if (isFixed(node.kind))
          fail(
            "invalid_input",
            "Sections cannot be duplicated.",
            "Duplicate the items inside it instead.",
          );
        needLive(id);
        const family = siblings(node.parentId);
        const at = family.findIndex((n) => n.id === node.id);
        const copy = cloneTree(node, node.parentId, "", `${node.name} copy`);
        family.splice(at + 1, 0, copy);
        renumber(family);
        return ok({ node: withLinks(copy) }, 201);
      }
      if (action === "trash" && method === "POST") {
        if (isFixed(node.kind))
          fail(
            "invalid_input",
            "Sections cannot be trashed.",
            "Trash the course instead, or the items inside the section.",
          );
        if (node.trashedAt) return ok({ node: withLinks(node) });
        const at = iso();
        for (const n of [node, ...descendantsOf(node.id).filter((d) => !d.trashedAt)])
          n.trashedAt = at;
        return ok({ node: withLinks(node) });
      }
      if (action === "restore" && method === "POST") {
        if (!node.trashedAt) return ok({ node: withLinks(node) });
        const parent = node.parentId ? byId(node.parentId) : undefined;
        if (parent?.trashedAt) {
          const top = ancestorsOf(node).find((a) => a.trashedAt && a.kind !== "section") ?? parent;
          fail(
            "conflict",
            `"${top.name}" is in the trash, so "${node.name}" has nowhere to go.`,
            `Restore "${top.name}" first.`,
          );
        }
        const batch = node.trashedAt;
        for (const n of [node, ...descendantsOf(node.id)])
          if (n.trashedAt === batch) n.trashedAt = null;
        return ok({ node: withLinks(node) });
      }
    }

    fail("not_found", `No route for ${method} /api${path}.`);
  }

  async function handle(request: Request): Promise<Response> {
    if (options.latencyMs) await new Promise((r) => setTimeout(r, options.latencyMs));
    const url = new URL(request.url);
    let payload: unknown;
    if (request.method !== "GET" && request.method !== "DELETE") {
      const text = await request.text();
      if (text) {
        try {
          payload = JSON.parse(text);
        } catch {
          return errorResponse({ code: "invalid_input", message: "The body is not valid JSON." });
        }
      }
    }
    try {
      const path = url.pathname.replace(/^\/api/, "");
      const result = route(request.method, path, url.searchParams, payload);
      if (request.method !== "GET") options.onChange?.(snapshot());
      return new Response(result.json === undefined ? null : JSON.stringify(result.json), {
        status: result.status,
        headers: result.json === undefined ? undefined : { "Content-Type": "application/json" },
      });
    } catch (error) {
      if (error instanceof Fail) return errorResponse(error.error);
      throw error;
    }
  }

  function errorResponse(error: ApiError): Response {
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (error.retryAfter) headers["Retry-After"] = String(error.retryAfter);
    return new Response(JSON.stringify({ error }), { status: STATUS[error.code] ?? 500, headers });
  }

  function snapshot(): MockSnapshot {
    return structuredClone({ nodes, files, recents, keys, signedIn, password });
  }

  return {
    handle,
    fetch: (input: RequestInfo | URL, init?: RequestInit) => handle(new Request(input, init)),
    snapshot,
    reset: () => load(),
  };
}

export type MockBackend = ReturnType<typeof createMockBackend>;
