import { type SourceFile, UPLOAD_LIMITS } from "@notes/schema";
import type { QueryClient } from "@tanstack/react-query";
import { ApiClientError, startUpload, type UploadHandle } from "../../lib/api";
import { uploadFailure } from "../../lib/messages";

export type UploadStatus = "queued" | "uploading" | "done" | "error" | "cancelled";

export interface UploadItem {
  id: number;
  file: File;
  name: string;
  size: number;
  nodeId: string | null;
  /** Where it is going, in words ("Lecture 07", "the inbox"). */
  target: string;
  status: UploadStatus;
  progress: number;
  error?: { message: string; hint?: string };
  result?: SourceFile;
}

const CONCURRENCY = 2;

/**
 * The upload queue. It lives above the router, so uploads keep going while she moves around the
 * app. Files go one request each, two at a time, with byte progress, cancel and retry.
 */
export class UploadManager {
  private items: UploadItem[] = [];
  private listeners = new Set<() => void>();
  private handles = new Map<number, UploadHandle>();
  private next = 1;
  private snapshot: readonly UploadItem[] = [];

  constructor(private client: QueryClient) {}

  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };
  getSnapshot = () => this.snapshot;

  private emit() {
    this.snapshot = [...this.items];
    for (const listener of this.listeners) listener();
  }

  private patch(id: number, change: Partial<UploadItem>) {
    this.items = this.items.map((item) => (item.id === id ? { ...item, ...change } : item));
    this.emit();
  }

  enqueue(files: File[], target: { nodeId: string | null; label: string }) {
    for (const file of files) {
      const id = this.next++;
      const tooBig = file.size > UPLOAD_LIMITS.maxBytes;
      this.items.push({
        id,
        file,
        name: file.name,
        size: file.size,
        nodeId: target.nodeId,
        target: target.label,
        status: tooBig ? "error" : "queued",
        progress: 0,
        ...(tooBig
          ? {
              error: uploadFailure(
                new ApiClientError(413, { code: "too_large", message: "Too large" }),
              ),
            }
          : {}),
      });
    }
    this.emit();
    this.pump();
  }

  private pump() {
    const running = this.items.filter((i) => i.status === "uploading").length;
    const waiting = this.items.filter((i) => i.status === "queued");
    for (const item of waiting.slice(0, Math.max(0, CONCURRENCY - running))) this.start(item);
  }

  private start(item: UploadItem) {
    this.patch(item.id, { status: "uploading", progress: 0, error: undefined });
    const handle = startUpload(item.file, item.nodeId, (fraction) =>
      this.patch(item.id, { progress: fraction }),
    );
    this.handles.set(item.id, handle);
    handle.promise
      .then((result) => {
        this.patch(item.id, { status: "done", progress: 1, result });
        void this.client.invalidateQueries({ queryKey: ["files"] });
      })
      .catch((error: unknown) => {
        if (error instanceof ApiClientError && error.code === "cancelled") {
          this.patch(item.id, { status: "cancelled" });
        } else {
          this.patch(item.id, { status: "error", error: uploadFailure(error) });
        }
      })
      .finally(() => {
        this.handles.delete(item.id);
        this.pump();
      });
  }

  cancel(id: number) {
    const item = this.items.find((i) => i.id === id);
    if (!item) return;
    if (item.status === "uploading") this.handles.get(id)?.cancel();
    else if (item.status === "queued") this.patch(id, { status: "cancelled" });
  }

  retry(id: number) {
    const item = this.items.find((i) => i.id === id);
    if (!item || (item.status !== "error" && item.status !== "cancelled")) return;
    this.patch(id, { status: "queued", progress: 0, error: undefined });
    this.pump();
  }

  dismiss(id: number) {
    this.items = this.items.filter((i) => i.id !== id || i.status === "uploading");
    this.emit();
  }

  clearFinished() {
    this.items = this.items.filter((i) => i.status === "queued" || i.status === "uploading");
    this.emit();
  }

  get active() {
    return this.items.some((i) => i.status === "uploading" || i.status === "queued");
  }
}
