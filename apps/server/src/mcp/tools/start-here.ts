import {
  BLOCK_REGISTRY,
  BLOCK_TYPES,
  CITATION_EXEMPT_TYPES,
  COLOR_TOKENS,
  COURSE_SECTIONS,
  DOCUMENT_LIMITS,
  EXAMPLE_CITATION,
  ID_PREFIX,
  MAX_FOLDER_DEPTH,
  UPLOAD_LIMITS,
} from "@notes/schema";
import { z } from "zod";
import { listApiKeys } from "../../domains/accounts/keys.js";
import { findUserById } from "../../domains/accounts/users.js";
import { json } from "../format.js";
import type { InboxSummary } from "../ports.js";
import { describe, jsonOf } from "../schema.js";
import { defineTool, parseWith, type ToolContext } from "../tool.js";

/** The server `instructions`, sent on connect. Kept short: some clients show only the start, Codex none. */
export const SERVER_INSTRUCTIONS =
  "You are connected to a private pharmacy study-notes app. The app has no AI of its own: you are its intelligence. You transcribe her uploaded lecture pages, file them in her library and write cited study material. Call start_here first: it explains the library, the rules and what your key may do.";

const TOPICS = ["overview", "library", "inbox", "blocks", "citations", "transcription"] as const;
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
  inbox: InboxSummary | null;
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
    inbox: ctx.ports.files ? ctx.ports.files.inboxSummary(ctx.userId) : null,
    tools: [...ctx.available],
  };
}

const has = (f: Facts, tool: string) => f.tools.includes(tool);

