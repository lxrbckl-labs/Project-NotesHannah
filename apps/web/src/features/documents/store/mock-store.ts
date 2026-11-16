import {
  type Actor,
  type Citation,
  type DocumentWithBlocks,
  type ImageSource,
  listReferences,
  type MarginNote,
  newId,
  type Revision,
  type RevisionSummary,
  restoreRevision as restoreSnapshot,
} from "@notes/schema";
import { applyCalls, applyReview, type OperationCall, OperationError } from "../model/ops";
import { guideDocument, guideRevisions, HER, largeDocument } from "./fixture";
import { MockNotes } from "./mock-notes";
import { findPage, MOCK_FILES, pageImage, regionForQuote } from "./mock-pages";
import {
  type BlockRequestInput,
  type CitationSource,
  type DocumentStore,
  type MarginNoteDraft,
  type MarginNotePatch,
  type PageChoice,
  type PageImage,
  type ReferenceWithStatus,
  StoreError,
} from "./types";

export interface MockStoreOptions {
  /** Simulated network delay in milliseconds. */
  latency?: number;
  /** Include the long copy of the guide (for performance checks). */
  large?: boolean;
  /** Make every write fail (to show rollback). */
  failWrites?: boolean;
  /** Extra documents to hold (tests). */
  documents?: DocumentWithBlocks[];
  /** Start the guide with a few of her side notes (default true). */
  sideNotes?: boolean;
}

const clone = <T>(value: T): T => structuredClone(value);

/**
 * An in-memory store seeded with the beta-blocker guide. It applies writer
 * operations with the same schema helpers the server uses, keeps revision
 * snapshots, and records requests, so the UI behaves as it will against the
 * real API.
 */
export class MockDocumentStore implements DocumentStore {
  readonly actor: Actor = HER;
  readonly requests: Array<BlockRequestInput & { id: string }> = [];
  latency: number;
  failWrites: boolean;
  /** Fail just the next N writes. */
  failNext = 0;
  private docs = new Map<string, DocumentWithBlocks>();
  private revisions = new Map<string, Revision[]>();
  private notes = new MockNotes((id) => this.get(id));

  constructor(options: MockStoreOptions = {}) {
    this.latency = options.latency ?? 120;
    this.failWrites = options.failWrites ?? false;
    const guide = guideDocument();
    this.docs.set(guide.id, guide);
    this.revisions.set(guide.id, guideRevisions(guide));
    if (options.sideNotes !== false) this.notes.seed(guide);
    for (const doc of options.documents ?? []) {
      this.docs.set(doc.id, doc);
      this.revisions.set(doc.id, []);
    }
    if (options.large) {
      const large = largeDocument();
      this.docs.set(large.id, large);
      this.revisions.set(large.id, [
        {
          id: newId("revision"),
          documentId: large.id,
          number: large.revision,
          author: HER,
          createdAt: large.updatedAt,
          summary: "Long copy",
          restoredFrom: null,
          snapshot: { title: large.title, kind: large.kind, blocks: large.blocks },
        },
      ]);
    }
  }

  get documentIds(): string[] {
    return [...this.docs.keys()];
  }

