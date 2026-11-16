import { SearchQuery } from "@notes/schema";
import { Hono } from "hono";
import { type AppEnv, getAuth, requireAuth } from "../../http/auth-context.js";
import { AppError } from "../../http/errors.js";
import type { SearchService } from "./service.js";

/** `GET /api/search`: names, transcript pages and document blocks in one list. */
export function searchRoutes(search: SearchService): Hono<AppEnv> {
  const app = new Hono<AppEnv>();

  app.get("/api/search", requireAuth, (c) => {
    const parsed = SearchQuery.safeParse(c.req.query());
    if (!parsed.success) {
      const problems = parsed.error.issues.map(
        (issue) => `${issue.path.join(".") || "query"}: ${issue.message}`,
      );
      throw new AppError("invalid_input", problems.join("; "), {
        hint: "Fix the parameter named above and send again.",
        example: { q: "beta blockers", kinds: "node,page,block", limit: 20 },
      });
    }
    return c.json(search.search(getAuth(c).userId, parsed.data));
  });

  return app;
}
