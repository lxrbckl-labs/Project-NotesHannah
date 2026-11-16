import {
  BLOCK_REGISTRY,
  BLOCK_TYPES,
  CITATION_EXEMPT_TYPES,
  COLOR_TOKENS,
  CONCEPT_EXAMPLES,
  CONCEPT_TYPE_INFO,
  CONCEPT_TYPES,
  COURSE_SECTIONS,
  DOCUMENT_LIMITS,
  EXAMPLE_CITATION,
  MAX_FOLDER_DEPTH,
  practice,
  RELATION_RULES,
  RELATION_TYPES,
  REQUEST_KIND_INFO,
} from "@notes/schema";
import { z } from "zod";
import { listApiKeys } from "../../domains/accounts/keys.js";
import { findUserById } from "../../domains/accounts/users.js";
import { json } from "../format.js";
import { describe, jsonOf } from "../schema.js";
import { defineTool, parseWith, type ToolContext } from "../tool.js";
import { studyMapGuide } from "./study-map.js";

/** The server `instructions`, sent on connect. Kept short: some clients show only the start, Codex none. */
export const SERVER_INSTRUCTIONS =
  "You are connected to a private pharmacy study-notes app. The app has no AI of its own: you are its intelligence. You transcribe her uploaded lecture pages, file them in her library and write cited study material. Call start_here first: it explains the library, the rules and what your key may do.";

const TOPICS = [
  "overview",
  "workflow",
  "library",
  "transcription",
  "citations",
  "blocks",
  "practice",
  "concepts",
  "requests",
  "study_map",
] as const;
type Topic = (typeof TOPICS)[number];

const StartInput = z.strictObject({ topic: z.enum(TOPICS).default("overview") });

/** Character budget for any start_here topic (about 5,000 tokens). */
export const START_HERE_MAX_CHARS = 20_000;

interface Facts {
  displayName: string;
  keyName: string | null;
  scope: "read" | "write";
  terms: number;
  courses: number;
  inbox: {
    waiting: number;
    converting: number;
    ready: number;
    failed: number;
    converter: string;
  } | null;
  requests: { waiting: number; inProgress: number } | null;
  tools: string[];
}

function facts(ctx: ToolContext): Facts {
  const user = findUserById(ctx.db, ctx.userId);
  const key = listApiKeys(ctx.db, ctx.userId).find((k) => k.id === ctx.keyId);
  const top = ctx.library.list(ctx.userId, { limit: 200 });
  const terms = top.items.filter((n) => n.kind === "term");
  return {
    displayName: user?.display_name ?? "the student",
    keyName: key?.name ?? null,
    scope: ctx.scope,
    terms: terms.length,
    courses: terms.reduce((sum, t) => sum + t.childCount, 0),
    inbox: inboxFacts(ctx),
    requests: ctx.backend.requests
      ? (() => {
          const c = ctx.backend.requests.counts(ctx.auth);
          return { waiting: c.waiting, inProgress: c.in_progress };
        })()
      : null,
    tools: [...ctx.available],
  };
}

function inboxFacts(ctx: ToolContext): Facts["inbox"] {
  const port = ctx.backend.files;
  if (!port) return null;
  const items = port.listFiles(ctx.auth, { inbox: true, limit: 200 }).items;
  const count = (...statuses: string[]) => items.filter((f) => statuses.includes(f.status)).length;
  return {
    waiting: items.length,
    converting: count("uploaded", "converting"),
    ready: count("converted", "transcribed"),
    failed: count("failed"),
    converter: port.converterStatus().state,
  };
}

const has = (f: Facts, tool: string) => f.tools.includes(tool);

function toolMap(f: Facts): string {
  const lines: Array<[string, string]> = [
    ["start_here", `this guide; topics: ${TOPICS.slice(1).join(", ")}`],
    ["requests", "what she asked for: list, claim, complete with a reply, decline, release"],
    ["browse_library", "one level of the tree (or the trash, favourites, recents)"],
    ["get_item", "open anything by ID; a file with text:true gives every page's text at once"],
    ["search_notes", "find by words: names, pages, blocks, questions, concepts"],
    [
      "edit_library",
      "create, rename, move, duplicate, trash, restore; claim a lecture you write for",
    ],
    ["changes", "what changed since your last session"],
    ["source_files", "upload links, inbox, wait for conversion, claim, file, move, retry"],
    ["get_page", "a page image with its native text and current transcript"],
    ["save_transcript", "a page's verbatim transcript with flags"],
    ["write_document", "create a document of cited study material"],
    ["edit_blocks", "insert, change, move, delete or regenerate blocks"],
    ["study_map", "read or arrange a document's study map (frames, cards, labelled connectors)"],
    ["concepts", "upsert concepts and relations; search, page, graph, filter, compare"],
    ["practice_questions", "create (or validate), list, update, trash questions"],
    ["study_progress", "her weak areas, missed notebook, due cards, sessions (read only)"],
    ["exams", "upcoming exams with coverage and progress; create, update"],
  ];
  return lines
    .filter(([name]) => has(f, name))
    .map(([name, what]) => `- ${name}: ${what}`)
    .join("\n");
}

