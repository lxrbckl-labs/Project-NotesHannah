/**
 * Check the "canvas" scenario of the live check from the database, not from the agent's word: the
 * study map of lecture 7 has frames and labelled connectors that reference real cards and real
 * block ids, her three pinned cards are exactly where she put them (and still hers), the agent added
 * a note card, nothing carries invented coordinates, and the activity log reads sensibly.
 *
 * Usage: DB_PATH=… DATA_DIR=… npx tsx scripts/mcp-live-check.verify-canvas.ts <username> '<seed json>'
 */
import { loadConfig } from "../src/config.js";
import { openDatabase } from "../src/db/client.js";
import { findUserByUsername } from "../src/domains/accounts/users.js";
import type { AuthContext } from "../src/http/auth-context.js";
import { createServices } from "../src/services.js";

const username = process.argv[2] ?? "hannah";
const seed = JSON.parse(process.argv[3] ?? "{}") as {
  documentId: string;
  pins: Array<{ id: string; x: number; y: number }>;
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

const { canvas, blocks } = services.canvas.get(auth, seed.documentId);
const blockIds = new Set(blocks.map((b) => b.id));
const cards = new Map(canvas.cards.map((c) => [c.id, c]));
const frameOf = new Map(canvas.frames.flatMap((f) => f.members.map((m) => [m, f.title] as const)));
console.log(
  `revision ${canvas.revision}: ${canvas.cards.length} cards, ${canvas.connectors.length} connectors, ${canvas.frames.length} frames`,
);
for (const f of canvas.frames)
  console.log(`  frame "${f.title}" (${f.origin}): ${f.members.length} cards`);
for (const e of canvas.connectors) {
  console.log(
    `  ${e.origin} connector ${cards.get(e.from)?.content.kind} -[${e.label ?? ""} / ${e.kind}]-> ${cards.get(e.to)?.content.kind}`,
  );
}

console.log("\n== Structure");
const agentFrames = canvas.frames.filter((f) => f.origin === "agent");
check(canvas.frames.length >= 2, "the map has frames (at least two)");
check(
  agentFrames.length >= 2,
  `the agent made frames (${agentFrames.length}), titles: ${agentFrames.map((f) => f.title).join(" | ")}`,
);
const agentEdges = canvas.connectors.filter((e) => e.origin === "agent");
check(agentEdges.length >= 2, `the agent made connectors (${agentEdges.length})`);
check(
  agentEdges.every((e) => (e.label ?? "").trim().length > 0),
  "every connector the agent made has a label",
);
check(
  canvas.connectors.every((e) => cards.has(e.from) && cards.has(e.to)),
  "every connector joins two cards on the map",
);
const blockCards = canvas.cards.filter((c) => c.content.kind === "block");
check(
  blockCards.every(
    (c) => c.content.kind === "block" && c.content.blockIds.every((id) => blockIds.has(id)),
  ),
  "every block card references a real block of the document",
);
check(
  canvas.frames.every((f) => f.members.every((m) => cards.has(m))),
  "every frame member is a card on the map",
);
const topicFrames = new Set(
  agentEdges.flatMap((e) => [frameOf.get(e.from), frameOf.get(e.to)]).filter(Boolean),
);
check(
  agentEdges.some((e) => frameOf.get(e.from) !== frameOf.get(e.to)),
  `some connector relates cards of two different frames (${[...topicFrames].join(", ")})`,
);

console.log("\n== Her pins");
for (const pin of seed.pins) {
  const card = cards.get(pin.id);
  const where = card?.position;
  console.log(
    `  ${pin.id}: wanted (${pin.x}, ${pin.y}), found ${JSON.stringify(where)} origin=${card?.origin}`,
  );
  check(
    card !== undefined && where?.x === pin.x && where?.y === pin.y,
    `her pinned card ${pin.id} is exactly where she put it`,
  );
}
const pinnedNow = canvas.cards
  .filter((c) => c.position !== null)
  .map((c) => c.id)
  .sort();
check(
  JSON.stringify(pinnedNow) === JSON.stringify(seed.pins.map((p) => p.id).sort()),
  "no other card is pinned: the agent invented no coordinates",
);
check(
  canvas.cards.every((c) => c.position !== null || c.dimensions === null),
  "no card carries a size without being placed by her",
);

console.log("\n== The note");
const notes = canvas.cards.filter((c) => c.content.kind === "note");
for (const n of notes) console.log(`  note (${n.origin}): ${JSON.stringify(n.content)}`);
check(
  notes.some((n) => n.origin === "agent"),
  "the agent added a note card",
);

console.log("\n== Activity log");
const log = services.activity
  .list(user.id, { limit: 100 })
  .items.filter((e) => e.keyLabel !== "Seed agent");
for (const e of log.slice(0, 12)) console.log(`  ${e.action} [${e.keyLabel}]: ${e.summary}`);
const arranged = log.filter((e) => e.action === "canvas.arranged" || e.action === "canvas.edited");
check(arranged.length > 0, "the activity log has canvas.arranged or canvas.edited entries");
check(
  arranged.every((e) => /study map/i.test(e.summary) && e.links.some((l) => l.type === "document")),
  "each reads as a sentence about the study map and links to the document",
);

console.log(failures === 0 ? "\nAll checks passed." : `\n${failures} check(s) failed.`);
process.exit(failures === 0 ? 0 : 1);
