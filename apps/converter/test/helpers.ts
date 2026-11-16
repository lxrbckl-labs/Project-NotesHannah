import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readdir, readFile, rename, rm, utimes, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { loadWorkerConfig, type WorkerConfig } from "../src/config.js";
import type { Converter, ConvertRequest, ConvertSuccess } from "../src/converter.js";
import { silentLogger } from "../src/log.js";
import type { JobFile } from "../src/protocol.js";
import { Worker } from "../src/worker.js";

export const USER = "usr_01HZX3K8M2N4P5Q6R7S8T9V0WX";
export const FILE = "fil_01HZX3K8M2N4P5Q6R7S8T9V0WX";
export const JOB = "job_01HZX3K8M2N4P5Q6R7S8T9V0WX";

export function ulid(n: number): string {
  return `01HZX3K8M2N4P5Q6R7S8T9${String(n)
    .padStart(4, "0")
    .replace(/[ILOU]/g, "0")}`.slice(0, 26);
}

export interface Env {
  dir: string;
  cfg: WorkerConfig;
  /** Put an original under originals/<user>/<sha256>; returns its sha256. */
  original(bytes: Buffer | string, user?: string): Promise<string>;
  /** Drop a job into pending the way the server must: temp name, then rename. */
  drop(job: Partial<JobFile> & { jobId: string }): Promise<void>;
  read(rel: string): Promise<unknown>;
  list(rel: string): Promise<string[]>;
  cleanup(): Promise<void>;
}

export async function makeEnv(overrides: Partial<WorkerConfig> = {}): Promise<Env> {
  const dir = await mkdtemp(path.join(os.tmpdir(), "conv-test-"));
  await mkdir(path.join(dir, "originals"), { recursive: true });
  const cfg: WorkerConfig = {
    ...loadWorkerConfig({ DATA_DIR: dir }),
    pollMs: 10,
    heartbeatMs: 50,
    settleMs: 2000,
    ...overrides,
  };
  const env: Env = {
    dir,
    cfg,
    async original(bytes, user = USER) {
      const buf = Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes);
      const sha = createHash("sha256").update(buf).digest("hex");
      await mkdir(path.join(dir, "originals", user), { recursive: true });
      await writeFile(path.join(dir, "originals", user, sha), buf);
      return sha;
    },
    async drop(job) {
      const full: JobFile = {
        userId: USER,
        fileId: FILE,
        sha256: "0".repeat(64),
        createdAt: new Date().toISOString(),
        ...job,
      };
      const pending = path.join(dir, "queue", "pending");
      await mkdir(pending, { recursive: true });
      const tmp = path.join(pending, `.${job.jobId}.tmp`);
      await writeFile(tmp, JSON.stringify(full));
      await rename(tmp, path.join(pending, `${job.jobId}.json`));
    },
    async read(rel) {
      return JSON.parse(await readFile(path.join(dir, rel), "utf8"));
    },
    async list(rel) {
      return readdir(path.join(dir, rel)).then(
        (l) => l.sort(),
        () => [],
      );
    },
    cleanup: () => rm(dir, { recursive: true, force: true }),
  };
  return env;
}

export function okResult(pages = 2): ConvertSuccess {
  return {
    type: "pdf",
    pages: Array.from({ length: pages }, (_, i) => ({
      index: i + 1,
      width: 1000,
      height: 1400,
      bytes: 1234,
      hasTextLayer: true,
      nativeText: `text ${i + 1}`,
      speakerNotes: null,
    })),
    warnings: [],
    timings: { total: 5 },
    toolVersions: { node: "test" },
    peakRssBytes: null,
  };
}

/** A converter that records calls and behaves as told. */
export class FakeConverter implements Converter {
  calls: ConvertRequest[] = [];
  constructor(
    private readonly behaviour: (
      req: ConvertRequest,
      signal: AbortSignal,
    ) => Promise<ConvertSuccess> = async (req) => {
      await mkdir(path.join(req.outDir, "thumbs"), { recursive: true });
      await writeFile(path.join(req.outDir, "0001.webp"), "page");
      await writeFile(path.join(req.outDir, "thumbs", "0001.webp"), "thumb");
      return okResult();
    },
  ) {}
  async convert(req: ConvertRequest, signal: AbortSignal): Promise<ConvertSuccess> {
    this.calls.push(req);
    return this.behaviour(req, signal);
  }
}

export async function makeWorker(env: Env, converter: Converter) {
  const worker = new Worker(env.cfg, converter, silentLogger);
  await worker.init();
  return worker;
}

export async function age(file: string, seconds: number): Promise<void> {
  const t = new Date(Date.now() - seconds * 1000);
  await utimes(file, t, t);
}

/** Poll until the condition holds (or fail after a few seconds). */
export async function until(cond: () => Promise<boolean>, ms = 5000): Promise<void> {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (await cond().catch(() => false)) return;
    await new Promise((r) => setTimeout(r, 10));
  }
  throw new Error("condition not met in time");
}
