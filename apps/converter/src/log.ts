export type Level = "debug" | "info" | "warn" | "error";

export interface Logger {
  log(level: Level, msg: string, fields?: Record<string, unknown>): void;
}

/** One JSON object per line on stdout. Callers pass ids, counts and timings, never file contents or names. */
export const stdoutLogger: Logger = {
  log(level, msg, fields = {}) {
    process.stdout.write(
      `${JSON.stringify({ ts: new Date().toISOString(), level, msg, ...fields })}\n`,
    );
  },
};

export const silentLogger: Logger = { log() {} };
