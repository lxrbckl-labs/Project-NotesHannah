import { findQuote } from "@notes/schema";

/** A citation as the source lookup sees it. */
export interface SourceRef {
  fileId: string;
  pageId: string;
  quote: string;
  transcriptId?: string | undefined;
  transcriptRevision?: number | undefined;
}

/** What the files domain knows about one cited source. */
export interface SourceInfo {
  /**
   * False when the lookup cannot say (the default adapter before the files
   * domain is plugged in). Unknown sources are allowed and shown as available.
   */
  known: boolean;
  /** The file and page exist (trashed ones still do). False once permanently deleted. */
  exists: boolean;
  /** The file is in the trash. */
  trashed: boolean;
  fileName: string | null;
  /** 1-based page number in the file. */
  pageIndex: number | null;
  /** The newest transcript revision of the page, or null when it has none. */
  currentTranscriptRevision: number | null;
  /** Whether the quote still occurs, character for character, in the current transcript. Null when unknown. */
  quoteFound: boolean | null;
}

/**
 * The narrow view of the files domain that documents need. The integrator
 * writes the real adapter over the files, pages and transcripts tables.
 * `resolve` returns one entry per ref, in the same order, and must only
 * report on sources owned by `userId` (someone else's page does not exist).
 */
export interface SourceLookup {
  resolve(userId: string, refs: readonly SourceRef[]): SourceInfo[];
}

export const UNKNOWN_SOURCE: SourceInfo = {
  known: false,
  exists: true,
  trashed: false,
  fileName: null,
  pageIndex: null,
  currentTranscriptRevision: null,
  quoteFound: null,
};

/** Default until the files domain is plugged in: every source is unknown but allowed. */
export const unknownSources: SourceLookup = {
  resolve: (_userId, refs) => refs.map(() => ({ ...UNKNOWN_SOURCE })),
};

export interface FakePage {
  userId: string;
  fileId: string;
  pageId: string;
  fileName: string;
  pageIndex: number;
  transcript: string | null;
  transcriptRevision?: number;
  trashed?: boolean;
}

/** An in-memory SourceLookup for tests. Anything not added is unknown-but-allowed unless `strict`. */
export interface FakeSourceLookup extends SourceLookup {
  addPage(page: FakePage): void;
  trash(fileId: string): void;
  restore(fileId: string): void;
  /** Permanently delete the file: its pages stop existing. */
  purge(fileId: string): void;
  setTranscript(pageId: string, transcript: string | null, revision?: number): void;
}

export function createFakeSourceLookup(options: { strict?: boolean } = {}): FakeSourceLookup {
  const pages = new Map<string, FakePage>();
  const purged = new Set<string>();
  return {
    addPage(page) {
      pages.set(page.pageId, { transcriptRevision: 1, ...page });
    },
    trash(fileId) {
      for (const page of pages.values()) if (page.fileId === fileId) page.trashed = true;
    },
    restore(fileId) {
      for (const page of pages.values()) if (page.fileId === fileId) page.trashed = false;
    },
    purge(fileId) {
      purged.add(fileId);
      for (const [id, page] of pages) if (page.fileId === fileId) pages.delete(id);
    },
    setTranscript(pageId, transcript, revision) {
      const page = pages.get(pageId);
      if (!page) return;
      page.transcript = transcript;
      page.transcriptRevision = revision ?? (page.transcriptRevision ?? 1) + 1;
    },
    resolve(userId, refs) {
      return refs.map((ref): SourceInfo => {
        const page = pages.get(ref.pageId);
        if (page && page.userId === userId && page.fileId === ref.fileId) {
          return {
            known: true,
            exists: true,
            trashed: page.trashed === true,
            fileName: page.fileName,
            pageIndex: page.pageIndex,
            currentTranscriptRevision:
              page.transcript === null ? null : (page.transcriptRevision ?? 1),
            quoteFound:
              page.transcript === null ? null : findQuote(page.transcript, ref.quote) >= 0,
          };
        }
        if (purged.has(ref.fileId)) {
          return { ...UNKNOWN_SOURCE, known: true, exists: false };
        }
        if (options.strict) return { ...UNKNOWN_SOURCE, known: true, exists: false };
        return { ...UNKNOWN_SOURCE };
      });
    },
  };
}
