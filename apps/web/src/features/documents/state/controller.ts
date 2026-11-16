import type { DocumentWithBlocks } from "@notes/schema";
import {
  applyCalls,
  applyReview,
  inverseOfAll,
  mapCallIds,
  OperationError,
  type PendingCall,
} from "../model/ops";
import { type DocumentStore, StoreError } from "../store/types";

/**
 * The editing session for one document: optimistic writes with rollback,
 * a save queue, client block IDs mapped to the server's, and undo/redo.
 *
 * Every change is a transaction of writer operations (or a review). It is
 * applied to what she sees at once, sent to the store in order, and on
 * failure the change (and anything queued after it, which was built on it)
 * is taken back and kept for retry.
 */

export type Txn =
  | { id: number; kind: "write"; calls: PendingCall[]; label: string }
  | {
      id: number;
      kind: "review";
      status: "reviewed" | "unverified";
      blockIds?: string[];
      label: string;
    };

type TxnSpec =
  | Omit<Extract<Txn, { kind: "write" }>, "id">
  | Omit<Extract<Txn, { kind: "review" }>, "id">;

interface UndoEntry {
  forward: TxnSpec;
  inverse: TxnSpec;
}

export type SaveStatus = "saved" | "saving" | "failed";

export interface ControllerState {
  phase: "loading" | "ready" | "error";
  loadError: string | null;
  /** What she sees: the confirmed document with pending changes applied. */
  doc: DocumentWithBlocks | null;
  /** The last state the store confirmed. */
  confirmed: DocumentWithBlocks | null;
  pending: Txn[];
  failed: Txn[];
  saveStatus: SaveStatus;
  /** Plain-language reason for the last failure, cleared on success. */
  error: string | null;
  /** True when the failure was a revision conflict: reload, do not retry. */
  conflict: boolean;
  canUndo: boolean;
  canRedo: boolean;
}

function messageOf(error: unknown): string {
  if (error instanceof StoreError) {
    if (error.code === "conflict")
      return "This document changed somewhere else. Reload to see the latest version.";
    if (error.code === "network" || error.code === "storage_unavailable")
      return "Couldn't reach the server, so your last change was undone.";
    return `Couldn't save: ${error.message}`;
  }
  if (error instanceof OperationError) return `That change isn't allowed: ${error.message}`;
  return "Something went wrong while saving.";
}

export class DocumentController {
  private listeners = new Set<() => void>();
  private nextId = 1;
  private running = false;
  private undoStack: UndoEntry[] = [];
  private redoStack: UndoEntry[] = [];
  private flushers = new Set<() => void>();
  private idleWaiters: Array<() => void> = [];
  /** Client block ID → the server's ID, for blocks inserted this session. */
  readonly idMap = new Map<string, string>();
  state: ControllerState = {
    phase: "loading",
    loadError: null,
    doc: null,
    confirmed: null,
    pending: [],
    failed: [],
    saveStatus: "saved",
    error: null,
    conflict: false,
    canUndo: false,
    canRedo: false,
  };

  constructor(
    readonly store: DocumentStore,
    readonly documentId: string,
  ) {}

  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  getState = () => this.state;

  private set(patch: Partial<ControllerState>) {
    const next = { ...this.state, ...patch };
    if ("confirmed" in patch || "pending" in patch)
      next.doc = this.fold(next.confirmed, next.pending);
    next.canUndo = this.undoStack.length > 0;
    next.canRedo = this.redoStack.length > 0;
    next.saveStatus =
      next.pending.length > 0
        ? "saving"
        : next.failed.length > 0 || next.conflict
          ? "failed"
          : "saved";
    this.state = next;
    for (const listener of this.listeners) listener();
    if (next.pending.length === 0) {
      const waiters = this.idleWaiters;
      this.idleWaiters = [];
      for (const resolve of waiters) resolve();
    }
  }

  private get context() {
    return { actor: this.store.actor };
  }

  private applyTxn(doc: DocumentWithBlocks, txn: TxnSpec): DocumentWithBlocks {
    if (txn.kind === "write") return applyCalls(doc, txn.calls, this.context).doc;
    return applyReview(doc, txn.status, txn.blockIds).doc;
  }

  private fold(confirmed: DocumentWithBlocks | null, pending: Txn[]): DocumentWithBlocks | null {
    if (!confirmed) return null;
    let doc = confirmed;
    for (const txn of pending) {
      try {
        doc = this.applyTxn(doc, txn);
      } catch {
        // A queued change that no longer applies is skipped; the store will refuse it too.
      }
    }
    return doc;
  }

  async load(): Promise<void> {
    this.set({ phase: "loading", loadError: null });
    try {
      const doc = await this.store.loadDocument(this.documentId);
      this.undoStack = [];
      this.redoStack = [];
      this.idMap.clear();
      this.set({
        phase: "ready",
        confirmed: doc,
        pending: [],
        failed: [],
        error: null,
        conflict: false,
      });
    } catch (error) {
      this.set({
        phase: "error",
        loadError:
          error instanceof StoreError ? error.message : "The document could not be loaded.",
      });
    }
  }

  /** Editors with unsaved typing register a flush so undo and restore see their text. */
  registerFlush(flush: () => void): () => void {
    this.flushers.add(flush);
    return () => this.flushers.delete(flush);
  }

  flushEditors() {
    for (const flush of [...this.flushers]) flush();
  }

