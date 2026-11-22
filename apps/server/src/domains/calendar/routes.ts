import { CalendarQuery } from "@notes/schema";
import { Hono } from "hono";
import { type AppEnv, getAuth, requireAuth } from "../../http/auth-context.js";
import type { ServerDeps } from "../../http/deps.js";
import { AppError } from "../../http/errors.js";
import { readCalendar } from "./service.js";

/** The calendar. Mount at "/api". Read-only; any sign-in (her session or an agent's key). */
export function calendarRoutes(deps: Pick<ServerDeps, "db" | "now">): Hono<AppEnv> {
  const app = new Hono<AppEnv>();
  app.get("/calendar", requireAuth, (c) => {
    const parsed = CalendarQuery.safeParse(c.req.query());
    if (!parsed.success) {
      throw new AppError(
        "invalid_input",
        parsed.error.issues.map((i) => `${i.path.join(".") || "query"}: ${i.message}`).join("; "),
        {
          hint: "Send from and to as YYYY-MM-DD, at most 62 days apart.",
          example: "/api/calendar?from=2026-11-01&to=2026-11-30&utcOffsetMinutes=-360",
        },
      );
    }
    return c.json(readCalendar(deps.db, getAuth(c).userId, deps.now(), parsed.data));
  });
  return app;
}
