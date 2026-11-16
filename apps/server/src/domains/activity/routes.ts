import { Hono } from "hono";
import { z } from "zod";
import { type AppEnv, getAuth, requireAuth } from "../../http/auth-context.js";
import type { ServerDeps } from "../../http/deps.js";
import { AppError } from "../../http/errors.js";
import { type ActivityLog, createActivityLog } from "./activity.js";
import { type ChangeFeed, createChangeFeed } from "./changes.js";

const ChangesQuery = z.object({
  cursor: z.string().max(20).optional(),
  limit: z.coerce.number().int().min(1).max(500).default(100),
});

const ActivityQuery = z.object({
  keyId: z.string().max(100).optional(),
  action: z.string().max(100).optional(),
  objectId: z.string().max(100).optional(),
  since: z.iso.datetime().optional(),
  until: z.iso.datetime().optional(),
  cursor: z.string().max(20).optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
});

function parseQuery<T extends z.ZodType>(schema: T, data: unknown, example: unknown): z.infer<T> {
  const result = schema.safeParse(data);
  if (result.success) return result.data;
  const problems = result.error.issues.map(
    (issue) => `${issue.path.join(".") || "query"}: ${issue.message}`,
  );
  throw new AppError("invalid_input", problems.join("; "), {
    hint: "Fix the parameter named above and send again.",
    example,
  });
}

/** The change feed (H9) and the agent activity log (H10). Reads only; writes happen as work is done. */
export function activityRoutes(
  deps: Pick<ServerDeps, "db" | "now">,
  /** The app's one feed and log. Default: new ones over the same database. */
  shared: { changes?: ChangeFeed; activity?: ActivityLog } = {},
): Hono<AppEnv> {
  const feed = shared.changes ?? createChangeFeed(deps.db, deps.now);
  const log = shared.activity ?? createActivityLog(deps.db, deps.now);
  const app = new Hono<AppEnv>();

  app.get("/changes", requireAuth, (c) => {
    const auth = getAuth(c);
    const q = parseQuery(ChangesQuery, c.req.query(), { cursor: "0", limit: 100 });
    return c.json(feed.changesSince(auth.userId, q.cursor, q.limit));
  });

  app.get("/activity", requireAuth, (c) => {
    const auth = getAuth(c);
    const q = parseQuery(ActivityQuery, c.req.query(), { limit: 50 });
    return c.json(log.list(auth.userId, q));
  });

  return app;
}
