import type {
  Actor,
  Block,
  Citation,
  Document,
  DocumentWithBlocks,
  ImageSource,
  Page,
  Revision,
  RevisionSummary,
  SourceFile,
  Transcript,
} from "@notes/schema";
import type { OperationCall, OperationResult } from "../model/ops";
import type {
  BlockRequestInput,
  CitationSource,
  DocumentStore,
  PageChoice,
  PageImage,
  ReferenceWithStatus,
} from "./types";
import { StoreError } from "./types";

/**
 * The store against the server's routes (docs/api.md, "Documents" and
 * "Files, pages and inbox"). Cookie session; the browser sends Origin on
 * writes. Exercised against the real server by the web-mount journeys (apps/web/e2e/real).
 */
export interface HttpStoreOptions {
  /** Her actor, from GET /api/me. */
  actor: Actor;
  /** Prefix for every route, default "/api". */
  base?: string;
  fetch?: typeof fetch;
}

type Json = Record<string, unknown>;

export class HttpDocumentStore implements DocumentStore {
  readonly actor: Actor;
  private base: string;
  private fetcher: typeof fetch;

  constructor(options: HttpStoreOptions) {
    this.actor = options.actor;
    this.base = options.base ?? "/api";
    this.fetcher = options.fetch ?? globalThis.fetch.bind(globalThis);
  }

  private async request<T>(method: string, path: string, body?: unknown): Promise<T> {
    const init: RequestInit = { method, credentials: "same-origin", headers: {} };
    if (body !== undefined) {
      init.body = JSON.stringify(body);
      init.headers = { "Content-Type": "application/json" };
    }
    let response: Response;
    try {
      response = await this.fetcher(`${this.base}${path}`, init);
    } catch {
      throw new StoreError("The server could not be reached.", "network", 0);
    }
    if (response.status === 204) return undefined as T;
    const data = (await response.json().catch(() => ({}))) as Json;
    if (!response.ok) {
      const error = (data.error ?? {}) as { code?: string; message?: string };
      throw new StoreError(
        error.message ?? `Request failed (${response.status}).`,
        error.code ?? "internal",
        response.status,
      );
    }
    return data as T;
  }

  async loadDocument(documentId: string): Promise<DocumentWithBlocks> {
    const blocks: Block[] = [];
    let document: Document | null = null;
    let from = 0;
    for (;;) {
      const page = await this.request<{ document: Document; blocks: Block[]; total: number }>(
        "GET",
        `/documents/${documentId}/content?from=${from}&limit=1000`,
      );
      document = page.document;
      blocks.push(...page.blocks);
      from += page.blocks.length;
      if (from >= page.total || page.blocks.length === 0) break;
    }
    return { ...(document as Document), blocks };
  }

  private async one(
    documentId: string,
    call: OperationCall,
    expectedRevision?: number,
  ): Promise<{ revision: number; result: OperationResult }> {
    const { documentId: _ignored, ...input } = call.input as Json;
    if (expectedRevision !== undefined) input.expectedRevision = expectedRevision;
    const doc = `/documents/${documentId}`;
    switch (call.operation) {
      case "insert_blocks": {
        const r = await this.request<{ revision: number; blockIds: string[] }>(
          "POST",
          `${doc}/blocks`,
          input,
        );
        return {
          revision: r.revision,
          result: { operation: call.operation, blockIds: r.blockIds },
        };
      }
      case "update_block": {
        const { blockId, mode: _mode, ...rest } = input as Json & { blockId: string };
        const r = await this.request<{ revision: number; block: Block }>(
          "PATCH",
          `${doc}/blocks/${blockId}`,
          rest,
        );
        return { revision: r.revision, result: { operation: call.operation, block: r.block } };
      }
      case "move_blocks": {
        const r = await this.request<{ revision: number; blockIds: string[] }>(
          "POST",
          `${doc}/blocks/move`,
          input,
        );
        return {
          revision: r.revision,
          result: { operation: call.operation, blockIds: r.blockIds },
        };
      }
      case "delete_blocks": {
        const r = await this.request<{ revision: number; removed: string[] }>(
          "POST",
          `${doc}/blocks/delete`,
          input,
        );
        return { revision: r.revision, result: { operation: call.operation, removed: r.removed } };
      }
    }
  }

