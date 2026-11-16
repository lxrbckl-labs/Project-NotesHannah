import { spawn } from "node:child_process";
import { createWriteStream } from "node:fs";
import { ConvertError } from "../errors.js";

const MAX_CAPTURE = 64 * 1024 * 1024;

export class Deadline {
  private readonly end: number;
  constructor(totalMs: number) {
    this.end = Date.now() + totalMs;
  }
  remaining(): number {
    const r = this.end - Date.now();
    if (r <= 0) throw new ConvertError("conversion_failed", "wall-clock limit reached", "timeout");
    return r;
  }
}

export interface RunResult {
  code: number | null;
  signal: NodeJS.Signals | null;
  stdout: Buffer;
  stderr: string;
}

/** Run a tool without a shell; it is killed (with its whole process group) when the shared deadline expires. */
export function run(
  deadline: Deadline,
  cmd: string,
  args: string[],
  opts: {
    env?: NodeJS.ProcessEnv;
    cwd?: string;
    /** Send stdout to this file instead of holding it in memory (for tools that print an image). */
    stdoutTo?: string;
  } = {},
): Promise<RunResult> {
  return new Promise((resolve, reject) => {
    const budget = deadline.remaining();
    const child = spawn(cmd, args, {
      env: opts.env ?? process.env,
      cwd: opts.cwd,
      stdio: ["ignore", "pipe", "pipe"],
      detached: true, // own process group so LibreOffice's oosplash/soffice.bin children die too
    });
    const sink = opts.stdoutTo ? createWriteStream(opts.stdoutTo, { mode: 0o600 }) : null;
    // A write error (disk full, directory gone) must not escape as an unhandled event and kill the child.
    let sinkError: Error | null = null;
    sink?.on("error", (e) => {
      sinkError = e;
    });
    const out: Buffer[] = [];
    let outBytes = 0;
    let err = "";
    let timedOut = false;
    const kill = () => {
      try {
        if (child.pid) process.kill(-child.pid, "SIGKILL");
      } catch {
        /* already gone */
      }
    };
    const timer = setTimeout(() => {
      timedOut = true;
      kill();
    }, budget);
    child.stdout.on("data", (d: Buffer) => {
      if (sink) {
        sink.write(d);
        return;
      }
      outBytes += d.length;
      if (outBytes > MAX_CAPTURE) {
        kill();
        return;
      }
      out.push(d);
    });
    child.stderr.on("data", (d: Buffer) => {
      if (err.length < 64 * 1024) err += d.toString("utf8");
    });
    child.on("error", (e) => {
      clearTimeout(timer);
      reject(
        new ConvertError("conversion_failed", `cannot start ${cmd}: ${e.message}`, "internal"),
      );
    });
    child.on("close", (code, signal) => {
      clearTimeout(timer);
      kill(); // reap any stragglers in the group
      sink?.end();
      if (sinkError) {
        reject(
          new ConvertError(
            "conversion_failed",
            `cannot write ${cmd}'s output: ${(sinkError as Error).message}`,
            "internal",
          ),
        );
        return;
      }
      if (timedOut) {
        reject(new ConvertError("conversion_failed", `${cmd} exceeded the time limit`, "timeout"));
        return;
      }
      resolve({ code, signal, stdout: Buffer.concat(out), stderr: err });
    });
  });
}
