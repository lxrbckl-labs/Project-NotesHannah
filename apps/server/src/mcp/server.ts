import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import {
  CallToolRequestSchema,
  type CallToolResult,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import type { ApiError } from "@notes/schema";
import { AppError } from "../http/errors.js";
import { agentFacing, toApiError } from "./errors.js";
import type { McpBackend } from "./ports.js";
import type { ToolContext, ToolDef, ToolOutput } from "./tool.js";
import { editBlocks, writeDocument } from "./tools/documents.js";
import { getPage, requestUploadLinks, saveTranscript, sourceFiles } from "./tools/files.js";
import { getItem } from "./tools/get-item.js";
import { browseLibrary, changesTool, editLibrary, searchTool } from "./tools/library.js";
import { SERVER_INSTRUCTIONS, startHere } from "./tools/start-here.js";

export const SERVER_NAME = "notes";
export const SERVER_VERSION = "1.0.0";

/** Text results longer than this are cut (about 15,000 tokens), with a note. */
export const MAX_TEXT_CHARS = 60_000;

/**
 * The tools for a backend, in the order agents should meet them. A tool
 * whose port is missing is not registered, so nothing unbacked is advertised.
 */
export function toolsFor(backend: Omit<McpBackend, "library">): ToolDef[] {
  return [
    startHere,
    browseLibrary,
    getItem,
    searchTool({ unified: Boolean(backend.search) }),
    editLibrary,
    ...(backend.changes ? [changesTool] : []),
    ...(backend.files ? [sourceFiles, getPage, saveTranscript, requestUploadLinks] : []),
    ...(backend.documents ? [writeDocument, editBlocks] : []),
  ];
}

/**
 * A refused call. The text form only: Claude Code shows the text of an error
 * result and Codex shows text and structured content alike, so one copy.
 */
export function errorResult(error: ApiError): CallToolResult {
  const lines = [`Error ${error.code}: ${error.message}`];
  if (error.hint) lines.push(`Hint: ${error.hint}`);
  if (error.example !== undefined) lines.push(`Example: ${JSON.stringify(error.example)}`);
  if (error.retryAfter !== undefined) lines.push(`Retry after ${error.retryAfter} s.`);
  return { isError: true, content: [{ type: "text", text: lines.join("\n") }] };
}

export interface CallScope {
  context: ToolContext;
  /** 0 when allowed, else seconds to wait. */
  rateLimit: () => number;
  /** Where refused writes are noted (the server log). Successful writes are logged by the domains. */
  log?: (line: string) => void;
}

/**
 * The success shape (measured with scripts/mcp-live-check.probe.ts, 2026-11-15):
 * Claude Code shows the model structuredContent (plus images) and drops the
 * text block when structured content is present; Codex shows both. So the full
 * result is structuredContent, led by the readable "message", and the text
 * block carries only its first line: one copy for both agents, and a client
 * that reads only text still gets a summary.
 */
function successResult(output: ToolOutput): CallToolResult {
  let text = output.text;
  if (text.length > MAX_TEXT_CHARS) {
    text = `${text.slice(0, MAX_TEXT_CHARS)}\n… (cut at ${MAX_TEXT_CHARS} characters; ask for less with limit, offset or cursor)`;
  }
  const headline = text.split("\n", 1)[0] ?? "";
  return {
    content: [
      { type: "text", text: headline },
      ...(output.images ?? []).map((img) => ({
        type: "image" as const,
        data: img.data,
        mimeType: img.mimeType,
      })),
    ],
    structuredContent: { message: text, ...output.structured },
  };
}

/** Run one tool call: rate limit, parse, scope check, run. Never throws. */
export async function callTool(
  tools: ToolDef[],
  name: string,
  args: unknown,
  scope: CallScope,
): Promise<CallToolResult> {
  const { context: ctx } = scope;
  const tool = tools.find((t) => t.name === name);
  if (!tool) {
    return errorResult({
      code: "not_found",
      message: `There is no tool named "${name}" on this server.`,
      hint: `Tools here: ${tools.map((t) => t.name).join(", ")}. Start with start_here.`,
    });
  }
  const wait = scope.rateLimit();
  if (wait > 0) {
    return errorResult({
      code: "rate_limited",
      message: "Too many calls with this API key in a short time.",
      hint: `Wait ${wait} second(s), then continue. Batch work where a tool allows it (several blocks per write, several pages per get_item, several upload links per call).`,
      retryAfter: wait,
    });
  }
  let writes = false;
  let action: string | null = null;
  try {
    const input = tool.parse(args);
    writes = tool.writes(input);
    action = tool.action(input);
    if (writes && ctx.scope !== "write") {
      throw new AppError(
        "read_only_key",
        `This API key is read-only, so ${tool.name}${action ? ` (${action})` : ""} is refused. Reading works.`,
        {
          hint: "Ask her for a read-write key: in the app, Settings, API keys, New key, scope read-write. Then reconnect with it.",
        },
      );
    }
    return successResult(await tool.run(ctx, input));
  } catch (error) {
    if (!(error instanceof AppError)) console.error(`mcp tool ${tool.name} failed`, error);
    const apiError = toApiError(agentFacing(error));
    if (writes || apiError.code === "read_only_key") {
      scope.log?.(
        `mcp refused ${tool.name}${action ? ` ${action}` : ""} key=${ctx.keyId} code=${apiError.code}`,
      );
    }
    return errorResult(apiError);
  }
}

/** A fresh MCP server for one stateless request. */
export function buildMcpServer(tools: ToolDef[], scope: CallScope): Server {
  const server = new Server(
    { name: SERVER_NAME, version: SERVER_VERSION },
    { capabilities: { tools: {} }, instructions: SERVER_INSTRUCTIONS },
  );
  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: tools.map((t) => ({
      name: t.name,
      title: t.title,
      description: t.description,
      inputSchema: t.inputSchema as { type: "object"; [k: string]: unknown },
      annotations: { title: t.title, ...t.annotations },
    })),
  }));
  server.setRequestHandler(CallToolRequestSchema, async (request) =>
    callTool(tools, request.params.name, request.params.arguments ?? {}, scope),
  );
  return server;
}
