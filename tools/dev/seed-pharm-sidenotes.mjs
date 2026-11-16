// `pnpm local:seed:pharm:sidenotes`: adds her side notes (private margin notes) to the Beta blockers and
// Hypertension study guides of an account that already has the pharmacy demo set from an earlier
// `pnpm local:seed:pharm`. Same sign-in as the other seeders (NOTES_SERVER_URL, NOTES_APP_ORIGIN,
// NOTES_LOCAL_USER, NOTES_LOCAL_PASSWORD, or the credentials of `pnpm local`). Side notes are hers, so
// they are written through her session only: the server refuses every API key.
//
// Each note is anchored to the block whose text holds a short phrase, so it lands on the right block
// whatever its id. Safe to run again: a note whose text is already on that document is skipped. Every
// block is looked up before the first write; when the account does not look like the pharmacy set (a
// lecture, its guide or an anchor phrase is missing) it says what is missing and changes nothing.
import { appOrigin } from "./env.mjs";
import { createSession, loadCredentials, signIn } from "./pharm/session.mjs";

/**
 * Her notes, in a student's voice. `anchor` is a phrase of the block's text (case ignored); `quote` the
 * words she highlighted, when any; `resolved` ones are closed after they are written.
 */
const NOTES = {
  beta: [
    {
      anchor: "competitive antagonists",
      text: "Why does less renin lower BP even more? Ask in OH.",
      colour: "yellow",
    },
    {
      anchor: "carvedilol and labetalol block alpha-1",
      quote: "labetalol",
      text: "I mix this up with labetalol every time. Carvedilol AND labetalol = the mixed alpha/beta ones.",
      colour: "pink",
    },
    {
      anchor: "cardioselective is not cardiac-only",
      text: "This was on the quiz! Selectivity goes away at high doses.",
      colour: "green",
    },
    {
      anchor: "hypoglycaemia; sweating still happens",
      quote: "sweating still happens",
      text: "Sweating is the one warning sign left. Remember for the diabetes case.",
      colour: "blue",
    },
    {
      anchor: "have survival data in hfref",
      text:
        "Three for HFrEF: bisoprolol, carvedilol, metoprolol SUCCINATE (not tartrate). " +
        "The professor said this comes up every year and people pick tartrate because it is the one they know.\n" +
        "Make a flashcard for it, and check whether the Pharmacotherapy guide has the starting doses for heart failure.",
    },
    {
      anchor: "6.25 mg twice daily with food",
      quote: "with food",
      text: "Dose reminder: carvedilol starts at 6.25 mg twice a day, WITH food.",
      colour: "yellow",
    },
    {
      anchor: "esmolol: minutes-long half-life",
      text: "Why is esmolol only IV? (Got it: the short half-life, it can be switched off.)",
      resolved: true,
    },
  ],
  htn: [
    {
      anchor: "the higher one wins",
      quote: "128/84 is stage 1",
      text: "This was on the quiz: 128/84 is stage 1, not elevated.",
      colour: "green",
      resolved: true,
    },
    {
      anchor: "never ace inhibitor plus arb",
      text: "Question for the professor: is an ACE inhibitor plus aliskiren a never too?",
      colour: "blue",
    },
    {
      anchor: "up to a 30% rise in serum creatinine",
      text: "So when DO we stop? More than 30%? Ask in OH.",
      colour: "yellow",
    },
    {
      anchor: "chlorthalidone preferred",
      quote: "chlorthalidone",
      text: "Why chlorthalidone over HCTZ? Longer acting?",
    },
  ],
};

const credentials = loadCredentials();
const { call, list } = createSession();
await signIn(call, credentials);

