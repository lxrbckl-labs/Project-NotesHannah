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
} from "@notes/schema";
import { z } from "zod";
import { listApiKeys } from "../../domains/accounts/keys.js";
import { findUserById } from "../../domains/accounts/users.js";
import { json } from "../format.js";
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
  inbox: {
    waiting: number;
    converting: number;
    ready: number;
    failed: number;
    converter: string;
  } | null;
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
    [
      "start_here",
      'this guide; topics: "library", "inbox", "blocks", "citations", "transcription"',
    ],
    ["browse_library", "list one level of the tree (or the trash, favourites, recents)"],
    [
      "get_item",
      'open anything by ID with links to its neighbours; on a file with "text": true, every page\'s text at once',
    ],
    ["search_notes", "find by words: library names, transcribed pages, document text"],
    ["edit_library", "create, update (rename), move, duplicate, trash, restore library items"],
    ["changes", "what changed since your last session"],
    [
      "source_files",
      "uploaded files: list the inbox with status and transcription progress, wait for conversion, claim, release, file, move (or back to the inbox), retry",
    ],
    [
      "get_page",
      "a page image (inline, or a download link) with its native text and current transcript",
    ],
    ["save_transcript", "save a page's verbatim transcript with flags"],
    ["request_upload_links", "upload files from your machine with curl"],
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

function inboxWorkflow(f: Facts): string {
  if (!has(f, "source_files")) {
    return "Uploads and the inbox are not available on this server yet; you can organise the library meanwhile.";
  }
  const steps = [
    "From files to cited study material, end to end:",
    has(f, "request_upload_links")
      ? '1. Get the files in. Files on your machine: request_upload_links {"files":[{"name":"lecture-07.pdf"}]} (add "bytes" if you can measure the file), then one bare curl per file with its absolute path: curl -sS -X PUT --data-binary @"/abs/path/lecture-07.pdf" "<url>" (no cd or &&); each PUT answers with the new file\'s JSON (its "id" is the fil_ ID). Files she uploaded are already in the inbox: source_files {"action":"list"}.'
      : '1. Files she uploaded wait in the inbox: source_files {"action":"list"}.',
    '2. Wait for conversion: source_files {"action":"wait","fileIds":["fil_…"]} waits up to 25 s and reports each file\'s status; call it again while any is still converting (a deck takes from seconds to a couple of minutes). Do not loop on list. "failed" shows the reason: retry once with source_files {"action":"retry"}, otherwise tell her (an encrypted or damaged file needs her). If the converter is not "online", nothing converts: tell her.',
    '3. Claim each converted file: source_files {"action":"claim","fileId":"fil_…"} so no other agent works on it.',
    '4. Read every page: get_item {"id":"fil_…"} lists the pages; get_page {"pageId":"pag_…"} shows the image with the file\'s own text. For many pages, get_page with "image":"link" and curl the links, then read the downloaded images.',
    '5. Transcribe every page with save_transcript, verbatim, flagging every dose, unit and decimal (topic "transcription"). The result says how many pages of the file are still missing.',
    "6. Place it: find or create the term, course and lecture (browse_library, edit_library; lectures go in the course's Lectures section with their number and date).",
    '7. File it: source_files {"action":"file","fileId":"fil_…","nodeId":"<lecture id>"}. Filing with pages still untranscribed is allowed but warns, listing them.',
  ];
  if (has(f, "write_document")) {
    steps.push(
      '8. Write the material: collect exact quotes with get_item {"id":"fil_…","text":true} (every page\'s transcript at once), then write_document with headings, callouts, tables and so on. Every content block cites the page it came from with a quote copied character for character from that page\'s transcript or native text; quotes that are not found are refused with the path of the block. Check the result with get_item on the document (its references list).',
    );
  }
  steps.push(
    `${steps.length}. Release each claim: source_files {"action":"release","fileId":"fil_…"}. If you stop midway, release too.`,
    'A file filed in the wrong place: source_files {"action":"move","fileId":"fil_…","nodeId":"<other lecture or folder id>"}; nodeId null puts it back in the inbox.',
    "Codex: uploads and downloads use curl, so its sandbox needs network access (see /agents.txt).",
  );
  return steps.join("\n");
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
    ? `Inbox: ${f.inbox.waiting} file(s) not filed (${f.inbox.converting} converting, ${f.inbox.ready} ready to transcribe or file, ${f.inbox.failed} failed). Converter: ${f.inbox.converter}.`
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
