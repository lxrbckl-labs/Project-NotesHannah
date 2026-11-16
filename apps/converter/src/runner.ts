import { execFile, spawn } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import type { Limits, WorkerConfig } from "./config.js";
import type { ChildOutcome } from "./convert/child.js";
import type { Converter, ConvertRequest, ConvertSuccess } from "./converter.js";
import { ConvertError, cleanMessage } from "./errors.js";
import type { Logger } from "./log.js";
import { snapshotProcs, treeOf } from "./proc.js";

const execFileP = promisify(execFile);
const MiB = 1024 * 1024;

export function limitsToEnv(l: Limits): Record<string, string> {
  return {
    MAX_INPUT_BYTES: String(l.maxInputBytes),
    MAX_PAGES: String(l.maxPages),
    MAX_ZIP_UNCOMPRESSED_BYTES: String(l.maxZipUncompressedBytes),
    MAX_ZIP_ENTRIES: String(l.maxZipEntries),
    MAX_XML_ENTRY_BYTES: String(l.maxXmlEntryBytes),
    MAX_PIXELS: String(l.maxPixelsPerImage),
    WALL_CLOCK_MS: String(l.wallClockMs),
    PAGE_LONG_EDGE: String(l.pageLongEdge),
    THUMB_LONG_EDGE: String(l.thumbLongEdge),
    WEBP_QUALITY: String(l.webpQuality),
    RENDER_CONCURRENCY: String(l.renderConcurrency),
  };
}

export interface ChildSpec {
  cmd: string;
  args: string[];
}

export interface RunnerOptions {
  cfg: WorkerConfig;
  logger: Logger;
  /** Where per-job scratch directories are made. Default: the OS temp dir (tmpfs in the container). */
  scratchRoot?: string;
  /** Build the child command line. Default: prlimit-wrapped node running convert/child.js. */
  childSpec?: (req: ConvertRequest, scratch: string) => ChildSpec;
  /** Memory sampling interval in ms. */
  sampleMs?: number;
  /** Override the memory sampler (tests). Returns resident bytes of the child tree, or null. */
  sampleRss?: (rootPid: number) => Promise<number | null>;
  toolVersions?: () => Promise<Record<string, string>>;
}

export async function hasPrlimit(): Promise<boolean> {
  try {
    await execFileP("prlimit", ["--version"]);
    return true;
  } catch {
    return false;
  }
}

async function dpkgVersion(pkg: string): Promise<string> {
  try {
    const { stdout } = await execFileP("dpkg-query", ["-W", "-f=\u0024{Version}", pkg]);
    return stdout.trim() || "unknown";
  } catch {
    return "unknown";
  }
}

/** Versions of the tools that produced the output, read once. */
export async function readToolVersions(): Promise<Record<string, string>> {
  const { default: sharp } = await import("sharp");
  const [lo, poppler, heif, de265] = await Promise.all([
    dpkgVersion("libreoffice-core"),
    dpkgVersion("poppler-utils"),
    dpkgVersion("libheif1"),
    dpkgVersion("libde265-0"),
  ]);
  return {
    node: process.version,
    sharp: sharp.versions.sharp ?? "unknown",
    libvips: sharp.versions.vips ?? "unknown",
    libreoffice: lo,
    poppler,
    libheif: heif,
    libde265: de265,
  };
}

/**
 * Runs each conversion in a child process of its own: resource limits (prlimit: CPU time, file size,
 * open files, no core dumps), a Node heap cap, a wall-clock kill, a resident-memory watchdog over the
 * child and every tool it started, and a private scratch directory that is wiped afterwards.
 */
export class ProcessConverter implements Converter {
  private versions: Promise<Record<string, string>> | null = null;
  constructor(private readonly opts: RunnerOptions) {}

  private defaultSpec(prlimit: boolean) {
    const { limits } = this.opts.cfg;
    const childJs = path.join(import.meta.dirname, "convert", "child.js");
    return (req: ConvertRequest, scratch: string): ChildSpec => {
      const node = [
        process.execPath,
        "--max-old-space-size=1024",
        childJs,
        req.inputPath,
        req.outDir,
        scratch,
      ];
      if (!prlimit) return { cmd: node[0] as string, args: node.slice(1) };
      const cpuSeconds = Math.ceil((limits.wallClockMs / 1000) * 2);
      return {
        cmd: "prlimit",
        args: [
          `--cpu=${cpuSeconds}`,
          `--fsize=${2 * 1024 * MiB}`,
          "--nofile=1024",
          "--core=0",
          "--",
          ...node,
        ],
      };
    };
  }

