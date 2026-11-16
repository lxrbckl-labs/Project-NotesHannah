import type { LayoutInput } from "@notes/schema";
import { computeLayout, type ElkLike, type TimedLayout } from "./elk-layout";

/**
 * Runs layouts in a dedicated worker when the browser has one, so ELK never
 * blocks panning; falls back to the main thread (tests, old browsers).
 * Only the latest request resolves: an older one still running when a newer
 * one arrives resolves with the newer result, so callers never apply a
 * stale layout.
 */
export interface LayoutRunner {
  run(input: LayoutInput): Promise<TimedLayout>;
  dispose(): void;
}

let sharedElk: Promise<ElkLike> | null = null;
function mainThreadElk(): Promise<ElkLike> {
  sharedElk ??= import("elkjs/lib/elk.bundled.js").then((m) => new m.default());
  return sharedElk;
}

export function createLayoutRunner(options: { worker?: boolean } = {}): LayoutRunner {
  const useWorker =
    options.worker ?? (typeof Worker !== "undefined" && !/jsdom/i.test(navigator.userAgent));
  let worker: Worker | null = null;
  let next = 0;
  const pending = new Map<
    number,
    { resolve: (r: TimedLayout) => void; reject: (e: Error) => void }
  >();
  if (useWorker) {
    try {
      worker = new Worker(new URL("./layout.worker.ts", import.meta.url), { type: "module" });
      worker.onmessage = (
        event: MessageEvent<{ id: number; result?: TimedLayout; error?: string }>,
      ) => {
        const { id, result, error } = event.data;
        const entry = pending.get(id);
        pending.delete(id);
        if (!entry) return;
        if (result) entry.resolve(result);
        else entry.reject(new Error(error ?? "layout failed"));
      };
      worker.onerror = () => {
        worker = null;
      };
    } catch {
      worker = null;
    }
  }
  return {
    async run(input) {
      if (!worker) return computeLayout(input, await mainThreadElk());
      const id = ++next;
      return new Promise<TimedLayout>((resolve, reject) => {
        pending.set(id, { resolve, reject });
        worker?.postMessage({ id, input });
      }).catch(async () => computeLayout(input, await mainThreadElk()));
    },
    dispose() {
      worker?.terminate();
      worker = null;
      pending.clear();
    },
  };
}
