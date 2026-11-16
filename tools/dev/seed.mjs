// `pnpm local:seed`: a small realistic library, with the fixture files uploaded through the real
// API. The server (and ideally the converter) must be running: start `pnpm local` first.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { appOrigin, credentialsFile, root, serverUrl } from "./env.mjs";

const credentials = (() => {
  if (process.env.NOTES_LOCAL_PASSWORD) {
    return {
      username: process.env.NOTES_LOCAL_USER ?? "hannah",
      password: process.env.NOTES_LOCAL_PASSWORD,
    };
  }
  try {
    return JSON.parse(readFileSync(credentialsFile, "utf8"));
  } catch {
    console.error(
      `No credentials found at ${credentialsFile}. Run \`pnpm local\` first (it creates the user),\n` +
        "or set NOTES_LOCAL_USER and NOTES_LOCAL_PASSWORD.",
    );
    process.exit(1);
  }
})();

let cookie = "";

async function call(method, path, body, form) {
  const response = await fetch(`${serverUrl}/api${path}`, {
    method,
    headers: {
      Origin: appOrigin,
      ...(cookie ? { Cookie: cookie } : {}),
      ...(body ? { "Content-Type": "application/json" } : {}),
    },
    body: form ?? (body ? JSON.stringify(body) : undefined),
  });
  const set = response.headers.getSetCookie?.() ?? [];
  if (set.length) {
    const jar = new Map(
      cookie
        .split("; ")
        .filter(Boolean)
        .map((c) => c.split(/=(.*)/s).slice(0, 2)),
    );
    for (const line of set) {
      const [pair] = line.split(";");
      const [name, value] = pair.split(/=(.*)/s);
      jar.set(name, value);
    }
    cookie = [...jar].map(([k, v]) => `${k}=${v}`).join("; ");
  }
  if (response.status === 204) return undefined;
  const json = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(`${method} ${path} -> ${response.status} ${json.error?.message ?? ""}`);
  }
  return json;
}

try {
  await fetch(`${serverUrl}/healthz`);
} catch {
  console.error(`The server is not running at ${serverUrl}. Start \`pnpm local\` first.`);
  process.exit(1);
}

await call("POST", "/auth/login", credentials);
const existing = await call("GET", "/nodes?limit=50");
if (existing.items.length > 0) {
  console.log("The library already has terms; nothing seeded. (`pnpm local:reset` starts over.)");
  process.exit(0);
}

const make = async (parentId, kind, name, extra = {}) =>
  (await call("POST", "/nodes", { parentId, kind, name, ...extra })).node;
const kids = async (id) => (await call("GET", `/nodes?parentId=${id}&limit=50`)).items;

const fall = await make(null, "term", "Fall 2026");
await make(null, "term", "Spring 2027");
const pharm = await make(fall.id, "course", "Pharmacology II", { course: { code: "PHAR 7340" } });
const therapy = await make(fall.id, "course", "Pharmacotherapy I", {
  course: { code: "PHAR 7310" },
});
const sections = Object.fromEntries((await kids(pharm.id)).map((s) => [s.section, s]));
const lecture = (parentId, number, name, date) =>
  make(parentId, "lecture", name, { lecture: { number, date } });
const l1 = await lecture(sections.lectures.id, 1, "Autonomic overview", "2026-08-26");
const l2 = await lecture(sections.lectures.id, 2, "Cholinergic agents", "2026-09-02");
const l3 = await lecture(sections.lectures.id, 3, "Beta blockers", "2026-09-09");
const tSections = Object.fromEntries((await kids(therapy.id)).map((s) => [s.section, s]));
await lecture(tSections.lectures.id, 1, "Hypertension guidelines", "2026-08-27");
await make(sections.study_guides.id, "folder", "Cardiovascular");
await call("PATCH", `/nodes/${pharm.id}`, { favourite: true });

const fixtures = join(root, "fixtures", "generated");
async function upload(name, nodeId, as = name) {
  const form = new FormData();
  const type = name.endsWith(".pdf") ? "application/pdf" : "application/octet-stream";
  form.append("file", new Blob([readFileSync(join(fixtures, name))], { type }), as);
  if (nodeId) form.append("nodeId", nodeId);
  const { file } = await call("POST", "/uploads", undefined, form);
  console.log(`  uploaded ${as} (${file.type}) ${nodeId ? "-> a lecture" : "-> inbox"}`);
}
console.log("Uploading fixture files:");
await upload("lecture.pptx", l1.id, "Lecture 01 slides.pptx");
await upload("text-layer.pdf", l2.id, "Lecture 02 notes.pdf");
await upload("image-only.pdf", l3.id, "Lecture 03 handwritten notes.pdf");
await upload("photo.heic", null, "Whiteboard photo.heic");
await upload("photo-exif6.jpg", null, "Textbook page.jpg");
console.log(`\nSeeded. Sign in at ${appOrigin} as ${credentials.username}.`);