  private wait(): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, this.latency));
  }

  private get(documentId: string): DocumentWithBlocks {
    const doc = this.docs.get(documentId);
    if (!doc) throw new StoreError("That document was not found.", "not_found", 404);
    return doc;
  }

  private checkWrite(doc: DocumentWithBlocks, expectedRevision?: number) {
    if (this.failWrites || this.failNext > 0) {
      if (this.failNext > 0) this.failNext -= 1;
      throw new StoreError("The server could not be reached.", "storage_unavailable", 503);
    }
    if (expectedRevision !== undefined && expectedRevision !== doc.revision) {
      throw new StoreError(
        `The document is at revision ${doc.revision}, not ${expectedRevision}.`,
        "conflict",
        409,
      );
    }
  }

  private commit(next: DocumentWithBlocks, summary: string, restoredFrom: number | null = null) {
    const now = new Date().toISOString();
    const saved = { ...next, revision: next.revision + 1, updatedAt: now, lastEditedBy: HER };
    this.docs.set(saved.id, saved);
    this.notes.follow(saved, now);
    const list = this.revisions.get(saved.id) ?? [];
    list.push({
      id: newId("revision"),
      documentId: saved.id,
      number: saved.revision,
      author: HER,
      createdAt: now,
      summary,
      restoredFrom,
      snapshot: { title: saved.title, kind: saved.kind, blocks: clone(saved.blocks) },
    });
    this.revisions.set(saved.id, list);
    return saved;
  }

  async loadDocument(documentId: string) {
    await this.wait();
    return clone(this.get(documentId));
  }

  async apply(
    documentId: string,
    calls: readonly OperationCall[],
    options: { expectedRevision?: number } = {},
  ) {
    await this.wait();
    const doc = this.get(documentId);
    this.checkWrite(doc, options.expectedRevision);
    try {
      const { doc: next, results } = applyCalls(
        doc,
        calls.map((call) => ({ call })),
        { actor: HER },
      );
      const saved = this.commit(next, summarise(calls));
      return { revision: saved.revision, results: clone(results) };
    } catch (error) {
      if (error instanceof OperationError) throw new StoreError(error.message, error.code, 400);
      throw error;
    }
  }

  async setReview(
    documentId: string,
    input: { status: "reviewed" | "unverified"; blockIds?: string[]; expectedRevision?: number },
  ) {
    await this.wait();
    const doc = this.get(documentId);
    this.checkWrite(doc, input.expectedRevision);
    const { doc: next, changed } = applyReview(doc, input.status, input.blockIds);
    if (changed.length === 0) return { revision: doc.revision, changed };
    const verb = input.status === "reviewed" ? "Reviewed" : "Marked unverified:";
    const saved = this.commit(
      next,
      `${verb} ${changed.length} block${changed.length === 1 ? "" : "s"}`,
    );
    return { revision: saved.revision, changed };
  }

  async listReferences(documentId: string): Promise<ReferenceWithStatus[]> {
    await this.wait();
    const doc = this.get(documentId);
    return listReferences(doc.blocks).map((ref) => {
      const found = findPage(ref.citation.pageId);
      if (!found || found.file.deleted)
        return { ...ref, status: "source_deleted", fileName: null, pageIndex: null };
      return {
        ...ref,
        status: found.file.trashed ? "source_trashed" : "available",
        fileName: found.file.name,
        pageIndex: found.page.index,
      };
    });
  }

  async resolveCitation(citation: Citation): Promise<CitationSource> {
    await this.wait();
    const found = findPage(citation.pageId);
    if (!found || found.file.deleted || found.file.id !== citation.fileId)
      return { status: "source_deleted", fileName: null, pageIndex: null };
    if (found.file.trashed)
      return { status: "source_trashed", fileName: found.file.name, pageIndex: found.page.index };
    return {
      status: "available",
      fileId: found.file.id,
      pageId: found.page.id,
      fileName: found.file.name,
      pageIndex: found.page.index,
      pageCount: found.file.pages.length,
      image: pageImage(found.page),
      transcript: found.page.text,
      region: citation.region ?? regionForQuote(found.page, citation.quote),
    };
  }

  async resolveImage(source: ImageSource): Promise<PageImage> {
    const file = MOCK_FILES.find((f) => f.id === source.fileId);
    const page = source.pageId ? file?.pages.find((p) => p.id === source.pageId) : file?.pages[0];
    if (!page) throw new StoreError("That page is no longer available.", "not_found", 404);
    return pageImage(page);
  }

  async listPages(): Promise<PageChoice[]> {
    await this.wait();
    return MOCK_FILES.filter((f) => !f.trashed).flatMap((file) =>
      file.pages.map((p) => ({
        fileId: file.id,
        pageId: p.id,
        fileName: file.name,
        pageIndex: p.index,
        thumbUrl: pageImage(p).url,
      })),
    );
  }

  async listRevisions(documentId: string): Promise<RevisionSummary[]> {
    await this.wait();
    const list = this.revisions.get(documentId) ?? [];
    return list
      .map(({ snapshot, ...rest }) => ({ ...rest, blockCount: snapshot.blocks.length }))
      .reverse();
  }

  async getRevision(documentId: string, number: number): Promise<Revision> {
    await this.wait();
    const found = (this.revisions.get(documentId) ?? []).find((r) => r.number === number);
    if (!found) throw new StoreError(`Revision ${number} was not found.`, "not_found", 404);
    return clone(found);
  }

  async restoreRevision(
    documentId: string,
    number: number,
    options: { expectedRevision?: number } = {},
  ) {
    await this.wait();
    const doc = this.get(documentId);
    this.checkWrite(doc, options.expectedRevision);
    const revision = (this.revisions.get(documentId) ?? []).find((r) => r.number === number);
    if (!revision) throw new StoreError(`Revision ${number} was not found.`, "not_found", 404);
    const restored = restoreSnapshot(doc, revision, { actor: HER });
    // restoreSnapshot already bumps the revision; commit bumps again, so step back one.
    const saved = this.commit(
      { ...restored, revision: restored.revision - 1 },
      `Restored revision ${number}`,
      number,
    );
    return { revision: saved.revision, restoredFrom: number };
  }

  async createRequest(input: BlockRequestInput) {
    await this.wait();
    if (this.failWrites)
      throw new StoreError("The server could not be reached.", "storage_unavailable", 503);
    const id = newId("request");
    this.requests.push({ ...input, id });
    return { id };
  }

  // ---- side notes (see mock-notes.ts) ----

  private failIfOffline() {
    if (this.failWrites || this.failNext > 0) {
      if (this.failNext > 0) this.failNext -= 1;
      throw new StoreError("The server could not be reached.", "storage_unavailable", 503);
    }
  }

  async listMarginNotes(documentId: string): Promise<MarginNote[]> {
    await this.wait();
    return this.notes.list(documentId);
  }

  async createMarginNote(documentId: string, input: MarginNoteDraft): Promise<MarginNote> {
    await this.wait();
    this.failIfOffline();
    return this.notes.create(documentId, input);
  }

  async updateMarginNote(
    documentId: string,
    noteId: string,
    patch: MarginNotePatch,
  ): Promise<MarginNote> {
    await this.wait();
    this.failIfOffline();
    return this.notes.update(documentId, noteId, patch);
  }

  async deleteMarginNote(documentId: string, noteId: string): Promise<void> {
    await this.wait();
    this.failIfOffline();
    this.notes.remove(documentId, noteId);
  }

  async reattachMarginNote(
    documentId: string,
    noteId: string,
    input: { blockId: string; quote?: string | null },
  ): Promise<MarginNote> {
    await this.wait();
    this.failIfOffline();
    return this.notes.reattach(documentId, noteId, input.blockId, input.quote ?? null);
  }
}

function summarise(calls: readonly OperationCall[]): string {
  const names: Record<OperationCall["operation"], string> = {
    insert_blocks: "Inserted a block",
    update_block: "Edited a block",
    move_blocks: "Moved a block",
    delete_blocks: "Deleted a block",
  };
  const unique = [...new Set(calls.map((c) => names[c.operation]))];
  return unique.join(", ");
}
