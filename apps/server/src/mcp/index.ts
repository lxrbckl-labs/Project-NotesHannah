import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import type { Actor, ApiError } from "@notes/schema";
import { type Context, Hono } from "hono";
import type { AppEnv, AuthContext } from "../http/auth-context.js";
import { authenticate } from "../http/authenticate.js";
import type { ServerDeps } from "../http/deps.js";
import type { Services } from "../services.js";
import { backendFromServices } from "./adapters.js";
import { agentGuide } from "./agent-guide.js";
import type { McpBackend } from "./ports.js";
import { createRateLimiter, DEFAULT_RATE_LIMIT, type RateLimitOptions } from "./rate-limit.js";
import { buildMcpServer, toolsFor } from "./server.js";
import { createWriteClaims } from "./write-claims.js";

export type { McpBackend } from "./ports.js";

export interface McpOptions {
  rateLimit?: RateLimitOptions;
  /** Where refused writes are noted. Default: the server log. */
  log?: (line: string) => void;
}

/**
 * The name the activity log shows for an agent: its X-Agent-Label header, or
 * else what its User-Agent says it is. Claude Code sends "claude-code/<v>",
 * Codex "codex_cli_rs/<v>" (seen in the live check).
 */
export function agentActor(actor: Actor, userAgent: string | undefined): Actor {
  if (actor.type !== "agent" || actor.label) return actor;
  const ua = userAgent ?? "";
  const label = /claude-code|claude-cli/i.test(ua)
    ? "Claude Code"
    : /codex/i.test(ua)
      ? "Codex"
      : undefined;
  return label ? { ...actor, label } : actor;
}

function isServices(value: McpBackend | Services): value is Services {
  return "activity" in value && "sources" in value;
}

function publicOrigin(c: Context, deps: ServerDeps): string {
  return deps.config.NODE_ENV === "production" ? deps.config.APP_ORIGIN : new URL(c.req.url).origin;
}

/**
 * The agent front door: `POST /mcp` (stateless Streamable HTTP, JSON
 * responses, API key only) and `GET /agents.txt`. Mount with
 * `app.route("/", mcpRoutes(deps, services))` before the catch-all for /mcp.
 * Pass the app's shared `Services` (production), or a `McpBackend` of ports
 * (tests with fakes); tools whose port is missing are not advertised.
 */
export function mcpRoutes(
  deps: ServerDeps,
  source: McpBackend | Services,
  options: McpOptions = {},
): Hono<AppEnv> {
  const backend = isServices(source) ? backendFromServices(source) : source;
  const limiter = createRateLimiter(options.rateLimit ?? DEFAULT_RATE_LIMIT, deps.now);
  const log = options.log ?? ((line: string) => console.log(line));
  const tools = toolsFor(backend);
  const claims = createWriteClaims(deps.db, backend.library, deps.now);
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
    const actor = agentActor(auth.actor, c.req.header("user-agent"));
    const caller: AuthContext = { ...auth, actor };
    const server = buildMcpServer(tools, {
      context: {
        auth: caller,
        userId: auth.userId,
        keyId: actor.type === "agent" ? actor.keyId : "",
        scope: auth.scope,
        actor,
        db: deps.db,
        library: backend.library,
        backend,
        claims,
        available,
        now: deps.now,
      },
      log,
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
