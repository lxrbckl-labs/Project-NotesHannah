/**
 * Seed the "requests" scenario of the live check through the HTTP API, as
 * she would in the browser (signed in with her session): term, course and
 * lecture 7, a lecture note with a paragraph she wrote herself (with a wrong
 * dose), the two fixture files uploaded but not processed, and two requests:
 * one on her block ("this is wrong: fix the dose") and one on the lecture
 * ("make me a quiz on beta blockers").
 *
 * Usage: npx tsx scripts/mcp-live-check.seed.ts <base url> <username> <password> <deck> <notes>
 * Prints the IDs as JSON.
 */
import { readFileSync } from "node:fs";
import { basename } from "node:path";

const [base, username, password, deck, notes] = process.argv.slice(2) as [
  string,
  string,
  string,
  string,
  string,
];
let cookie = "";

async function call(method: string, path: string, body?: unknown, form?: FormData) {
  const res = await fetch(`${base}${path}`, {
    method,
    headers: {
      origin: base,
      ...(cookie ? { cookie } : {}),
      ...(body !== undefined ? { "content-type": "application/json" } : {}),
    },
    body: form ?? (body === undefined ? undefined : JSON.stringify(body)),
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
const lectures = sections.find((s) => s.section === "lectures")?.id;
const lecture = (
  await call("POST", "/api/nodes", {
    parentId: lectures,
    kind: "lecture",
    name: "Beta blockers",
    lecture: { number: 7, date: "2026-10-14" },
  })
).node;
// Her own lecture note: a heading and a paragraph in her words, with a wrong dose.
const doc = await call("POST", "/api/documents", {
  nodeId: lecture.id,
  kind: "lecture_note",
  title: "Beta blockers (my notes)",
  blocks: [
    { type: "heading", content: { level: 1, text: "Beta blockers" } },
    {
      type: "paragraph",
      content: { text: "Metoprolol tartrate: usual daily dose 500-2000 mg, twice daily." },
    },
  ],
});
const herBlock = doc.blockIds[1] as string;
// Two files uploaded through the browser route and left in the inbox.
const uploaded: string[] = [];
for (const path of [deck, notes]) {
  const form = new FormData();
  form.append("file", new Blob([readFileSync(path)]), basename(path));
  uploaded.push((await call("POST", "/api/uploads", undefined, form)).file.id);
}
const onBlock = (
  await call("POST", "/api/requests", {
    target: { type: "block", documentId: doc.documentId, blockId: herBlock },
    kind: "wrong",
    message: "this is wrong: fix the dose",
  })
).request;
const onLecture = (
  await call("POST", "/api/requests", {
    target: { type: "node", nodeId: lecture.id },
    kind: "quiz_me",
    message: "make me a quiz on beta blockers",
  })
).request;
console.log(
  JSON.stringify({
    lectureId: lecture.id,
    documentId: doc.documentId,
    herBlock,
    blockRequest: onBlock.id,
    lectureRequest: onLecture.id,
    files: uploaded,
  }),
);
