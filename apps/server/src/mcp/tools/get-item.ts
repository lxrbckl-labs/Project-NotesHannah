import {
  blockPlainText,
  type IdKind,
  type NodeWithLinks,
  PageRequest,
  type SourceFile,
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
import { defineTool, parseWith, type ToolContext, type ToolOutput } from "../tool.js";

/** Most characters of a transcript returned by one call. */
export const TRANSCRIPT_WINDOW = 30_000;
/** Most blocks returned by one call. */
export const BLOCK_WINDOW = 40;

const GetInput = z.strictObject({
  id: z.string().min(1).max(200),
  cursor: PageRequest.shape.cursor,
  offset: z.number().int().min(0).default(0),
  limit: z.number().int().min(1).max(TRANSCRIPT_WINDOW).optional(),
});
type GetInput = z.output<typeof GetInput>;

export function fileLine(f: SourceFile): string {
  const claim = f.claimedBy?.type === "agent" ? `, claimed by key ${f.claimedBy.keyId}` : "";
  return `- ${f.id} "${f.originalName}" ${f.type}, ${f.pageCount ?? "?"} pages, status ${f.status}${claim}${f.nodeId ? `, filed under ${f.nodeId}` : ""}`;
}

export function fileItem(f: SourceFile) {
  return {
    id: f.id,
    name: f.originalName,
    type: f.type,
    status: f.status,
    pageCount: f.pageCount,
    nodeId: f.nodeId,
    claimedBy: f.claimedBy,
    errorCode: f.errorCode,
    errorMessage: f.errorMessage,
    createdAt: f.createdAt,
  };
}

function readableKinds(ctx: ToolContext): IdKind[] {
  return [
    "node",
    ...(ctx.ports.files ? (["file", "page", "transcript"] as const) : []),
    ...(ctx.ports.documents ? (["document", "block"] as const) : []),
  ];
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
  if (node.trashedAt)
    lines.push(
      `In the trash since ${node.trashedAt}. Restore with edit_library {"action":"restore","id":"${node.id}"}.`,
    );
  const children = node.trashedAt
    ? { items: [], nextCursor: null }
    : ctx.library.list(ctx.userId, { parentId: id, cursor: input.cursor, limit: 25 });
  const childItems = children.items.map(nodeItem);
  lines.push(`Children (${node.childCount}):`, ...childItems.map(nodeLine));
  if (children.nextCursor)
    lines.push(`More children: get_item with cursor "${children.nextCursor}", or browse_library.`);
  lines.push(placementRule(node.kind));
  const structured: Record<string, unknown> = {
    kind: "node",
    node: { ...item, createdAt: node.createdAt, updatedAt: node.updatedAt },
    links: {
      parent: node.parentId,
      ancestors,
      children: childItems,
      childrenNextCursor: children.nextCursor,
      canCreateHere: childKindsOf(node.kind),
    },
  };
  const links = structured.links as Record<string, unknown>;
  if (ctx.ports.documents && (node.kind === "lecture" || node.kind === "document")) {
    const doc = ctx.ports.documents.documentForNode(ctx.userId, id);
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
        ? `Document: ${doc.id} "${doc.title}" (${doc.blockIds.length} blocks, revision ${doc.revision}).`
        : `No document yet. Write one with write_document {"nodeId":"${id}", ...}.`,
    );
  }
  if (
    ctx.ports.files &&
    (node.kind === "lecture" || node.kind === "folder" || node.kind === "section")
  ) {
    const files = ctx.ports.files.listFilesUnder(ctx.userId, id, { limit: 20 });
    links.sources = files.items.map(fileItem);
    if (files.items.length) lines.push("Source files filed here:", ...files.items.map(fileLine));
  }
  return { text: lines.join("\n"), structured };
}

function getFile(ctx: ToolContext, id: string, input: GetInput): ToolOutput {
  const files = ctx.ports.files;
  if (!files) throw new AppError("internal", "Files are not available.");
  const file = files.getFile(ctx.userId, id);
  const pages = files.listPages(ctx.userId, id, { cursor: input.cursor, limit: 100 });
  const lines = [
    `File ${file.id} "${file.originalName}" (${file.type}, ${file.pageCount ?? "?"} pages), status ${file.status}.`,
    file.nodeId ? `Filed under ${file.nodeId}.` : "In the inbox (not filed yet).",
    ...(file.status === "failed" ? [`Failed: ${file.errorCode} ${file.errorMessage ?? ""}`] : []),
    "Pages (open with get_page):",
    ...pages.items.map(
      (p) =>
        `- ${p.id} page ${p.index}${p.transcriptId ? `, transcript ${p.transcriptId}` : ", not transcribed"}${p.hasTextLayer ? ", has native text" : ""}`,
    ),
  ];
  if (pages.nextCursor) lines.push(`More pages: get_item with cursor "${pages.nextCursor}".`);
  return {
    text: lines.join("\n"),
    structured: {
      kind: "file",
      file: fileItem(file),
      pages: pages.items.map((p) => ({
        id: p.id,
        index: p.index,
        transcriptId: p.transcriptId,
        hasTextLayer: p.hasTextLayer,
      })),
      pagesNextCursor: pages.nextCursor,
      links: { node: file.nodeId },
    },
  };
}

