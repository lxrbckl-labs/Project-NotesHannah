/**
 * "This document's canvas changed" notices, in memory. A notice carries no data: each listener loads
 * the canvas itself as its own caller, so one user can never be handed another's canvas. Notices are
 * delivered after the current turn of the event loop, so a listener woken inside a write transaction
 * only runs once it has committed, and a burst of writes wakes it once.
 */
export interface CanvasEvents {
  subscribe(documentId: string, listener: () => void): () => void;
  publish(documentId: string): void;
  /** How many listeners are waiting, for tests and the health of the stream. */
  listeners(documentId?: string): number;
}

export function createCanvasEvents(): CanvasEvents {
  const byDocument = new Map<string, Set<() => void>>();
  const scheduled = new Set<string>();
  return {
    subscribe(documentId, listener) {
      const set = byDocument.get(documentId) ?? new Set<() => void>();
      byDocument.set(documentId, set);
      set.add(listener);
      return () => {
        const current = byDocument.get(documentId);
        current?.delete(listener);
        if (current && current.size === 0) byDocument.delete(documentId);
      };
    },
    publish(documentId) {
      if (!byDocument.has(documentId) || scheduled.has(documentId)) return;
      scheduled.add(documentId);
      setImmediate(() => {
        scheduled.delete(documentId);
        for (const listener of [...(byDocument.get(documentId) ?? [])]) {
          try {
            listener();
          } catch {
            // One broken listener must not stop the others.
          }
        }
      });
    },
    listeners(documentId) {
      if (documentId !== undefined) return byDocument.get(documentId)?.size ?? 0;
      let n = 0;
      for (const set of byDocument.values()) n += set.size;
      return n;
    },
  };
}
