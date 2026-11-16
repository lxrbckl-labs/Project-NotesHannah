import {
  FileId,
  FileStatus,
  NodeId,
  PageId,
  PageRequest,
  RequestUploadsInput,
  SaveTranscriptInput,
  type TranscriptFlag,
  UPLOAD_LIMITS,
} from "@notes/schema";
import { z } from "zod";
import { AppError } from "../../http/errors.js";
import { exampleId } from "../errors.js";
import { clip, json } from "../format.js";
import { describe, flattenActions, jsonOf } from "../schema.js";
import { defineTool, parseAction, parseWith, type ToolContext } from "../tool.js";
import { fileItem, fileLine } from "./get-item.js";

const FILE = exampleId("file");
const PAGE = exampleId("page");
const NODE = exampleId("node");

function files(ctx: ToolContext) {
  const port = ctx.ports.files;
  if (!port) throw new AppError("internal", "Files are not available.");
  return port;
}

// ---------------------------------------------------------------------------
// source_files: the inbox workflow and where uploaded files are filed
// ---------------------------------------------------------------------------

const FILE_BRANCHES = {
  list: z.strictObject({
    nodeId: NodeId.optional(),
    status: FileStatus.optional(),
    cursor: PageRequest.shape.cursor,
    limit: z.number().int().min(1).max(50).default(20),
  }),
  claim: z.strictObject({ fileId: FileId }),
  release: z.strictObject({ fileId: FileId }),
  file: z.strictObject({ fileId: FileId, nodeId: NodeId }),
  move: z.strictObject({ fileId: FileId, nodeId: NodeId.nullable() }),
};
type FileAction = keyof typeof FILE_BRANCHES;

const FILE_EXAMPLES: Record<FileAction, Record<string, unknown>> = {
  list: { action: "list" },
  claim: { action: "claim", fileId: FILE },
  release: { action: "release", fileId: FILE },
  file: { action: "file", fileId: FILE, nodeId: NODE },
  move: { action: "move", fileId: FILE, nodeId: NODE },
};

