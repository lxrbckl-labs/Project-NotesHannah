import type {
  Actor,
  Citation,
  CitationStatus,
  DocumentWithBlocks,
  ImageSource,
  NormalizedBox,
  Reference,
  Revision,
  RevisionSummary,
} from "@notes/schema";
import type { OperationCall, OperationResult } from "../model/ops";

/**
 * The documents feature's data boundary. The shell injects one; the demo and
 * tests use the in-memory `MockDocumentStore`, the app the `HttpDocumentStore`.
 * Writes are writer operations exactly as `WRITER_OPERATIONS` define them.
 */
export interface DocumentStore {
  /** Who is editing: her, as the server will stamp her edits. */
  readonly actor: Actor;

  /** The document with every block, in order. */
  loadDocument(documentId: string): Promise<DocumentWithBlocks>;

  /**
   * Apply writer operations in order, all or none, as one new revision.
   * Rejects with a `StoreError` (code `conflict` when `expectedRevision` is stale).
   */
  apply(
    documentId: string,
    calls: readonly OperationCall[],
    options?: { expectedRevision?: number },
  ): Promise<{ revision: number; results: OperationResult[] }>;

  /** Mark blocks (or, without `blockIds`, the whole document) reviewed or unverified. */
  setReview(
    documentId: string,
    input: { status: "reviewed" | "unverified"; blockIds?: string[]; expectedRevision?: number },
  ): Promise<{ revision: number; changed: string[] }>;

  /** The references list (K7) with each source's current status. */
  listReferences(documentId: string): Promise<ReferenceWithStatus[]>;

  /** Everything the source panel shows for one citation. */
  resolveCitation(citation: Citation): Promise<CitationSource>;

  /** An image of a page (or a region of one) for image and labelled-image blocks. */
  resolveImage(source: ImageSource): Promise<PageImage>;

  /** Pages she can pick for a new image block. */
  listPages(): Promise<PageChoice[]>;

  listRevisions(documentId: string): Promise<RevisionSummary[]>;
  getRevision(documentId: string, number: number): Promise<Revision>;
  restoreRevision(
    documentId: string,
    number: number,
    options?: { expectedRevision?: number },
  ): Promise<{ revision: number; restoredFrom: number }>;

  /** Ask an agent about a block (L1, L5). */
  createRequest(input: BlockRequestInput): Promise<{ id: string }>;
}

export interface ReferenceWithStatus extends Reference {
  status: CitationStatus;
  fileName: string | null;
  pageIndex: number | null;
}

export interface PageImage {
  url: string;
  width: number;
  height: number;
}

/** What the source panel needs for one citation. */
export type CitationSource =
  | {
      status: "available";
      fileId: string;
      pageId: string;
      fileName: string;
      pageIndex: number;
      pageCount: number;
      image: PageImage;
      /** The current transcript text (or the page's native text), null when not transcribed. */
      transcript: string | null;
      region?: NormalizedBox | undefined;
    }
  | {
      status: "source_trashed" | "source_deleted";
      fileName: string | null;
      pageIndex: number | null;
    };

export interface PageChoice {
  fileId: string;
  pageId: string;
  fileName: string;
  pageIndex: number;
  thumbUrl: string;
}

/** The quick asks on a block (L5). */
export const REQUEST_KINDS = ["wrong", "unclear", "expand", "make_questions"] as const;
export type RequestKind = (typeof REQUEST_KINDS)[number];

export interface BlockRequestInput {
  documentId: string;
  blockId: string;
  kind: RequestKind;
  /** Her own words, optional. */
  note?: string;
}

export class StoreError extends Error {
  constructor(
    message: string,
    readonly code: string,
    readonly status = 0,
  ) {
    super(message);
    this.name = "StoreError";
  }
}
