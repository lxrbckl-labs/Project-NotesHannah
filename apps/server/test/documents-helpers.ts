import { type Actor, EXAMPLE_CITATION, newId } from "@notes/schema";
import { Hono } from "hono";
import { createTestDatabase } from "../src/db/client.js";
import {
  activityRoutes,
  createActivityLog,
  createChangeFeed,
} from "../src/domains/activity/index.js";
import {
  createDocumentsService,
  createFakeSourceLookup,
  type DocumentsPorts,
  documentsRoutes,
} from "../src/domains/documents/index.js";
import { createLibraryService, libraryRoutes } from "../src/domains/library/index.js";
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

/** A quote that exists in the fake transcript, so citations resolve. */
export const QUOTE =
  "Cardioselective agents (atenolol, metoprolol) preferentially block β1 receptors.";

export function setupDocs(options: { revisionCap?: number; strictSources?: boolean } = {}) {
  const db = createTestDatabase();
  let ms = Date.UTC(2026, 10, 15, 12, 0, 0);
  const now = () => {
    ms += 1000;
    return ms;
  };
  const sources = createFakeSourceLookup(options.strictSources ? { strict: true } : {});
  const ports: DocumentsPorts = { sources };
  if (options.revisionCap !== undefined) ports.revisionCap = options.revisionCap;
  const deps = { db, now };
  const service = createDocumentsService(deps, ports);
  const library = createLibraryService(db, { now: () => new Date(now()) });
  const feed = createChangeFeed(db, now);
  const log = createActivityLog(db, now);

  const app = new Hono<AppEnv>();
  app.use("*", async (c, next) => {
    const user = c.req.header("x-user");
    const key = c.req.header("x-key");
    const scope = (c.req.header("x-scope") ?? "write") as "read" | "write";
    let auth: AuthContext | null = null;
    if (user && key) auth = agentAuth(user, key, scope);
    else if (user)
      auth = { ...userAuth(user), via: (c.req.header("x-via") ?? "session") as never, scope };
    c.set("auth", auth);
    await next();
  });
  app.route("/", libraryRoutes(db));
  app.route("/api", documentsRoutes(deps, ports, service));
  app.route("/api", activityRoutes(deps));
  app.onError(handleError);

  const alice = newId("user");
  const bob = newId("user");
  const she = userAuth(alice);
  const bot = agentAuth(alice, newId("apiKey"));
  const otherBot = agentAuth(alice, newId("apiKey"), "write", "Codex");
  const bobUser = userAuth(bob);

  /** term > course > sections; returns ids of the sections. */
  function spine(userId = alice) {
    const term = library.create(userId, { parentId: null, kind: "term", name: "Fall 2026" });
    const course = library.create(userId, {
      parentId: term.id,
      kind: "course",
      name: "Pharmacology II",
      course: { code: "PHAR 7340" },
    });
    const kids = library.list(userId, { parentId: course.id }).items;
    const sec = Object.fromEntries(kids.map((s) => [s.section as string, s.id]));
    return { term, course, sec: sec as Record<string, string> };
  }

  /** A page the fake source lookup knows, with a transcript containing QUOTE. */
  function addPage(userId = alice, transcript: string | null = `Slide 12. ${QUOTE} More text.`) {
    const fileId = newId("file");
    const pageId = newId("page");
    sources.addPage({
      userId,
      fileId,
      pageId,
      fileName: "Lecture 7.pdf",
      pageIndex: 12,
      transcript,
    });
    return { fileId, pageId, citation: { fileId, pageId, quote: QUOTE, label: "Slide 12" } };
  }

  return {
    db,
    deps,
    service,
    library,
    feed,
    log,
    app,
    sources,
    alice,
    bob,
    she,
    bot,
    otherBot,
    bobUser,
    spine,
    addPage,
    exampleCitation: EXAMPLE_CITATION,
    /** Create a study guide document under a fresh course's Study guides section. */
    newDoc(
      auth: AuthContext = she,
      blocks: unknown[] = [],
      title = "Beta blockers",
      sectionOwner = auth.userId,
    ) {
      const { sec } = spine(sectionOwner);
      return service.createDocument(auth, {
        parentId: sec.study_guides as string,
        kind: "study_guide",
        title,
        blocks,
      } as never);
    },
    async call(
      who: { user?: string; key?: string; via?: string; scope?: string } | null,
      method: string,
      path: string,
      body?: unknown,
    ): Promise<{ status: number; body: Json }> {
      const headers: Record<string, string> = {};
      if (who?.user) headers["x-user"] = who.user;
      if (who?.key) headers["x-key"] = who.key;
      if (who?.via) headers["x-via"] = who.via;
      if (who?.scope) headers["x-scope"] = who.scope;
      if (body !== undefined) headers["content-type"] = "application/json";
      const res = await app.request(path, {
        method,
        headers,
        ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
      });
      const text = await res.text();
      return { status: res.status, body: text ? JSON.parse(text) : null };
    },
  };
}

export type Docs = ReturnType<typeof setupDocs>;

export const para = (text: string, citations: unknown[] = []): Json => ({
  type: "paragraph",
  content: { text },
  citations,
});
export const heading = (text: string, level = 2): Json => ({
  type: "heading",
  content: { level, text },
});
export const general = (text: string): Json => ({
  type: "paragraph",
  content: { text },
  generalKnowledge: true,
});

export function actorOf(auth: AuthContext): Actor {
  return auth.actor;
}

/** Run `fn` and return the AppError it threw (or fail). */
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
