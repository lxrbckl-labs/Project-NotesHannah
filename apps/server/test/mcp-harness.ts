import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type { ApiError } from "@notes/schema";
import { Hono } from "hono";
import { createApiKey } from "../src/domains/accounts/keys.js";
import { createLibraryService } from "../src/domains/library/index.js";
import type { AppEnv } from "../src/http/auth-context.js";
import { handleError } from "../src/http/errors.js";
import { mcpRoutes } from "../src/mcp/index.js";
import type { McpBackend } from "../src/mcp/ports.js";
import type { RateLimitOptions } from "../src/mcp/rate-limit.js";
import { createServices } from "../src/services.js";
import { initStorage } from "../src/storage/storage.js";
import { FakeConverter } from "./files.support.js";
import { makeTestApp } from "./helpers.js";

export interface CallResult {
  text: string;
  /** The text block alone (the message's first line on success). */
  headline: string;
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
    const isError = result.isError === true;
    return {
      // The full readable text: the structured "message" on success, the text on errors.
      text: isError ? text : ((structured.message as string | undefined) ?? text),
      headline: text,
      structured,
      isError,
      error: isError ? parseError(text) : undefined,
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
 * An MCP router over in-memory fakes: the real library service plus whichever
 * fake ports a test passes. For the real composed stack use `realSetup`.
 */
export async function mcpSetup(
  options: {
    ports?: Omit<McpBackend, "library">;
    rateLimit?: RateLimitOptions;
    log?: (line: string) => void;
  } = {},
) {
  const t = makeTestApp();
  const deps = { config: t.config, db: t.db, now: t.clock.now, hasher: t.hasher };
  const library = createLibraryService(t.db, { now: () => new Date(t.clock.now()) });
  const app = new Hono<AppEnv>();
  app.onError(handleError);
  app.route(
    "/",
    mcpRoutes(
      deps,
      { library, ...options.ports },
      {
        ...(options.rateLimit ? { rateLimit: options.rateLimit } : {}),
        log: options.log ?? (() => {}),
      },
    ),
  );
  return { ...accounts(t, app), library };
}

/**
 * The real app (createApp with the composed services, as index.ts builds
 * them) over a temporary storage directory, with a fake converter that plays
 * the queue protocol. Nothing inside the server is faked.
 */
export async function realSetup() {
  const dir = mkdtempSync(join(tmpdir(), "notes-mcp-real-"));
  const { storage } = initStorage(dir);
  const t = makeTestApp({
    env: { DATA_DIR: dir, APP_ORIGIN: "http://localhost" },
    services: (deps) =>
      createServices(deps, {
        files: { storage, signingSecret: "mcp-secret", partialGraceMs: 0, log: () => {} },
      }),
  });
  const services = t.services;
  if (!services) throw new Error("no services");
  const converter = new FakeConverter(storage.root);
  /** Play the converter for every queued job, then let the server ingest the results. */
  function convertAll(pages = 2, mutate?: (result: Record<string, unknown>) => void) {
    for (const jobId of converter.pending()) {
      converter.succeed(jobId, { pages, ...(mutate ? { mutate } : {}) });
    }
    services?.files.processQueue();
  }
  return { ...accounts(t, t.app), services, converter, convertAll, storage, dir };
}

function accounts(t: ReturnType<typeof makeTestApp>, app: Fetcher) {
  const users: Record<string, { id: string }> = {};
  async function user(name: string) {
    users[name] ??= await t.addUser(name, "correct horse battery");
    return users[name];
  }
  function key(userId: string, scope: "read" | "write" = "write", name = "agent") {
    return createApiKey(t.db, userId, { name, scope }, t.clock.now());
  }
  /** A connected agent for a user (made on first use). */
  async function agent(name = "hannah", scope: "read" | "write" = "write", headers = {}) {
    const u = await user(name);
    const k = key(u.id, scope);
    return { user: u, key: k, ...(await connect(app, k.secret, headers)) };
  }
  return { t, app, user, key, agent };
}

/** The ApiError in an error result's text ("Error code: message", "Hint: …", "Example: {…}"). */
export function parseError(text: string): ApiError {
  const markers = ["\nHint: ", "\nExample: ", "\nRetry after "];
  const cut = (from: number) => {
    const ends = markers.map((m) => text.indexOf(m, from)).filter((i) => i >= 0);
    return ends.length ? Math.min(...ends) : text.length;
  };
  const head = /^Error (\w+): /.exec(text);
  if (!head) throw new Error(`not an error result: ${text}`);
  const error: ApiError = {
    code: head[1] as ApiError["code"],
    message: text.slice(head[0].length, cut(0)),
  };
  const hint = text.indexOf("\nHint: ");
  if (hint >= 0) error.hint = text.slice(hint + 7, cut(hint + 1));
  const example = text.indexOf("\nExample: ");
  if (example >= 0) error.example = JSON.parse(text.slice(example + 10, cut(example + 1)));
  const retry = /\nRetry after (\d+) s\./.exec(text);
  if (retry) error.retryAfter = Number(retry[1]);
  return error;
}

/** Every string in a value, for leak checks. */
export function allText(value: unknown): string {
  return JSON.stringify(value);
}