function toolMap(f: Facts): string {
  const lines: Array<[string, string]> = [
    [
      "start_here",
      'this guide; topics: "library", "inbox", "blocks", "citations", "transcription"',
    ],
    ["browse_library", "list one level of the tree (or the trash, favourites, recents)"],
    ["get_item", "open anything by ID, with links to its parent, children, sources"],
    ["search_notes", "find by words"],
    ["edit_library", "create, update (rename), move, duplicate, trash, restore library items"],
    ["changes", "what changed since your last session"],
    [
      "source_files",
      "uploaded files: list the inbox, claim, release, file, and move between lectures or folders (or back to the inbox)",
    ],
    ["get_page", "a page image (inline) with its native text and transcript status"],
    ["save_transcript", "save a page's verbatim transcript with flags"],
    ["request_upload_links", "upload files from your machine"],
    ["write_document", "create a document of cited study material"],
    ["edit_blocks", "insert, change, move, delete or regenerate blocks"],
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
    "- Where things go: uploads are filed under their lecture (in Lectures) or a folder in Sources; a lecture's merged note is the lecture's own document; study guides go in Study guides; question sets and flashcards in Practice; exams in Exams.",
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

function inboxWorkflow(f: Facts): string {
  if (!has(f, "source_files")) {
    return "Uploads and the inbox are not available on this server yet; you can organise the library meanwhile.";
  }
  return [
    "Processing the inbox (do one file at a time):",
    '1. source_files {"action":"list"}: files waiting. Work on status "converted" (pages ready); "converting" ones are not ready; "failed" ones need her (tell her the error).',
    '2. source_files {"action":"claim","fileId":"fil_…"} so no other agent takes it.',
    '3. get_item {"id":"fil_…"} lists its pages; get_page {"pageId":"pag_…"} shows each page image.',
    '4. save_transcript for every page (rules in topic "transcription").',
    "5. Find or create its term, course and lecture with browse_library / edit_library.",
    '6. source_files {"action":"file","fileId":"fil_…","nodeId":"<lecture id>"}: files it and ends your claim.',
    has(f, "write_document")
      ? '7. Build material from it: the lecture\'s merged note (write_document with nodeId = the lecture, kind "lecture_note"), study guides and practice, all cited.'
      : "7. Study material tools are not available on this server yet.",
    "If you stop midway, release the claim.",
    'A file filed in the wrong place: source_files {"action":"move","fileId":"fil_…","nodeId":"<other lecture or folder id>"}; nodeId null puts it back in the inbox.',
    has(f, "request_upload_links")
      ? `Uploading from your machine: request_upload_links, then curl -X PUT each file (single-use links, ${UPLOAD_LIMITS.linkTtlSeconds / 60} minutes, up to ${UPLOAD_LIMITS.maxBatch} files per call). Codex needs network access in its sandbox for curl.`
      : "",
  ]
    .filter(Boolean)
    .join("\n");
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

function overview(f: Facts): string {
  const scopeLine =
    f.scope === "write"
      ? "Your key is read-write: you can read and change everything except permanent deletion."
      : "Your key is READ-ONLY: you can look at everything, but every change is refused with read_only_key. Ask her for a read-write key (Settings, API keys) if you need to change things.";
  const inbox = f.inbox
    ? `Inbox: ${f.inbox.pending} file(s) waiting. Converter: ${f.inbox.converter}${f.inbox.converterNote ? ` (${f.inbox.converterNote})` : ""}.`
    : "Inbox: uploads are not available on this server yet.";
  return [
    "# Study notes: start here",
    `This is ${f.displayName}'s private study-notes app (pharmacy school). It builds study material from her own lecture material: she uploads slides and handwritten notes; an agent (you) transcribes the pages, files them under term, course and lecture, and writes study material (notes, study guides, drug cards, practice) that cites the exact page it came from. She then reads, edits and reviews it. The app itself contains no AI and never calls a model.`,
    "",
    "## Right now",
    `${scopeLine}${f.keyName ? ` (key "${f.keyName}")` : ""}`,
    `Library: ${f.terms} term(s), ${f.courses} course(s). ${inbox}`,
    "",
    "## Tools",
    toolMap(f),
    "",
    "## IDs",
    `Every object has a permanent ID: a prefix, an underscore and 26 characters, e.g. nod_01J9Z8Y7X6W5V4T3S2R1Q0P9N8. Prefixes: ${(["node", "file", "page", "transcript", "document", "block"] as const).map((k) => `${ID_PREFIX[k]}_ ${k}`).join(", ")}. Copy IDs exactly from results; never invent them.`,
    "",
    "## Library",
    libraryRules(f),
    "",
    "## Inbox",
    inboxWorkflow(f),
    "",
    "## Transcription",
    transcriptionRules(),
    "",
    "## Citations and her edits",
    citationRules(),
    "",
    "## Blocks",
    blockCatalogue(false),
    "",
    "## Results and errors",
    "Results are short text plus the same facts as structured JSON. Lists are light and paged (pass nextCursor); open one item fully with get_item. A refused call returns an error with code (invalid_input, not_found, conflict, read_only_key, rate_limited, ...), a message naming the field or rule, a hint, and a valid example: fix and retry. not_found means the ID does not exist in her library (or is not yours to see).",
  ].join("\n");
}

export const startHere = defineTool({
  name: "start_here",
  title: "Start here: what this app is and how to work in it",
  description:
    "CALL THIS FIRST in every session. Explains this private study-notes app and your role in it (you are its only intelligence), the library structure and where things go, how to process the upload inbox, the transcription and citation rules, the block types, and what your API key may do, with live facts (her name, library size, inbox size). Optional topic for detail: library, inbox, blocks, citations, transcription.",
  annotations: {
    readOnlyHint: true,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: false,
  },
  inputSchema: describe(jsonOf(StartInput), {
    topic:
      '"overview" (default: everything in brief), or one topic in full: "library" (structure and placement), "inbox" (processing uploads), "blocks" (every block type with an example), "citations", "transcription".',
  }),
  parse: (raw) =>
    parseWith("start_here", StartInput, raw, { topic: "overview" }) as z.output<typeof StartInput>,
  writes: () => false,
  action: (input) => input.topic,
  run(ctx, input) {
    const f = facts(ctx);
    const bodies: Record<Topic, () => string> = {
      overview: () => overview(f),
      library: () => libraryRules(f),
      inbox: () => inboxWorkflow(f),
      blocks: () => blockCatalogue(true),
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
        tools: f.tools,
      },
    };
  },
});