export const sourceFiles = defineTool({
  name: "source_files",
  title: "Uploaded files: the inbox, filing and moving",
  description: `Her uploaded source files (slides, PDFs, photos of handwritten notes). New uploads wait in the inbox until filed. Inbox workflow per file: "list" (no nodeId) shows the inbox; "claim" one so no other agent works on it; open its pages with get_item {"id":"fil_…"} and get_page; transcribe each page with save_transcript; create or find its lecture with edit_library; then "file" it under that lecture (or a folder), which ends the claim; "release" gives a claim back if you stop. To move a file that is already filed to another lecture or folder, use "move" with the new nodeId; "move" with nodeId null returns it to the inbox. "list" with a nodeId shows the files filed there. (Library items such as folders, lectures and documents move with edit_library instead.) Statuses: uploaded, converting, converted (ready to transcribe), transcribed, filed, failed.`,
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
      '"list" the inbox (or the files under a node); "claim" a file to work on; "release" a claim; "file" an inbox file under a lecture or folder when done; "move" a file to another lecture or folder, or back to the inbox (nodeId null).',
    ),
    {
      status: 'list: only files with this status, e.g. "converted" for files ready to transcribe.',
      cursor: "list: the nextCursor of the previous list call.",
      limit: "list: files per page, 1 to 50 (default 20).",
      fileId: `The file, e.g. "${FILE}".`,
      nodeId: `file and move: the lecture or folder to put it under, e.g. "${NODE}"; for move, null returns it to the inbox. list: show the files filed under this node instead of the inbox.`,
    },
  ),
  parse: (raw) => parseAction("source_files", "action", FILE_BRANCHES, FILE_EXAMPLES, raw),
  writes: (input) => (input as { action: string }).action !== "list",
  action: (input) => (input as { action: string }).action,
  run(ctx, input) {
    const port = files(ctx);
    const { action, value } = input as unknown as {
      action: FileAction;
      value: Record<string, unknown>;
    };
    if (action === "list") {
      const v = value as unknown as z.output<typeof FILE_BRANCHES.list>;
      const opts = { cursor: v.cursor, limit: v.limit };
      const page = v.nodeId
        ? port.listFilesUnder(ctx.userId, v.nodeId, opts)
        : port.listInbox(ctx.userId, { ...opts, status: v.status });
      const summary = port.inboxSummary(ctx.userId);
      const lines = [
        v.nodeId
          ? `Files filed under ${v.nodeId}:`
          : `Inbox: ${summary.pending} file(s) pending. Converter: ${summary.converter}${summary.converterNote ? ` (${summary.converterNote})` : ""}.`,
        ...page.items.map(fileLine),
      ];
      if (page.items.length === 0) lines.push(v.nodeId ? "(no files here)" : "(nothing waiting)");
      if (page.nextCursor) {
        lines.push(
          `More: source_files ${json({ action: "list", ...(v.nodeId ? { nodeId: v.nodeId } : {}), cursor: page.nextCursor })}.`,
        );
      }
      return {
        text: lines.join("\n"),
        structured: { summary, items: page.items.map(fileItem), nextCursor: page.nextCursor },
      };
    }
    const v = value as unknown as { fileId: string; nodeId?: string | null };
    const before = action === "move" ? port.getFile(ctx.userId, v.fileId) : null;
    const file =
      action === "claim"
        ? port.claim(ctx.actor, ctx.userId, v.fileId)
        : action === "release"
          ? port.release(ctx.actor, ctx.userId, v.fileId)
          : port.fileUnder(ctx.actor, ctx.userId, v.fileId, v.nodeId ?? null);
    /** Filing is allowed before transcription; say so when pages are still missing. */
    const untranscribedNote = (): string => {
      const pages = port.listPages(ctx.userId, file.id, { limit: 500 }).items;
      const missing = pages.filter((p) => p.transcriptId === null);
      return missing.length === 0
        ? ""
        : `\nNote: ${missing.length} of ${pages.length} page(s) have no transcript yet (${missing
            .slice(0, 5)
            .map((p) => p.id)
            .join(", ")}${missing.length > 5 ? ", …" : ""}). Transcribe them with save_transcript.`;
    };
    const said: Record<Exclude<FileAction, "list">, string> = {
      claim: `Claimed:\n${fileLine(file)}\nNext: get_item {"id":"${file.id}"} to list its pages, then get_page for each.`,
      release: `Released:\n${fileLine(file)}\nThe file is free for another agent.`,
      file: `Filed:\n${fileLine(file)}\nDone with this file.${untranscribedNote()}`,
      move:
        v.nodeId === null
          ? `Returned to the inbox (was under ${before?.nodeId ?? "nothing"}):\n${fileLine(file)}`
          : `Moved (was ${before?.nodeId ? `under ${before.nodeId}` : "in the inbox"}):\n${fileLine(file)}`,
    };
    return {
      text: said[action],
      structured: {
        action,
        file: fileItem(file),
        ...(before ? { previousNodeId: before.nodeId } : {}),
      },
      targets: [
        file.id,
        ...(v.nodeId ? [v.nodeId] : []),
        ...(before?.nodeId ? [before.nodeId] : []),
      ],
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
  description: `One page of an uploaded file: the page image (inline, so you can read it), any text taken straight from the file, speaker notes, its current transcript status, and the previous and next page IDs. The image is the authority: native text may be out of order or missing (handwriting has none). For many pages or big images ask for image "link" and download it with curl (no key needed; valid for minutes).`,
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
    size: '"page" (default, about 1568 px on the long edge, for reading) or "thumb" (small, for a quick look).',
  }),
  parse: (raw) =>
    parseWith("get_page", GetPageInput, raw, { pageId: PAGE }) as z.output<typeof GetPageInput>,
  writes: () => false,
  action: (input) => input.image,
  run(ctx, input) {
    const port = files(ctx);
    const view = port.getPage(ctx.userId, input.pageId);
    const { page, file } = view;
    const native = page.nativeText ? clip(page.nativeText, 8000) : null;
    const notes = page.speakerNotes ? clip(page.speakerNotes, 4000) : null;
    const lines = [
      `Page ${page.id}: page ${page.index} of ${file.pageCount ?? "?"} in "${file.originalName}" (file ${file.id}). ${page.width}x${page.height}.`,
      `Previous page: ${view.previousPageId ?? "none"}. Next page: ${view.nextPageId ?? "none"}.`,
      view.transcript
        ? `Transcript: ${view.transcript.id}, revision ${view.transcript.revision}, ${view.transcript.reviewStatus}. Read it with get_item; replace it with save_transcript.`
        : `Not transcribed yet. Save one with save_transcript {"pageId":"${page.id}","text":"…","flags":[…]}.`,
      native
        ? `Native text from the file (may be out of order; the image is the authority)${native.clipped ? ", clipped" : ""}:\n${native.text}`
        : "No native text (image-only page): read the image.",
    ];
    if (notes) lines.push(`Speaker notes${notes.clipped ? " (clipped)" : ""}:\n${notes.text}`);
    let backlinks: unknown = null;
    if (ctx.ports.documents?.pageBacklinks) {
      const b = ctx.ports.documents.pageBacklinks(ctx.userId, page.id);
      backlinks = b.items.slice(0, 20);
      lines.push(`Cited by ${b.items.length} item(s).`);
    }
    const images: Array<{ data: string; mimeType: string }> = [];
    let link: { url: string; expiresAt: string } | null = null;
    if (input.image === "inline") {
      const img = port.pageImage(ctx.userId, page.id, input.size);
      if (img.data.byteLength <= INLINE_IMAGE_MAX_BYTES) {
        images.push({ data: Buffer.from(img.data).toString("base64"), mimeType: img.mimeType });
        lines.push(`Image attached (${img.width}x${img.height}, ${img.mimeType}).`);
      } else {
        link = port.pageImageLink(ctx.userId, page.id, input.size);
        lines.push(
          `Image too large to attach (${img.data.byteLength} bytes); download it instead.`,
        );
      }
    } else if (input.image === "link") {
      link = port.pageImageLink(ctx.userId, page.id, input.size);
    }
    if (link) {
      lines.push(
        `Download (no key needed, expires ${link.expiresAt}): curl -sS -o page-${page.index}.img "${link.url}"`,
      );
    }
    return {
      text: lines.join("\n"),
      structured: {
        // Native text and speaker notes are in the message, once.
        page: {
          id: page.id,
          fileId: page.fileId,
          index: page.index,
          width: page.width,
          height: page.height,
          hasTextLayer: page.hasTextLayer,
          hasSpeakerNotes: page.speakerNotes !== null,
          transcriptId: page.transcriptId,
        },
        file,
        previousPageId: view.previousPageId,
        nextPageId: view.nextPageId,
        transcript: view.transcript,
        imageLink: link,
        ...(backlinks ? { citedBy: backlinks } : {}),
      },
      ...(images.length ? { images } : {}),
    };
  },
});

