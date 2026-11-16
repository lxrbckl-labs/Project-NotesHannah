import {
  FileId,
  FileStatus,
  NodeId,
  PageId,
  PageRequest,
  RequestUploadsInput,
  SaveTranscriptInput,
  type SourceFile,
  type TranscriptFlag,
  UPLOAD_LIMITS,
} from "@notes/schema";
import { z } from "zod";
import { MUST_FLAG } from "../../domains/files/figures.js";
import { AppError } from "../../http/errors.js";
import { exampleId } from "../errors.js";
import { clip, json } from "../format.js";
import type { FilesPort } from "../ports.js";
import { describe, flattenActions, jsonOf } from "../schema.js";
import { fileItem, fileLine, pagesIfAny, progressOf, untranscribedWarning } from "../sources.js";
import { defineTool, parseAction, parseWith, type ToolContext } from "../tool.js";

const FILE = exampleId("file");
const PAGE = exampleId("page");
const NODE = exampleId("node");

function files(ctx: ToolContext): FilesPort {
  const port = ctx.backend.files;
  if (!port) throw new AppError("internal", "Files are not available.");
  return port;
}

function converterLine(port: FilesPort): string {
  const c = port.converterStatus();
  const busy = `${c.queued} queued, ${c.processing} converting`;
  return c.state === "online"
    ? `Converter: online (${busy}).`
    : `Converter: ${c.state}${c.lastSeenAt ? ` (last seen ${c.lastSeenAt})` : ""}, ${busy}. While it is not online nothing converts; tell her.`;
}

// ---------------------------------------------------------------------------
// source_files: the inbox workflow and where uploaded files are filed
// ---------------------------------------------------------------------------

/** Longest single wait, under the 60-second tool timeout some agents use. */
export const MAX_WAIT_SECONDS = 25;

/**
 * The shared input, with each file's size optional: an agent that cannot
 * measure a file (no shell) may leave it out and gets the largest size
 * allowed, which is what the link then accepts.
 */
const UploadFile = RequestUploadsInput.shape.files.element;
const UploadInput = z.strictObject({
  ...RequestUploadsInput.shape,
  files: z
    .array(z.strictObject({ ...UploadFile.shape, bytes: UploadFile.shape.bytes.optional() }))
    .min(1)
    .max(UPLOAD_LIMITS.maxBatch),
});
/** File or move, turning the domain's refusal for untranscribed pages into a tool example. */
function fileUnder(
  port: FilesPort,
  ctx: ToolContext,
  v: { fileId: string; nodeId?: string | null; force?: boolean; reason?: string },
) {
  try {
    return port.fileUnder(ctx.auth, v.fileId, v.nodeId ?? null, {
      force: v.force,
      reason: v.reason,
    });
  } catch (error) {
    const example = error instanceof AppError ? (error.example as { force?: boolean }) : null;
    if (!(error instanceof AppError) || !example || example.force !== true) throw error;
    throw new AppError(error.code, error.message, {
      hint: 'Read each of those pages (get_page) and save_transcript it, then file again. Only if a page truly cannot be transcribed, file again with "force": true and a short "reason" (recorded in the activity log).',
      example: {
        action: "file",
        fileId: v.fileId,
        nodeId: v.nodeId,
        force: true,
        reason: "page 3 is a blank scan",
      },
    });
  }
}

/** Upload links for local files (source_files "upload_links"). */
function uploadLinks(ctx: ToolContext, input: z.output<typeof UploadInput>) {
  const tickets = files(ctx).requestUploads(ctx.auth, {
    ...input,
    files: input.files.map((f) => ({ name: f.name, bytes: f.bytes ?? UPLOAD_LIMITS.maxBytes })),
  });
  const lines = [
    `${tickets.length} upload link(s). Send each file with one plain curl command per file, giving the file's absolute path after the @ (no cd, no &&: agent permission rules often allow only a bare curl). No key is needed. Each PUT answers with JSON whose file.id is the new file's ID.`,
    ...tickets.map(
      (t) =>
        `- ${t.name} (expires ${t.expiresAt}): curl -sS -X PUT --data-binary @${json(`/absolute/path/to/${t.name}`)} "${t.url}"`,
    ),
    'Then wait for conversion: source_files {"action":"wait","fileIds":[<the ids from the PUT responses>]}, or source_files {"action":"list"}.',
  ];
  return { text: lines.join("\n"), structured: { tickets } };
}