function libraryRules(f: Facts): string {
  const sections = COURSE_SECTIONS.map((s) => s.name).join(", ");
  return [
    "The library is a tree of permanent IDs; paths are only readable aliases, so renames and moves never break a link or citation.",
    '- Top level: terms (e.g. "Fall 2026"). Nothing else goes at the top level.',
    '- Term > course (e.g. "Pharmacology II", optional code "PHAR 7340").',
    `- Course > exactly five fixed sections, created automatically: ${sections}. They cannot be created, renamed, moved or trashed.`,
    `- Section or folder > folders, lectures, documents. Folders nest at most ${MAX_FOLDER_DEPTH} deep below a section.`,
    '- Lecture > documents. Lectures have a number and a date and are shown as "07 · Beta blockers · Oct 14"; they sort in teaching order. Put lectures in the course\'s Lectures section.',
    "- Where things go: uploads are filed under their lecture (in Lectures), a folder, or the course's Sources section; a lecture's merged note is the lecture's own document (write_document with nodeId = the lecture); study guides go in Study guides (write_document with parentId = that section); question sets and flashcards in Practice; exams in Exams.",
    "- Trash keeps everything restorable. Only she can delete permanently, in the browser.",
    "Moving things (you can do every move she can do in the app; the same rules apply):",
    '- Library items (folders, lectures, documents, courses, terms): edit_library {"action":"move","id":"<id>","parentId":"<new parent>","afterId":"<sibling or null>"}. parentId is the new place (it must be allowed to hold that kind); afterId places it after a sibling (null: first; omit: last). Sections never move.',
    has(f, "source_files")
      ? '- Uploaded files: source_files {"action":"move","fileId":"fil_…","nodeId":"<lecture or folder id>"}; nodeId null returns the file to the inbox. A file is not a library item, so edit_library cannot move it.'
      : "- Uploaded files cannot be moved over MCP on this server yet.",
    "Examples:",
    `edit_library ${json({ action: "create", parentId: null, kind: "term", name: "Fall 2026" })}`,
    `edit_library ${json({ action: "create", parentId: "<term id>", kind: "course", name: "Pharmacology II", course: { code: "PHAR 7340" } })}`,
    `edit_library ${json({ action: "create", parentId: "<Lectures section id>", kind: "lecture", name: "Beta blockers", lecture: { number: 7, date: "2026-10-14" } })}`,
    `edit_library ${json({ action: "update", id: "<id>", name: "New name" })}`,
  ].join("\n");
}

/** The whole job in order; `detail` adds the how-to of each step. */
function workflow(f: Facts, detail: boolean): string {
  const steps: Array<[string, string, string]> = [
    [
      "requests",
      'Check her requests FIRST: requests {"action":"list"}. Claim one, do it, complete it with a reply and links (or decline with a reason).',
      " Her blocks and questions are protected from agents; passing the claimed request's requestId to edit_blocks is the only way to change them.",
    ],
    [
      "source_files",
      'Process the inbox: source_files "upload_links" for files on your machine (then one bare curl per file), "wait" until converted, "claim" each file.',
      ' wait polls up to 25 s per call; call it again while converting. "failed" shows the reason: retry once, else tell her. If the converter is not online, tell her.',
    ],
    [
      "save_transcript",
      "Read every page (get_page) and save_transcript it verbatim, flagging every dose, unit and decimal. Slides too: their native text is a draft, not a transcript (check it against the image and save it).",
      ' For many pages, get_page with "image":"link" and curl the links. The save result says how many pages are still missing.',
    ],
    [
      "edit_library",
      'Find or create the term, course and lecture (lectures go in the course\'s Lectures section, numbered and dated), then source_files "file" it under the lecture.',
      ' Filing is refused while any page has no transcript (the error lists the page numbers); only if a page truly cannot be transcribed, pass "force": true with a short "reason".',
    ],
    [
      "write_document",
      'Claim the lecture for writing (edit_library "claim"), collect exact quotes with get_item {"id":"fil_…","text":true}, then write the lecture note (write_document with nodeId = the lecture, kind lecture_note), every content block citing its page.',
      " Study guides go in the course's Study guides section (parentId). Check with get_item on the document (references).",
    ],
    [
      "concepts",
      'Record concepts and relations from the material: concepts {"action":"upsert"}, each citing its page.',
      ' See start_here {"topic":"concepts"} for the types and which relation fits which pair.',
    ],
    [
      "practice_questions",
      "Author practice: practice_questions create under the lecture, each citing its page; use study_progress to target weak areas.",
      ' Validate first with "validateOnly": true. Types and examples: start_here {"topic":"practice"}.',
    ],
    [
      "requests",
      "Complete the requests you claimed, then release every claim: files (source_files release) and writing claims (edit_library release).",
      "",
    ],
  ];
  const usable = steps.filter(([tool]) => has(f, tool));
  return [
    "The job, in order:",
    ...usable.map(([, what, more], i) => `${i + 1}. ${what}${detail ? more : ""}`),
  ].join("\n");
}

