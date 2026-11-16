/**
 * Live check of the ported tools (inbox, pages, transcripts, documents) with
 * a real agent, before the files and documents domains exist: the real MCP
 * router over the in-memory fakes, with the spike's two test pages (a typed
 * slide and handwriting) waiting in the inbox.
 *
 * Usage (from apps/server):
 *   npx tsx scripts/mcp-live-check.ports.ts [claude|codex]
 * Env: PORT (default 8791), CLAUDE_MODEL (default haiku), BUDGET_USD (default 1).
 */
import { spawn } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { loadConfig } from "../src/config.js";
import { createTestDatabase } from "../src/db/client.js";
import { createApiKey } from "../src/domains/accounts/keys.js";
import { PasswordHasher } from "../src/domains/accounts/passwords.js";
import { insertUser } from "../src/domains/accounts/users.js";
import type { AppEnv } from "../src/http/auth-context.js";
import { handleError } from "../src/http/errors.js";
import { sqliteAudit } from "../src/mcp/audit.js";
import { fakeDocuments, fakeFiles } from "../src/mcp/fakes.js";
import { mcpRoutes } from "../src/mcp/index.js";

const agent = process.argv[2] ?? "claude";
const port = Number(process.env.PORT ?? 8791);
const base = `http://127.0.0.1:${port}`;
const images = new URL("../../../spikes/s1-mcp-key-auth/images/", import.meta.url);
const work = mkdtempSync(join(tmpdir(), "notes-mcp-ports."));

const db = createTestDatabase();
const now = Date.now;
const user = insertUser(
  db,
  { username: "hannah", displayName: "Hannah", passwordHash: "unused" },
  now(),
);
const key = createApiKey(db, user.id, { name: "live check", scope: "write" }, now());
const files = fakeFiles();
const documents = fakeDocuments();
const slide = files.addFile(user.id, "lecture-07-slides.pdf", 1, {
  nativeText: "Beta-Blocker Dosing Review\nVeloprol Zantrexal Corbimide",
});
const notes = files.addFile(user.id, "lecture-07-notes.png", 1);
files.setImage(slide.pageIds[0] as string, readFileSync(new URL("slide.png", images)), 1568, 882);
files.setImage(
  notes.pageIds[0] as string,
  readFileSync(new URL("handwritten.png", images)),
  1400,
  900,
);

const deps = {
  config: loadConfig({ NODE_ENV: "test" }),
  db,
  now,
  hasher: new PasswordHasher(),
};
const app = new Hono<AppEnv>();
app.onError(handleError);
app.route("/", mcpRoutes(deps, { files: files.port, documents: documents.port }));
const server = serve({ fetch: app.fetch, port, hostname: "127.0.0.1" });

const prompt =
  process.env.PROMPT ??
  "You have been connected to an app you have never seen. Find out what it is and what is waiting for you, then process its inbox completely: transcribe every page, put the files under lecture 7 'Beta blockers' of the course 'Pharmacology II' in term 'Fall 2026' (create what is missing), and write that lecture's note with a few cited blocks. Then it turns out the handwritten notes belong to lecture 8 'Antiarrhythmics': move that file there. Report what you did and every error the app gave you.";

const env = { ...process.env, NOTES_MCP_KEY: key.secret };

/** Run an agent CLI without blocking this process, which also serves /mcp. */
function run(cmd: string, args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { env, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    child.stdout.on("data", (d) => {
      stdout += d;
    });
    child.on("error", reject);
    child.on("close", () => resolve(stdout));
  });
}

let out: string;
if (agent === "codex") {
  out = await run("codex", [
    "exec",
    "--ignore-user-config",
    "--ephemeral",
    "--skip-git-repo-check",
    "--json",
    "-s",
    "read-only",
    "-C",
    work,
    "-c",
    `mcp_servers.notes.url="${base}/mcp"`,
    "-c",
    'mcp_servers.notes.bearer_token_env_var="NOTES_MCP_KEY"',
    "-c",
    'mcp_servers.notes.default_tools_approval_mode="approve"',
    prompt,
  ]);
} else {
  const config = join(work, "notes-mcp.json");
  writeFileSync(
    config,
    JSON.stringify({
      mcpServers: {
        notes: {
          type: "http",
          url: `${base}/mcp`,
          // Claude Code expands ${NOTES_MCP_KEY} from the environment; the key stays out of the file.
          // biome-ignore lint/suspicious/noTemplateCurlyInString: literal placeholder for Claude Code
          headers: { Authorization: "Bearer ${NOTES_MCP_KEY}" },
        },
      },
    }),
  );
  out = await run("claude", [
    "-p",
    "--model",
    process.env.CLAUDE_MODEL ?? "haiku",
    "--strict-mcp-config",
    "--mcp-config",
    config,
    "--allowedTools",
    "mcp__notes",
    "--permission-mode",
    "dontAsk",
    "--output-format",
    "stream-json",
    "--verbose",
    "--max-budget-usd",
    process.env.BUDGET_USD ?? "1",
    prompt,
  ]);
}
writeFileSync(join(work, `${agent}.jsonl`), out);

const clip = (s: string, n: number) => s.replace(/\s+/g, " ").slice(0, n);
for (const line of out.split("\n")) {
  let e: Record<string, unknown>;
  try {
    e = JSON.parse(line);
  } catch {
    continue;
  }
  const content = (e.message as { content?: unknown } | undefined)?.content;
  for (const p of Array.isArray(content) ? content : []) {
    if (p.type === "tool_use") console.log(`CALL ${p.name} ${clip(JSON.stringify(p.input), 400)}`);
    if (p.type === "tool_result") {
      const text = Array.isArray(p.content)
        ? p.content.map((c: { type: string; text?: string }) => c.text ?? `[${c.type}]`).join(" ")
        : String(p.content);
      console.log(`  ${p.is_error ? "ERROR" : "ok"}: ${clip(text, 400)}`);
    }
  }
  if (e.type === "result")
    console.log(`RESULT turns=${e.num_turns} cost=$${e.total_cost_usd}\n${e.result}`);
  const item = e.item as Record<string, unknown> | undefined;
  if (e.type === "item.completed" && item?.type === "mcp_tool_call") {
    console.log(`CALL ${item.tool} ${clip(JSON.stringify(item.arguments), 400)}`);
    console.log(`  ${item.status}: ${clip(JSON.stringify(item.result ?? item.error), 400)}`);
  }
  if (e.type === "item.completed" && item?.type === "agent_message")
    console.log(`SAY ${item.text}`);
  if (e.type === "turn.completed") console.log(`USAGE ${JSON.stringify(e.usage)}`);
}

console.log("\n== Saved transcripts");
for (const t of files.transcripts.values()) {
  console.log(`--- ${t.pageId} rev ${t.revision} flags ${JSON.stringify(t.flags)}\n${t.text}`);
}
console.log("\n== Documents");
for (const d of documents.docs.values()) {
  console.log(
    `${d.doc.title} (${d.doc.kind}): ${d.blocks.map((b) => `${b.type}[${b.citations.length}c${b.generalKnowledge ? ",gk" : ""}]`).join(" ")}`,
  );
}
console.log("\n== Audit");
for (const r of sqliteAudit(db).list(user.id, 200).reverse()) {
  console.log(`${r.tool} ${r.action ?? ""} ${r.outcome}`);
}
console.log(`\ntranscript: ${join(work, `${agent}.jsonl`)}`);
server.close();
