// `pnpm local:seed:pharm`: the pharmacy demo set. Uploads the files in fixtures/demo/files through the
// real API and leaves the account looking like a student's several weeks into a term: two courses,
// lectures with their slides and notes, a transcript for every page, a cited study guide per lecture,
// practice questions with some history, concepts and relations, exams, requests and arranged canvases,
// the notes she wrote herself (pharm/own-notes.mjs, also `pnpm local:seed:pharm:notes`), and last her saved
// references (pharm/references.mjs, also `pnpm local:seed:pharm:references`).
//
// Like `pnpm local:seed`, it signs in as the user for what she does (library, uploads, exams, requests,
// practice, reviews, pins) and uses an app-issued key for what an agent writes (transcripts, filing,
// guides, questions, concepts, canvases, request replies). It refuses to touch an account whose library
// is not empty. Needs the server and the converter: start `pnpm local` first, or point NOTES_SERVER_URL
// and NOTES_APP_ORIGIN at another instance. All content is original sample material.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { appOrigin, root, serverUrl } from "./env.mjs";
import { conceptSet } from "./pharm/concepts.mjs";
import { adrenergicGuide, betaGuide } from "./pharm/guides-adrenergic.mjs";
import { autonomicGuide, cholinergicGuide } from "./pharm/guides-autonomic.mjs";
import { heartFailureGuide, hypertensionGuide } from "./pharm/guides-therapy.mjs";
import { buildOwnNotes, writeOwnNotes } from "./pharm/own-notes.mjs";
import { questions as questionSet } from "./pharm/questions.mjs";
import { writeAttributedBlocks, writeReferences } from "./pharm/references.mjs";
import { apiError, createSession, loadCredentials, signIn } from "./pharm/session.mjs";
import { loadManifest, sourceHelpers } from "./pharm/sources.mjs";

const started = Date.now();
const elapsed = () => `${((Date.now() - started) / 1000).toFixed(1)}s`;
const say = (line) => console.log(`[${elapsed()}] ${line}`);

const credentials = loadCredentials();

// ---- HTTP: her browser session, and an agent's key ----------------------------------------------------
const { call, list } = createSession();