/** Filing a file whose pages are not all transcribed is refused unless forced with a reason. */
const FORCE = {
  force: z.boolean().optional(),
  reason: z.string().trim().min(3).max(200).optional(),
};

const FILE_BRANCHES = {
  upload_links: UploadInput,
  list: z.strictObject({
    nodeId: NodeId.optional(),
    status: FileStatus.optional(),
    cursor: PageRequest.shape.cursor,
    limit: z.number().int().min(1).max(50).default(20),
  }),
  wait: z.strictObject({
    fileIds: z.array(FileId).min(1).max(20),
    timeoutSeconds: z.number().int().min(1).max(MAX_WAIT_SECONDS).default(20),
  }),
  claim: z.strictObject({ fileId: FileId }),
  release: z.strictObject({ fileId: FileId }),
  file: z.strictObject({ fileId: FileId, nodeId: NodeId, ...FORCE }),
  move: z.strictObject({ fileId: FileId, nodeId: NodeId.nullable(), ...FORCE }),
  retry: z.strictObject({ fileId: FileId }),
};
type FileAction = keyof typeof FILE_BRANCHES;

const FILE_EXAMPLES: Record<FileAction, Record<string, unknown>> = {
  list: { action: "list" },
  wait: { action: "wait", fileIds: [FILE] },
  claim: { action: "claim", fileId: FILE },
  release: { action: "release", fileId: FILE },
  file: { action: "file", fileId: FILE, nodeId: NODE },
  move: { action: "move", fileId: FILE, nodeId: NODE },
  retry: { action: "retry", fileId: FILE },
  upload_links: { action: "upload_links", files: [{ name: "lecture-07.pdf" }] },
};

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const pending = (f: SourceFile) => f.status === "converting" || f.status === "uploaded";

