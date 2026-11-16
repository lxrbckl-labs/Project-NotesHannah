import { loadWorkerConfig } from "./config.js";
import { stdoutLogger as logger } from "./log.js";
import { ProcessConverter } from "./runner.js";
import { Worker } from "./worker.js";

export { loadLimits, loadWorkerConfig } from "./config.js";
export type { Converter } from "./converter.js";
export * from "./protocol.js";
export { Worker } from "./worker.js";

async function main(): Promise<void> {
  process.umask(0o002); // results are group-writable so a server in the same group can clean up
  const cfg = loadWorkerConfig();
  const worker = new Worker(cfg, new ProcessConverter({ cfg, logger }), logger);
  let stopRequested = false;
  const shutdown = (sig: string) => {
    if (stopRequested) return;
    stopRequested = true;
    logger.log("info", "shutdown requested", { signal: sig });
    worker.stop();
  };
  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("SIGINT", () => shutdown("SIGINT"));

  await worker.init();
  logger.log("info", "converter started", {
    dataDir: cfg.dataDir,
    pid: process.pid,
    node: process.version,
    maxPages: cfg.limits.maxPages,
    maxInputBytes: cfg.limits.maxInputBytes,
    wallClockMs: cfg.limits.wallClockMs,
  });
  await worker.run();
  logger.log("info", "converter stopped");
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().then(
    () => process.exit(0),
    (e: unknown) => {
      logger.log("error", "converter failed to start", {
        error: e instanceof Error ? e.message : String(e),
      });
      process.exit(1);
    },
  );
}
