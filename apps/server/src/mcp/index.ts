import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import type { ApiError } from "@notes/schema";
import { type Context, Hono } from "hono";
import { createLibraryService } from "../domains/library/index.js";
import type { AppEnv } from "../http/auth-context.js";
import { authenticate } from "../http/authenticate.js";
import type { ServerDeps } from "../http/deps.js";
import { agentGuide } from "./agent-guide.js";
import { sqliteAudit } from "./audit.js";
import type { McpPorts } from "./ports.js";
import { createRateLimiter, DEFAULT_RATE_LIMIT, type RateLimitOptions } from "./rate-limit.js";
import { buildMcpServer, toolsFor } from "./server.js";

export type { McpPorts } from "./ports.js";

export interface McpOptions {
  rateLimit?: RateLimitOptions;
}

function publicOrigin(c: Context, deps: ServerDeps): string {
  return deps.config.NODE_ENV === "production" ? deps.config.APP_ORIGIN : new URL(c.req.url).origin;
}

/**
 * The agent front door: `POST /mcp` (stateless Streamable HTTP, JSON
 * responses, API key only) and `GET /agents.txt`. Mount with
 * `app.route("/", mcpRoutes(deps, ports))` before the catch-all for /mcp.
 * Tools whose port is not given are not advertised.
 */
export function mcpRoutes(
  deps: ServerDeps,
  ports: McpPorts = {},
  options: McpOptions = {},
): Hono<AppEnv> {
  const library = createLibraryService(deps.db, { now: () => new Date(deps.now()) });
  const audit = ports.audit ?? sqliteAudit(deps.db);
  const limiter = createRateLimiter(options.rateLimit ?? DEFAULT_RATE_LIMIT, deps.now);
  const tools = toolsFor(ports);
  const available = new Set(tools.map((t) => t.name));
  const app = new Hono<AppEnv>();

  app.get("/agents.txt", (c) => {
    c.header("Cache-Control", "no-cache");
    return c.text(agentGuide(publicOrigin(c, deps)));
  });

  app.use("/mcp", authenticate(deps));
  app.all("/mcp", async (c) => {
    const auth = c.get("auth");
    if (auth?.via !== "key") {
      const sentKey = c.req.header("authorization") !== undefined;
      const error: ApiError = {
        code: "unauthenticated",
        message: sentKey
          ? "The API key was not accepted: it is wrong, revoked, or its account is disabled."
          : auth?.via === "session"
            ? "This endpoint accepts API keys only, not browser sessions."
            : "An API key is required.",
        hint: `Create a key in the app under Settings, API keys, and send it as "Authorization: Bearer <key>". Setup for Claude Code and Codex: ${publicOrigin(c, deps)}/agents.txt`,
      };
      c.header(
        "WWW-Authenticate",
        sentKey ? 'Bearer realm="notes", error="invalid_token"' : 'Bearer realm="notes"',
      );
      return c.json({ error }, 401);
    }
    if (c.req.method !== "POST") {
      // Stateless server: no standing SSE stream (GET) and no session to end (DELETE).
      c.header("Allow", "POST");
      return c.json(
        {
          jsonrpc: "2.0",
          error: {
            code: -32000,
            message: "Method not allowed: this MCP server is stateless; use POST.",
          },
          id: null,
        },
        405,
      );
    }
    const label = auth.actor.type === "agent" ? (auth.actor.label ?? null) : null;
    const server = buildMcpServer(tools, {
      context: {
        userId: auth.userId,
        keyId: auth.actor.type === "agent" ? auth.actor.keyId : "",
        scope: auth.scope,
        actor: auth.actor,
        db: deps.db,
        library,
        ports,
        available,
        now: deps.now,
      },
      agentLabel: label,
      audit,
      rateLimit: () => limiter.take(auth.actor.type === "agent" ? auth.actor.keyId : auth.userId),
    });
    const transport = new WebStandardStreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
      enableJsonResponse: true,
    });
    await server.connect(transport);
    try {
      return await transport.handleRequest(c.req.raw);
    } finally {
      await server.close();
    }
  });
  return app;
}
