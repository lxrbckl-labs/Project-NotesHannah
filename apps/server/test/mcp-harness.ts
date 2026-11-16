import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type { ApiError } from "@notes/schema";
import { Hono } from "hono";
import { createApiKey } from "../src/domains/accounts/keys.js";
import type { AppEnv } from "../src/http/auth-context.js";
import { handleError } from "../src/http/errors.js";
import { mcpRoutes } from "../src/mcp/index.js";
import type { McpPorts } from "../src/mcp/ports.js";
import type { RateLimitOptions } from "../src/mcp/rate-limit.js";
import { makeTestApp } from "./helpers.js";

export interface CallResult {
  text: string;
  structured: Record<string, unknown>;
  isError: boolean;
  error: ApiError | undefined;
  images: Array<{ data: string; mimeType: string }>;
}

type Fetcher = { request: (input: string, init?: RequestInit) => Response | Promise<Response> };

/** An MCP SDK client talking to a Hono app in-process. */
export async function connect(
  app: Fetcher,
  key: string | null,
  headers: Record<string, string> = {},
) {
  const client = new Client({ name: "vitest", version: "1.0.0" });
  const transport = new StreamableHTTPClientTransport(new URL("http://localhost/mcp"), {
    fetch: (url, init) => Promise.resolve(app.request(url.toString(), init)),
    requestInit: {
      headers: { ...(key ? { Authorization: `Bearer ${key}` } : {}), ...headers },
    },
  });
  await client.connect(transport);
  async function call(name: string, args: Record<string, unknown> = {}): Promise<CallResult> {
    const result = (await client.callTool({ name, arguments: args })) as {
      content: Array<{ type: string; text?: string; data?: string; mimeType?: string }>;
      structuredContent?: Record<string, unknown>;
      isError?: boolean;
    };
    const text = result.content
      .filter((c) => c.type === "text")
      .map((c) => c.text)
      .join("\n");
    const structured = result.structuredContent ?? {};
    return {
      text,
      structured,
      isError: result.isError === true,
      error: structured.error as ApiError | undefined,
      images: result.content
        .filter((c) => c.type === "image")
        .map((c) => ({ data: c.data as string, mimeType: c.mimeType as string })),
    };
  }
  /** Call and expect success; returns the structured content. */
  async function ok(name: string, args: Record<string, unknown> = {}) {
    const r = await call(name, args);
    if (r.isError) throw new Error(`${name} failed: ${r.text}`);
    return r;
  }
  /** Call and expect a tool error; returns the ApiError. */
  async function fail(name: string, args: Record<string, unknown> = {}) {
    const r = await call(name, args);
    if (!r.isError || !r.error) throw new Error(`${name} unexpectedly succeeded: ${r.text}`);
    return { ...r, error: r.error };
  }
  return { client, call, ok, fail, close: () => client.close() };
}

/**
 * The real app's accounts and database, with an MCP router built from the
 * given ports (the app itself mounts it with none).
 */
export async function mcpSetup(options: { ports?: McpPorts; rateLimit?: RateLimitOptions } = {}) {
  const t = makeTestApp();
  const deps = { config: t.config, db: t.db, now: t.clock.now, hasher: t.hasher };
  const app = new Hono<AppEnv>();
  app.onError(handleError);
  app.route("/", mcpRoutes(deps, options.ports, { rateLimit: options.rateLimit }));
  const users: Record<string, { id: string }> = {};
  async function user(name: string) {
    users[name] ??= await t.addUser(name, "correct horse battery");
    return users[name];
  }
  function key(userId: string, scope: "read" | "write" = "write", name = "agent") {
    return createApiKey(t.db, userId, { name, scope }, t.clock.now());
  }
  /** A signed-in agent for a fresh user. */
  async function agent(name = "hannah", scope: "read" | "write" = "write") {
    const u = await user(name);
    const k = key(u.id, scope);
    return { user: u, key: k, ...(await connect(app, k.secret)) };
  }
  return { t, app, deps, user, key, agent };
}

/** Every string in a value, for leak checks. */
export function allText(value: unknown): string {
  return JSON.stringify(value);
}
