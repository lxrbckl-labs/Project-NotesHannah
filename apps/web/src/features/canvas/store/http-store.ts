import type { Actor, CanvasOp, Point, Problem } from "@notes/schema";
import type { ApplyOutcome, CanvasStore, LayoutVariant, LoadedCanvas, Placement } from "./types";

/**
 * The store against the server routes proposed in docs/canvas.md:
 *
 *   GET  /api/documents/:id/canvas              → LoadedCanvas
 *   POST /api/documents/:id/canvas/ops          { ops, expectedRevision? } → { canvas, report }
 *   PUT  /api/documents/:id/canvas/placements   { placements } → { canvas }
 *   GET  /api/documents/:id/canvas/layout-cache/:variant → { positions } (204 when none)
 *   PUT  /api/documents/:id/canvas/layout-cache/:variant { positions }
 *   GET  /api/documents/:id/canvas/events       Server-Sent Events, event "canvas" with LoadedCanvas
 *
 * Errors use the shared ApiError shape; invalid input carries `problems`.
 */
export interface HttpStoreOptions {
  actor: Actor;
  baseUrl?: string;
  fetch?: typeof fetch;
  debounceMs?: number;
}

export class HttpCanvasStore implements CanvasStore {
  readonly actor: Actor;
  private readonly base: string;
  private readonly http: typeof fetch;
  private readonly debounceMs: number;
  private pending = new Map<string, Map<string, Placement>>();
  private timers = new Map<string, ReturnType<typeof setTimeout>>();

  constructor(options: HttpStoreOptions) {
    this.actor = options.actor;
    this.base = options.baseUrl ?? "/api";
    this.http = options.fetch ?? fetch.bind(globalThis);
    this.debounceMs = options.debounceMs ?? 600;
  }

  private url(documentId: string, tail = ""): string {
    return `${this.base}/documents/${encodeURIComponent(documentId)}/canvas${tail}`;
  }

  async load(documentId: string): Promise<LoadedCanvas> {
    const res = await this.http(this.url(documentId), { credentials: "same-origin" });
    if (!res.ok) throw new Error(`Could not load the canvas (${res.status})`);
    return (await res.json()) as LoadedCanvas;
  }

  async apply(
    documentId: string,
    ops: CanvasOp[],
    options: { expectedRevision?: number } = {},
  ): Promise<ApplyOutcome> {
    const res = await this.http(this.url(documentId, "/ops"), {
      method: "POST",
      credentials: "same-origin",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ documentId, ops, expectedRevision: options.expectedRevision }),
    });
    const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    if (res.ok) return { ok: true, canvas: body.canvas as never, report: body.report as never };
    const problems = (body.problems as Problem[] | undefined) ?? [
      {
        path: "$",
        message: String(body.message ?? `Request failed (${res.status})`),
        example: null,
      },
    ];
    return { ok: false, problems, conflict: res.status === 409 };
  }

  savePlacements(documentId: string, placements: Placement[]): void {
    const queue = this.pending.get(documentId) ?? new Map<string, Placement>();
    for (const p of placements) queue.set(p.id, p);
    this.pending.set(documentId, queue);
    const existing = this.timers.get(documentId);
    if (existing) clearTimeout(existing);
    this.timers.set(
      documentId,
      setTimeout(() => void this.flushDocument(documentId), this.debounceMs),
    );
  }

  private async flushDocument(documentId: string): Promise<void> {
    const queue = this.pending.get(documentId);
    this.pending.delete(documentId);
    const timer = this.timers.get(documentId);
    if (timer) clearTimeout(timer);
    this.timers.delete(documentId);
    if (!queue || queue.size === 0) return;
    await this.http(this.url(documentId, "/placements"), {
      method: "PUT",
      credentials: "same-origin",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ placements: [...queue.values()] }),
      keepalive: true,
    });
  }

  async flush(): Promise<void> {
    await Promise.all([...this.pending.keys()].map((id) => this.flushDocument(id)));
  }

  subscribe(documentId: string, listener: (next: LoadedCanvas) => void): () => void {
    if (typeof EventSource === "undefined") return () => {};
    const source = new EventSource(this.url(documentId, "/events"), { withCredentials: true });
    const onCanvas = (event: MessageEvent<string>) => {
      try {
        listener(JSON.parse(event.data) as LoadedCanvas);
      } catch {
        // Ignore a malformed event; the next one carries the full state.
      }
    };
    source.addEventListener("canvas", onCanvas as EventListener);
    return () => source.close();
  }

  async loadLayoutCache(
    documentId: string,
    variant: LayoutVariant,
  ): Promise<Record<string, Point> | null> {
    const res = await this.http(this.url(documentId, `/layout-cache/${variant}`), {
      credentials: "same-origin",
    });
    if (!res.ok || res.status === 204) return null;
    const body = (await res.json()) as { positions?: Record<string, Point> };
    return body.positions ?? null;
  }

  saveLayoutCache(
    documentId: string,
    variant: LayoutVariant,
    positions: Record<string, Point>,
  ): void {
    void this.http(this.url(documentId, `/layout-cache/${variant}`), {
      method: "PUT",
      credentials: "same-origin",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ positions }),
    }).catch(() => {});
  }
}