  async apply(
    documentId: string,
    calls: readonly OperationCall[],
    options: { expectedRevision?: number } = {},
  ) {
    if (calls.length === 1) {
      const { revision, result } = await this.one(
        documentId,
        calls[0] as OperationCall,
        options.expectedRevision,
      );
      return { revision, results: [result] };
    }
    const operations = calls.map((call) => ({
      operation: call.operation,
      input: {
        ...call.input,
        documentId,
        ...(options.expectedRevision !== undefined
          ? { expectedRevision: options.expectedRevision }
          : {}),
      },
    }));
    const response = await this.request<{
      results: Array<Json & { operation: string; revision?: number }>;
    }>("POST", "/documents/batch", { operations });
    let revision = options.expectedRevision ?? 0;
    const results = response.results.map((r) => {
      if (typeof r.revision === "number") revision = Math.max(revision, r.revision);
      return r as unknown as OperationResult;
    });
    return { revision, results };
  }

  setReview(
    documentId: string,
    input: { status: "reviewed" | "unverified"; blockIds?: string[]; expectedRevision?: number },
  ) {
    return this.request<{ revision: number; changed: string[] }>(
      "POST",
      `/documents/${documentId}/review`,
      input,
    );
  }

  async listReferences(documentId: string): Promise<ReferenceWithStatus[]> {
    const r = await this.request<{ items: ReferenceWithStatus[] }>(
      "GET",
      `/documents/${documentId}/references`,
    );
    return r.items;
  }

  async resolveCitation(citation: Citation): Promise<CitationSource> {
    let page: Page;
    try {
      page = (await this.request<{ page: Page }>("GET", `/pages/${citation.pageId}`)).page;
    } catch (error) {
      if (error instanceof StoreError && error.code === "not_found")
        return { status: "source_deleted", fileName: null, pageIndex: null };
      throw error;
    }
    const file = (await this.request<{ file: SourceFile }>("GET", `/files/${page.fileId}`)).file;
    if (file.trashedAt)
      return { status: "source_trashed", fileName: file.originalName, pageIndex: page.index };
    const [image, transcript] = await Promise.all([
      this.request<{ url: string }>("GET", `/pages/${page.id}/image-url?size=page`),
      this.request<{ transcript: Transcript | null }>("GET", `/pages/${page.id}/transcript`),
    ]);
    return {
      status: "available",
      fileId: file.id,
      pageId: page.id,
      fileName: file.originalName,
      pageIndex: page.index,
      pageCount: file.pageCount ?? page.index,
      image: { url: image.url, width: page.width, height: page.height },
      transcript: transcript.transcript?.text ?? page.nativeText,
      region: citation.region,
    };
  }

  async resolveImage(source: ImageSource): Promise<PageImage> {
    let page: Page;
    if (source.pageId) {
      page = (await this.request<{ page: Page }>("GET", `/pages/${source.pageId}`)).page;
    } else {
      const pages = await this.request<{ items: Page[] }>("GET", `/files/${source.fileId}/pages`);
      const first = pages.items[0];
      if (!first) throw new StoreError("That file has no pages.", "not_found", 404);
      page = first;
    }
    return { url: `${this.base}/pages/${page.id}/image`, width: page.width, height: page.height };
  }

  async listPages(): Promise<PageChoice[]> {
    const files = await this.request<{ items: SourceFile[] }>("GET", "/files?limit=20");
    const out: PageChoice[] = [];
    for (const file of files.items.filter((f) => (f.pageCount ?? 0) > 0)) {
      const pages = await this.request<{ items: Page[] }>("GET", `/files/${file.id}/pages`);
      for (const page of pages.items)
        out.push({
          fileId: file.id,
          pageId: page.id,
          fileName: file.originalName,
          pageIndex: page.index,
          thumbUrl: `${this.base}/pages/${page.id}/image?size=thumb`,
        });
    }
    return out;
  }

  async listRevisions(documentId: string): Promise<RevisionSummary[]> {
    const r = await this.request<{ items: RevisionSummary[] }>(
      "GET",
      `/documents/${documentId}/revisions?limit=200`,
    );
    return r.items;
  }

  async getRevision(documentId: string, number: number): Promise<Revision> {
    const r = await this.request<{ revision: Revision }>(
      "GET",
      `/documents/${documentId}/revisions/${number}`,
    );
    return r.revision;
  }

  async restoreRevision(
    documentId: string,
    number: number,
    options: { expectedRevision?: number } = {},
  ) {
    return this.request<{ revision: number; restoredFrom: number }>(
      "POST",
      `/documents/${documentId}/revisions/${number}/restore`,
      options,
    );
  }

  /** A request on a block (L1, L5): `POST /api/requests` with a block target and a quick kind. */
  createRequest(input: BlockRequestInput) {
    return this.request<{ request: { id: string } }>("POST", "/requests", {
      target: { type: "block", documentId: input.documentId, blockId: input.blockId },
      kind: input.kind,
      ...(input.note ? { message: input.note } : {}),
    }).then((r) => ({ id: r.request.id }));
  }
}
