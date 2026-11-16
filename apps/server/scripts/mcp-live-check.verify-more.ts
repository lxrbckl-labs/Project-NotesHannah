/**
 * Check the "requests" scenario of the live check from the database, not
 * from the agent's word: both of her requests answered, her block changed
 * only through her request, the practice set (counts by type; every question
 * valid and citing text that is really on its page; calculations graded
 * correct by the shared grade function for their own answer), concepts and
 * relations with citations, files processed, and the activity log.
 *
 * Usage: DB_PATH=… DATA_DIR=… npx tsx scripts/mcp-live-check.verify-more.ts <username> '<seed json>'
 */
import { blockCitations, findQuote, practice } from "@notes/schema";
import { loadConfig } from "../src/config.js";
import { openDatabase } from "../src/db/client.js";
import { findUserByUsername } from "../src/domains/accounts/users.js";
import type { AuthContext } from "../src/http/auth-context.js";
import { createServices } from "../src/services.js";

const username = process.argv[2] ?? "hannah";
const seed = JSON.parse(process.argv[3] ?? "{}") as {
  lectureId: string;
  documentId: string;
  herBlock: string;
  blockRequest: string;
  lectureRequest: string;
  files: string[];
};
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
const pageTexts = (pageId: string): string[] => {
  try {
    const page = services.files.getPage(auth, pageId);
    const t = services.files.getTranscript(auth, pageId);
    return [t?.text, page.nativeText, page.speakerNotes].filter(
      (x): x is string => typeof x === "string",
    );
  } catch {
    return [];
  }
};
const quoteOnPage = (pageId: string, quote: string) =>
  pageTexts(pageId).some((t) => findQuote(norm(t), norm(quote)) >= 0);

// ---- requests
console.log("== Requests");
for (const [name, id] of [
  ["block request", seed.blockRequest],
  ["lecture request", seed.lectureRequest],
] as const) {
  const r = services.requests.get(auth, id);
  console.log(
    `${name}: ${r.status}; reply: ${r.reply?.text ?? "(none)"}; links: ${JSON.stringify(r.reply?.links ?? [])}`,
  );
  check(r.status === "done" && (r.reply?.text.length ?? 0) > 0, `${name} completed with a reply`);
}

// ---- her block
console.log("\n== Her block");
const content = services.documents.getFull(auth, seed.documentId);
const block = content.blocks.find((b) => b.id === seed.herBlock);
console.log(`now: ${JSON.stringify(block?.content)} origin=${block?.origin}`);
const touching = services.changes
  .changesSince(user.id, "0", 500)
  .items.filter((c) => c.objectIds.includes(seed.herBlock) && c.actor.type === "agent");
for (const c of touching)
  console.log(`  change ${c.action} by agent, requestId=${c.requestId}: ${c.summary}`);
check(touching.length > 0, "an agent changed her block");
check(
  touching.every((c) => c.requestId === seed.blockRequest),
  "every agent change to her block carried her block request",
);

// ---- files
console.log("\n== Files");
for (const id of seed.files) {
  const f = services.files.getFile(auth, id);
  const pages = f.pageCount === null ? [] : services.files.listPages(auth, id);
  const transcribed = pages.filter((p) => p.transcriptId !== null).length;
  console.log(
    `${f.originalName}: ${f.status}, ${transcribed}/${pages.length} transcribed, node ${f.nodeId}`,
  );
  check(
    f.status === "filed" && transcribed === pages.length && pages.length > 0,
    `${f.originalName} processed and filed`,
  );
}

// ---- practice
console.log("\n== Practice under lecture 7");
const qs = services.practice.listQuestions(auth, { nodeId: seed.lectureId, full: true, limit: 200 })
  .items as Array<{
  id: string;
  type: string;
  question: practice.Question;
  author: { type: string };
}>;
const byType: Record<string, number> = {};
for (const q of qs) byType[q.type] = (byType[q.type] ?? 0) + 1;
console.log(`${qs.length} question(s): ${JSON.stringify(byType)}`);
check(qs.length >= 12, "at least 12 questions");
check((byType.calculation ?? 0) >= 2, "at least two calculations");
check((byType.flashcard ?? 0) >= 4, "at least four flashcards");
for (const q of qs) {
  const valid = practice.Question.safeParse(q.question).success;
  const sources =
    (q.question as { sources?: Array<{ pageId: string; quote: string }> }).sources ?? [];
  const cites = sources.length > 0 && sources.every((s) => quoteOnPage(s.pageId, s.quote));
  check(valid && cites, `${q.type} ${q.id} is valid and every source quote is on its page`);
  if (!cites) console.log(`   sources: ${JSON.stringify(sources).slice(0, 300)}`);
  if (q.type === "calculation") {
    for (const seedNo of [0, 1, 2]) {
      const stated = practice.correctAnswerOf(q.question, seedNo);
      const graded = practice.grade(q.question, stated.data, { variantSeed: seedNo });
      check(
        graded.correct,
        `  calculation ${q.id} (seed ${seedNo}) grades its own answer "${stated.text}" correct`,
      );
    }
  }
}

// ---- concepts
console.log("\n== Concepts");
const conceptIds = (
  db.prepare("SELECT id FROM concepts WHERE user_id = ?").all(user.id) as Array<{ id: string }>
).map((r) => r.id);
const relationsSeen = new Map<
  string,
  { type: string; citations: Array<{ pageId: string; quote: string }>; generalKnowledge: boolean }
>();
let conceptsCited = 0;
for (const id of conceptIds) {
  const page = services.concepts.page(auth, id);
  const c = page.concept;
  const ok = c.citations.every((x) => quoteOnPage(x.pageId, x.quote));
  if (c.citations.length > 0) conceptsCited++;
  console.log(
    `- ${c.type}:${c.name} ${c.citations.length} citation(s)${c.generalKnowledge ? ", general knowledge" : ""}`,
  );
  check(ok, `  ${c.name}: every citation quote is on its page`);
  for (const g of page.groups)
    for (const item of g.items) relationsSeen.set(item.relation.id, item.relation);
}
console.log(
  `${conceptIds.length} concept(s) (${conceptsCited} citing her pages), ${relationsSeen.size} relation(s): ${[...new Set([...relationsSeen.values()].map((r) => r.type))].join(", ")}`,
);
check(conceptIds.length > 0 && relationsSeen.size > 0, "concepts and relations exist");
check(
  [...relationsSeen.values()].every(
    (r) => r.citations.length > 0 && r.citations.every((x) => quoteOnPage(x.pageId, x.quote)),
  ),
  "every relation cites a page with a quote that is on it",
);

// ---- documents written by agents
console.log("\n== Agent blocks in documents");
const docs = db.prepare("SELECT id FROM documents WHERE user_id = ?").all(user.id) as Array<{
  id: string;
}>;
for (const d of docs) {
  const full = services.documents.getFull(auth, d.id);
  for (const b of full.blocks.filter((x) => x.origin === "agent")) {
    for (const use of blockCitations(b)) {
      check(
        quoteOnPage(use.citation.pageId, use.citation.quote),
        `  ${b.type} ${b.id} citation is on its page`,
      );
    }
  }
}

// ---- activity
console.log("\n== Activity log (oldest first)");
for (const e of services.activity.list(user.id, { limit: 200 }).items.reverse()) {
  console.log(`${e.at} [${e.keyLabel ?? "no label"}] ${e.action}: ${e.summary.slice(0, 160)}`);
}
console.log(`\n${failures === 0 ? "ALL CHECKS PASSED" : `${failures} CHECK(S) FAILED`}`);
db.close();
process.exit(failures === 0 ? 0 : 1);
