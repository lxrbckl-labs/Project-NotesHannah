/**
 * Check a live agent run from the database, not from the agent's word:
 * files converted and filed, every page transcribed, the document and its
 * blocks, every agent block's citations quoting text that really is on the
 * cited page, the references list, and the activity log.
 *
 * Usage: DB_PATH=… DATA_DIR=… npx tsx scripts/mcp-live-check.verify.ts <username>
 * Exit code 1 when a check fails.
 */
import { blockCitations, findQuote } from "@notes/schema";
import { loadConfig } from "../src/config.js";
import { openDatabase } from "../src/db/client.js";
import { findUserByUsername } from "../src/domains/accounts/users.js";
import type { AuthContext } from "../src/http/auth-context.js";
import { createServices } from "../src/services.js";

const username = process.argv[2] ?? "hannah";
const config = loadConfig();
const db = openDatabase(config.DB_PATH);
const user = findUserByUsername(db, username);
if (!user) throw new Error(`no user ${username}`);
const services = createServices({ config, db, now: Date.now });
const auth: AuthContext = {
  userId: user.id,
  actor: { type: "user", userId: user.id },
  via: "session",
  scope: "write",
};

let failures = 0;
const check = (ok: boolean, what: string) => {
  console.log(`${ok ? "PASS" : "FAIL"} ${what}`);
  if (!ok) failures++;
};
const norm = (s: string) => s.replace(/\s+/gu, " ").trim();

// ---- files and pages
const files = services.files.listFiles(auth, { limit: 200 }).items;
console.log(`\n== Files (${files.length})`);
const pageText = new Map<string, string[]>();
for (const f of files) {
  const pages = f.pageCount === null ? [] : services.files.listPages(auth, f.id);
  const node = f.nodeId ? services.library.get(user.id, f.nodeId) : null;
  console.log(
    `${f.originalName}: ${f.type}, status ${f.status}, ${pages.length} pages, filed under ${node ? `"${node.path}"` : "nothing"}`,
  );
  check(f.status !== "failed" && f.pageCount !== null, `${f.originalName} converted`);
  check(f.status === "filed", `${f.originalName} filed`);
  for (const p of pages) {
    const t = services.files.getTranscript(auth, p.id);
    check(
      t !== null && t.text.trim().length > 0,
      `${f.originalName} page ${p.index} has a transcript`,
    );
    pageText.set(
      p.id,
      [t?.text, p.nativeText, p.speakerNotes].filter((x): x is string => typeof x === "string"),
    );
    if (t) {
      console.log(
        `  page ${p.index}: ${t.text.length} chars, ${t.flags.length} flags, by ${t.author.type}; native text ${p.nativeText ? `${p.nativeText.length} chars` : "none"}`,
      );
    }
  }
}

// ---- documents
const docIds = (
  db
    .prepare("SELECT id FROM documents WHERE user_id = ? AND trashed_at IS NULL")
    .all(user.id) as Array<{
    id: string;
  }>
).map((r) => r.id);
console.log(`\n== Documents (${docIds.length})`);
check(docIds.length > 0, "a document exists");
for (const id of docIds) {
  const full = services.documents.getFull(auth, id);
  const node = services.library.get(user.id, full.document.nodeId);
  const types = full.blocks.map((b) => b.type);
  console.log(
    `"${full.document.title}" (${full.document.kind}) at "${node.path}": ${types.join(", ")}`,
  );
  check(full.blocks.length > 0, `"${full.document.title}" has blocks`);
  check(types.includes("heading"), "it has a heading");
  check(types.includes("callout"), "it has a callout");
  check(types.includes("table") || types.includes("comparison_table"), "it has a table");
  for (const b of full.blocks) {
    if (b.origin !== "agent") continue;
    const uses = blockCitations(b);
    const exempt = ["heading", "divider", "checklist", "image", "question"].includes(b.type);
    if (!exempt) check(uses.length > 0 || b.generalKnowledge, `${b.type} ${b.id} cites a page`);
    if (b.generalKnowledge) console.log(`  ${b.type} ${b.id} is marked general knowledge`);
    for (const use of uses) {
      const texts = pageText.get(use.citation.pageId) ?? [];
      const found = texts.some((t) => findQuote(norm(t), norm(use.citation.quote)) >= 0);
      check(
        found,
        `  quote in ${b.type} ${b.id} occurs on page ${use.citation.pageId}: "${use.citation.quote.slice(0, 60)}"`,
      );
    }
  }
  const refs = services.documents.references(auth, id);
  console.log(`References (${refs.items.length}):`);
  for (const r of refs.items) {
    console.log(
      `  [${r.number}] ${r.fileName} p.${r.pageIndex} ${r.status} quoteStillPresent=${r.quoteStillPresent}`,
    );
  }
  check(
    refs.items.length > 0 &&
      refs.items.every((r) => r.status === "available" && r.quoteStillPresent !== false),
    "every reference resolves to an available page that still has the quote",
  );
}

// ---- library and activity
console.log("\n== Library");
const walk = (parentId: string | null, depth: number) => {
  for (const n of services.library.list(user.id, { parentId, limit: 200 }).items) {
    console.log(
      `${"  ".repeat(depth)}${n.kind} ${n.name}${n.lecture?.number != null ? ` (#${n.lecture.number})` : ""}`,
    );
    walk(n.id, depth + 1);
  }
};
walk(null, 0);

console.log("\n== Activity log (oldest first)");
const activity = services.activity.list(user.id, { limit: 200 }).items.reverse();
for (const e of activity)
  console.log(`${e.at} [${e.keyLabel ?? "no label"}] ${e.action}: ${e.summary}`);
check(activity.length > 0, "the activity log has the agent's work");

console.log(`\n${failures === 0 ? "ALL CHECKS PASSED" : `${failures} CHECK(S) FAILED`}`);
db.close();
process.exit(failures === 0 ? 0 : 1);