const missing = [];
const childrenOf = async (parentId) => list(`/nodes?parentId=${parentId}&limit=200`);
const named = (nodes, kind, name, where) => {
  const found = nodes.find((n) => n.kind === kind && n.name === name && !n.trashedAt);
  if (!found) missing.push(`no ${kind} "${name}"${where ? ` in ${where}` : ""}`);
  return found;
};
function refuse() {
  console.error(
    `This account does not look like the pharmacy demo set (\`pnpm local:seed:pharm\`):\n  - ${missing.join("\n  - ")}\n` +
      "Nothing was changed.",
  );
  process.exit(1);
}

// ---- the two guides: the documents of the Beta blockers and Hypertension lectures -------------------------
console.log("Looking for the pharmacy set");
const term = named(await list("/nodes?limit=200"), "term", "Fall 2026");
if (missing.length) refuse();
const courses = await childrenOf(term.id);
const pharm = named(courses, "course", "Pharmacology II", "Fall 2026");
const therapy = named(courses, "course", "Pharmacotherapy I", "Fall 2026");
if (missing.length) refuse();
const lecturesOf = async (course) => {
  const section = (await childrenOf(course.id)).find((n) => n.section === "lectures");
  if (!section) {
    missing.push(`no Lectures section in ${course.name}`);
    return [];
  }
  return childrenOf(section.id);
};
const lectures = {
  beta: named(await lecturesOf(pharm), "lecture", "Beta blockers", "Pharmacology II"),
  htn: named(await lecturesOf(therapy), "lecture", "Hypertension", "Pharmacotherapy I"),
};
if (missing.length) refuse();

/** Every block of a document, page by page. */
async function blocksOf(documentId) {
  const all = [];
  for (let from = 0; ; ) {
    const page = await call("GET", `/documents/${documentId}/content?from=${from}&limit=200`);
    all.push(...page.blocks);
    from += page.blocks.length;
    if (page.blocks.length === 0 || from >= page.total) return all;
  }
}

// Plan everything before the first write: the guide, the notes already there, the block of each new note.
const plan = [];
let skipped = 0;
for (const key of ["beta", "htn"]) {
  const lecture = lectures[key];
  const doc = await call("GET", `/nodes/${lecture.id}/document`).catch(() => null);
  const documentId = doc?.document?.id;
  if (!documentId) {
    missing.push(`the ${lecture.name} lecture has no study guide`);
    continue;
  }
  const existing = new Set(
    (await list(`/documents/${documentId}/margin-notes`)).map((n) => n.text),
  );
  const blocks = await blocksOf(documentId);
  // The block's content as lower-case text: enough to find a phrase in a paragraph, list, table or card.
  const haystacks = blocks.map((b) => [b.id, JSON.stringify(b.content ?? {}).toLowerCase()]);
  for (const note of NOTES[key]) {
    if (existing.has(note.text)) {
      skipped++;
      continue;
    }
    const hit = haystacks.find(([, text]) => text.includes(note.anchor.toLowerCase()));
    if (!hit) {
      missing.push(`no block with "${note.anchor}" in the ${lecture.name} guide`);
      continue;
    }
    plan.push({ guide: lecture.name, documentId, blockId: hit[0], note });
  }
}
if (missing.length) refuse();

// ---- write them, as she does -------------------------------------------------------------------------------
console.log(`Adding ${plan.length} side notes (her session)`);
let resolved = 0;
for (const { guide, documentId, blockId, note } of plan) {
  const { note: made } = await call("POST", `/documents/${documentId}/margin-notes`, {
    blockId,
    text: note.text,
    ...(note.quote ? { quote: note.quote } : {}),
    ...(note.colour ? { colour: note.colour } : {}),
  });
  if (note.resolved) {
    await call("PATCH", `/documents/${documentId}/margin-notes/${made.id}`, { resolved: true });
    resolved++;
  }
  console.log(`  ${guide}: ${note.text.split("\n")[0].slice(0, 70)}`);
}

console.log(
  `\nAdded ${plan.length} side notes (${resolved} resolved; ${skipped} already there).\n` +
    `Sign in at ${appOrigin} as ${credentials.username}.`,
);
