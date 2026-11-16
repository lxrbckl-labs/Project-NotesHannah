/**
 * Seed the "canvas" scenario of the live check through the HTTP API: term, course and lecture 7;
 * the lecture deck uploaded through the browser route and converted by the REAL converter; a cited
 * study guide written for the lecture by an agent key (the seed key, labelled "Seed agent"); the deck
 * filed under the lecture by her; and three cards on the study map pinned by her session, as if she
 * had dragged them.
 *
 * Usage: npx tsx scripts/mcp-live-check.seed-canvas.ts <base url> <username> <password> <deck> <seed key>
 * Prints the IDs and her pins as JSON.
 */
import { readFileSync } from "node:fs";
import { basename } from "node:path";

const [base, username, password, deck, seedKey] = process.argv.slice(2) as [
  string,
  string,
  string,
  string,
  string,
];
let cookie = "";

async function call(
  method: string,
  path: string,
  body?: unknown,
  extra: { form?: FormData; agent?: boolean } = {},
) {
  const res = await fetch(`${base}${path}`, {
    method,
    headers: {
      origin: base,
      ...(extra.agent
        ? { authorization: `Bearer ${seedKey}`, "x-agent-label": "Seed agent" }
        : cookie
          ? { cookie }
          : {}),
      ...(body !== undefined ? { "content-type": "application/json" } : {}),
    },
    body: extra.form ?? (body === undefined ? undefined : JSON.stringify(body)),
  });
  const set = res.headers.getSetCookie();
  if (set.length) cookie = set.map((c) => c.split(";")[0]).join("; ");
  const json = (await res.json().catch(() => null)) as Record<string, never> | null;
  if (!res.ok) throw new Error(`${method} ${path}: ${res.status} ${JSON.stringify(json)}`);
  // biome-ignore lint/suspicious/noExplicitAny: response bodies are read loosely in this script
  return json as Record<string, any>;
}

await call("POST", "/api/auth/login", { username, password });
const term = (await call("POST", "/api/nodes", { parentId: null, kind: "term", name: "Fall 2026" }))
  .node;
const course = (
  await call("POST", "/api/nodes", {
    parentId: term.id,
    kind: "course",
    name: "Pharmacology II",
    course: { code: "PHAR 7340" },
  })
).node;
const sections = (await call("GET", `/api/nodes?parentId=${course.id}`)).items as Array<{
  id: string;
  section: string;
}>;
const lecture = (
  await call("POST", "/api/nodes", {
    parentId: sections.find((s) => s.section === "lectures")?.id,
    kind: "lecture",
    name: "Beta blockers",
    lecture: { number: 7, date: "2026-10-14" },
  })
).node;

// The deck, converted by the real converter.
const form = new FormData();
form.append("file", new Blob([readFileSync(deck)]), basename(deck));
const fileId = (await call("POST", "/api/uploads", undefined, { form })).file.id as string;
for (let i = 0; ; i++) {
  const f = (await call("GET", `/api/files/${fileId}`)).file;
  if (f.status !== "uploaded" && f.status !== "converting") {
    if (f.status === "failed") throw new Error(`conversion failed: ${f.errorMessage}`);
    break;
  }
  if (i > 240) throw new Error("conversion timed out");
  await new Promise((r) => setTimeout(r, 500));
}
const pages = (await call("GET", `/api/files/${fileId}/pages`)).items as Array<{
  id: string;
  index: number;
  nativeText: string | null;
}>;

// A cited study guide by an agent key: one h2 per slide that has text, with a paragraph quoting it.
const lines = (text: string | null) =>
  (text ?? "")
    .split("\n")
    .map((l) => l.replace(/\s+/g, " ").trim())
    .filter((l) => l.length >= 18);
// biome-ignore lint/suspicious/noExplicitAny: block bodies are plain JSON here
const blocks: any[] = [
  { type: "heading", content: { level: 1, text: "Beta blockers: study guide" } },
];
for (const page of pages.slice(1, 10)) {
  const ls = lines(page.nativeText);
  if (ls.length < 2) continue;
  blocks.push({ type: "heading", content: { level: 2, text: (ls[0] as string).slice(0, 80) } });
  for (const quote of ls.slice(1, 3)) {
    blocks.push({
      type: "paragraph",
      content: { text: quote },
      citations: [{ fileId, pageId: page.id, quote }],
    });
  }
}
const doc = await call(
  "POST",
  "/api/documents",
  { nodeId: lecture.id, kind: "study_guide", title: "Beta blockers: study guide", blocks },
  { agent: true },
);
await call("POST", `/api/files/${fileId}/file`, { nodeId: lecture.id });

// Her three pins: she drags three paragraph cards somewhere on the map.
const canvas = (await call("GET", `/api/documents/${doc.documentId}/canvas`)).canvas as {
  cards: Array<{ id: string; content: { kind: string; blockIds?: string[] } }>;
};
const paragraphIds = new Set(
  (doc.blockIds as string[]).filter((_, i) => blocks[i]?.type === "paragraph"),
);
const pinnable = canvas.cards.filter((c) => c.content.blockIds?.some((id) => paragraphIds.has(id)));
const pins = [pinnable[1], pinnable[4], pinnable[7]].filter(Boolean).map((c, i) => ({
  id: (c as { id: string }).id,
  x: 120 + i * 520,
  y: 1900,
}));
await call("PUT", `/api/documents/${doc.documentId}/canvas/placements`, { placements: pins });
console.log(
  JSON.stringify({
    lectureId: lecture.id,
    documentId: doc.documentId,
    fileId,
    blockCount: (doc.blockIds as string[]).length,
    pins,
  }),
);
