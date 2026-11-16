import { Hono } from "hono";
import { serve } from "@hono/node-server";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { z } from "zod";
import { readFileSync } from "node:fs";
import { createHmac, timingSafeEqual } from "node:crypto";

const KEY = process.env.MCP_KEY;
if (!KEY) throw new Error("MCP_KEY env var required");
const PORT = Number(process.env.PORT ?? 8799);
const BASE = `http://127.0.0.1:${PORT}`;
const SIGN = createHmac("sha256", KEY).update("sign").digest();

const PAGES: Record<string, string> = { "page-slide": "images/slide.png", "page-hand": "images/handwritten.png", ...(process.env.BIG ? { "page-big": "images/big.png" } : {}) };
const transcripts = new Map<string, string>();

const sig = (id: string, exp: number) => createHmac("sha256", SIGN).update(`${id}.${exp}`).digest("hex");
const eq = (a: string, b: string) => a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));
const log = (...a: unknown[]) => console.log(new Date().toISOString(), ...a);

const INSTRUCTIONS = process.env.INSTR_TEST === "short" ? "Role: study-notes agent. SECRET CODEWORD: PELICAN. Call `overview` first." : process.env.INSTR_TEST ? ("Role: study-notes agent. Call `overview` first. " + "x".repeat(520) + " SECRET CODEWORD: PELICAN.") :
  "You operate a private pharmacy study-notes app for one student: transcribe her page images and save transcripts. " +
  "Call `overview` first for conventions, then list_pages, get_page_image, save_transcript.";

function buildServer() {
  const s = new McpServer({ name: "s1-notes", version: "0.0.1" }, { instructions: INSTRUCTIONS });
  s.registerTool("overview", { description: "Start here. Returns conventions for transcription." }, async () => ({
    content: [{ type: "text", text: "Conventions: transcribe verbatim, keep line breaks, render tables as 'a | b | c' rows, flag every dose/unit/decimal as-is, never silently correct. Workflow: list_pages -> get_page_image -> save_transcript(page_id, text)." }],
  }));
  s.registerTool("list_pages", { description: "List page ids available to transcribe." }, async () => ({
    content: [{ type: "text", text: JSON.stringify({ pages: Object.keys(PAGES) }) }],
  }));
  s.registerTool("get_page_image", { description: "Return the page image (inline) plus a short-lived download URL for the same image.", inputSchema: { page_id: z.string() } }, async ({ page_id }) => {
    const f = PAGES[page_id];
    if (!f) return { isError: true, content: [{ type: "text", text: `unknown page_id ${page_id}; call list_pages` }] };
    const buf = readFileSync(f);
    const exp = Math.floor(Date.now() / 1000) + 300;
    const url = `${BASE}/files/${page_id}.png?exp=${exp}&sig=${sig(page_id, exp)}`;
    log("get_page_image", page_id, "bytes", buf.length, "b64", Math.ceil(buf.length / 3) * 4);
    return { content: [
      { type: "image", data: buf.toString("base64"), mimeType: "image/png" },
      { type: "text", text: `Same image as a download (valid 5 min, signed, no auth header needed): ${url}` },
    ] };
  });
  s.registerTool("save_transcript", { description: "Save the transcript text for a page.", inputSchema: { page_id: z.string(), text: z.string() } }, async ({ page_id, text }) => {
    transcripts.set(page_id, text); log("save_transcript", page_id, text.length);
    return { content: [{ type: "text", text: "ok" }] };
  });
  s.registerTool("get_transcript", { description: "Get the saved transcript for a page.", inputSchema: { page_id: z.string() } }, async ({ page_id }) => ({
    content: [{ type: "text", text: transcripts.get(page_id) ?? "(none)" }],
  }));
  return s;
}

const app = new Hono();
app.get("/files/:name", (c) => {
  const id = c.req.param("name").replace(/\.png$/, "");
  const exp = Number(c.req.query("exp")); const sg = c.req.query("sig") ?? "";
  if (!PAGES[id] || !(exp > Date.now() / 1000) || !eq(sg, sig(id, exp))) return c.text("forbidden", 403);
  return new Response(readFileSync(PAGES[id]), { headers: { "content-type": "image/png" } });
});
app.get("/debug/transcripts", (c) => (eq((c.req.header("authorization") ?? ""), `Bearer ${KEY}`) ? c.json(Object.fromEntries(transcripts)) : c.text("unauthorized", 401)));
app.all("/mcp", async (c) => {
  const auth = c.req.header("authorization") ?? "";
  if (!eq(auth, `Bearer ${KEY}`)) { log("401", c.req.method); return c.text("unauthorized", 401, { "WWW-Authenticate": 'Bearer realm="notes"' }); }
  const server = buildServer();
  const transport = new WebStandardStreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
  await server.connect(transport);
  const t0 = Date.now();
  const res = await transport.handleRequest(c.req.raw);
  log(c.req.method, "/mcp", res.status, `${Date.now() - t0}ms`);
  return res;
});
serve({ fetch: app.fetch, port: PORT, hostname: "127.0.0.1" }, () => log("listening", BASE));
