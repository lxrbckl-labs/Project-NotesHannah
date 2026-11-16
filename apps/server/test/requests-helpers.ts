import { type Actor, newId } from "@notes/schema";
import { Hono } from "hono";
import { createTestDatabase } from "../src/db/client.js";
import { createActivityLog } from "../src/domains/activity/index.js";
import { createDocumentsService } from "../src/domains/documents/index.js";
import { createLibraryService, libraryRoutes } from "../src/domains/library/index.js";
import {
  createRequestsService,
  type RequestsPorts,
  requestsRoutes,
} from "../src/domains/requests/index.js";
import type { AppEnv, AuthContext } from "../src/http/auth-context.js";
import { handleError } from "../src/http/errors.js";

// biome-ignore lint/suspicious/noExplicitAny: response bodies are inspected loosely in tests
export type Json = any;

export function userAuth(userId: string): AuthContext {
  return {
    userId,
    actor: { type: "user", userId },
    via: "session",
    scope: "write",
    sessionId: "ses_x",
  };
}

export function agentAuth(
  userId: string,
  keyId = newId("apiKey"),
  scope: "read" | "write" = "write",
  label = "Claude Code",
): AuthContext {
  return { userId, actor: { type: "agent", keyId, label }, via: "key", scope };
}

export function thrown(fn: () => unknown): {
  code: string;
  message: string;
  hint?: string;
  example?: unknown;
} {
  try {
    fn();
  } catch (error) {
    return error as never;
  }
  throw new Error("expected the call to throw");
}

export const REQUEST_START = Date.UTC(2026, 10, 15, 12, 0, 0);

/** A request queue over a real database, library and documents service, with a clock the test moves. */
export function setupRequests(options: { ports?: RequestsPorts } = {}) {
  const db = createTestDatabase();
  let ms = REQUEST_START;
  const clock = {
    now: () => ms,
    advance(by: number) {
      ms += by;
    },
  };
  const deps = { db, now: clock.now };
  const library = createLibraryService(db, { now: () => new Date(clock.now()) });
  const documents = createDocumentsService(deps, { library });
  const service = createRequestsService(deps, {
    activity: createActivityLog(db, clock.now),
    ...options.ports,
  });

  const app = new Hono<AppEnv>();
  app.use("*", async (c, next) => {
    const user = c.req.header("x-user");
    const key = c.req.header("x-key");
    const scope = (c.req.header("x-scope") ?? "write") as "read" | "write";
    let auth: AuthContext | null = null;
    if (user && key) auth = agentAuth(user, key, scope);
    else if (user) auth = { ...userAuth(user), scope };
    c.set("auth", auth);
    await next();
  });
  app.route("/", libraryRoutes(db));
  app.route("/api", requestsRoutes(deps, {}, service));
  app.onError(handleError);

  const alice = newId("user");
  const bob = newId("user");
  const she = userAuth(alice);
  const herBob = userAuth(bob);
  const bot = agentAuth(alice);
  const otherBot = agentAuth(alice, newId("apiKey"), "write", "Codex");
  const readBot = agentAuth(alice, newId("apiKey"), "read");

  function spine(userId = alice) {
    const term = library.create(userId, { parentId: null, kind: "term", name: "Fall 2026" });
    const course = library.create(userId, {
      parentId: term.id,
      kind: "course",
      name: "Pharmacology II",
      course: { code: "PHAR 7340" },
    });
    const kids = library.list(userId, { parentId: course.id }).items;
    const sec = Object.fromEntries(kids.map((s) => [s.section as string, s.id])) as Record<
      string,
      string
    >;
    return { term, course, sec };
  }

  /** A study guide with these paragraphs, written by an agent. */
  function newDoc(
    texts: string[] = ["Atenolol is β1-selective.", "Metoprolol too."],
    userId = alice,
  ) {
    const { sec, course } = spine(userId);
    const writer = userId === alice ? bot : agentAuth(userId);
    const made = documents.createDocument(writer, {
      parentId: sec.study_guides as string,
      kind: "study_guide",
      title: "Beta blockers",
      blocks: texts.map((text) => ({
        type: "paragraph",
        content: { text },
        generalKnowledge: true,
      })),
    } as never);
    return { ...made, course, sec };
  }

  async function call(
    who: { user?: string; key?: string; scope?: string } | null,
    method: string,
    path: string,
    body?: unknown,
  ): Promise<{ status: number; body: Json }> {
    const headers: Record<string, string> = {};
    if (who?.user) headers["x-user"] = who.user;
    if (who?.key) headers["x-key"] = who.key;
    if (who?.scope) headers["x-scope"] = who.scope;
    if (body !== undefined) headers["content-type"] = "application/json";
    const res = await app.request(path, {
      method,
      headers,
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });
    const text = await res.text();
    return { status: res.status, body: text ? JSON.parse(text) : null };
  }

  const asUser = (userId: string) => ({ user: userId });
  const asKey = (auth: AuthContext) => ({
    user: auth.userId,
    key: (auth.actor as Extract<Actor, { type: "agent" }>).keyId,
    scope: auth.scope,
  });

  return {
    db,
    clock,
    deps,
    library,
    documents,
    service,
    app,
    alice,
    bob,
    she,
    herBob,
    bot,
    otherBot,
    readBot,
    spine,
    newDoc,
    call,
    asUser,
    asKey,
  };
}

export type Requests = ReturnType<typeof setupRequests>;