/** Question types with tiny examples. */
function practiceGuide(full: boolean): string {
  if (!full) {
    return [
      `Question types: ${practice.QUESTION_TYPES.join(", ")}. Each cites its page in "sources" (or generalKnowledge: true). Tiny examples:`,
      `- ${json(practice.exampleFor("flashcard"))}`,
      `- ${json(practice.exampleFor("calculation"))}`,
      'Every type with an example: start_here {"topic":"practice"}.',
    ].join("\n");
  }
  const lines = [
    'A question is {"type", the type\'s own fields, "sources" (citations: fileId, pageId, exact quote) or "generalKnowledge": true, "difficulty" 1-3, "tags", "conceptIds"}. Create up to 100 per call under the lectures they belong to; validate first with "validateOnly": true. Agents never take sessions or answer.',
  ];
  for (const type of practice.QUESTION_TYPES) {
    const info = practice.QUESTION_REGISTRY[type];
    lines.push(
      `- ${type} (${info.label}; ${info.grading}-graded): ${info.description}\n  ${json(info.example)}`,
    );
  }
  return lines.join("\n");
}

/** Concept and relation types, with which pairs a relation fits. */
function conceptsGuide(full: boolean): string {
  if (!full) {
    return [
      `Concept types: ${CONCEPT_TYPES.join(", ")}. Relation types: ${RELATION_TYPES.join(", ")}; each fits only certain type pairs. Tiny example:`,
      `concepts ${json({ action: "upsert", concepts: [CONCEPT_EXAMPLES.concept], relations: [CONCEPT_EXAMPLES.relation] })}`,
      'Every type and rule: start_here {"topic":"concepts"}.',
    ].join("\n");
  }
  return [
    "Concepts are matched by type and normalised name; upsert updates what exists and never merges look-alikes (they are reported as suggestions). Each needs a citation or generalKnowledge: true.",
    "Concept types:",
    ...CONCEPT_TYPES.map(
      (t) => `- ${t}: ${CONCEPT_TYPE_INFO[t].meaning} e.g. "${CONCEPT_TYPE_INFO[t].example}"`,
    ),
    "Relation types (from > to):",
    ...RELATION_TYPES.map((r) => {
      const rule = RELATION_RULES[r];
      return `- ${r}: ${rule.rule}. ${rule.from.join("|")} > ${rule.to.join("|")}${rule.symmetric ? " (either way)" : ""}`;
    }),
    `Example: concepts ${json({ action: "upsert", ...CONCEPT_EXAMPLES.bulk })}`,
    `Interaction: ${json(CONCEPT_EXAMPLES.interaction)}`,
  ].join("\n");
}

function requestsGuide(): string {
  return [
    "Her requests are the queue of what she asked for. Check them first in every session.",
    `Kinds: ${Object.entries(REQUEST_KIND_INFO)
      .map(([k, v]) => `${k} (${v.meaning})`)
      .join("; ")}.`,
    '1. requests {"action":"list"}: open ones, waiting first, each with its target, path and a preview.',
    '2. requests {"action":"claim","requestId":"req_…"}: 30 minutes, claim again to renew.',
    '3. Do it. On a block she wrote: edit_blocks {"operation":"update_block",...,"requestId":"req_…"}; the request lifts her block\'s protection only while you hold its claim and only for its document or block.',
    '4. requests {"action":"complete","requestId":"req_…","reply":"what you did","links":[{"type":"block","documentId":"doc_…","blockId":"blk_…"}]}, or "decline" with a reason. She sees the reply.',
  ].join("\n");
}

