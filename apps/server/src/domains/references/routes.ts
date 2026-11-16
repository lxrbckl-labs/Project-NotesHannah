import { ReferenceId, ReferenceListQuery } from "@notes/schema";
import { Hono } from "hono";
import {
  type AppEnv,
  getAuth,
  requireAuth,
  requireSession,
  requireWrite,
} from "../../http/auth-context.js";
import { AppError } from "../../http/errors.js";
import type { ReferencesService } from "./service.js";

async function readBody(c: { req: { json(): Promise<unknown> } }) {
  try {
    return await c.req.json();
  } catch {
    throw new AppError("invalid_input", "The request body must be JSON.", {
      hint: "Send a JSON object with the header Content-Type: application/json.",
      example: { title: "Beers Criteria", url: "https://doi.org/10.1111/jgs.18372" },
    });
  }
}

/** Reference routes. Mount at "/api". Reads need any sign-in; changes a session or write key; delete her session. */
export function referencesRoutes(service: ReferencesService): Hono<AppEnv> {
  const app = new Hono<AppEnv>();
  const rid = (v: string | undefined) => {
    const r = ReferenceId.safeParse(v);
    if (!r.success) {
      throw new AppError("not_found", "No such reference.", {
        hint: "Reference IDs look like ref_...; list them with GET /api/references.",
      });
    }
    return r.data;
  };

  app.get("/references", requireAuth, (c) => {
    const parsed = ReferenceListQuery.safeParse(c.req.query());
    if (!parsed.success) {
      throw new AppError(
        "invalid_input",
        parsed.error.issues.map((i) => `${i.path.join(".") || "query"}: ${i.message}`).join("; "),
        { hint: "Fix the parameter named above and send again.", example: { kind: "guideline" } },
      );
    }
    return c.json(service.list(getAuth(c), parsed.data));
  });

  app.post("/references", requireWrite, async (c) => {
    return c.json({ reference: service.create(getAuth(c), await readBody(c)) }, 201);
  });

  app.get("/references/:id", requireAuth, (c) => {
    return c.json({ reference: service.get(getAuth(c), rid(c.req.param("id"))) });
  });

  app.get("/references/:id/used-in", requireAuth, (c) => {
    return c.json({ items: service.usedIn(getAuth(c), rid(c.req.param("id"))) });
  });

  app.patch("/references/:id", requireWrite, async (c) => {
    const body = await readBody(c);
    return c.json({ reference: service.update(getAuth(c), rid(c.req.param("id")), body) });
  });

  app.delete("/references/:id", requireWrite, requireSession, (c) => {
    service.delete(getAuth(c), rid(c.req.param("id")));
    return c.body(null, 204);
  });

  return app;
}
