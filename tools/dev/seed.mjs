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
  return file;
}
console.log("Uploading fixture files:");
const slides = await upload("lecture.pptx", l1.id, "Lecture 01 slides.pptx");
await upload("text-layer.pdf", l2.id, "Lecture 02 notes.pdf");
await upload("image-only.pdf", l3.id, "Lecture 03 handwritten notes.pdf");
await upload("photo.heic", null, "Whiteboard photo.heic");
await upload("photo-exif6.jpg", null, "Textbook page.jpg");

// ---- the study guide, questions and an exam: what an agent would leave behind -------------------
async function waitConverted(fileId, seconds) {
  const until = Date.now() + seconds * 1000;
  while (Date.now() < until) {
    const { file } = await call("GET", `/files/${fileId}`);
    if (file.status === "failed") return null;
    if (file.status !== "converting" && file.status !== "uploaded") return file;
    await new Promise((r) => setTimeout(r, 1500));
  }
  return null;
}

console.log("Waiting for the converter to read the slides (needs Docker; skipped without it)...");
const converted = await waitConverted(slides.id, Number(process.env.NOTES_SEED_WAIT ?? 90));
if (!converted) {
  console.log(
    "The slides were not converted in time, so the study guide, questions and exam are skipped.\n" +
      "Start the converter (Docker) and run `pnpm local:reset` then `pnpm local` and `pnpm local:seed` again.",
  );
} else {
  const { items: pages } = await call("GET", `/files/${slides.id}/pages`);
  const [p1, p2] = pages;
  const T1 =
    "Beta blockers reduce heart rate and blood pressure.\nMetoprolol 50 mg PO BID, titrate to effect.";
  const T2 =
    "Cardioselective agents (atenolol, metoprolol) preferentially block beta-1 receptors.\nNon-selective agents (propranolol) also block beta-2 receptors.";
  await call("PUT", `/pages/${p1.id}/transcript`, {
    text: T1,
    flags: [{ kind: "dose", quote: "50 mg", note: "Check the dose against the slide." }],
  });
  await call("PUT", `/pages/${p2.id}/transcript`, { text: T2 });

  // An agent's key, so the guide is written the way an agent writes it (unverified, cited).
  const { secret } = await call("POST", "/keys", { name: "Seed agent", scope: "write" });
  const asAgent = async (method, path, body) => {
    const response = await fetch(`${serverUrl}/api${path}`, {
      method,
      headers: { Authorization: `Bearer ${secret}`, "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const json = await response.json().catch(() => ({}));
    if (!response.ok)
      throw new Error(
        `agent ${method} ${path} -> ${response.status} ${JSON.stringify(json.error ?? json).slice(0, 400)}`,
      );
    return json;
  };
  const cite = (page, quote, label) => ({ fileId: slides.id, pageId: page.id, quote, label });
  const c1 = cite(p1, "Beta blockers reduce heart rate and blood pressure.", "Slide 1");
  const c2 = cite(
    p2,
    "Cardioselective agents (atenolol, metoprolol) preferentially block beta-1 receptors.",
    "Slide 2",
  );
  const guide = await asAgent("POST", "/documents", {
    nodeId: l1.id,
    kind: "lecture_note",
    title: "Autonomic overview",
    blocks: [
      { type: "heading", content: { level: 2, text: "Beta blockers" } },
      {
        type: "paragraph",
        content: {
          text: "Beta blockers reduce heart rate and blood pressure. Metoprolol is usually started at 50 mg twice a day and titrated to effect.",
        },
        citations: [c1],
      },
      {
        type: "bulleted_list",
        content: {
          items: [
            "Cardioselective: atenolol, metoprolol (beta-1)",
            "Non-selective: propranolol (beta-1 and beta-2)",
          ],
        },
        citations: [c2],
      },
      { type: "heading", content: { level: 3, text: "Choosing an agent" } },
      {
        type: "paragraph",
        content: {
          text: "Cardioselective agents preferentially block beta-1 receptors, so they cause less bronchoconstriction.",
        },
        citations: [c2],
      },
      {
        type: "paragraph",
        content: { text: "Titrate to heart rate and blood pressure rather than to a fixed dose." },
        citations: [c1],
      },
      {
        type: "numbered_list",
        content: { items: ["Check heart rate", "Check blood pressure", "Ask about dizziness"] },
        citations: [c1],
      },
      {
        type: "paragraph",
        content: { text: "Non-selective agents such as propranolol also block beta-2 receptors." },
        citations: [c2],
      },
      {
        type: "callout",
        content: {
          kind: "exam_tip",
          title: "Exam tip",
          text: "Cardioselective agents preferentially block beta-1 receptors, so they are safer in asthma.",
        },
        citations: [c2],
      },
    ],
  });
  console.log(
    `  study guide written by an agent (${guide.blockIds.length} blocks, unverified, cited)`,
  );

  const src = [c1];
  const questions = [
    {
      type: "multiple_choice",
      prompt: "Which effect do beta blockers have on the heart?",
      options: [
        { text: "Slower heart rate", correct: true, rationale: "Beta blockade lowers heart rate." },
        { text: "Faster heart rate" },
        { text: "Higher potassium" },
      ],
      explanation: "Beta blockers slow the heart rate and lower blood pressure.",
      sources: src,
      tags: ["beta blockers"],
    },
    {
      type: "calculation",
      prompt:
        "A patient weighs 70 kg. The order is 5 mg/kg as a single dose. How many mg is the dose?",
      answer: { kind: "fixed", value: 350 },
      units: ["mg"],
      explanation: "70 kg x 5 mg/kg = 350 mg.",
      sources: src,
      tags: ["dosing"],
    },
    {
      type: "fill_blank",
      text: "Metoprolol is a {{1}} selective blocker.",
      blanks: [{ answers: ["beta-1", "cardio"] }],
      explanation: "Metoprolol preferentially blocks beta-1 receptors.",
      sources: [c2],
      tags: ["beta blockers"],
    },
    {
      type: "flashcard",
      front: "Name two cardioselective beta blockers.",
      back: "Atenolol and metoprolol.",
      sources: [c2],
      tags: ["beta blockers"],
    },
  ];
  await asAgent("POST", "/practice/questions", { nodeIds: [l1.id], questions });
  console.log(`  ${questions.length} practice questions authored`);

  const days = (n) => new Date(Date.now() + n * 86_400_000).toISOString().slice(0, 10);
  await call("POST", "/exams", {
    courseId: pharm.id,
    title: "Exam 1",
    date: days(12),
    nodeIds: [l1.id],
    notes: "Beta blockers and dosing.",
  });
  console.log("  an exam planned in 12 days");

  // ---- concepts, requests and a canvas: the rest of what an agent leaves behind -----------------
  const guideId = guide.documentId ?? guide.document?.id ?? guide.id;
  const [, bBeta, bList, , bTitrate, , bNonSel] = guide.blockIds;
  const concepts = await asAgent("POST", "/concepts/bulk", {
    concepts: [
      {
        type: "drug_class",
        name: "beta blockers",
        citations: [c1],
        summary:
          "Drugs that block beta-adrenergic receptors, lowering heart rate and blood pressure.",
      },
      {
        type: "drug",
        name: "metoprolol",
        drug: { brandNames: ["Lopressor"] },
        citations: [c2],
        summary: "A cardioselective beta-1 blocker, started at 50 mg twice a day.",
      },
      { type: "drug", name: "atenolol", drug: { brandNames: ["Tenormin"] }, citations: [c2] },
      { type: "drug", name: "propranolol", drug: { brandNames: ["Inderal"] }, citations: [c2] },
      { type: "drug", name: "verapamil", generalKnowledge: true },
      { type: "mechanism", name: "beta-1 receptor blockade", citations: [c2] },
      { type: "adverse_effect", name: "bradycardia", generalKnowledge: true },
      { type: "adverse_effect", name: "bronchoconstriction", citations: [c2] },
      { type: "indication", name: "hypertension", generalKnowledge: true },
      { type: "monitoring_parameter", name: "heart rate", citations: [c1] },
    ],
    relations: [
      {
        from: { type: "drug", name: "metoprolol" },
        to: { type: "drug_class", name: "beta blockers" },
        type: "belongs_to_class",
        citations: [c2],
      },
      {
        from: { type: "drug", name: "atenolol" },
        to: { type: "drug_class", name: "beta blockers" },
        type: "belongs_to_class",
        citations: [c2],
      },
      {
        from: { type: "drug", name: "propranolol" },
        to: { type: "drug_class", name: "beta blockers" },
        type: "belongs_to_class",
        citations: [c2],
      },
      {
        from: { type: "drug", name: "metoprolol" },
        to: { type: "mechanism", name: "beta-1 receptor blockade" },
        type: "has_mechanism",
        citations: [c2],
      },
      {
        from: { type: "drug", name: "metoprolol" },
        to: { type: "adverse_effect", name: "bradycardia" },
        type: "causes_adverse_effect",
        generalKnowledge: true,
      },
      {
        from: { type: "drug", name: "propranolol" },
        to: { type: "adverse_effect", name: "bronchoconstriction" },
        type: "causes_adverse_effect",
        citations: [c2],
      },
      {
        from: { type: "drug", name: "metoprolol" },
        to: { type: "indication", name: "hypertension" },
        type: "treats",
        generalKnowledge: true,
      },
      {
        from: { type: "drug", name: "metoprolol" },
        to: { type: "drug", name: "verapamil" },
        type: "interacts_with",
        interaction: { severity: "major", effect: "additive bradycardia and AV block" },
        generalKnowledge: true,
      },
      {
        from: { type: "drug", name: "metoprolol" },
        to: { type: "monitoring_parameter", name: "heart rate" },
        type: "monitored_by",
        citations: [c1],
      },
    ],
    partial: true,
  });
  console.log(
    `  ${concepts.concepts?.length ?? 0} concepts and their relations written by an agent`,
  );
  const metoprolol = concepts.concepts?.find((x) => x.name === "metoprolol");

  // One request still waiting, and one an agent answered with links she can follow.
  await call("POST", "/requests", {
    target: { type: "block", documentId: guideId, blockId: bTitrate },
    kind: "unclear",
    message: "Why titrate to heart rate rather than a fixed dose?",
  });
  const done = (
    await call("POST", "/requests", {
      target: { type: "block", documentId: guideId, blockId: bBeta },
      kind: "expand",
      message: "Add the usual starting dose for metoprolol.",
    })
  ).request;
  await asAgent("POST", `/requests/${done.id}/claim`, {});
  const links = [
    { type: "block", documentId: guideId, blockId: bBeta, label: "The beta blockers paragraph" },
  ];
  const firstQuestion = (await call("GET", "/practice/questions?limit=1")).items?.[0];
  if (firstQuestion)
    links.push({ type: "question", questionId: firstQuestion.id, label: "A practice question" });
  await asAgent("POST", `/requests/${done.id}/complete`, {
    reply: "Added the usual starting dose (50 mg twice a day) and a question to check it.",
    links,
  });
  console.log("  one request waiting, one answered with links");

  // A canvas with frames and labelled connectors.
  const cards = [
    { ref: "intro", content: { kind: "block", blockIds: [bBeta] } },
    { ref: "agents", content: { kind: "block", blockIds: [bList] } },
    { ref: "choose", content: { kind: "block", blockIds: [bTitrate] } },
    { ref: "nonsel", content: { kind: "block", blockIds: [bNonSel] } },
    { ref: "tip", content: { kind: "note", text: "Think: -olol = beta blocker" }, color: "yellow" },
    ...(metoprolol
      ? [
          {
            ref: "metoprolol",
            content: { kind: "concept", conceptId: metoprolol.id, label: "metoprolol" },
          },
        ]
      : []),
  ];
  await asAgent("PUT", `/documents/${guideId}/canvas/structure`, {
    documentId: guideId,
    cards,
    connectors: [
      { from: "intro", to: "agents", label: "two groups", kind: "leads_to" },
      { from: "agents", to: "choose", label: "so choose by", kind: "leads_to" },
      { from: "agents", to: "nonsel", label: "but also", kind: "related" },
      { from: "tip", to: "agents", kind: "related" },
    ],
    frames: [
      { ref: "basics", title: "The basics", color: "blue", members: ["intro", "agents", "tip"] },
      {
        ref: "selection",
        title: "Choosing an agent",
        color: "purple",
        members: ["choose", "nonsel"],
      },
    ],
  });
  console.log("  a canvas with two frames and labelled connectors");
}

console.log(`\nSeeded. Sign in at ${appOrigin} as ${credentials.username}.`);