function transcriptionRules(): string {
  return [
    "Transcription rules (she relies on these for doses):",
    '- Copy verbatim. Keep line breaks. Tables as "a | b | c" rows. Never silently correct a word, a drug name or a number; if it looks wrong, keep it and flag it.',
    '- Flag every dose, unit and decimal (kind "dose", "unit", "decimal"), uncertain readings ("uncertain", with a note such as "could be 35"), unreadable parts ("illegible") and drug names you are unsure of ("drug_name").',
    "- A flag's quote is the exact characters from your text. A save with an unflagged dose or decimal is refused and lists what to add.",
    "- Handwriting: watch 8/s, l/I, 0/o, 1/7 and decimal points. Native text from slides may be out of order; the image is the authority.",
    '- Transcripts stay "unverified" until she reviews them. Saving again creates a new revision; old ones are kept.',
    `Example: save_transcript ${json({ pageId: "pag_…", text: "Metoprolol 25 mg PO BID\nHold if HR < 55", flags: [{ kind: "dose", quote: "25 mg" }] })}`,
  ].join("\n");
}

function citationRules(): string {
  return [
    "Citations are required. Every generated block or practice question must say where it came from, so she can tap through to the original page.",
    "- A citation is {fileId, pageId, quote, region?, label?}. The quote is copied character for character from that page's transcript (transcribe first); quotes that are not found are refused.",
    '- Content not from her notes must set "generalKnowledge": true instead (labelled "not from your notes"); never both on the same block.',
    `- Exempt types: ${CITATION_EXEMPT_TYPES.join(", ")}.`,
    '- Inside rich text, {"cite": 1} marks where citation 1 supports a claim. Drug card lines and comparison cells can carry their own citations and flags, so each dose can cite its source.',
    "- Regions are fractions of the page (0,0 top-left); best effort on handwriting.",
    `Example citation: ${json(EXAMPLE_CITATION)}`,
    "Edit protection: you may overwrite only blocks an agent wrote that she has not edited or reviewed. Her blocks are kept and reported as skipped, unless you act on her request and pass its requestId.",
  ].join("\n");
}

function blockCatalogue(full: boolean): string {
  if (!full) {
    return `Block types: ${BLOCK_TYPES.join(", ")}. Each block is {"type", "content", "citations"?, "generalKnowledge"?, "flags"?, "style"?}. Details and an example of each: start_here {"topic":"blocks"}.`;
  }
  const lines = [
    `A document is an ordered list of blocks (at most ${DOCUMENT_LIMITS.blocks}; ${DOCUMENT_LIMITS.blocksPerCall} per write). A block is {"type", "content", "citations"?, "generalKnowledge"?, "flags"?, "style"?}; the server assigns id, origin, review and provenance (do not send them).`,
    'Rich text: wherever text is expected, send a plain string, or a list of runs: {"text": "Metoprolol", "bold": true}, {"cite": 1}, {"concept": "con_…", "text": "propranolol"}. Marks: bold, italic, underline, strike, code, highlight (a colour), link.',
    `Colours are tokens only: ${COLOR_TOKENS.join(", ")}.`,
    "Types (cites = must cite or be general knowledge):",
  ];
  for (const type of BLOCK_TYPES) {
    const entry = BLOCK_REGISTRY[type];
    lines.push(
      `- ${type}${entry.citationsRequired ? " (cites)" : ""}: ${entry.description}\n  ${json(entry.example)}`,
    );
  }
  return lines.join("\n");
}

/** What the study map is for, short; the detail is the study_map topic. */
function studyMapSection(): string {
  return [
    "Study map: every document also has a map she can open: its blocks as cards on a canvas, grouped in frames and joined by labelled connectors. When she asks you to arrange or summarise a document visually, or after writing a long guide, use study_map. You describe STRUCTURE only (which cards, which frame, how they relate) and the app lays it out; she can drag cards and what she places stays where she put it. Never send coordinates.",
    `study_map ${json({
      action: "set_structure",
      documentId: "doc_…",
      cards: [
        { ref: "a", content: { kind: "block", blockIds: ["blk_…"] } },
        { ref: "b", content: { kind: "note", text: "Key point" } },
      ],
      connectors: [{ from: "a", to: "b", label: "leads to", kind: "leads_to" }],
      frames: [{ title: "Topic", members: ["a", "b"] }],
    })}`,
    'Her pinned or edited items are left alone unless you pass the requestId of her request about the whole document. start_here {"topic":"study_map"} has every op.',
  ].join("\n");
}

