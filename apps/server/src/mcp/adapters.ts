import { readFileSync } from "node:fs";
import type { WriterOperation } from "@notes/schema";
import type { OperationResult } from "../domains/documents/index.js";
import type { Services } from "../services.js";
import type { DocumentsPort, FilesPort, McpBackend, WriteSummary } from "./ports.js";

/**
 * The MCP backend over the app's one shared set of services. Thin on purpose:
 * every write goes through the same domain call the HTTP API makes, so it is
 * checked, recorded in the change feed and written to the activity log the
 * same way.
 */
export function backendFromServices(services: Services): McpBackend {
  const { files, documents, changes, search, library } = services;

  const filesPort: FilesPort = {
    converterStatus: () => files.converterStatus(),
    listFiles: (auth, options) => files.listFiles(auth, options),
    getFile: (auth, id) => files.getFile(auth, id),
    listPages: (auth, id) => files.listPages(auth, id),
    getPage: (auth, id) => files.getPage(auth, id),
    claim: (auth, id) => files.claim(auth, id),
    release: (auth, id) => files.release(auth, id),
    retry: (auth, id) => files.retry(auth, id),
    fileUnder: (auth, id, nodeId, options) => files.fileUnder(auth, id, nodeId, options),
    pageImage(auth, pageId, size) {
      const stored = files.pageImage(auth, pageId, size);
      return { data: readFileSync(stored.path), mimeType: stored.contentType };
    },
    pageImageLink: (auth, pageId, size) => files.signedImageUrl(auth, pageId, size),
    getTranscript: (auth, pageId) => files.getTranscript(auth, pageId),
    saveTranscript: (auth, input) => files.saveTranscript(auth, input),
    requestUploads: (auth, input) => files.requestUploads(auth, input),
  };

  const documentsPort: DocumentsPort = {
    getDocument(auth, id, range) {
      const r = documents.getFull(auth, id, { from: range.offset, limit: range.limit });
      return { document: r.document, blocks: r.blocks, total: r.total };
    },
    documentForNode(auth, nodeId) {
      try {
        return documents.getDocumentByNode(auth, nodeId).document;
      } catch {
        return null;
      }
    },
    getBlock: (auth, documentId, blockId) => documents.getBlock(auth, documentId, blockId),
    write(auth, operation, input): WriteSummary {
      // The single-operation entry points, so error paths read "$.blocks[1]…" as the agent sent them.
      const single: Record<WriterOperation, (a: typeof auth, i: never) => OperationResult> = {
        create_document: documents.createDocument,
        insert_blocks: documents.insertBlocks,
        update_block: documents.updateBlock,
        move_blocks: documents.moveBlocks,
        delete_blocks: documents.deleteBlocks,
        replace_generated: documents.replaceGenerated,
        restore_revision: documents.restoreRevision,
      };
      const r = single[operation](auth, input as never);
      const base = { documentId: r.documentId, revision: r.revision, removed: [], skipped: [] };
      switch (r.operation) {
        case "create_document":
          return { ...base, nodeId: r.nodeId, written: r.blockIds };
        case "insert_blocks":
        case "move_blocks":
          return { ...base, written: r.blockIds };
        case "update_block":
          return { ...base, written: [r.block.id] };
        case "delete_blocks":
          return { ...base, written: [], removed: r.removed };
        case "replace_generated":
          return { ...base, written: r.written, removed: r.removed, skipped: r.skipped };
        case "restore_revision":
          return { ...base, written: [] };
      }
    },
    references(auth, documentId) {
      return documents.references(auth, documentId).items.map((r) => ({
        number: r.number,
        fileId: r.citation.fileId,
        pageId: r.citation.pageId,
        quote: r.citation.quote,
        status: r.status,
        fileName: r.fileName,
        pageIndex: r.pageIndex,
        quoteStillPresent: r.quoteStillPresent,
      }));
    },
    citedByCount: (auth, pageId) =>
      documents.citedBy(auth, { pageId }, { limit: 200 }).items.length,
  };

  return {
    library,
    practice: services.practice,
    exams: services.exams,
    requests: services.requests,
    concepts: services.concepts,
    canvas: services.canvasPort,
    references: services.references,
    search: { search: (userId, request) => search.search(userId, request) },
    files: filesPort,
    documents: documentsPort,
    changes: {
      changesSince: (userId, cursor, limit) => changes.changesSince(userId, cursor, limit),
      latestCursor: (userId) => changes.latestCursor(userId),
    },
  };
}
