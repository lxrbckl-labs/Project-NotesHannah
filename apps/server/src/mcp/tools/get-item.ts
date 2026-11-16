import {
  BlockId,
  blockPlainText,
  type IdKind,
  type NodeWithLinks,
  PageRequest,
} from "@notes/schema";
import { z } from "zod";
import { AppError } from "../../http/errors.js";
import {
  checkIdShape,
  describeIdKind,
  exampleId,
  prefixList,
  routeForKind,
  translateLibraryError,
  withArticle,
} from "../errors.js";
import { childKindsOf, clip, nodeItem, nodeLine, placementRule } from "../format.js";
import { describe, jsonOf } from "../schema.js";
import { fileItem, fileLine, pagesIfAny, progressOf } from "../sources.js";
import { defineTool, parseWith, type ToolContext, type ToolOutput } from "../tool.js";

/** Most characters of page text returned by one call (all pages together). */
export const TEXT_WINDOW = 40_000;
/** Most blocks returned by one call. */
export const BLOCK_WINDOW = 40;

const GetInput = z.strictObject({
  id: z.string().min(1).max(200),
  documentId: z.string().max(40).optional(),
  text: z.boolean().default(false),
  cursor: PageRequest.shape.cursor,
  offset: z.number().int().min(0).default(0),
  limit: z.number().int().min(1).max(500).optional(),
});
type GetInput = z.output<typeof GetInput>;

function readableKinds(ctx: ToolContext): IdKind[] {
  return [
    "node",
    ...(ctx.backend.files ? (["file", "page"] as const) : []),
    ...(ctx.backend.documents ? (["document", "block"] as const) : []),
  ];
}

function files(ctx: ToolContext) {
  const port = ctx.backend.files;
  if (!port) throw new AppError("internal", "Files are not available.");
  return port;
}

function docs(ctx: ToolContext) {
  const port = ctx.backend.documents;
  if (!port) throw new AppError("internal", "Documents are not available.");
  return port;
}

function getNode(ctx: ToolContext, id: string, input: GetInput): ToolOutput {
  let node: NodeWithLinks;
  try {
    node = ctx.library.get(ctx.userId, id);
  } catch (error) {
    throw translateLibraryError(error, null, id);
  }
  const ancestors = node.ancestors.map((a) => {
    const n = ctx.library.get(ctx.userId, a);
    return { id: n.id, kind: n.kind, name: n.name };
  });
  const lines: string[] = [];
  const item = nodeItem(node);
  lines.push(`${node.kind} "${item.label}" (${node.id})`);
  lines.push(`Path: ${node.path}`);
  if (ancestors.length) {
    lines.push(
      `Parent: ${node.parentId}. Ancestors: ${ancestors.map((a) => `${a.kind} ${a.id}`).join(" > ")}`,
    );
  } else lines.push("Parent: none (top level).");
  if (node.trashedAt) {
    lines.push(
      `In the trash since ${node.trashedAt}. Restore with edit_library {"action":"restore","id":"${node.id}"}.`,
    );
  }
  const children = node.trashedAt
    ? { items: [], nextCursor: null }
    : ctx.library.list(ctx.userId, { parentId: id, cursor: input.cursor, limit: 25 });
  const childItems = children.items.map(nodeItem);
  lines.push(`Children (${node.childCount}):`, ...childItems.map(nodeLine));
  if (children.nextCursor) {
    lines.push(`More children: get_item with cursor "${children.nextCursor}", or browse_library.`);
  }
  lines.push(placementRule(node.kind));
  const links: Record<string, unknown> = {
    parent: node.parentId,
    ancestors,
    children: childItems,
    childrenNextCursor: children.nextCursor,
    canCreateHere: childKindsOf(node.kind),
  };
  if (ctx.backend.documents && (node.kind === "lecture" || node.kind === "document")) {
    const doc = ctx.backend.documents.documentForNode(ctx.auth, id);
    links.document = doc
      ? {
          id: doc.id,
          title: doc.title,
          kind: doc.kind,
          blockCount: doc.blockIds.length,
          revision: doc.revision,
        }
      : null;
    lines.push(
      doc
        ? `Document: ${doc.id} "${doc.title}" (${doc.kind}, ${doc.blockIds.length} blocks, revision ${doc.revision}).`
        : node.kind === "lecture"
          ? `No document yet. Write the lecture's note with write_document {"nodeId":"${id}","kind":"lecture_note",...}, or a study guide in the course's Study guides section with write_document {"parentId":"<Study guides id>",...}.`
          : `No content yet. Write it with write_document {"nodeId":"${id}",...}.`,
    );
  }
  if (
    ctx.backend.files &&
    (node.kind === "lecture" || node.kind === "folder" || node.kind === "section")
  ) {
    const port = ctx.backend.files;
    const filed = port.listFiles(ctx.auth, { nodeId: id, limit: 20 });
    const withProgress = filed.items.map((f) => ({
      f,
      p: progressOf(pagesIfAny(port, ctx.auth, f)),
    }));
    links.sources = withProgress.map(({ f, p }) => fileItem(f, p));
    if (filed.items.length) {
      lines.push("Source files filed here:", ...withProgress.map(({ f, p }) => fileLine(f, p)));
    }
  }
  return {
    text: lines.join("\n"),
    structured: {
      kind: "node",
      node: { ...item, createdAt: node.createdAt, updatedAt: node.updatedAt },
      links,
    },
  };
}