function overview(f: Facts): string {
  const scopeLine =
    f.scope === "write"
      ? "Your key is read-write: you can read and change everything except permanent deletion."
      : "Your key is READ-ONLY: you can look at everything, but every change is refused with read_only_key. Ask her for a read-write key (Settings, API keys) if you need to change things.";
  const inbox = f.inbox
    ? `Inbox: ${f.inbox.waiting} file(s) not filed (${f.inbox.converting} converting, ${f.inbox.ready} ready, ${f.inbox.failed} failed); converter ${f.inbox.converter}.`
    : "";
  const requests = f.requests
    ? `Requests: ${f.requests.waiting} waiting, ${f.requests.inProgress} in progress.`
    : "";
  return [
    "# Study notes: start here",
    `This is ${f.displayName}'s private study-notes app (pharmacy school). She uploads slides and handwritten notes; you (an agent; the app has no AI of its own) transcribe the pages, file them under term, course and lecture, and write study material, concepts and practice questions that cite the exact page they came from. She reads, edits and reviews it.`,
    "",
    "## Right now",
    `${scopeLine}${f.keyName ? ` (key "${f.keyName}")` : ""}`,
    `Library: ${f.terms} term(s), ${f.courses} course(s). ${inbox} ${requests}`.trim(),
    "",
    "## Tools",
    toolMap(f),
    "",
    "## Workflow",
    workflow(f, false),
    "",
    "## Rules",
    `- IDs are a prefix and 26 characters (nod_ node, fil_ file, pag_ page, doc_ document, blk_ block, req_ request, qst_ question, con_ concept, exm_ exam). Copy them exactly from results.`,
    `- Library: term > course > five fixed sections (${COURSE_SECTIONS.map((x) => x.name).join(", ")}) > folders, lectures, documents. Trash is restorable; only she deletes for good.`,
    "- Transcribe verbatim; flag every dose, unit and decimal (save_transcript refuses otherwise).",
    '- Everything you generate cites its page: {fileId, pageId, quote copied exactly from the transcript or slide text}. A refused quote comes with the closest passage on that page: copy it. "generalKnowledge": true is only for what is not in her material at all.',
    "- Her blocks, questions and reviewed items are protected; only a claimed request of hers lifts that (pass its requestId).",
    "- Before writing for a lecture, claim it (edit_library claim) so two agents do not write the same thing.",
    "",
    ...(has(f, "study_map") ? ["## Study map", studyMapSection(), ""] : []),
    "## Content types",
    blockCatalogue(false),
    practiceGuide(false),
    conceptsGuide(false),
    "",
    "## Results and errors",
    'Results are readable text with the facts as structured JSON. Lists are paged (nextCursor). A refused call says the code, the field or rule, a hint and a valid example: fix and retry. Topics for detail: start_here {"topic":"workflow"} (and library, transcription, citations, blocks, practice, concepts, requests, study_map).',
  ].join("\n");
}

export const startHere = defineTool({
  name: "start_here",
  title: "Start here: what this app is and how to work in it",
  description:
    "CALL THIS FIRST in every session. Explains this private study-notes app and your role in it (you are its only intelligence): the workflow (her requests first, then the inbox, notes, concepts, practice), the rules (citations, transcription, her protected edits), the content types, and what your key may do, with live facts (her name, library size, inbox, open requests). Optional topic for detail.",
  annotations: {
    readOnlyHint: true,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: false,
  },
  inputSchema: describe(jsonOf(StartInput), {
    topic:
      '"overview" (default: everything in brief), or one topic in full: "workflow", "library", "transcription", "citations", "blocks" (every block type with an example), "practice" (every question type with an example), "concepts" (types and which relation fits which pair), "requests", "study_map" (every op with an example, the pin rule).',
  }),
  parse: (raw) =>
    parseWith("start_here", StartInput, raw, { topic: "overview" }) as z.output<typeof StartInput>,
  writes: () => false,
  action: (input) => input.topic,
  run(ctx, input) {
    const f = facts(ctx);
    const bodies: Record<Topic, () => string> = {
      overview: () => overview(f),
      workflow: () => workflow(f, true),
      library: () => libraryRules(f),
      blocks: () => blockCatalogue(true),
      practice: () => practiceGuide(true),
      concepts: () => conceptsGuide(true),
      requests: requestsGuide,
      study_map: studyMapGuide,
      citations: citationRules,
      transcription: transcriptionRules,
    };
    const text = bodies[input.topic as Topic]();
    return {
      text,
      structured: {
        topic: input.topic,
        app: "private pharmacy study-notes app",
        user: { displayName: f.displayName },
        key: { name: f.keyName, scope: f.scope },
        library: { terms: f.terms, courses: f.courses },
        inbox: f.inbox,
        requests: f.requests,
        tools: f.tools,
      },
    };
  },
});
