import { existsSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { serveStatic } from "@hono/node-server/serve-static";
import { SCHEMA_VERSION } from "@notes/schema";
import { Hono } from "hono";
import { type Config, webDistDir } from "./config.js";
import { createTestDatabase, type Db } from "./db/client.js";
import { PasswordHasher } from "./domains/accounts/passwords.js";
import { accountRoutes, keyRoutes } from "./domains/accounts/routes.js";
import { filesRoutes } from "./domains/files/index.js";
import { healthRoutes } from "./domains/health/routes.js";
import { libraryRoutes } from "./domains/library/index.js";
import type { AppEnv } from "./http/auth-context.js";
import { authenticate } from "./http/authenticate.js";
import type { ServerDeps } from "./http/deps.js";
import { AppError, handleError } from "./http/errors.js";
import { originCheck, securityHeaders } from "./http/security.js";

export const SCHEMA_VERSION_IN_USE = SCHEMA_VERSION;

const API_PREFIXES = ["/api", "/mcp", "/healthz"];

export interface AppOptions {
  /** The opened, migrated database. Optional only under NODE_ENV=test (an in-memory one is made). */
  db?: Db;
  now?: () => number;
  hasher?: PasswordHasher;
}

function notFound(): never {
  throw new AppError("not_found", "No such route.");
}

export function createApp(config: Config, options: AppOptions = {}): Hono<AppEnv> {
  let db = options.db;
  if (!db) {
    if (config.NODE_ENV !== "test") throw new Error("createApp needs an opened database.");
    db = createTestDatabase();
  }
  const deps: ServerDeps = {
    config,
    db,
    now: options.now ?? Date.now,
    hasher: options.hasher ?? new PasswordHasher(),
  };
  // Have the dummy hash ready so the first unknown-username sign-in is not faster.
  void deps.hasher.warmUp();

  const app = new Hono<AppEnv>();
  app.onError(handleError);
  app.notFound((c) => handleError(new AppError("not_found", "No such route."), c));
  app.use("*", securityHeaders(config));

  app.get("/robots.txt", (c) => c.text("User-agent: *\nDisallow: /\n"));
  app.route("/", healthRoutes);

  app.use("/api/*", authenticate(deps));
  app.use("/api/*", originCheck(config));
  app.route("/api", accountRoutes(deps));
  app.route("/api", keyRoutes(deps));
  // Library routes carry their full /api paths.
  app.route("/", libraryRoutes(db));
  // Files routes carry their full /api paths; PUT /api/uploads/:token is credentialed by its token alone.
  app.route("/", filesRoutes(deps));

  // Unknown API-ish paths are ApiError 404s, never the SPA shell.
  for (const prefix of ["/api", "/mcp"]) {
    app.all(`${prefix}/*`, () => notFound());
    app.all(prefix, () => notFound());
  }

  if (config.NODE_ENV === "production") {
    const dist = webDistDir(config);
    const indexPath = join(dist, "index.html");
    if (!existsSync(indexPath)) {
      throw new Error(`Built web app not found at ${indexPath}. Run \`pnpm build\` first.`);
    }
    const indexHtml = readFileSync(indexPath, "utf8");
    app.use("*", serveStatic({ root: relative(process.cwd(), dist) || "." }));
    app.get("*", (c) => {
      if (API_PREFIXES.some((p) => c.req.path === p || c.req.path.startsWith(`${p}/`))) {
        return notFound();
      }
      return c.html(indexHtml);
    });
  }
  return app;
}