/** A file: its pages with transcript state, and with text=true their text, windowed. */
function getFile(ctx: ToolContext, id: string, input: GetInput): ToolOutput {
  const port = files(ctx);
  const file = port.getFile(ctx.auth, id);
  const pages = pagesIfAny(port, ctx.auth, file);
  const progress = progressOf(pages);
  const lines = [fileLine(file, progress).replace(/^- /, "File ")];
  if (file.status === "converting") {
    lines.push(
      'Still converting: pages appear when it is done. Wait with source_files {"action":"wait","fileIds":["' +
        id +
        '"]}.',
    );
  }
  const from = Math.min(input.offset, pages.length);
  const shown = pages.slice(from, from + (input.limit ?? 500));
  const pageRows: Array<Record<string, unknown>> = [];
  let budget = TEXT_WINDOW;
  let stoppedAt: number | null = null;
  if (shown.length)
    lines.push(input.text ? "Pages with their text:" : "Pages (open with get_page):");
  for (const [i, p] of shown.entries()) {
    const row: Record<string, unknown> = {
      id: p.id,
      index: p.index,
      transcriptId: p.transcriptId,
      hasNativeText: p.nativeText !== null,
    };
    if (!input.text) {
      lines.push(
        `- ${p.id} page ${p.index}${p.transcriptId ? `, transcript ${p.transcriptId}` : ", not transcribed"}${p.hasTextLayer ? ", has native text" : ", image only"}`,
      );
    } else {
      const transcript = p.transcriptId ? port.getTranscript(ctx.auth, p.id) : null;
      const body = transcript
        ? `[transcript revision ${transcript.revision}]\n${transcript.text}`
        : p.nativeText
          ? `[no transcript; native text from the file]\n${p.nativeText}`
          : "[no transcript and no native text: read the image with get_page]";
      if (body.length > budget && i > 0) {
        stoppedAt = p.index;
        break;
      }
      const cut = clip(body, budget);
      budget -= cut.text.length;
      lines.push(`--- page ${p.index} (${p.id})`, cut.text);
      row.transcriptRevision = transcript?.revision ?? null;
    }
    pageRows.push(row);
  }
  const nextOffset =
    stoppedAt !== null
      ? stoppedAt - 1
      : from + shown.length < pages.length
        ? from + shown.length
        : null;
  if (nextOffset !== null) {
    lines.push(
      `More pages: get_item ${JSON.stringify({ id, ...(input.text ? { text: true } : {}), offset: nextOffset })}.`,
    );
  }
  if (!input.text && pages.length) {
    lines.push(
      `All pages' text at once (for quoting in citations): get_item {"id":"${id}","text":true}.`,
    );
  }
  return {
    text: lines.join("\n"),
    structured: {
      kind: "file",
      file: fileItem(file, progress),
      pages: pageRows,
      nextOffset,
      links: { node: file.nodeId },
    },
  };
}

function getPageSummary(ctx: ToolContext, id: string): ToolOutput {
  const port = files(ctx);
  const page = port.getPage(ctx.auth, id);
  const transcript = port.getTranscript(ctx.auth, id);
  const lines = [
    `Page ${page.id}: page ${page.index} of file ${page.fileId}.`,
    transcript
      ? `Transcript ${transcript.id}, revision ${transcript.revision}, ${transcript.reviewStatus}:\n${clip(transcript.text, TEXT_WINDOW).text}`
      : "Not transcribed yet.",
    `For the image call get_page {"pageId":"${id}"}.`,
  ];
  return {
    text: lines.join("\n"),
    structured: {
      kind: "page",
      page: {
        id: page.id,
        fileId: page.fileId,
        index: page.index,
        transcriptId: page.transcriptId,
      },
      links: { file: page.fileId },
    },
  };
}