export const sourceFiles = defineTool({
  name: "source_files",
  title: "Uploaded files: inbox, conversion, filing and moving",
  description: `Her uploaded source files (slides, PDFs, photos of handwritten notes). To upload files from your machine: "upload_links" (one per file; size optional), then one bare curl per file with its absolute path: curl -sS -X PUT --data-binary @"/abs/path/lecture.pdf" "<url>" (links are single use, last ${UPLOAD_LIMITS.linkTtlSeconds / 60} minutes and need no key; PDF, PPTX, JPEG, PNG, HEIC up to ${UPLOAD_LIMITS.maxBytes / 1024 / 1024} MB). Each upload is converted to page images (status converting, then converted; or failed), then transcribed (transcribed), then filed under a lecture, folder or Sources section (filed). Actions: "list" the inbox with each file's status and how many pages are transcribed (with nodeId: the files filed there); "wait" until files finish converting (waits up to ${MAX_WAIT_SECONDS} s per call, call again if still converting); "claim" a file before transcribing it so no other agent works on it (claims expire after a while; claim again to renew); "release" it when done or if you stop; "file" it under the right lecture (refused while any page has no transcript, naming the pages; only if a page truly cannot be transcribed, pass "force": true with a short "reason", which is logged); "move" a filed file to another place, or back to the inbox with nodeId null; "retry" a failed conversion. Library items (folders, lectures, documents) move with edit_library instead.`,
  annotations: {
    readOnlyHint: false,
    destructiveHint: false,
    idempotentHint: false,
    openWorldHint: false,
  },
  inputSchema: describe(
    flattenActions(
      "action",
      Object.fromEntries(Object.entries(FILE_BRANCHES).map(([k, v]) => [k, jsonOf(v)])),
      '"upload_links" for local files; "list" the inbox (or the files under a node); "wait" for conversion; "claim" a file to work on; "release" a claim; "file" a file under a lecture, folder or Sources section; "move" it elsewhere or back to the inbox (nodeId null); "retry" a failed conversion.',
    ),
    {
      status: 'list: only files with this status, e.g. "converted" for files ready to transcribe.',
      cursor: "list: the nextCursor of the previous list call.",
      limit: "list: files per page, 1 to 50 (default 20).",
      fileIds: `wait: the files to wait for, e.g. ["${FILE}"].`,
      timeoutSeconds: `wait: how long to wait at most, 1 to ${MAX_WAIT_SECONDS} seconds (default 20).`,
      fileId: `The file, e.g. "${FILE}".`,
      files: `upload_links: one entry per file, 1 to ${UPLOAD_LIMITS.maxBatch}.`,
      "files[].name": 'upload_links: the file name, e.g. "lecture-07.pdf".',
      "files[].bytes":
        "upload_links, optional: the size in bytes or an upper bound (the link accepts up to this many); leave it out if you cannot measure the file.",
      force:
        'file, move: file anyway although some pages have no transcript (only if they truly cannot be transcribed); needs "reason".',
      reason: 'file, move: with "force", why, in a few words; it is recorded in the activity log.',
      nodeId: `upload_links: optionally file the uploads here once converted. file and move: the lecture, folder or Sources section to put it under, e.g. "${NODE}"; for move, null returns it to the inbox. list: show the files filed under this node instead of the inbox.`,
    },
  ),
  parse: (raw) => parseAction("source_files", "action", FILE_BRANCHES, FILE_EXAMPLES, raw),
  writes: (input) => !["list", "wait"].includes((input as { action: string }).action),
  action: (input) => (input as { action: string }).action,
  async run(ctx, input) {
    const port = files(ctx);
    const { action, value } = input as unknown as {
      action: FileAction;
      value: Record<string, unknown>;
    };
    if (action === "list") {
      const v = value as unknown as z.output<typeof FILE_BRANCHES.list>;
      const page = port.listFiles(ctx.auth, {
        ...(v.nodeId ? { nodeId: v.nodeId } : { inbox: true }),
        status: v.status,
        cursor: v.cursor,
        limit: v.limit,
      });
      const rows = page.items.map((f) => ({ f, p: progressOf(pagesIfAny(port, ctx.auth, f)) }));
      const lines = [
        v.nodeId
          ? `Files filed under ${v.nodeId}:`
          : `Inbox (files not filed yet), newest first. ${converterLine(port)}`,
        ...rows.map(({ f, p }) => fileLine(f, p)),
      ];
      if (rows.length === 0) lines.push(v.nodeId ? "(no files here)" : "(nothing waiting)");
      if (page.nextCursor) {
        lines.push(
          `More: source_files ${json({ action: "list", ...(v.nodeId ? { nodeId: v.nodeId } : {}), cursor: page.nextCursor })}.`,
        );
      }
      return {
        text: lines.join("\n"),
        structured: {
          converter: port.converterStatus(),
          items: rows.map(({ f, p }) => fileItem(f, p)),
          nextCursor: page.nextCursor,
        },
      };
    }
    if (action === "upload_links") {
      return uploadLinks(ctx, value as unknown as z.output<typeof UploadInput>);
    }
    if (action === "wait") {
      const v = value as unknown as z.output<typeof FILE_BRANCHES.wait>;
      // Real time, not the injected clock: this waits for the converter.
      const deadline = Date.now() + v.timeoutSeconds * 1000;
      let current = v.fileIds.map((id) => port.getFile(ctx.auth, id));
      while (current.some(pending) && Date.now() < deadline) {
        if (port.converterStatus().state === "offline") break;
        await sleep(500);
        current = v.fileIds.map((id) => port.getFile(ctx.auth, id));
      }
      const waiting = current.filter(pending);
      const failed = current.filter((f) => f.status === "failed");
      const head =
        waiting.length === 0
          ? failed.length === 0
            ? "All converted: claim each file and transcribe its pages."
            : `Done converting; ${failed.length} failed (see below; retry, or tell her if it is the file itself).`
          : `${waiting.length} still converting after ${v.timeoutSeconds} s. Call wait again (large decks take a minute or two).`;
      const rows = current.map((f) => ({ f, p: progressOf(pagesIfAny(port, ctx.auth, f)) }));
      return {
        text: [head, converterLine(port), ...rows.map(({ f, p }) => fileLine(f, p))].join("\n"),
        structured: {
          done: waiting.length === 0,
          converter: port.converterStatus(),
          items: rows.map(({ f, p }) => fileItem(f, p)),
        },
      };
    }
    const v = value as unknown as {
      fileId: string;
      nodeId?: string | null;
      force?: boolean;
      reason?: string;
    };
    const before = action === "move" ? port.getFile(ctx.auth, v.fileId) : null;
    const file =
      action === "claim"
        ? port.claim(ctx.auth, v.fileId)
        : action === "release"
          ? port.release(ctx.auth, v.fileId)
          : action === "retry"
            ? port.retry(ctx.auth, v.fileId)
            : fileUnder(port, ctx, v);
    const progress = progressOf(pagesIfAny(port, ctx.auth, file));
    const warning = untranscribedWarning(progress);
    const said: Record<Exclude<FileAction, "list" | "wait" | "upload_links">, string> = {
      claim: `Claimed (a claim expires after a while; claim again to renew it on long work):\n${fileLine(file, progress)}\nNext: get_item {"id":"${file.id}"} lists its pages; get_page shows each one.`,
      release: `Released:\n${fileLine(file, progress)}`,
      retry: `Queued for conversion again:\n${fileLine(file, progress)}\nWait with source_files {"action":"wait","fileIds":["${file.id}"]}.`,
      file: `Filed${v.force ? " (forced, reason recorded)" : ""}:\n${fileLine(file, progress)}${warning ? `\n${warning}` : ""}\nRelease the claim when you are done with it.`,
      move:
        v.nodeId === null
          ? `Returned to the inbox (was under ${before?.nodeId ?? "nothing"}):\n${fileLine(file, progress)}`
          : `Moved (was ${before?.nodeId ? `under ${before.nodeId}` : "in the inbox"}):\n${fileLine(file, progress)}${warning ? `\n${warning}` : ""}`,
    };
    return {
      text: said[action],
      structured: {
        action,
        file: fileItem(file, progress),
        ...(before ? { previousNodeId: before.nodeId } : {}),
        ...(warning ? { untranscribedPages: progress.missing } : {}),
      },
    };
  },
});

