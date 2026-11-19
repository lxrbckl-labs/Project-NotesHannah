import { PreferencesPatch } from "@notes/schema";
import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { type AppEnv, getAuth, requireSession } from "../../http/auth-context.js";
import type { ServerDeps } from "../../http/deps.js";
import { AppError } from "../../http/errors.js";
import { parseJson } from "../../http/validate.js";
import { getPreferences, updatePreferences } from "./service.js";

const smallBody = bodyLimit({
  maxSize: 16 * 1024,
  onError: () => {
    throw new AppError("too_large", "The request body is too large.");
  },
});

/** Her preferences. Mount at "/api". A browser session only: an agent key has no use for her tab bar. */
export function preferencesRoutes(deps: ServerDeps): Hono<AppEnv> {
  const { db } = deps;
  const app = new Hono<AppEnv>();
  app.use("/me/preferences", requireSession);

  app.get("/me/preferences", (c) => c.json({ preferences: getPreferences(db, getAuth(c).userId) }));

  app.patch("/me/preferences", smallBody, async (c) => {
    const patch = await parseJson(c, PreferencesPatch, {
      tabOrder: ["settings", "library", "practice", "calendar", "search", "inbox"],
    });
    return c.json({ preferences: updatePreferences(db, getAuth(c).userId, patch, deps.now()) });
  });

  return app;
}
