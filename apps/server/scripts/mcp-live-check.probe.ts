/**
 * Which part of a tool result does each agent's model actually see? A one-tool
 * MCP server whose result puts a different code word in the text content, in
 * structuredContent and in an image, then asks the agent to repeat what it saw.
 * Decides the result shape in src/mcp/server.ts (see docs/mcp.md, "Results").
 *
 * Usage (from apps/server): npx tsx scripts/mcp-live-check.probe.ts [claude|codex]
 */
import { spawn } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { serve } from "@hono/node-server";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { Hono } from "hono";

const agent = process.argv[2] ?? "claude";
const mode = process.env.SHAPE ?? "both"; // both | text | structured
const port = Number(process.env.PORT ?? 8792);
const work = mkdtempSync(join(tmpdir(), "notes-mcp-probe."));

// A real converter output (WebP), as get_page sends it.
const webp = readFileSync(
  new URL("../../../spikes/s5-converter/samples/lecture-slide-4.webp", import.meta.url),
);

function build() {
  const s = new Server({ name: "probe", version: "1" }, { capabilities: { tools: {} } });
  s.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: [
      {
        name: "probe",
        description: "Returns a result to inspect. Call it once.",
        inputSchema: { type: "object", properties: {} },
      },
    ],
  }));
  s.setRequestHandler(CallToolRequestSchema, async () => ({
    content: [
      ...(mode !== "structured" ? [{ type: "text" as const, text: "TEXT-ALPHA" }] : []),
      { type: "image" as const, data: webp.toString("base64"), mimeType: "image/webp" },
    ],
    ...(mode !== "text" ? { structuredContent: { word: "STRUCT-BRAVO" } } : {}),
  }));
  return s;
}

const app = new Hono();
app.post("/mcp", async (c) => {
  const s = build();
  const t = new WebStandardStreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
    enableJsonResponse: true,
  });
  await s.connect(t);
  return t.handleRequest(c.req.raw);
});
app.all("/mcp", (c) => c.body(null, 405));
const server = serve({ fetch: app.fetch, port, hostname: "127.0.0.1" });

const prompt =
  "Call the probe tool once. Then list, verbatim, every code word (WORD-WORD in capitals) you can see in its result and where it appeared (plain text or JSON), and give the title of the slide in the image if you can see an image. Do nothing else.";
const run = (cmd: string, args: string[]) =>
  new Promise<string>((resolve) => {
    const child = spawn(cmd, args, { stdio: ["ignore", "pipe", "pipe"] });
    let out = "";
    child.stdout.on("data", (d) => {
      out += d;
    });
    child.on("close", () => resolve(out));
  });

let out: string;
if (agent === "codex") {
  out = await run("codex", [
    "exec",
    "--ignore-user-config",
    "--ephemeral",
    "--skip-git-repo-check",
    "-s",
    "read-only",
    "-C",
    work,
    "-c",
    `mcp_servers.probe.url="http://127.0.0.1:${port}/mcp"`,
    "-c",
    'mcp_servers.probe.default_tools_approval_mode="approve"',
    prompt,
  ]);
} else {
  const config = join(work, "probe.json");
  writeFileSync(
    config,
    JSON.stringify({
      mcpServers: { probe: { type: "http", url: `http://127.0.0.1:${port}/mcp` } },
    }),
  );
  out = await run("claude", [
    "-p",
    "--model",
    "haiku",
    "--strict-mcp-config",
    "--mcp-config",
    config,
    "--allowedTools",
    "mcp__probe",
    "--permission-mode",
    "dontAsk",
    "--max-budget-usd",
    "0.2",
    prompt,
  ]);
}
console.log(`${agent} (shape ${mode}):\n${out.trim()}`);
server.close();