// ---------------------------------------------------------------------------
// get_page
// ---------------------------------------------------------------------------

/** Inline images above this size are sent as a link instead. */
export const INLINE_IMAGE_MAX_BYTES = 1_500_000;

const GetPageInput = z.strictObject({
  pageId: PageId,
  image: z.enum(["inline", "link", "none"]).default("inline"),
  size: z.enum(["page", "thumb"]).default("page"),
});

export const getPage = defineTool({
  name: "get_page",
  title: "Look at a source page",
  description: `One page of an uploaded file: the page image inline (so you can read it), the text taken straight from the file, speaker notes, its current transcript (text and flags), and the previous and next page IDs. The image is the authority: native text may be out of order or incomplete, and handwriting has none. For many pages (bulk work), ask for image "link" and download each with curl (no key needed; links last five minutes), then read the files; this keeps large images out of the conversation.`,
  annotations: {
    readOnlyHint: true,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: false,
  },
  inputSchema: describe(jsonOf(GetPageInput), {
    pageId: `The page, e.g. "${PAGE}". Page IDs come from get_item on a file.`,
    image:
      '"inline" (default) returns the image in the result; "link" returns a short-lived download URL instead; "none" returns text only.',
    size: '"page" (default, at most 1568 px on the long edge, for reading) or "thumb" (small, for a quick look).',
  }),
  parse: (raw) =>
    parseWith("get_page", GetPageInput, raw, { pageId: PAGE }) as z.output<typeof GetPageInput>,
  writes: () => false,
  action: (input) => input.image,
  run(ctx, input) {
    const port = files(ctx);
    const page = port.getPage(ctx.auth, input.pageId);
    const file = port.getFile(ctx.auth, page.fileId);
    const all = port.listPages(ctx.auth, page.fileId);
    const at = all.findIndex((p) => p.id === page.id);
    const previousPageId = all[at - 1]?.id ?? null;
    const nextPageId = all[at + 1]?.id ?? null;
    const transcript = port.getTranscript(ctx.auth, page.id);
    const native = page.nativeText ? clip(page.nativeText, 8000) : null;
    const notes = page.speakerNotes ? clip(page.speakerNotes, 4000) : null;
    const lines = [
      `Page ${page.id}: page ${page.index} of ${all.length} in "${file.originalName}" (file ${file.id}). ${page.width}x${page.height}.`,
      `Previous page: ${previousPageId ?? "none"}. Next page: ${nextPageId ?? "none"}.`,
      transcript
        ? `Current transcript ${transcript.id}, revision ${transcript.revision}, ${transcript.reviewStatus}, flags ${transcript.flags.map((f) => `${f.kind} "${f.quote}"`).join("; ") || "none"}:\n${clip(transcript.text, 20000).text}\n(Saving again with save_transcript makes a new revision.)`
        : `Not transcribed yet. Save one with save_transcript {"pageId":"${page.id}","text":"…","flags":[…]}.`,
      native
        ? `Native text from the file (may be out of order; the image is the authority)${native.clipped ? ", clipped" : ""}:\n${native.text}`
        : "No native text (image-only page): read the image.",
    ];
    if (notes) lines.push(`Speaker notes${notes.clipped ? " (clipped)" : ""}:\n${notes.text}`);
    if (ctx.backend.documents) {
      const count = ctx.backend.documents.citedByCount(ctx.auth, page.id);
      if (count > 0) lines.push(`Cited by ${count} block(s).`);
    }
    const images: Array<{ data: string; mimeType: string }> = [];
    let link: { url: string; expiresAt: string } | null = null;
    if (input.image === "inline") {
      const img = port.pageImage(ctx.auth, page.id, input.size);
      if (img.data.byteLength <= INLINE_IMAGE_MAX_BYTES) {
        images.push({ data: Buffer.from(img.data).toString("base64"), mimeType: img.mimeType });
        lines.push(`Image attached (${img.mimeType}, ${img.data.byteLength} bytes).`);
      } else {
        link = port.pageImageLink(ctx.auth, page.id, input.size);
        lines.push(
          `Image too large to attach (${img.data.byteLength} bytes); download it instead.`,
        );
      }
    } else if (input.image === "link") {
      link = port.pageImageLink(ctx.auth, page.id, input.size);
    }
    if (link) {
      lines.push(
        `Download (no key needed, expires ${link.expiresAt}): curl -sS -o page-${page.index}.webp "${link.url}"`,
      );
    }
    return {
      text: lines.join("\n"),
      structured: {
        // Text bodies are in the message, once.
        page: {
          id: page.id,
          fileId: page.fileId,
          index: page.index,
          width: page.width,
          height: page.height,
          hasTextLayer: page.hasTextLayer,
          hasSpeakerNotes: page.speakerNotes !== null,
        },
        file: fileItem(file),
        previousPageId,
        nextPageId,
        transcript: transcript
          ? {
              id: transcript.id,
              revision: transcript.revision,
              reviewStatus: transcript.reviewStatus,
            }
          : null,
        imageLink: link,
      },
      ...(images.length ? { images } : {}),
    };
  },
});

