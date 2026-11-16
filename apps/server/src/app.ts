import { existsSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { serveStatic } from "@hono/node-server/serve-static";
import { SCHEMA_VERSION } from "@notes/schema";
import { Hono } from "hono";
import { type Config, webDistDir } from "./config.js";
import { healthRoutes } from "./domains/health/routes.js";

export const SCHEMA_VERSION_IN_USE = SCHEMA_VERSION;

const API_PREFIXES = ["/api", "/mcp", "/healthz"];

export function createApp(config: Config): Hono {
  const app = new Hono();
  app.route("/", healthRoutes);

  // Unknown API-ish paths are 404s, never the SPA shell.
  for (const prefix of ["/api", "/mcp"]) {
    app.all(`${prefix}/*`, (c) => c.json({ error: "not_found" }, 404));
    app.all(prefix, (c) => c.json({ error: "not_found" }, 404));
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
        return c.notFound();
      }
      return c.html(indexHtml);
    });
  }
  return app;
}
