import { spawn } from "node:child_process";
import { ConvertError } from "./errors.js";

const MAX_CAPTURE = 64 * 1024 * 1024;

export class Deadline {
  private readonly end: number;
  constructor(totalMs: number) {
    this.end = Date.now() + totalMs;
  }
  remaining(): number {
    const r = this.end - Date.now();
    if (r <= 0) throw new ConvertError("TIMEOUT", "wall-clock limit reached");
    return r;
  }
}

export interface RunResult {
  code: number | null;
  signal: NodeJS.Signals | null;
  stdout: Buffer;
  stderr: string;
}

/** Run a child process without a shell; killed when the shared deadline expires. */
export function run(
  deadline: Deadline,
  cmd: string,
  args: string[],
  opts: { env?: NodeJS.ProcessEnv; cwd?: string } = {},
): Promise<RunResult> {
  return new Promise((resolve, reject) => {
    const budget = deadline.remaining();
    const child = spawn(cmd, args, {
      env: opts.env ?? process.env,
      cwd: opts.cwd,
      stdio: ["ignore", "pipe", "pipe"],
      detached: true, // own process group so LibreOffice's oosplash/soffice.bin children die too
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
      reject(new ConvertError("INTERNAL_ERROR", `cannot spawn ${cmd}: ${e.message}`));
    });
    child.on("close", (code, signal) => {
      clearTimeout(timer);
      kill(); // reap any stragglers in the group
      if (timedOut) {
        reject(new ConvertError("TIMEOUT", `${cmd} exceeded the wall-clock limit`));
        return;
      }
      resolve({ code, signal, stdout: Buffer.concat(out), stderr: err });
    });
  });
}