function getDocument(ctx: ToolContext, id: string, input: GetInput): ToolOutput {
  const port = docs(ctx);
  const limit = Math.min(input.limit ?? BLOCK_WINDOW, BLOCK_WINDOW);
  const { document, blocks, total } = port.getDocument(ctx.auth, id, {
    offset: input.offset,
    limit,
  });
  const end = input.offset + blocks.length;
  const lines = [
    `Document ${document.id} "${document.title}" (${document.kind}), revision ${document.revision}, ${document.reviewStatus}, in node ${document.nodeId}. Blocks ${input.offset}-${end} of ${total}:`,
    ...blocks.map((b) => {
      const text = clip(blockPlainText(b).replace(/\s+/g, " "), 200).text;
      return `- ${b.id} ${b.type} [${b.origin}, ${b.review.status}${b.citations.length ? `, ${b.citations.length} citation(s)` : ""}${b.generalKnowledge ? ", general knowledge" : ""}] ${text}`;
    }),
  ];
  if (end < total) lines.push(`More blocks: get_item {"id":"${id}","offset":${end}}.`);
  const references = input.offset === 0 ? port.references(ctx.auth, id) : [];
  if (references.length) {
    lines.push("References:");
    for (const r of references.slice(0, 50)) {
      const stale = r.quoteStillPresent === false ? " (quote no longer in the transcript)" : "";
      lines.push(
        `[${r.number}] ${r.fileName ?? r.fileId}, page ${r.pageIndex ?? "?"}: "${clip(r.quote, 80).text}" ${r.status}${stale}`,
      );
    }
  }
  lines.push(
    `Full block JSON is in "blocks". Change blocks with edit_blocks; pass expectedRevision ${document.revision}.`,
  );
  return {
    text: lines.join("\n"),
    structured: {
      kind: "document",
      document,
      blocks,
      references,
      range: { offset: input.offset, end, total },
      links: { node: document.nodeId },
    },
  };
}

function getBlock(ctx: ToolContext, id: string, input: GetInput): ToolOutput {
  const port = docs(ctx);
  if (!input.documentId) {
    throw new AppError("invalid_input", "To open a block, also give its documentId.", {
      hint: 'Block IDs come with their document in search hits and in get_item on a document. Or open the whole document with get_item {"id":"doc_…"}.',
      example: { id, documentId: exampleId("document") },
    });
  }
  const block = port.getBlock(ctx.auth, input.documentId, id);
  return {
    text: `Block ${block.id} (${block.type}) in document ${input.documentId}, ${block.origin}, ${block.review.status}.\n${JSON.stringify(block)}`,
    structured: { kind: "block", block, links: { document: input.documentId } },
  };
}

export const getItem = defineTool({
  name: "get_item",
  title: "Open any item by ID",
  description: `Open one item by its ID with links to its neighbours. The prefix says the kind: nod_ library node (children, its document, the source files filed there with transcription progress), fil_ uploaded file (status and pages; with "text": true every page's transcript or native text in one call, which is how to collect exact quotes for citations), pag_ page (its transcript; use get_page for the image), doc_ document (blocks with full JSON, and its references list), blk_ block (also give documentId). Long content comes in windows: offset and limit for a file's pages or a document's blocks, cursor for a node's children.`,
  annotations: {
    readOnlyHint: true,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: false,
  },
  inputSchema: describe(jsonOf(GetInput), {
    id: `The ID, copied exactly, e.g. "${exampleId("node")}" (a library node) or "${exampleId("file")}" (a file).`,
    documentId: `Only for a block ID: the document it belongs to, e.g. "${exampleId("document")}".`,
    text: "Only for a file ID: include every page's text (transcript, or native text when there is none), up to about 40,000 characters per call.",
    cursor: "Next page of a node's children: the nextCursor from the previous get_item result.",
    offset: "Where to start: a page index - 1 for a file, a block index for a document. Default 0.",
    limit: `How many pages (file) or blocks (document, at most ${BLOCK_WINDOW}) to return.`,
  }),
  parse: (raw) => parseWith("get_item", GetInput, raw, { id: exampleId("node") }) as GetInput,
  writes: () => false,
  action: (input) => input.id.slice(0, 3),
  run(ctx, input) {
    const allowed = readableKinds(ctx);
    const kind = checkIdShape(input.id, allowed);
    if (kind === "transcript" && ctx.backend.files) {
      throw new AppError(
        "invalid_input",
        "Transcripts are opened through their page: get_page or get_item on the pag_ ID.",
        {
          hint: "Search hits and get_item on a file give the page ID of each transcript.",
          example: { id: exampleId("page") },
        },
      );
    }
    if (!allowed.includes(kind)) {
      throw new AppError(
        "invalid_input",
        `${input.id} is ${withArticle(describeIdKind(kind))} ID, which get_item cannot open${kind === "apiKey" || kind === "user" || kind === "session" ? " (account objects are not visible to agents)" : " yet"}.`,
        {
          hint: `get_item opens: ${prefixList(allowed)}. ${routeForKind(kind)}`,
          example: { id: exampleId("node") },
        },
      );
    }
    if (input.documentId !== undefined && !BlockId.safeParse(input.id).success) {
      throw new AppError("invalid_input", "documentId is only for opening a block (blk_ ID).", {
        example: { id: input.id },
      });
    }
    switch (kind) {
      case "node":
        return getNode(ctx, input.id, input);
      case "file":
        return getFile(ctx, input.id, input);
      case "page":
        return getPageSummary(ctx, input.id);
      case "document":
        return getDocument(ctx, input.id, input);
      default:
        return getBlock(ctx, input.id, input);
    }
  },
});