  async convert(req: ConvertRequest, signal: AbortSignal): Promise<ConvertSuccess> {
    const { cfg, logger } = this.opts;
    if (signal.aborted) throw abortError();
    const scratch = await mkdtemp(path.join(this.opts.scratchRoot ?? os.tmpdir(), "conv-"));
    const spec = (this.opts.childSpec ?? this.defaultSpec(await this.prlimitAvailable()))(
      req,
      scratch,
    );
    const env: Record<string, string> = {
      PATH: process.env.PATH ?? "/usr/local/bin:/usr/bin:/bin",
      LANG: "C.UTF-8",
      HOME: scratch,
      TMPDIR: scratch,
      ...limitsToEnv(cfg.limits),
    };
    let killedFor: "timeout" | "memory" | "abort" | null = null;
    let peak = 0;
    const seen = new Set<number>();
    try {
      const child = spawn(spec.cmd, spec.args, {
        env,
        cwd: scratch,
        stdio: ["ignore", "ignore", "pipe"],
        detached: true,
      });
      let stderr = "";
      child.stderr.on("data", (d: Buffer) => {
        if (stderr.length < 8192) stderr += d.toString("utf8");
      });
      const killTree = async (why: "timeout" | "memory" | "abort") => {
        killedFor ??= why;
        await killAll(child.pid, seen);
      };
      const wall = setTimeout(
        () => void killTree("timeout"),
        cfg.limits.wallClockMs + cfg.killGraceMs,
      );
      const onAbort = () => void killTree("abort");
      signal.addEventListener("abort", onAbort, { once: true });
      const sampler = setInterval(async () => {
        if (child.pid === undefined) return;
        const rss = await (this.opts.sampleRss ?? defaultSample(seen))(child.pid);
        if (rss === null) return;
        peak = Math.max(peak, rss);
        if (rss > cfg.childRssBytes) {
          logger.log("warn", "conversion over its memory limit, killing", {
            jobId: req.jobId,
            rssMb: Math.round(rss / MiB),
          });
          void killTree("memory");
        }
      }, this.opts.sampleMs ?? 250);
      const exit = await new Promise<{ code: number | null; signal: NodeJS.Signals | null }>(
        (resolve, reject) => {
          child.on("error", (e) =>
            reject(
              new ConvertError(
                "conversion_failed",
                `cannot start the conversion process: ${e.message}`,
                "internal",
              ),
            ),
          );
          child.on("close", (code, sig) => resolve({ code, signal: sig }));
        },
      ).finally(() => {
        clearTimeout(wall);
        clearInterval(sampler);
        signal.removeEventListener("abort", onAbort);
      });
      await killAll(undefined, seen); // tools orphaned by a crashed child

      if (killedFor === "abort") throw abortError();
      if (killedFor === "timeout")
        throw new ConvertError(
          "conversion_failed",
          "the conversion took too long and was stopped",
          "timeout",
        );
      if (killedFor === "memory")
        throw new ConvertError(
          "conversion_failed",
          "the conversion used too much memory and was stopped",
          "memory_limit",
        );

      let outcome: ChildOutcome;
      try {
        outcome = JSON.parse(
          await readFile(path.join(scratch, "result.json"), "utf8"),
        ) as ChildOutcome;
      } catch {
        const killed = exit.signal !== null;
        logger.log("warn", "conversion child left no result", {
          jobId: req.jobId,
          code: exit.code,
          signal: exit.signal,
          stderr: cleanMessage(stderr, 200),
        });
        throw new ConvertError(
          "conversion_failed",
          killed
            ? `the conversion process was killed (${exit.signal}), probably out of memory or CPU time`
            : "the conversion process crashed",
          killed ? "resource_limit" : "crashed",
        );
      }
      if (!outcome.ok) throw new ConvertError(outcome.code, outcome.message, outcome.reason);
      this.versions ??= (this.opts.toolVersions ?? readToolVersions)();
      const r = outcome.result;
      return {
        type: r.type,
        pages: r.pages,
        warnings: r.warnings,
        timings: r.timings,
        toolVersions: await this.versions,
        peakRssBytes: peak > 0 ? peak : null,
      };
    } finally {
      await rm(scratch, { recursive: true, force: true }).catch(() => undefined);
    }
  }

  private prlimitCache: boolean | null = null;
  private async prlimitAvailable(): Promise<boolean> {
    if (this.prlimitCache === null) {
      this.prlimitCache = await hasPrlimit();
      if (!this.prlimitCache)
        this.opts.logger.log("warn", "prlimit not found; running conversions without rlimits");
    }
    return this.prlimitCache;
  }
}

function abortError(): Error {
  return Object.assign(new Error("aborted"), { name: "AbortError" });
}

function defaultSample(seen: Set<number>) {
  return async (root: number): Promise<number | null> => {
    const procs = await snapshotProcs();
    if (!procs) return null;
    const tree = treeOf(procs, root);
    for (const p of tree) seen.add(p.pid);
    return tree.reduce((n, p) => n + p.rssBytes, 0);
  };
}

/** SIGKILL the child's process group and every process seen below it (tools run in groups of their own). */
async function killAll(root: number | undefined, seen: Set<number>): Promise<void> {
  if (root !== undefined) {
    const procs = await snapshotProcs();
    if (procs) for (const p of treeOf(procs, root)) seen.add(p.pid);
    try {
      process.kill(-root, "SIGKILL");
    } catch {
      /* gone */
    }
  }
  for (const pid of seen) {
    try {
      process.kill(pid, "SIGKILL");
    } catch {
      /* gone */
    }
    try {
      process.kill(-pid, "SIGKILL");
    } catch {
      /* not a group leader */
    }
  }
}