let agentKey = "";
async function agent(method, path, body) {
  const response = await fetch(`${serverUrl}/api${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${agentKey}`,
      "X-Agent-Label": "Study agent",
      ...(body ? { "Content-Type": "application/json" } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (response.status === 204) return undefined;
  const json = await response.json().catch(() => ({}));
  if (!response.ok) throw apiError(`agent ${method}`, path, response.status, json);
  return json;
}

const pause = (ms) => new Promise((r) => setTimeout(r, ms));

// ---- preflight -----------------------------------------------------------------------------------------
await signIn(call, credentials);
const already = [
  ["library items", (await list("/nodes?limit=1")).length],
  ["files", (await list("/files?limit=1")).length],
  ["concepts", (await list("/concepts?limit=1")).length],
  ["practice questions", (await list("/practice/questions?limit=1")).length],
];
const busy = already.filter(([, n]) => n > 0).map(([what]) => what);
if (busy.length) {
  console.error(
    `This account already has ${busy.join(", ")}; the pharmacy demo set only goes into an empty account.\n` +
      "Nothing was changed. (`pnpm local:reset` starts a local instance over.)",
  );
  process.exit(1);
}

const manifest = loadManifest();
const byKey = Object.fromEntries(manifest.files.map((f) => [f.key, f]));

// ---- the library ---------------------------------------------------------------------------------------
say("Building the library");
const make = async (parentId, kind, name, extra = {}) =>
  (await call("POST", "/nodes", { parentId, kind, name, ...extra })).node;
const sectionsOf = async (courseId) =>
  Object.fromEntries(
    (await list(`/nodes?parentId=${courseId}&limit=50`)).map((s) => [s.section, s]),
  );

const fall = await make(null, "term", "Fall 2026");
await make(null, "term", "Spring 2027");
const pharm = await make(fall.id, "course", "Pharmacology II", { course: { code: "PHAR 7340" } });
const therapy = await make(fall.id, "course", "Pharmacotherapy I", {
  course: { code: "PHAR 7310" },
});
const pS = await sectionsOf(pharm.id);
const tS = await sectionsOf(therapy.id);
const lecture = (parentId, number, name, date) =>
  make(parentId, "lecture", name, { lecture: { number, date } });
const lectures = {
  ans: await lecture(pS.lectures.id, 7, "Autonomic nervous system overview", "2026-10-13"),
  chol: await lecture(pS.lectures.id, 8, "Cholinergic agonists and antagonists", "2026-10-20"),
  adr: await lecture(pS.lectures.id, 9, "Adrenergic agonists", "2026-10-27"),
  beta: await lecture(pS.lectures.id, 10, "Beta blockers", "2026-11-03"),
  htn: await lecture(tS.lectures.id, 8, "Hypertension", "2026-10-22"),
  hf: await lecture(tS.lectures.id, 9, "Heart failure (HFrEF)", "2026-11-05"),
};
const calcFolder = await make(tS.practice.id, "folder", "Calculations");
const examFolder = await make(pS.study_guides.id, "folder", "Exam 3 review");
await call("PATCH", `/nodes/${pharm.id}`, { favourite: true });
await call("PATCH", `/nodes/${lectures.beta.id}`, { favourite: true });

const { secret } = await call("POST", "/keys", { name: "Study agent", scope: "write" });
agentKey = secret;

// ---- uploads ---------------------------------------------------------------------------------------------
say("Uploading the demo files");
const TYPES = { pdf: "application/pdf", jpg: "image/jpeg", pptx: "application/octet-stream" };
const uploads = {};
async function upload(key, nodeId) {
  const entry = byKey[key];
  const form = new FormData();
  const ext = entry.file.split(".").pop();
  const bytes = readFileSync(join(root, "fixtures", "demo", "files", entry.file));
  form.append("file", new Blob([bytes], { type: TYPES[ext] }), entry.name);
  if (nodeId) form.append("nodeId", nodeId);
  const { file } = await call("POST", "/uploads", undefined, form);
  uploads[key] = file;
  console.log(`  ${entry.name} -> ${nodeId ? "a lecture or course" : "the inbox"}`);
}
for (const key of ["ans", "chol", "adr", "beta", "htn", "hf"]) await upload(key, lectures[key].id);
for (const key of ["calc", "top", "hand", "board", "card"]) await upload(key, null);

say("Waiting for the converter (needs Docker)");
const waitSeconds = Number(process.env.NOTES_SEED_WAIT ?? 300);
const until = Date.now() + waitSeconds * 1000;
const pending = new Set(Object.keys(uploads));
while (pending.size && Date.now() < until) {
  for (const key of [...pending]) {
    const { file } = await call("GET", `/files/${uploads[key].id}`);
    if (file.status === "failed") {
      console.error(
        `The converter could not read ${byKey[key].name}: ${file.errorMessage ?? file.errorCode}`,
      );
      process.exit(1);
    }
    if (file.status !== "converting" && file.status !== "uploaded") pending.delete(key);
  }
  if (pending.size) await pause(1500);
}
if (pending.size) {
  console.error(
    `Not converted within ${waitSeconds}s: ${[...pending].map((k) => byKey[k].name).join(", ")}.\n` +
      "Is the converter running (Docker)? Raise NOTES_SEED_WAIT for a slow machine. The files are uploaded;\n" +
      "reset the account before running the seeder again.",
  );
  process.exit(1);
}

// ---- transcripts and filing (the agent) -----------------------------------------------------------------
say("Transcribing every page");
const pages = {};
for (const [key, file] of Object.entries(uploads)) {
  const { items } = await agent("GET", `/files/${file.id}/pages`);
  const expected = byKey[key].pages;
  if (items.length !== expected.length) {
    throw new Error(
      `${byKey[key].name}: the converter made ${items.length} pages, the manifest has ${expected.length}`,
    );
  }
  pages[key] = items;
  await agent("POST", `/files/${file.id}/claim`, {});
  for (const [i, page] of items.entries()) {
    await agent("PUT", `/pages/${page.id}/transcript`, {
      text: expected[i].text,
      flags: expected[i].flags,
    });
  }
  await agent("POST", `/files/${file.id}/release`, {});
}
const pageCount = Object.values(pages).reduce((n, p) => n + p.length, 0);
console.log(`  ${pageCount} pages transcribed`);
await agent("POST", `/files/${uploads.calc.id}/file`, { nodeId: tS.sources.id });
await agent("POST", `/files/${uploads.top.id}/file`, { nodeId: pS.sources.id });
await agent("POST", `/files/${uploads.hand.id}/file`, { nodeId: lectures.beta.id });
console.log(
  "  filed the handout, the top drugs sheet and the handwritten notes; two photos stay in the inbox",
);

// ---- what the content modules get: citations checked against the transcripts ----------------------------
const ctx = {
  ...sourceHelpers({ byKey, uploads, pages }),
  concept(type, name) {
    const id = conceptIds.get(`${type}:${name}`);
    if (!id) throw new Error(`No concept ${type} ${name}`);
    return id;
  },
  q(key) {
    const id = questionIds.get(key);
    if (!id) throw new Error(`No question ${key}`);
    return id;
  },
};

// ---- concepts ----------------------------------------------------------------------------------------------
say("Recording concepts and relations");
const conceptIds = new Map();
const { concepts, relations } = conceptSet(ctx);
const bulk = await agent("POST", "/concepts/bulk", { concepts, relations });
if (!bulk.applied) {
  throw new Error(
    `The concept map was refused:\n${JSON.stringify(bulk.problems, null, 1).slice(0, 3000)}`,
  );
}
for (const item of bulk.concepts) {
  const input = concepts[item.index];
  if (item.id) conceptIds.set(`${input.type}:${input.name}`, item.id);
}
console.log(`  ${concepts.length} concepts, ${relations.length} relations`);

// ---- practice questions ----------------------------------------------------------------------------------
say("Writing practice questions");
const questionIds = new Map();
const allQuestions = questionSet(ctx);
const homes = {
  ...Object.fromEntries(Object.entries(lectures).map(([k, n]) => [k, n.id])),
  calc: calcFolder.id,
  top: pS.practice.id,
};
const questionMeta = new Map();
// Link each question to the drugs and classes it names, as an agent tags what it writes.
const linkable = concepts
  .filter((x) => x.type === "drug" || x.type === "drug_class")
  .map((x) => ({ id: conceptIds.get(`${x.type}:${x.name}`), word: x.name.toLowerCase() }))
  .sort((a, b) => b.word.length - a.word.length);
for (const item of allQuestions) {
  const text = JSON.stringify(item.q).toLowerCase();
  const ids = [];
  for (const { id, word } of linkable) {
    const escaped = word.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&");
    if (new RegExp(`(^|[^a-z])${escaped}([^a-z]|$)`).test(text) && !ids.includes(id)) ids.push(id);
  }
  if (ids.length) item.q.conceptIds = ids.slice(0, 8);
}
for (const home of Object.keys(homes)) {
  const group = allQuestions.filter((x) => x.home === home);
  if (!group.length) continue;
  const result = await agent("POST", "/practice/questions", {
    nodeIds: [homes[home]],
    questions: group.map((x) => x.q),
  });
  result.created.forEach((summary, i) => {
    const item = group[i];
    if (item.key) questionIds.set(item.key, summary.id);
    questionMeta.set(summary.id, item);
  });
}
const byType = {};
for (const x of allQuestions) byType[x.q.type] = (byType[x.q.type] ?? 0) + 1;
console.log(
  `  ${allQuestions.length} questions: ${Object.entries(byType)
    .map(([t, n]) => `${n} ${t}`)
    .join(", ")}`,
);

// Her own notes are built here, so a quote missing from a transcript stops the run before the guides.
const ownBuilt = buildOwnNotes(ctx);

// ---- study guides --------------------------------------------------------------------------------------------
say("Writing a study guide for each lecture");
const guideSpecs = [
  ["ans", "Autonomic nervous system overview", autonomicGuide],
  ["chol", "Cholinergic agonists and antagonists", cholinergicGuide],
  ["adr", "Adrenergic agonists", adrenergicGuide],
  ["beta", "Beta blockers", betaGuide],
  ["htn", "Hypertension", hypertensionGuide],
  ["hf", "Heart failure (HFrEF)", heartFailureGuide],
];
const guides = {};
let blockTotal = 0;
for (const [key, title, build] of guideSpecs) {
  const blocks = build(ctx);
  const result = await agent("POST", "/documents", {
    nodeId: lectures[key].id,
    kind: "lecture_note",
    title,
    blocks,
  });
  guides[key] = { id: result.documentId, blocks, blockIds: result.blockIds };
  blockTotal += blocks.length;
  console.log(`  ${title}: ${blocks.length} blocks`);
}
/** The ID of the n-th block of a type (0-based) in a guide. */
function blockOf(key, type, n = 0) {
  const g = guides[key];
  const indexes = g.blocks.flatMap((b, i) => (b.type === type ? [i] : []));
  if (indexes[n] === undefined) throw new Error(`${key} has no ${type} number ${n}`);
  return g.blockIds[indexes[n]];
}

// ---- canvases --------------------------------------------------------------------------------------------------
say("Arranging two canvases");
const blockCard = (ref, key, type, n, extra = {}) => ({
  ref,
  content: { kind: "block", blockIds: [blockOf(key, type, n)] },
  ...extra,
});
const conceptCard = (ref, type, name, extra = {}) => ({
  ref,
  content: { kind: "concept", conceptId: ctx.concept(type, name), label: name },
  ...extra,
});
const betaCanvas = await agent("PUT", `/documents/${guides.beta.id}/canvas/structure`, {
  documentId: guides.beta.id,
  cards: [
    blockCard("mechanism", "beta", "paragraph", 0),
    blockCard("net", "beta", "callout", 0),
    blockCard("classes", "beta", "table", 0, { size: "wide" }),
    blockCard("rule", "beta", "mnemonic", 0),
    blockCard("metoprolol", "beta", "drug_card", 0),
    blockCard("carvedilol", "beta", "drug_card", 1),
    blockCard("hfref", "beta", "callout", 2),
    blockCard("adverse", "beta", "bulleted_list", 2),
    blockCard("contra", "beta", "callout", 3),
    blockCard("interactions", "beta", "table", 1),
    conceptCard("brady", "adverse_effect", "bradycardia", { color: "red" }),
    conceptCard("hypo", "adverse_effect", "masked hypoglycaemia", { color: "orange" }),
    {
      ref: "stems",
      content: {
        kind: "note",
        text: "-olol: beta blocker. -alol or -ilol (labetalol, carvedilol): blocks alpha-1 too.",
      },
      color: "yellow",
      title: "Name stems",
    },
    { ref: "careful", content: { kind: "sticker", sticker: "warning" } },
  ],
  connectors: [
    { from: "mechanism", to: "net", label: "adds up to", kind: "leads_to" },
    { from: "classes", to: "metoprolol", label: "cardioselective", kind: "part_of" },
    { from: "classes", to: "carvedilol", label: "alpha-1 and beta", kind: "part_of" },
    { from: "metoprolol", to: "hfref", label: "succinate only", kind: "treats" },
    { from: "carvedilol", to: "hfref", label: "proven", kind: "treats" },
    { from: "adverse", to: "brady", label: "most common", kind: "causes" },
    { from: "adverse", to: "hypo", label: "insulin users", kind: "causes" },
    { from: "contra", to: "adverse", label: "why", kind: "related" },
    {
      from: "interactions",
      to: "brady",
      label: "verapamil, diltiazem",
      kind: "causes",
      line: "dashed",
    },
    { from: "rule", to: "stems", label: "same idea", kind: "related", direction: "none" },
  ],
  frames: [
    { ref: "how", title: "How they work", color: "blue", members: ["mechanism", "net"] },
    {
      ref: "which",
      title: "Which one",
      color: "purple",
      members: ["classes", "rule", "stems", "metoprolol", "carvedilol", "hfref"],
    },
    {
      ref: "safety",
      title: "Safety",
      color: "red",
      members: ["adverse", "contra", "interactions", "brady", "hypo", "careful"],
    },
  ],
});
const htnCanvas = await agent("PUT", `/documents/${guides.htn.id}/canvas/structure`, {
  documentId: guides.htn.id,
  cards: [
    blockCard("categories", "htn", "table", 0, { size: "wide" }),
    blockCard("higher", "htn", "callout", 0),
    blockCard("start", "htn", "table", 1),
    blockCard("goal", "htn", "callout", 2),
    blockCard("firstline", "htn", "bulleted_list", 0),
    blockCard("acd", "htn", "mnemonic", 0),
    blockCard("compelling", "htn", "table", 2),
    blockCard("lisinopril", "htn", "drug_card", 0),
    blockCard("chlorthalidone", "htn", "drug_card", 1),
    blockCard("monitor", "htn", "comparison_table", 1),
    blockCard("followup", "htn", "numbered_list", 1),
    conceptCard("cough", "adverse_effect", "dry cough", { color: "orange" }),
    conceptCard("potassium", "monitoring_parameter", "serum potassium", { color: "teal" }),
    {
      ref: "board",
      content: { kind: "note", text: "Same four classes as the whiteboard photo in my inbox." },
      color: "pink",
    },
  ],
  connectors: [
    { from: "categories", to: "start", label: "stage decides", kind: "leads_to" },
    { from: "higher", to: "categories", label: "tie-break", kind: "related" },
    { from: "start", to: "goal", label: "aim for", kind: "leads_to" },
    { from: "goal", to: "firstline", label: "with", kind: "leads_to" },
    { from: "firstline", to: "compelling", label: "unless", kind: "contrasts" },
    { from: "firstline", to: "lisinopril", label: "example", kind: "part_of" },
    { from: "firstline", to: "chlorthalidone", label: "example", kind: "part_of" },
    { from: "lisinopril", to: "cough", label: "can cause", kind: "causes" },
    { from: "lisinopril", to: "potassium", label: "check", kind: "related" },
    { from: "monitor", to: "followup", label: "then", kind: "leads_to" },
  ],
  frames: [
    { ref: "diagnose", title: "Diagnose", color: "gray", members: ["categories", "higher"] },
    { ref: "decide", title: "Decide", color: "blue", members: ["start", "goal"] },
    {
      ref: "choose",
      title: "Choose",
      color: "green",
      members: ["firstline", "acd", "compelling", "lisinopril", "chlorthalidone", "board"],
    },
    {
      ref: "monitorframe",
      title: "Monitor",
      color: "orange",
      members: ["monitor", "followup", "cough", "potassium"],
    },
  ],
});
// She drags two cards where she wants them: pins.
await call("PUT", `/documents/${guides.beta.id}/canvas/placements`, {
  placements: [
    { id: betaCanvas.report.refs.stems, x: 40, y: -260 },
    { id: betaCanvas.report.refs.careful, x: 1180, y: -240 },
  ],
});
await call("PUT", `/documents/${guides.htn.id}/canvas/placements`, {
  placements: [
    { id: htnCanvas.report.refs.board, x: 980, y: -200 },
    { id: htnCanvas.report.refs.cough, x: 1320, y: 520 },
  ],
});
console.log(
  "  beta blockers and hypertension canvases: frames, labeled connectors, two pinned cards each",
);

// ---- exams ---------------------------------------------------------------------------------------------------
say("Planning exams");
const day = (n) => new Date(Date.now() + n * 86_400_000).toISOString().slice(0, 10);
await call("POST", "/exams", {
  courseId: therapy.id,
  title: "Calculations quiz",
  date: day(4),
  nodeIds: [calcFolder.id],
  notes: "Cockcroft-Gault, infusion rates, mEq. Calculator allowed.",
});
await call("POST", "/exams", {
  courseId: pharm.id,
  title: "Exam 3: autonomic pharmacology",
  date: day(9),
  nodeIds: [lectures.ans.id, lectures.chol.id, lectures.adr.id, lectures.beta.id],
  notes: "Lectures 7 to 10. Receptor tables and toxidromes are always on it.",
});
await call("POST", "/exams", {
  courseId: therapy.id,
  title: "Exam 2: cardiovascular",
  date: day(16),
  nodeIds: [lectures.htn.id, lectures.hf.id],
  notes: "Hypertension and HFrEF, cases.",
});

// ---- requests ----------------------------------------------------------------------------------------------
say("Leaving requests, and answering some as the agent");
const ask = async (target, kind, message) =>
  (await call("POST", "/requests", { target, kind, ...(message ? { message } : {}) })).request;
await ask(
  { type: "block", documentId: guides.hf.id, blockId: blockOf("hf", "drug_card", 2) },
  "unclear",
  "Why does dapagliflozin help in heart failure when the patient does not have diabetes?",
);
await ask(
  { type: "source", fileId: uploads.hand.id, pageId: pages.hand[2].id },
  "other",
  "Can you look at the office-hours question at the bottom of this page and add the answer to the beta blocker guide?",
);
const busyReq = await ask(
  { type: "node", nodeId: lectures.adr.id },
  "make_questions",
  "More questions on the alpha agonists please, especially midodrine and clonidine.",
);
await agent("POST", `/requests/${busyReq.id}/claim`, { ttlSeconds: 86_400 });

const expand = await ask(
  { type: "block", documentId: guides.beta.id, blockId: blockOf("beta", "comparison_table", 0) },
  "expand",
  "Why do the lipophilic ones cause vivid dreams?",
);
await agent("POST", `/requests/${expand.id}/claim`, {});
await agent("POST", `/requests/${expand.id}/complete`, {
  reply:
    "Lipophilic beta blockers such as propranolol cross the blood-brain barrier, so they reach the brain and can disturb sleep and cause vivid dreams. Water-soluble ones such as atenolol and nadolol mostly stay out. The speaker notes on the pharmacokinetics slide say this, and the bullet under the table already covers it.",
  links: [
    {
      type: "source",
      fileId: uploads.beta.id,
      pageId: pages.beta[4].id,
      label: "Pharmacokinetics slide and notes",
    },
    {
      type: "block",
      documentId: guides.beta.id,
      blockId: blockOf("beta", "bulleted_list", 0),
      label: "The bullet under the table",
    },
    { type: "concept", conceptId: ctx.concept("drug", "propranolol"), label: "propranolol" },
  ],
});

const wrong = await ask(
  { type: "question", questionId: ctx.q("chol-atropine-dose") },
  "wrong",
  "Is the atropine dose really 1 mg? I learned 0.5 mg.",
);
await agent("POST", `/requests/${wrong.id}/claim`, {});
await agent("POST", `/requests/${wrong.id}/complete`, {
  reply:
    "The question matches the lecture: 1 mg IV every 3 to 5 minutes, up to 3 mg. The older 0.5 mg dose is what you may have seen in earlier material. I left the question as it is; the dose is flagged on the slide so you can check it against a current reference.",
  links: [
    {
      type: "source",
      fileId: uploads.chol.id,
      pageId: pages.chol[9].id,
      label: "Doses at a glance",
    },
    { type: "question", questionId: ctx.q("chol-atropine-dose"), label: "The question" },
  ],
});

const summary = await ask({ type: "document", documentId: guides.htn.id }, "summarise");
await agent("POST", `/requests/${summary.id}/claim`, {});
await agent("POST", `/requests/${summary.id}/complete`, {
  reply:
    "The quickest summary is already in the guide: the decision map and the compelling indications table, linked below. The whiteboard photo in your inbox shows the same four first-line classes.",
  links: [
    {
      type: "block",
      documentId: guides.htn.id,
      blockId: blockOf("htn", "mind_map", 0),
      label: "Decision map",
    },
    {
      type: "block",
      documentId: guides.htn.id,
      blockId: blockOf("htn", "table", 2),
      label: "Compelling indications",
    },
    { type: "source", fileId: uploads.board.id, label: "Whiteboard photo" },
  ],
});

const tooBig = await ask(
  { type: "library" },
  "other",
  "Could you make flashcards for every drug on the full top drugs list?",
);
await agent("POST", `/requests/${tooBig.id}/decline`, {
  reason:
    "Only the drugs on your brand and generic sheet are in your library so far, and they already have cards in the brand and generic drill. Upload the full list and ask again, and I will make the cards from it.",
});
console.log("  two waiting, one in progress, three answered with links, one declined");

// ---- practice history: her sessions -------------------------------------------------------------------------
say("Practicing (her answers, some wrong, some skipped)");
const detailCache = new Map();
async function stored(questionId) {
  if (!detailCache.has(questionId)) {
    const { question } = await call("GET", `/practice/questions/${questionId}`);
    detailCache.set(questionId, question.question ?? question);
  }
  return detailCache.get(questionId);
}
const round = (x) => String(Math.round(x * 100) / 100);
function answerPart(q, view, right, solve) {
  switch (q.type) {
    case "multiple_choice": {
      const pick = q.options.find((o) => o.correct === right) ?? q.options[0];
      return { type: q.type, optionId: pick.id };
    }
    case "select_all": {
      const correct = q.options.filter((o) => o.correct).map((o) => o.id);
      return { type: q.type, optionIds: right ? correct : correct.slice(1) };
    }
    case "matching": {
      const matches = q.pairs.map((p) => ({ pairId: p.id, right: p.right }));
      if (!right && matches.length > 1)
        [matches[0].right, matches[1].right] = [matches[1].right, matches[0].right];
      return { type: q.type, matches };
    }
    case "fill_blank":
      return {
        type: q.type,
        blanks: q.blanks.map((b, i) => (right || i > 0 ? b.answers[0] : "not sure")),
      };
    case "calculation": {
      const value = q.answer.kind === "fixed" ? q.answer.value : solve(view.prompt);
      return { type: q.type, response: round(right ? value : value * 10), unit: q.units[0] };
    }
    case "flashcard":
      return { type: q.type, rating: right ? "good" : "again" };
    case "free_response":
      return {
        type: q.type,
        text: right ? q.modelAnswer : "Not sure; I need to review this.",
        covered: right ? q.rubric.map((_, i) => i) : [0],
      };
    default:
      throw new Error(`No answer for ${q.type}`);
  }
}
async function practise(
  label,
  scope,
  length,
  pattern,
  { skip = [], finish = true, stopAfter } = {},
) {
  let { session, next } = await call("POST", "/practice/sessions", { scope, length });
  const skipped = new Set();
  let answered = 0;
  let correct = 0;
  while (next) {
    if (stopAfter !== undefined && answered >= stopAfter) break;
    if (skip.includes(next.position) && !skipped.has(next.position)) {
      skipped.add(next.position);
      await call("POST", `/practice/sessions/${session.id}/skip`, { position: next.position });
      ({ next } = await call("GET", `/practice/sessions/${session.id}/next`));
      if (next && skipped.has(next.position)) break; // only set-aside questions are left
      continue;
    }
    if (skipped.has(next.position)) break;
    const q = await stored(next.questionId);
    const right = pattern[answered % pattern.length] === 1;
    const solve = questionMeta.get(next.questionId)?.solve;
    if (next.selfGraded)
      await call("POST", `/practice/sessions/${session.id}/reveal`, { position: next.position });
    const answer =
      q.type === "case"
        ? {
            type: "case",
            parts: q.questions.map((part, i) =>
              answerPart(part, next.view.parts?.[i] ?? {}, right || i > 0, solve),
            ),
          }
        : answerPart(q, next.view, right, solve);
    const outcome = await call("POST", `/practice/sessions/${session.id}/answer`, {
      position: next.position,
      answer,
      timeTakenMs: 20_000 + ((answered * 7919) % 70_000),
    });
    answered += 1;
    if (outcome.result?.correct) correct += 1;
    next = outcome.next;
    session = outcome.session ?? session;
  }
  if (finish) await call("POST", `/practice/sessions/${session.id}/finish`);
  console.log(
    `  ${label}: ${answered} answered, ${correct} right${skipped.size ? `, ${skipped.size} skipped` : ""}${finish ? "" : ", left open"}`,
  );
  return { answered, correct };
}
// Put a few non-flashcard questions on the review schedule as well.
for (const key of [
  "ans-sweat",
  "beta-hfref",
  "adr-shock",
  "calc-crcl",
  "calc-kcl-mg",
  "adr-epi-volume",
]) {
  await call("POST", `/practice/questions/${ctx.q(key)}/schedule`, { enabled: true });
}
const nodesScope = (...keys) => ({ kind: "nodes", nodeIds: keys.map((k) => homes[k]) });
await practise("Beta blockers", nodesScope("beta"), 10, [1, 1, 0, 1, 1, 1, 0, 1, 1, 1]);
await practise("Autonomic and cholinergic", nodesScope("ans", "chol"), 12, [1, 0, 1, 1, 0, 1, 1], {
  skip: [4, 9],
});
await practise("Cardiovascular therapy", nodesScope("htn", "hf"), 10, [1, 0, 1, 0, 1, 1]);
await practise("Calculations", nodesScope("calc"), 8, [0, 1, 1, 0, 1]);
await practise("Adrenergic agonists", nodesScope("adr"), 8, [1, 1, 0], {
  finish: false,
  stopAfter: 3,
});

// ---- what she has checked herself --------------------------------------------------------------------------
say("Marking some of it reviewed, as she would");
await call("POST", `/documents/${guides.ans.id}/review`, { status: "reviewed" });
await call("POST", `/documents/${guides.htn.id}/review`, {
  status: "reviewed",
  blockIds: guides.htn.blockIds.slice(0, 12),
});
await call("POST", `/documents/${guides.beta.id}/review`, {
  status: "reviewed",
  blockIds: guides.beta.blockIds.slice(0, 6),
});
const firstQuestions = [...questionMeta.keys()].slice(0, 18);
await call("POST", "/practice/questions/review", {
  questionIds: firstQuestions,
  status: "reviewed",
});
for (const [type, name] of [
  ["drug", "metoprolol succinate"],
  ["drug", "carvedilol"],
  ["drug", "lisinopril"],
  ["drug", "atropine"],
  ["drug_class", "beta blockers"],
  ["drug_class", "ACE inhibitors"],
  ["indication", "HFrEF"],
  ["adverse_effect", "bradycardia"],
]) {
  await call("POST", `/concepts/${ctx.concept(type, name)}/review`, { status: "reviewed" });
}
for (const key of ["ans", "hand"]) {
  for (const page of pages[key])
    await call("POST", `/pages/${page.id}/transcript/review`, { reviewed: true });
}

// ---- her own notes: written in her session, so they show as hers -------------------------------------------
say("Writing her own notes (her session)");
const own = await writeOwnNotes({
  call,
  list,
  built: ownBuilt,
  places: {
    beta: lectures.beta.id,
    htn: lectures.htn.id,
    chol: lectures.chol.id,
    cram: examFolder.id,
    calc: tS.study_guides.id,
  },
  betaGuide: guides.beta.id,
});
const ownBlocks = own.written.reduce((n, d) => n + d.blocks, 0);

// ---- her saved references, and three agent blocks checked against them (links only) ---------------------
say("Saving her references and the reference-checked blocks");
const refs = await writeReferences({ call, list, lectures });
const attributed = await writeAttributedBlocks({
  call,
  agent: async () => agent,
  guides: { adr: guides.adr.id, htn: guides.htn.id, hf: guides.hf.id },
  ids: refs.ids,
});

say("Done");
console.log(
  `\nSeeded the pharmacy demo set: ${Object.keys(uploads).length} files (${pageCount} pages), ${guideSpecs.length} guides ` +
    `(${blockTotal} blocks), ${allQuestions.length} questions, ${concepts.length} concepts, ${relations.length} relations, ` +
    `3 exams, 7 requests, 2 arranged canvases, ${own.written.length} documents of her own (${ownBlocks} blocks), ` +
    `${refs.saved.length} saved references with ${attributed} reference-checked blocks ` +
    `and her edits in the beta blocker guide.\nSign in at ${appOrigin} as ${credentials.username}.`,
);
