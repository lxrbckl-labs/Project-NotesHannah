import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import {
  CallToolRequestSchema,
  type CallToolResult,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import type { ApiError } from "@notes/schema";
import { AppError } from "../http/errors.js";
import { agentFacing, toApiError } from "./errors.js";
import type { AuditPort, McpPorts } from "./ports.js";
import type { ToolContext, ToolDef } from "./tool.js";
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
 * The tools for a set of ports, in the order agents should meet them. A tool
 * whose port is missing is not registered, so nothing unbacked is advertised.
 */
export function toolsFor(ports: McpPorts): ToolDef[] {
  const files = ports.files;
  const documents = ports.documents;
  return [
    startHere,
    browseLibrary,
    getItem,
    searchTool({
      transcripts: Boolean(files?.searchTranscripts),
      documents: Boolean(documents?.searchDocuments),
    }),
    editLibrary,
    ...(ports.changes ? [changesTool] : []),
    ...(files ? [sourceFiles, getPage, saveTranscript, requestUploadLinks] : []),
    ...(documents ? [writeDocument, editBlocks] : []),
  ];
}

export function errorResult(error: ApiError): CallToolResult {
  const lines = [`Error ${error.code}: ${error.message}`];
  if (error.hint) lines.push(`Hint: ${error.hint}`);
  if (error.example !== undefined) lines.push(`Example: ${JSON.stringify(error.example)}`);
  if (error.retryAfter !== undefined) lines.push(`Retry after ${error.retryAfter} s.`);
  return {
    isError: true,
    content: [{ type: "text", text: lines.join("\n") }],
    structuredContent: { error },
  };
}

export interface CallScope {
  context: ToolContext;
  agentLabel: string | null;
  audit: AuditPort;
  /** 0 when allowed, else seconds to wait. */
  rateLimit: () => number;
}

/** Run one tool call: rate limit, parse, scope check, run, audit. Never throws. */
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
      hint: `Wait ${wait} second(s), then continue. Batch work where a tool allows it (several blocks per write, several upload links per call).`,
      retryAfter: wait,
    });
  }
  let input: unknown;
  let writes = false;
  let action: string | null = null;
  const audit = (outcome: string, targets: string[]) => {
    if (!writes) return;
    scope.audit.record({
      userId: ctx.userId,
      keyId: ctx.keyId,
      agentLabel: scope.agentLabel,
      tool: tool.name,
      action,
      targetIds: [...new Set(targets)],
      outcome,
      at: new Date(ctx.now()).toISOString(),
    });
  };
  try {
    input = tool.parse(args);
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
    const output = await tool.run(ctx, input);
    audit("ok", output.targets ?? []);
    let text = output.text;
    if (text.length > MAX_TEXT_CHARS) {
      text = `${text.slice(0, MAX_TEXT_CHARS)}\n… (cut at ${MAX_TEXT_CHARS} characters; ask for less with limit, offset or cursor)`;
    }
    return {
      content: [
        { type: "text", text },
        ...(output.images ?? []).map((img) => ({
          type: "image" as const,
          data: img.data,
          mimeType: img.mimeType,
        })),
      ],
      // Claude Code shows the model only structuredContent when it is present
      // (seen in the live check), Codex shows both. So the readable text leads
      // the structured result as "message"; bulk text lives only there.
      structuredContent: { message: text, ...output.structured },
    };
  } catch (error) {
    if (!(error instanceof AppError)) console.error(`mcp tool ${tool.name} failed`, error);
    const apiError = toApiError(agentFacing(error));
    audit(apiError.code, []);
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