// ---------------------------------------------------------------------------
// save_transcript
// ---------------------------------------------------------------------------

const SaveInput = z.strictObject(SaveTranscriptInput.shape);

/** Numbers that must be flagged: decimals, and numbers with a dose or lab unit. */
const MUST_FLAG =
  /\b\d+(?:[.,]\d+)?\s?(?:mg\/kg|mcg|µg|mg|g|kg|mL|ml|L|units?|IU|mEq|mmol|mL\/min|%)(?![A-Za-z])|\b\d+\.\d+\b/g;
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
  description: `Save what a page says, verbatim, as a new revision of its transcript (earlier revisions are kept; she reviews it later). Rules: copy exactly what is written, keep line breaks, render tables as "a | b | c" rows, never silently correct a misspelling or a dose. Flag anything she should check: every dose, unit and decimal number (kind "dose", "unit" or "decimal"), uncertain or illegible words, and drug names you are unsure of. Each flag's "quote" must be the exact characters in the text. A save with an unflagged dose or decimal is refused with the list to add.`,
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
    const t = files(ctx).saveTranscript(ctx.actor, ctx.userId, input);
    return {
      text: `Saved transcript ${t.id} for page ${t.pageId}: revision ${t.revision}, ${t.text.length} characters, ${t.flags.length} flag(s), ${t.reviewStatus} until she reviews it.`,
      structured: {
        transcript: {
          id: t.id,
          pageId: t.pageId,
          revision: t.revision,
          reviewStatus: t.reviewStatus,
          flags: t.flags.length,
        },
      },
      targets: [t.id, t.pageId],
    };
  },
});

// ---------------------------------------------------------------------------
// request_upload_links
// ---------------------------------------------------------------------------

const UploadInput = z.strictObject(RequestUploadsInput.shape);
const UPLOAD_EXAMPLE = { files: [{ name: "lecture-07.pdf", bytes: 2400000 }], nodeId: NODE };

export const requestUploadLinks = defineTool({
  name: "request_upload_links",
  title: "Get upload links for local files",
  description: `Upload files from your machine into her inbox: ask for one link per file (name and size in bytes), then send each file with an HTTP PUT of the raw bytes, e.g. curl -sS -X PUT --data-binary @"lecture-07.pdf" "<url>". Links are single use, expire after ${UPLOAD_LIMITS.linkTtlSeconds / 60} minutes and need no key. Accepted: PDF, PPTX, JPEG, PNG, HEIC, up to ${UPLOAD_LIMITS.maxBytes / 1024 / 1024} MB and ${UPLOAD_LIMITS.maxPages} pages each, ${UPLOAD_LIMITS.maxBatch} files per call. Uploaded files are converted to page images and appear in the inbox.`,
  annotations: {
    readOnlyHint: false,
    destructiveHint: false,
    idempotentHint: false,
    openWorldHint: false,
  },
  inputSchema: describe(jsonOf(UploadInput), {
    files: `One entry per file, 1 to ${UPLOAD_LIMITS.maxBatch}.`,
    "files[].name": 'The file name, e.g. "lecture-07.pdf".',
    "files[].bytes": "The file size in bytes (e.g. from `wc -c` or `stat`).",
    nodeId: `Optional: file the uploads under this lecture or folder once converted, e.g. "${NODE}". Omit to leave them in the inbox.`,
  }),
  parse: (raw) =>
    parseWith("request_upload_links", UploadInput, raw, UPLOAD_EXAMPLE) as z.output<
      typeof UploadInput
    >,
  writes: () => true,
  action: () => null,
  run(ctx, input) {
    const tickets = files(ctx).requestUploads(ctx.actor, ctx.userId, input);
    const lines = [
      `${tickets.length} upload link(s). Send each file with curl; no key is needed.`,
      ...tickets.map(
        (t) =>
          `- ${t.name} (${t.id}, expires ${t.expiresAt}): curl -sS -X PUT --data-binary @${json(t.name)} "${t.url}"`,
      ),
      'Then check the inbox: source_files {"action":"list"}.',
    ];
    return {
      text: lines.join("\n"),
      structured: { tickets },
      targets: tickets.map((t) => t.id),
    };
  },
});
