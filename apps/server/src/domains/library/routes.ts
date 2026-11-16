import { CreateNodeInput, MoveNodeInput, NodeId, UpdateNodeInput } from "@notes/schema";
import { Hono } from "hono";
import { z } from "zod";
import type { Db } from "../../db/client.js";
import {
  type AppEnv,
  getAuth,
  requireAuth,
  requireSession,
  requireWrite,
} from "../../http/auth-context.js";
import { AppError } from "../../http/errors.js";
import { EXAMPLE_ID } from "./rules.js";
import { createLibraryService, type LibraryService } from "./service.js";

const Limit = z.coerce.number().int().min(1).max(200).default(50);
const Cursor = z.string().max(200).optional();

const ListQuery = z.object({ parentId: NodeId.optional(), cursor: Cursor, limit: Limit });
const PageQuery = z.object({ cursor: Cursor, limit: Limit });
const RecentsQuery = z.object({ limit: z.coerce.number().int().min(1).max(100).default(20) });
const SearchQuery = z.object({
  q: z.string().trim().min(1).max(200),
  cursor: Cursor,
  limit: Limit,
});

/** Parse input with a zod schema, or throw invalid_input naming the field with a valid example. */
function parse<T extends z.ZodType>(schema: T, data: unknown, example: unknown): z.infer<T> {
  const result = schema.safeParse(data);
  if (result.success) return result.data;
  const problems = result.error.issues.map((issue) => {
    const field = issue.path.length > 0 ? issue.path.join(".") : "body";
    return `${field}: ${issue.message}`;
  });
  throw new AppError("invalid_input", problems.join("; "), {
    hint: `Fix the field${problems.length > 1 ? "s" : ""} named above and send again.`,
    example,
  });
}

async function readBody(
  c: { req: { json(): Promise<unknown> } },
  example: unknown,
): Promise<unknown> {
  try {
    return await c.req.json();
  } catch {
    throw new AppError("invalid_input", "The request body must be JSON.", {
      hint: "Send a JSON object with the header Content-Type: application/json.",
      example,
    });
  }
}

const EXAMPLES = {
  create: { parentId: EXAMPLE_ID, kind: "folder", name: "Week 1" },
  update: { name: "New name", favourite: true },
  move: { parentId: EXAMPLE_ID, afterId: null },
  list: { parentId: EXAMPLE_ID, limit: 50 },
  page: { limit: 50 },
  search: { q: "beta" },
};

export interface LibraryRoutesOptions {
  /** Share the app's one library service. Default: a new one over `db`. */
  service?: LibraryService;
  /**
   * Serve `GET /api/search` (names only). The composed app turns this off and
   * mounts the unified search, which also finds pages and blocks.
   */
  nameSearch?: boolean;
}

export function libraryRoutes(db: Db, options: LibraryRoutesOptions = {}): Hono<AppEnv> {
  const library = options.service ?? createLibraryService(db);
  const app = new Hono<AppEnv>();

  app.get("/api/nodes", requireAuth, (c) => {
    const query = parse(ListQuery, c.req.query(), EXAMPLES.list);
    return c.json(library.list(getAuth(c).userId, query));
  });

  app.get("/api/nodes/:id", requireAuth, (c) => {
    const { userId, via } = getAuth(c);
    const node = library.get(userId, c.req.param("id"));
    // Recents reflect what she opened, not what an agent walked through.
    if (via === "session") library.markOpened(userId, node.id);
    return c.json({ node });
  });

  app.post("/api/nodes", requireWrite, async (c) => {
    const input = parse(CreateNodeInput, await readBody(c, EXAMPLES.create), EXAMPLES.create);
    return c.json({ node: library.create(getAuth(c).userId, input, getAuth(c).actor) }, 201);
  });

  app.patch("/api/nodes/:id", requireWrite, async (c) => {
    const input = parse(UpdateNodeInput, await readBody(c, EXAMPLES.update), EXAMPLES.update);
    return c.json({
      node: library.update(getAuth(c).userId, c.req.param("id"), input, getAuth(c).actor),
    });
  });

  app.post("/api/nodes/:id/move", requireWrite, async (c) => {
    const input = parse(MoveNodeInput, await readBody(c, EXAMPLES.move), EXAMPLES.move);
    return c.json({
      node: library.move(getAuth(c).userId, c.req.param("id"), input, getAuth(c).actor),
    });
  });

  app.post("/api/nodes/:id/duplicate", requireWrite, (c) =>
    c.json(
      { node: library.duplicate(getAuth(c).userId, c.req.param("id"), getAuth(c).actor) },
      201,
    ),
  );

  app.post("/api/nodes/:id/trash", requireWrite, (c) =>
    c.json({ node: library.trash(getAuth(c).userId, c.req.param("id"), getAuth(c).actor) }),
  );

  app.post("/api/nodes/:id/restore", requireWrite, (c) =>
    c.json({ node: library.restore(getAuth(c).userId, c.req.param("id"), getAuth(c).actor) }),
  );

  app.delete("/api/nodes/:id", requireWrite, requireSession, (c) => {
    library.permanentDelete(getAuth(c).userId, c.req.param("id"), getAuth(c).actor);
    return c.body(null, 204);
  });

  app.get("/api/trash", requireAuth, (c) =>
    c.json(library.listTrash(getAuth(c).userId, parse(PageQuery, c.req.query(), EXAMPLES.page))),
  );

  app.get("/api/recents", requireAuth, (c) =>
    c.json(library.recents(getAuth(c).userId, parse(RecentsQuery, c.req.query(), { limit: 20 }))),
  );

  app.get("/api/favourites", requireAuth, (c) => c.json(library.favourites(getAuth(c).userId)));

  if (options.nameSearch !== false) {
    app.get("/api/search", requireAuth, (c) =>
      c.json(library.search(getAuth(c).userId, parse(SearchQuery, c.req.query(), EXAMPLES.search))),
    );
  }

  return app;
}