  /**
   * Apply a change. Returns false (and leaves everything as it was) when the
   * change does not apply to what she sees, e.g. a field over its limit.
   */
  perform(calls: PendingCall[], label: string, options: { undoable?: boolean } = {}): boolean {
    const doc = this.state.doc;
    if (!doc || calls.length === 0) return false;
    let inverse: PendingCall[];
    try {
      applyCalls(doc, calls, this.context);
      inverse = inverseOfAll(doc, calls, this.context);
    } catch (error) {
      this.set({ error: messageOf(error) });
      return false;
    }
    if (options.undoable !== false) {
      this.undoStack.push({
        forward: { kind: "write", calls, label },
        inverse: { kind: "write", calls: inverse, label: `Undo ${label.toLowerCase()}` },
      });
      if (this.undoStack.length > 200) this.undoStack.shift();
      this.redoStack = [];
    }
    this.enqueue({ kind: "write", calls, label });
    return true;
  }

  /** Mark blocks reviewed or unverified (all blocks when `blockIds` is left out). */
  review(status: "reviewed" | "unverified", blockIds?: string[]) {
    const doc = this.state.doc;
    if (!doc) return;
    const { changed } = applyReview(doc, status, blockIds);
    if (changed.length === 0) return;
    const label = status === "reviewed" ? "Mark reviewed" : "Mark unverified";
    this.undoStack.push({
      forward: { kind: "review", status, blockIds: changed, label },
      inverse: {
        kind: "review",
        status: status === "reviewed" ? "unverified" : "reviewed",
        blockIds: changed,
        label: `Undo ${label.toLowerCase()}`,
      },
    });
    this.redoStack = [];
    this.enqueue({ kind: "review", status, ...(blockIds ? { blockIds: changed } : {}), label });
  }

  undo() {
    this.flushEditors();
    const entry = this.undoStack.pop();
    if (!entry) return;
    if (!this.replay(entry.inverse)) {
      this.set({ error: "That change can't be undone any more." });
      return;
    }
    this.redoStack.push(entry);
  }

  redo() {
    this.flushEditors();
    const entry = this.redoStack.pop();
    if (!entry) return;
    if (!this.replay(entry.forward)) {
      this.set({ error: "That change can't be redone any more." });
      return;
    }
    this.undoStack.push(entry);
  }

  private replay(spec: TxnSpec): boolean {
    const doc = this.state.doc;
    if (!doc) return false;
    try {
      this.applyTxn(doc, spec);
    } catch {
      return false;
    }
    this.enqueue(spec);
    return true;
  }

  private enqueue(spec: TxnSpec) {
    const txn = { ...spec, id: this.nextId++ } as Txn;
    this.set({ pending: [...this.state.pending, txn], error: null });
    void this.pump();
  }

  private toServer = (id: string) => this.idMap.get(id) ?? id;

  private async pump() {
    if (this.running) return;
    this.running = true;
    try {
      while (this.state.pending.length > 0) {
        const txn = this.state.pending[0] as Txn;
        const confirmed = this.state.confirmed as DocumentWithBlocks;
        try {
          let next: DocumentWithBlocks;
          if (txn.kind === "write") {
            const result = await this.store.apply(
              this.documentId,
              txn.calls.map((c) => mapCallIds(c.call, this.toServer)),
              { expectedRevision: confirmed.revision },
            );
            txn.calls.forEach((c, i) => {
              const r = result.results[i];
              if (c.clientIds && r && r.operation === "insert_blocks")
                r.blockIds.forEach((serverId, j) => {
                  const clientId = c.clientIds?.[j];
                  if (clientId) this.idMap.set(clientId, serverId);
                });
            });
            next = {
              ...applyCalls(confirmed, txn.calls, this.context).doc,
              revision: result.revision,
            };
          } else {
            const result = await this.store.setReview(this.documentId, {
              status: txn.status,
              ...(txn.blockIds ? { blockIds: txn.blockIds.map(this.toServer) } : {}),
              expectedRevision: confirmed.revision,
            });
            next = {
              ...applyReview(confirmed, txn.status, txn.blockIds).doc,
              revision: result.revision,
            };
          }
          this.set({ confirmed: next, pending: this.state.pending.slice(1), conflict: false });
        } catch (error) {
          const conflict = error instanceof StoreError && error.code === "conflict";
          this.set({
            pending: [],
            failed: conflict ? [] : [...this.state.failed, ...this.state.pending],
            error: messageOf(error),
            conflict,
          });
        }
      }
    } finally {
      this.running = false;
    }
  }

  /** Send failed changes again. */
  retry() {
    const failed = this.state.failed;
    if (failed.length === 0) return;
    this.set({ failed: [], pending: [...this.state.pending, ...failed], error: null });
    void this.pump();
  }

  dismissError() {
    this.set({ error: null });
  }

  /** Resolves when nothing is waiting to be saved. */
  idle(): Promise<void> {
    if (this.state.pending.length === 0) return Promise.resolve();
    return new Promise((resolve) => this.idleWaiters.push(resolve));
  }

  /** Restore an earlier revision (D12), then reload. */
  async restore(number: number): Promise<void> {
    this.flushEditors();
    await this.idle();
    const revision = this.state.confirmed?.revision;
    await this.store.restoreRevision(
      this.documentId,
      number,
      revision !== undefined ? { expectedRevision: revision } : {},
    );
    await this.load();
  }

  /** The server's ID for a block she sees (for links and requests). */
  serverId(blockId: string): string {
    return this.toServer(blockId);
  }
}
