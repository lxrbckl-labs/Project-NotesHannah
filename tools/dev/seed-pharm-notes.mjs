// `pnpm local:seed:pharm:notes`: adds the notes she wrote herself (pharm/own-notes.mjs) to an account
// that already has the pharmacy demo set from an earlier `pnpm local:seed:pharm`. Signs in as she does
// (NOTES_SERVER_URL, NOTES_APP_ORIGIN, NOTES_LOCAL_USER, NOTES_LOCAL_PASSWORD, or the credentials of
// `pnpm local`), finds the lectures, folders, files and questions by name, and writes only her notes.
//
// Safe to run again: a document already there by name under the same parent is skipped, and so is any
// edit to the beta blocker guide she has already made. Everything is looked up and every citation is
// checked against the account's own transcripts before the first write; when the account does not look
// like the pharmacy set it says what is missing and changes nothing.
import { appOrigin } from "./env.mjs";
import {
  buildOwnNotes,
  PLACED_QUESTIONS,
  planGuideEdits,
  writeOwnNotes,
} from "./pharm/own-notes.mjs";
import { createSession, loadCredentials, signIn } from "./pharm/session.mjs";
import { loadManifest, sourceHelpers } from "./pharm/sources.mjs";

const credentials = loadCredentials();
const { call, list } = createSession();
await signIn(call, credentials);

const missing = [];
function refuse() {
  console.error(
    `This account does not look like the pharmacy demo set (\`pnpm local:seed:pharm\`):\n  - ${missing.join("\n  - ")}\n` +
      "Nothing was changed.",
  );
  process.exit(1);
}
const childrenOf = async (parentId) =>
  parentId ? list(`/nodes?parentId=${parentId}&limit=200`) : [];
const named = (nodes, kind, name, where) => {
  const found = nodes.find((n) => n.kind === kind && n.name === name && !n.trashedAt);
  if (!found) missing.push(`no ${kind} "${name}"${where ? ` in ${where}` : ""}`);
  return found;
};

// ---- the library -----------------------------------------------------------------------------------------
console.log("Looking for the pharmacy set");
const term = named(await list("/nodes?limit=200"), "term", "Fall 2026");
if (missing.length) refuse();
const courses = await childrenOf(term?.id);
const pharm = named(courses, "course", "Pharmacology II", "Fall 2026");
const therapy = named(courses, "course", "Pharmacotherapy I", "Fall 2026");
if (missing.length) refuse();
const section = async (course, kind) => {
  const found = (await childrenOf(course.id)).find((n) => n.section === kind);
  if (!found) missing.push(`no ${kind} section in ${course.name}`);
  return found;
};
const pLectures = await section(pharm, "lectures");
const pGuides = await section(pharm, "study_guides");
const tLectures = await section(therapy, "lectures");
const tGuides = await section(therapy, "study_guides");
if (missing.length) refuse();
const pl = await childrenOf(pLectures.id);
const tl = await childrenOf(tLectures.id);
const lectures = {
  beta: named(pl, "lecture", "Beta blockers", "Pharmacology II"),
  chol: named(pl, "lecture", "Cholinergic agonists and antagonists", "Pharmacology II"),
  htn: named(tl, "lecture", "Hypertension", "Pharmacotherapy I"),
};
const examFolder = named(
  await childrenOf(pGuides.id),
  "folder",
  "Exam 3 review",
  "Pharmacology II study guides",
);

// ---- the files, their pages and transcripts ----------------------------------------------------------------
// Citations are checked against the transcripts in this account, not the manifest, so a quote that the
// account's transcript lacks stops the run before anything is written.
const manifest = loadManifest();
const files = await list("/files?limit=200");
const byKey = {};
const uploads = {};
const pages = {};
for (const key of ["ans", "chol", "beta", "htn", "calc", "hand", "board", "card"]) {
  const entry = manifest.files.find((f) => f.key === key);
  const file = files.find((f) => f.originalName === entry.name);
  if (!file) {
    missing.push(`no file "${entry.name}"`);
    continue;
  }
  const items = await list(`/files/${file.id}/pages`);
  if (items.length !== entry.pages.length) {
    missing.push(
      `"${entry.name}" has ${items.length} pages, the demo file has ${entry.pages.length}`,
    );
    continue;
  }
  const texts = [];
  for (const page of items) {
    const { transcript } = await call("GET", `/pages/${page.id}/transcript`).catch(() => ({}));
    texts.push({ text: transcript?.text ?? "" });
  }
  byKey[key] = { ...entry, pages: texts };
  uploads[key] = file;
  pages[key] = items;
}

// ---- the questions she places, and the guide she edits -------------------------------------------------------
const questionIds = new Map();
for (const [key, { lecture, stem }] of Object.entries(PLACED_QUESTIONS)) {
  if (!lectures[lecture]) continue;
  const items = await list(
    `/practice/questions?nodeId=${lectures[lecture].id}&full=true&limit=200`,
  );
  const found = items.find((x) => JSON.stringify(x).includes(stem));
  if (found) questionIds.set(key, found.id);
  else missing.push(`no practice question starting "${stem.slice(0, 50)}…" on ${lecture}`);
}
let betaGuide;
if (lectures.beta) {
  const doc = await call("GET", `/nodes/${lectures.beta.id}/document`).catch(() => null);
  if (!doc) missing.push("the Beta blockers lecture has no study guide");
  else {
    betaGuide = doc.id ?? doc.document?.id;
    const { blocks } = await call("GET", `/documents/${betaGuide}/content?limit=1000`);
    try {
      planGuideEdits(blocks);
    } catch (error) {
      missing.push(error.message);
    }
  }
}
if (missing.length) refuse();

let built;
try {
  built = buildOwnNotes({
    ...sourceHelpers({ byKey, uploads, pages }),
    q: (key) => questionIds.get(key),
  });
} catch (error) {
  missing.push(error.message);
  refuse();
}

// ---- writing --------------------------------------------------------------------------------------------------
console.log("Writing her own notes (her session)");
const report = await writeOwnNotes({
  call,
  list,
  built,
  places: {
    beta: lectures.beta.id,
    htn: lectures.htn.id,
    chol: lectures.chol.id,
    cram: examFolder.id,
    calc: tGuides.id,
  },
  betaGuide,
});
const blocks = report.written.reduce((n, d) => n + d.blocks, 0);
console.log(
  `\nWrote ${report.written.length} documents of hers (${blocks} blocks), skipped ${report.skipped.length} already there; ` +
    `beta blocker guide: ${report.guide.length ? report.guide.join(", ") : "nothing new"}.\n` +
    `Sign in at ${appOrigin} as ${credentials.username}.`,
);
