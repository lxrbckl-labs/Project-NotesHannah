import { createFilesService, type FilesDeps, type FilesServiceOptions } from "./service.js";

export interface QueueWatcherOptions extends FilesServiceOptions {
  /** How often the queue directories are scanned. */
  intervalMs?: number;
}

export interface QueueWatcher {
  /** Stop scanning. Safe to call twice. */
  stop(): void;
  /** Scan once now (also what the timer does). */
  tick(): void;
}

/**
 * Poll `queue/done` and `queue/failed` for the converter's results, notice
 * jobs it has picked up, and fail the ones that time out. Started once from
 * the server's entry point; the timer never keeps the process alive.
 */
export function startQueueWatcher(
  deps: FilesDeps,
  options: QueueWatcherOptions = {},
): QueueWatcher {
  const log = options.log ?? ((message: string) => console.warn(`[files] ${message}`));
  const service = createFilesService(deps, { ...options, log });
  let lastError = "";
  let running = false;

  function tick(): void {
    if (running) return;
    running = true;
    try {
      service.processQueue();
      lastError = "";
    } catch (error) {
      const message = String(error);
      // Say it once, not every second, while the storage drive is away.
      if (message !== lastError) log(`queue scan failed: ${message}`);
      lastError = message;
    } finally {
      running = false;
    }
  }

  const timer = setInterval(tick, options.intervalMs ?? 1500);
  timer.unref();
  return {
    tick,
    stop() {
      clearInterval(timer);
    },
  };
}

/** Stop a watcher started with `startQueueWatcher`. */
export function stopQueueWatcher(watcher: QueueWatcher): void {
  watcher.stop();
}