// ---------------------------------------------------------------------------
// save_transcript
// ---------------------------------------------------------------------------

const SaveInput = z.strictObject(SaveTranscriptInput.shape);

const FLAGGING_KINDS = new Set(["dose", "unit", "decimal", "uncertain", "illegible"]);

/**
 * Doses, units and decimals in the text that no flag covers. A value is
 * covered when a flag's quote, wherever it occurs in the text, overlaps the
 * value's digits: flagging "5.0", "5.0 mEq/L" or "3.5-5.0 mEq/L" all cover
 * the "5.0 mEq" in "K+ 3.5-5.0 mEq/L".
 */
export function unflaggedNumbers(text: string, flags: TranscriptFlag[]): string[] {
  const spans: Array<[number, number]> = [];
  for (const flag of flags) {
    if (!FLAGGING_KINDS.has(flag.kind)) continue;
    for (let at = text.indexOf(flag.quote); at >= 0; at = text.indexOf(flag.quote, at + 1)) {
      spans.push([at, at + flag.quote.length]);
    }
  }
  const found = new Set<string>();
  for (const match of text.matchAll(MUST_FLAG)) {
    const token = match[0].trim();
    const digits = /\d+(?:[.,]\d+)?/.exec(token)?.[0] ?? token;
    const start = (match.index ?? 0) + match[0].indexOf(digits);
    const end = start + digits.length;
    if (!spans.some(([a, b]) => a < end && start < b)) found.add(token);
  }
  return [...found];
}

const SAVE_EXAMPLE = {
  pageId: PAGE,
  text: "Metoprolol 25 mg PO BID\nHold if HR < 55",
  flags: [
    { kind: "dose", quote: "25 mg" },
    { kind: "uncertain", quote: "55", note: "could be 35" },
  ],
};

