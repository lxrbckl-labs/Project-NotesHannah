// `pnpm local:seed:pharm:references`: adds her saved references (pharm/references.mjs) to an account
// that already has the pharmacy demo set from an earlier `pnpm local:seed:pharm`, and three blocks in
// the agent's guides that name an outside reference. Same sign-in as the other seeders
// (NOTES_SERVER_URL, NOTES_APP_ORIGIN, NOTES_LOCAL_USER, NOTES_LOCAL_PASSWORD, or the credentials of
// `pnpm local`).
//
// Safe to run again: a reference already saved at the same address is skipped, and so is a block whose
// text is already in the guide. When the account does not look like the pharmacy set it says what is
// missing and changes nothing. Links only: nothing is fetched from any of the sites.
import { appOrigin, serverUrl } from "./env.mjs";
import { writeAttributedBlocks, writeReferences } from "./pharm/references.mjs";
import { apiError, createSession, loadCredentials, signIn } from "./pharm/session.mjs";

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
const pl = await lecturesOf(pharm);
const tl = await lecturesOf(therapy);
const lectures = {
  adr: named(pl, "lecture", "Adrenergic agonists", "Pharmacology II"),
  beta: named(pl, "lecture", "Beta blockers", "Pharmacology II"),
  htn: named(tl, "lecture", "Hypertension", "Pharmacotherapy I"),
  hf: named(tl, "lecture", "Heart failure (HFrEF)", "Pharmacotherapy I"),
};
const guides = {};
for (const key of ["adr", "htn", "hf"]) {
  if (!lectures[key]) continue;
  const doc = await call("GET", `/nodes/${lectures[key].id}/document`).catch(() => null);
  const id = doc?.document?.id ?? doc?.id;
  if (!id) missing.push(`the ${lectures[key].name} lecture has no study guide`);
  else guides[key] = id;
}
if (missing.length) refuse();

console.log("Saving her references (her session)");
const result = await writeReferences({ call, list, lectures });

// The attributed blocks are the agent's: a key is made only when one is needed.
let key = "";
async function agent() {
  if (!key) {
    key = (await call("POST", "/keys", { name: "Reference demo agent", scope: "write" })).secret;
  }
  return async (method, path, body) => {
    const response = await fetch(`${serverUrl}/api${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${key}`,
        "X-Agent-Label": "Study agent",
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });
    const json = await response.json().catch(() => ({}));
    if (!response.ok) throw apiError(`agent ${method}`, path, response.status, json);
    return json;
  };
}
console.log("Adding reference-checked blocks to the agent's guides");
const added = await writeAttributedBlocks({ call, agent, guides, ids: result.ids });

console.log(
  `\nSaved ${result.saved.length} references (${result.skipped.length} already there); ` +
    `added ${added} reference-checked blocks.\nSign in at ${appOrigin} as ${credentials.username}.`,
);