function getTranscript(ctx: ToolContext, id: string, input: GetInput): ToolOutput {
  const files = ctx.ports.files;
  if (!files) throw new AppError("internal", "Files are not available.");
  const t = files.getTranscript(ctx.userId, id);
  const limit = input.limit ?? TRANSCRIPT_WINDOW;
  const slice = t.text.slice(input.offset, input.offset + limit);
  const end = input.offset + slice.length;
  const more = end < t.text.length;
  const lines = [
    `Transcript ${t.id} of page ${t.pageId}, revision ${t.revision}, ${t.reviewStatus}. Characters ${input.offset}-${end} of ${t.text.length}.`,
    `Flags: ${t.flags.length ? t.flags.map((f) => `${f.kind} "${f.quote}"`).join("; ") : "none"}`,
    "---",
    slice,
    "---",
  ];
  if (more) lines.push(`More text: get_item {"id":"${id}","offset":${end}}.`);
  return {
    text: lines.join("\n"),
    structured: {
      kind: "transcript",
      // The text itself is in the message, once.
      transcript: {
        id: t.id,
        pageId: t.pageId,
        revision: t.revision,
        reviewStatus: t.reviewStatus,
        flags: t.flags,
        author: t.author,
        createdAt: t.createdAt,
      },
      range: { offset: input.offset, end, total: t.text.length },
      links: { page: t.pageId },
    },
  };
}

function getDocument(ctx: ToolContext, id: string, input: GetInput): ToolOutput {
  const docs = ctx.ports.documents;
  if (!docs) throw new AppError("internal", "Documents are not available.");
  const limit = Math.min(input.limit ?? BLOCK_WINDOW, BLOCK_WINDOW);
  const { document, blocks } = docs.getDocument(ctx.userId, id, { offset: input.offset, limit });
  const end = input.offset + blocks.length;
  const lines = [
    `Document ${document.id} "${document.title}" (${document.kind}), revision ${document.revision}, ${document.reviewStatus}, in node ${document.nodeId}. Blocks ${input.offset}-${end} of ${document.blockIds.length}:`,
    ...blocks.map((b) => {
      const text = clip(blockPlainText(b).replace(/\s+/g, " "), 200).text;
      return `- ${b.id} ${b.type} [${b.origin}, ${b.review.status}${b.citations.length ? `, ${b.citations.length} citation(s)` : ""}${b.generalKnowledge ? ", general knowledge" : ""}] ${text}`;
    }),
  ];
  if (end < document.blockIds.length)
    lines.push(`More blocks: get_item {"id":"${id}","offset":${end}}.`);
  lines.push(
    "Full block JSON is in the structured result. Change blocks with edit_blocks (pass expectedRevision to avoid overwriting her edits).",
  );
  return {
    text: lines.join("\n"),
    structured: {
      kind: "document",
      document,
      blocks,
      range: { offset: input.offset, end, total: document.blockIds.length },
      links: { node: document.nodeId },
    },
  };
}

function getBlock(ctx: ToolContext, id: string): ToolOutput {
  const docs = ctx.ports.documents;
  if (!docs) throw new AppError("internal", "Documents are not available.");
  const { documentId, block } = docs.getBlock(ctx.userId, id);
  return {
    text: `Block ${block.id} (${block.type}) in document ${documentId}, ${block.origin}, ${block.review.status}.\n${JSON.stringify(block)}`,
    structured: { kind: "block", block, links: { document: documentId } },
  };
}

function getPageSummary(ctx: ToolContext, id: string): ToolOutput {
  const files = ctx.ports.files;
  if (!files) throw new AppError("internal", "Files are not available.");
  const view = files.getPage(ctx.userId, id);
  return {
    text: `Page ${view.page.id}: page ${view.page.index} of file ${view.file.id} "${view.file.originalName}". Transcript: ${view.transcript ? `${view.transcript.id} (revision ${view.transcript.revision}, ${view.transcript.reviewStatus})` : "none"}. Previous ${view.previousPageId ?? "none"}, next ${view.nextPageId ?? "none"}. For the image and native text call get_page {"pageId":"${id}"}.`,
    structured: {
      kind: "page",
      ...view,
      links: {
        file: view.file.id,
        previous: view.previousPageId,
        next: view.nextPageId,
        transcript: view.transcript?.id ?? null,
      },
    },
  };
}

export const getItem = defineTool({
  name: "get_item",
  title: "Open any item by ID",
  description: `Open one item by its ID and get its full content plus links to its neighbours (parent, children, sources, document). Works for any ID an earlier result gave you: the prefix says the kind (nod_ library node, fil_ file, pag_ page, trn_ transcript, doc_ document, blk_ block). Long content comes in windows: use offset (and limit) for a document's blocks or a transcript's characters, cursor for a node's children or a file's pages.`,
  annotations: {
    readOnlyHint: true,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: false,
  },
  inputSchema: describe(jsonOf(GetInput), {
    id: `The ID, copied exactly, e.g. "${exampleId("node")}" (a library node) or "${exampleId("document")}" (a document).`,
    cursor:
      "Next page of a node's children or a file's pages: the nextCursor from the previous get_item result.",
    offset: `Where to start in a document's blocks (0-based block index) or a transcript's text (character offset). Default 0.`,
    limit: `How many blocks (at most ${BLOCK_WINDOW}) or transcript characters (at most ${TRANSCRIPT_WINDOW}) to return.`,
  }),
  parse: (raw) => parseWith("get_item", GetInput, raw, { id: exampleId("node") }) as GetInput,
  writes: () => false,
  action: (input) => input.id.slice(0, 3),
  run(ctx, input) {
    const allowed = readableKinds(ctx);
    const kind = checkIdShape(input.id, allowed);
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
    switch (kind) {
      case "node":
        return getNode(ctx, input.id, input);
      case "file":
        return getFile(ctx, input.id, input);
      case "page":
        return getPageSummary(ctx, input.id);
      case "transcript":
        return getTranscript(ctx, input.id, input);
      case "document":
        return getDocument(ctx, input.id, input);
      default:
        return getBlock(ctx, input.id);
    }
  },
});