export const saveTranscript = defineTool({
  name: "save_transcript",
  title: "Save a page transcript",
  description: `Save what a page says, verbatim, as a new revision of its transcript (earlier revisions are kept; she reviews it later). Rules: copy exactly what is written, keep line breaks, render tables as "a | b | c" rows, never silently correct a misspelling or a dose. Flag anything she should check: every dose, unit and decimal number (kind "dose", "unit" or "decimal"), uncertain or illegible words, and drug names you are unsure of. Each flag's "quote" must be the exact characters in the text. A save with an unflagged dose or decimal is refused with the list to add. Claim the file first (source_files claim); another agent's claim blocks the save. Your exact wording matters later: citations quote it character for character.`,
  annotations: {
    readOnlyHint: false,
    destructiveHint: false,
    idempotentHint: false,
    openWorldHint: false,
  },
  inputSchema: describe(jsonOf(SaveInput), {
    pageId: `The page this transcript is for, e.g. "${PAGE}".`,
    text: "The page's text, verbatim, up to 200,000 characters. Use \\n for line breaks.",
    flags:
      "Spots she should check against the image. Every dose, unit and decimal must be flagged.",
    "flags[].kind":
      '"dose", "unit", "decimal", "uncertain" (you are not sure of the reading), "illegible" (cannot be read), or "drug_name" (check the spelling).',
    "flags[].quote": 'The exact characters in text this flag is about, e.g. "25 mg".',
    "flags[].note": 'Optional: what is uncertain, e.g. "could be 35".',
  }),
  parse(raw) {
    const input = parseWith("save_transcript", SaveInput, raw, SAVE_EXAMPLE) as z.output<
      typeof SaveInput
    >;
    const missingQuote = input.flags.findIndex((f) => !input.text.includes(f.quote));
    if (missingQuote >= 0) {
      throw new AppError(
        "invalid_input",
        `flags[${missingQuote}].quote "${input.flags[missingQuote]?.quote}" does not appear in text.`,
        {
          hint: "A flag's quote must be copied character for character from the transcript text, so she can see it highlighted.",
          example: SAVE_EXAMPLE,
        },
      );
    }
    const unflagged = unflaggedNumbers(input.text, input.flags);
    if (unflagged.length > 0) {
      const shown = unflagged.slice(0, 12);
      throw new AppError(
        "invalid_input",
        `flags: ${unflagged.length} dose, unit or decimal value(s) are not flagged: ${shown.map((t) => `"${t}"`).join(", ")}${unflagged.length > shown.length ? ", …" : ""}.`,
        {
          hint: 'Every dose, unit and decimal must carry a flag so she checks it against the page. Add these flags (kind "dose" for doses, "unit" for lab values with units, "decimal" for other decimals) and save again.',
          example: {
            pageId: input.pageId,
            text: "(your text, unchanged)",
            flags: [
              ...input.flags,
              ...shown.map((quote) => ({
                kind: /\d\s?[A-Za-zµ%]/.test(quote) ? "dose" : "decimal",
                quote,
              })),
            ],
          },
        },
      );
    }
    return input;
  },
  writes: () => true,
  action: () => null,
  run(ctx, input) {
    const port = files(ctx);
    const t = port.saveTranscript(ctx.auth, input);
    const page = port.getPage(ctx.auth, t.pageId);
    const progress = progressOf(port.listPages(ctx.auth, page.fileId));
    const left =
      progress.missing.length === 0
        ? (() => {
            const file = port.getFile(ctx.auth, page.fileId);
            return file.nodeId
              ? "Every page of this file is transcribed."
              : `Every page of this file is transcribed. Next: file it under its lecture, source_files {"action":"file","fileId":"${file.id}","nodeId":"<lecture id>"}.`;
          })()
        : `${progress.missing.length} page(s) of this file still need a transcript: ${progress.missing.slice(0, 5).join(", ")}${progress.missing.length > 5 ? ", …" : ""}.`;
    return {
      text: `Saved transcript ${t.id} for page ${t.pageId}: revision ${t.revision}, ${t.text.length} characters, ${t.flags.length} flag(s), ${t.reviewStatus} until she reviews it. ${left}`,
      structured: {
        transcript: {
          id: t.id,
          pageId: t.pageId,
          revision: t.revision,
          reviewStatus: t.reviewStatus,
          flags: t.flags.length,
        },
      },
    };
  },
});
