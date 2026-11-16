import { mkdir, readFile, rm, stat, symlink, utimes, writeFile } from "node:fs/promises";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { ConvertError } from "../src/errors.js";
import { silentLogger } from "../src/log.js";
import { Worker } from "../src/worker.js";
import {
  age,
  type Env,
  FakeConverter,
  FILE,
  JOB,
  makeEnv,
  makeWorker,
  okResult,
  USER,
  until,
} from "./helpers.js";

let env: Env;
beforeEach(async () => {
  env = await makeEnv();
});
afterEach(async () => {
  await env.cleanup();
});

const job2 = "job_01HZX3K8M2N4P5Q6R7S8T9V0WY";

describe("success", () => {
  test("claims, converts, installs pages, writes done, removes the processing file", async () => {
    const sha = await env.original("hello original");
    await env.drop({ jobId: JOB, sha256: sha });
    const conv = new FakeConverter();
    const w = await makeWorker(env, conv);

    expect(await w.processNext()).toBe("done");

    expect(conv.calls).toHaveLength(1);
    expect(conv.calls[0]?.inputPath).toBe(path.join(env.dir, "originals", USER, sha));
    expect(conv.calls[0]?.outDir).toBe(path.join(env.dir, "pages", USER, `${FILE}.tmp-${JOB}`));
    expect(await env.list("queue/pending")).toEqual([]);
    expect(await env.list("queue/processing")).toEqual([]);
    expect(await env.list("queue/done")).toEqual([`${JOB}.json`]); // no .tmp-* leftovers
    expect(await env.list(`pages/${USER}`)).toEqual([FILE]); // staging was renamed away
    expect(await env.list(`pages/${USER}/${FILE}`)).toEqual(["0001.webp", "thumbs"]);

    const done = (await env.read(`queue/done/${JOB}.json`)) as Record<string, unknown>;
    expect(done).toMatchObject({
      jobId: JOB,
      fileId: FILE,
      ok: true,
      type: "pdf",
      pageCount: 2,
      attempt: 1,
      warnings: [],
      toolVersions: { node: "test" },
    });
    expect((done.pages as unknown[])[0]).toEqual({
      index: 1,
      width: 1000,
      height: 1400,
      bytes: 1234,
      hasTextLayer: true,
      nativeText: "text 1",
      speakerNotes: null,
    });
    expect(done.timings).toMatchObject({ total: 5 });
    expect(Object.keys(done.timings as object)).toEqual(
      expect.arrayContaining(["queueWait", "elapsed"]),
    );
  });

  test("a retry replaces the previous output", async () => {
    const sha = await env.original("x");
    await mkdir(path.join(env.dir, "pages", USER, FILE), { recursive: true });
    await writeFile(path.join(env.dir, "pages", USER, FILE, "stale.webp"), "old");
    await env.drop({ jobId: JOB, sha256: sha });
    const w = await makeWorker(env, new FakeConverter());
    await w.processNext();
    expect(await env.list(`pages/${USER}/${FILE}`)).toEqual(["0001.webp", "thumbs"]);
    expect(await env.list(`pages/${USER}`)).toEqual([FILE]);
  });

  test("jobs run one at a time, oldest id first", async () => {
    const sha = await env.original("x");
    await env.drop({ jobId: job2, sha256: sha, fileId: "fil_01HZX3K8M2N4P5Q6R7S8T9V0WY" });
    await env.drop({ jobId: JOB, sha256: sha });
    const order: string[] = [];
    let running = 0;
    let maxRunning = 0;
    const conv = new FakeConverter(async (req) => {
      running += 1;
      maxRunning = Math.max(maxRunning, running);
      order.push(req.jobId);
      await new Promise((r) => setTimeout(r, 20));
      running -= 1;
      return okResult(1);
    });
    const w = await makeWorker(env, conv);
    expect(await w.processNext()).toBe("done");
    expect(await w.processNext()).toBe("done");
    expect(await w.processNext()).toBe("idle");
    expect(order).toEqual([JOB, job2]);
    expect(maxRunning).toBe(1);
  });
});

describe("failure", () => {
  test("a ConvertError becomes failed/<jobId>.json with the schema error code and leaves no pages", async () => {
    const sha = await env.original("x");
    await env.drop({ jobId: JOB, sha256: sha });
    const conv = new FakeConverter(async (req) => {
      await writeFile(path.join(req.outDir, "partial.webp"), "half");
      throw new ConvertError("encrypted_file", "PDF requires a password", "pdf_password");
    });
    const w = await makeWorker(env, conv);
    expect(await w.processNext()).toBe("failed");
    expect(await env.read(`queue/failed/${JOB}.json`)).toEqual({
      jobId: JOB,
      fileId: FILE,
      ok: false,
      errorCode: "encrypted_file",
      message: "PDF requires a password",
      reason: "pdf_password",
      attempt: 1,
      elapsedMs: expect.any(Number),
    });
    expect(await env.list("queue/processing")).toEqual([]);
    expect(await env.list("queue/done")).toEqual([]);
    expect(await env.list(`pages/${USER}`)).toEqual([]);
  });

  test("an unexpected exception becomes conversion_failed and does not leak its message", async () => {
    const sha = await env.original("x");
    await env.drop({ jobId: JOB, sha256: sha });
    const w = await makeWorker(
      env,
      new FakeConverter(async () => {
        throw new Error("secret internal detail /etc/passwd");
      }),
    );
    expect(await w.processNext()).toBe("failed");
    const r = (await env.read(`queue/failed/${JOB}.json`)) as Record<string, string>;
    expect(r.errorCode).toBe("conversion_failed");
    expect(r.message).not.toContain("passwd");
  });

  test("a failed retry keeps the earlier output out of the way only on success (old pages stay on failure)", async () => {
    const sha = await env.original("x");
    await mkdir(path.join(env.dir, "pages", USER, FILE), { recursive: true });
    await writeFile(path.join(env.dir, "pages", USER, FILE, "0001.webp"), "good earlier output");
    await env.drop({ jobId: JOB, sha256: sha });
    const w = await makeWorker(
      env,
      new FakeConverter(async () => {
        throw new ConvertError("corrupt_file", "bad");
      }),
    );
    await w.processNext();
    expect(await readFile(path.join(env.dir, "pages", USER, FILE, "0001.webp"), "utf8")).toBe(
      "good earlier output",
    );
  });
});

describe("the original", () => {
  test("missing original fails without calling the converter", async () => {
    await env.drop({ jobId: JOB, sha256: "a".repeat(64) });
    const conv = new FakeConverter();
    const w = await makeWorker(env, conv);
    await w.processNext();
    expect(conv.calls).toHaveLength(0);
    expect(await env.read(`queue/failed/${JOB}.json`)).toMatchObject({
      errorCode: "conversion_failed",
      reason: "original_missing",
    });
  });

  test("an original that does not match its fingerprint is refused", async () => {
    const sha = await env.original("real bytes");
    await writeFile(path.join(env.dir, "originals", USER, sha), "tampered");
    await env.drop({ jobId: JOB, sha256: sha });
    const conv = new FakeConverter();
    const w = await makeWorker(env, conv);
    await w.processNext();
    expect(conv.calls).toHaveLength(0);
    expect(await env.read(`queue/failed/${JOB}.json`)).toMatchObject({
      reason: "original_mismatch",
    });
  });

  test("a symlink in place of the original is refused", async () => {
    const outside = path.join(env.dir, "outside.txt");
    await writeFile(outside, "outside");
    const sha = "b".repeat(64);
    await mkdir(path.join(env.dir, "originals", USER), { recursive: true });
    await symlink(outside, path.join(env.dir, "originals", USER, sha));
    await env.drop({ jobId: JOB, sha256: sha });
    const conv = new FakeConverter();
    const w = await makeWorker(env, conv);
    await w.processNext();
    expect(conv.calls).toHaveLength(0);
    expect(await env.read(`queue/failed/${JOB}.json`)).toMatchObject({
      reason: "original_missing",
    });
  });

  test("an original over the size limit is too_large before any hashing or conversion", async () => {
    await env.cleanup();
    env = await makeEnv({ limits: { ...(await makeEnv()).cfg.limits, maxInputBytes: 10 } });
    const sha = await env.original("this is more than ten bytes");
    await env.drop({ jobId: JOB, sha256: sha });
    const conv = new FakeConverter();
    const w = await makeWorker(env, conv);
    await w.processNext();
    expect(conv.calls).toHaveLength(0);
    expect(await env.read(`queue/failed/${JOB}.json`)).toMatchObject({
      errorCode: "too_large",
      reason: "file_too_large",
    });
  });
});

describe("job files that are not trustworthy", () => {
  test("names that are not job ids, and temp names, are never picked up", async () => {
    const pending = path.join(env.dir, "queue", "pending");
    await mkdir(pending, { recursive: true });
    for (const n of [
      `.${JOB}.tmp`,
      `${JOB}.json.tmp`,
      "readme.json",
      `${JOB}.JSON`,
      "job_short.json",
      `x${JOB}.json`,
    ]) {
      await writeFile(path.join(pending, n), "{}");
    }
    const conv = new FakeConverter();
    const w = await makeWorker(env, conv);
    expect(await w.processNext()).toBe("idle");
    expect(conv.calls).toHaveLength(0);
    expect(await env.list("queue/failed")).toEqual([]);
    expect((await env.list("queue/pending")).length).toBe(6);
  });

  test("a half-written job file with a real name is left alone while it is fresh", async () => {
    const pending = path.join(env.dir, "queue", "pending");
    await mkdir(pending, { recursive: true });
    await writeFile(path.join(pending, `${JOB}.json`), '{"jobId":"job_01HZX3K8');
    const conv = new FakeConverter();
    const w = await makeWorker(env, conv);
    expect(await w.processNext()).toBe("requeued");
    expect(await env.list("queue/pending")).toEqual([`${JOB}.json`]);
    expect(await env.list("queue/failed")).toEqual([]);
    expect(conv.calls).toHaveLength(0);
  });

  test("the same file, once it is old enough, is refused as malformed", async () => {
    const pending = path.join(env.dir, "queue", "pending");
    await mkdir(pending, { recursive: true });
    const f = path.join(pending, `${JOB}.json`);
    await writeFile(f, '{"jobId":"job_01HZX3K8');
    await age(f, 60);
    const w = await makeWorker(env, new FakeConverter());
    expect(await w.processNext()).toBe("failed");
    expect(await env.read(`queue/failed/${JOB}.json`)).toMatchObject({
      ok: false,
      fileId: null,
      errorCode: "conversion_failed",
      reason: "invalid_job",
    });
    expect(await env.list("queue/processing")).toEqual([]);
  });

  test.each([
    ["userId with traversal", { userId: "../../etc" }],
    ["userId absolute", { userId: "/etc" }],
    ["userId wrong prefix", { userId: "fil_01HZX3K8M2N4P5Q6R7S8T9V0WX" }],
    ["userId lowercase ulid", { userId: "usr_01hzx3k8m2n4p5q6r7s8t9v0wx" }],
    ["userId with nul", { userId: "usr_01HZX3K8M2N4P5Q6R7S8T9V0W\u0000" }],
    ["fileId with traversal", { fileId: "fil_../../../../tmp/x" }],
    ["fileId too long", { fileId: `${FILE}0` }],
    ["fileId with slash", { fileId: "fil_01HZX3K8M2N4P5Q6R7S8T9V/WX" }],
    ["sha256 traversal", { sha256: `../../${"a".repeat(55)}` }],
    ["sha256 uppercase", { sha256: "A".repeat(64) }],
    ["sha256 too short", { sha256: "a".repeat(63) }],
    ["jobId different from file name", { jobId: job2 }],
    ["bad createdAt", { createdAt: "not a date" }],
    ["attempts negative", { attempts: -1 }],
    ["attempts string", { attempts: "1" }],
  ])(
    "%s is refused and nothing is read or written outside the expected place",
    async (_label, patch) => {
      const pending = path.join(env.dir, "queue", "pending");
      await mkdir(pending, { recursive: true });
      const body = {
        jobId: JOB,
        userId: USER,
        fileId: FILE,
        sha256: "c".repeat(64),
        createdAt: new Date().toISOString(),
        ...patch,
      };
      await writeFile(path.join(pending, `${JOB}.json`), JSON.stringify(body));
      const conv = new FakeConverter();
      const w = await makeWorker(env, conv);
      expect(await w.processNext()).toBe("failed");
      expect(conv.calls).toHaveLength(0);
      const r = (await env.read(`queue/failed/${JOB}.json`)) as Record<string, unknown>;
      expect(r).toMatchObject({ ok: false, errorCode: "conversion_failed", reason: "invalid_job" });
      expect(await env.list("pages")).toEqual([]); // no per-user directory was created for the bogus ids
      expect(await env.list("queue/processing")).toEqual([]);
      // Nothing escaped into the parent of the data dir.
      await expect(stat(path.join(env.dir, "..", "etc"))).rejects.toThrow();
    },
  );

  test("a job that is not an object is refused", async () => {
    const pending = path.join(env.dir, "queue", "pending");
    await mkdir(pending, { recursive: true });
    await writeFile(path.join(pending, `${JOB}.json`), "[1,2,3]");
    const w = await makeWorker(env, new FakeConverter());
    expect(await w.processNext()).toBe("failed");
    expect(await env.read(`queue/failed/${JOB}.json`)).toMatchObject({ fileId: null });
  });

  test("an oversized job file is refused unread", async () => {
    const pending = path.join(env.dir, "queue", "pending");
    await mkdir(pending, { recursive: true });
    await writeFile(path.join(pending, `${JOB}.json`), `{"x":"${"a".repeat(100_000)}"}`);
    const w = await makeWorker(env, new FakeConverter());
    expect(await w.processNext()).toBe("failed");
  });
});

describe("crash recovery", () => {
  async function leaveInProcessing(attempts?: number) {
    const sha = await env.original("x");
    const proc = path.join(env.dir, "queue", "processing");
    await mkdir(proc, { recursive: true });
    const job = {
      jobId: JOB,
      userId: USER,
      fileId: FILE,
      sha256: sha,
      createdAt: new Date().toISOString(),
      ...(attempts === undefined ? {} : { attempts }),
    };
    await writeFile(path.join(proc, `${JOB}.json`), JSON.stringify(job));
    return sha;
  }

  test("a job left in processing goes back to pending once, then runs as attempt 2", async () => {
    await leaveInProcessing(1);
    const conv = new FakeConverter();
    const w = await makeWorker(env, conv);
    expect(await env.list("queue/processing")).toEqual([]);
    expect(await env.list("queue/pending")).toEqual([`${JOB}.json`]);
    expect(await w.processNext()).toBe("done");
    expect(await env.read(`queue/done/${JOB}.json`)).toMatchObject({ attempt: 2, ok: true });
  });

  test("a job already retried is failed with conversion_failed instead of looping", async () => {
    await leaveInProcessing(2);
    const conv = new FakeConverter();
    const w = await makeWorker(env, conv);
    expect(await env.list("queue/pending")).toEqual([]);
    expect(await env.read(`queue/failed/${JOB}.json`)).toMatchObject({
      ok: false,
      fileId: FILE,
      errorCode: "conversion_failed",
      reason: "crashed",
      attempt: 2,
    });
    expect(await w.processNext()).toBe("idle");
    expect(conv.calls).toHaveLength(0);
  });

  test("a crash on every attempt ends in failed after exactly two starts", async () => {
    const sha = await env.original("x");
    await env.drop({ jobId: JOB, sha256: sha });
    let starts = 0;
    for (let boot = 1; boot <= 3; boot++) {
      // "Hang" in the conversion and abandon this worker object: that is what a killed process leaves behind.
      const w = new Worker(
        env.cfg,
        new FakeConverter(() => {
          starts += 1;
          return new Promise<never>(() => undefined);
        }),
        silentLogger,
      );
      await w.init();
      void w.processNext();
      // Wait for the outcome of this boot instead of a fixed sleep, so a busy machine cannot
      // make the test race: boots 1 and 2 start a conversion, boot 3 publishes the failure.
      const settled = async () =>
        boot < 3 ? starts === boot : (await env.list("queue/failed")).includes(`${JOB}.json`);
      for (let waited = 0; waited < 400 && !(await settled()); waited++) {
        await new Promise((r) => setTimeout(r, 25));
      }
    }
    expect(starts).toBe(2);
    expect(await env.read(`queue/failed/${JOB}.json`)).toMatchObject({
      errorCode: "conversion_failed",
      reason: "crashed",
      attempt: 2,
    });
    expect(await env.list("queue/pending")).toEqual([]);
    expect(await env.list("queue/processing")).toEqual([]);
  });

  test("a crash before the attempt was counted does not use up a retry", async () => {
    await leaveInProcessing(undefined);
    await makeWorker(env, new FakeConverter());
    expect(await env.list("queue/pending")).toEqual([`${JOB}.json`]);
  });

  test("a job whose result was already published is only cleaned up", async () => {
    await leaveInProcessing(1);
    await mkdir(path.join(env.dir, "queue", "done"), { recursive: true });
    await writeFile(
      path.join(env.dir, "queue", "done", `${JOB}.json`),
      JSON.stringify({ jobId: JOB, ok: true }),
    );
    const conv = new FakeConverter();
    await makeWorker(env, conv);
    expect(await env.list("queue/processing")).toEqual([]);
    expect(await env.list("queue/pending")).toEqual([]);
    expect(await env.list("queue/failed")).toEqual([]);
  });

  test("stale staging and swap directories and temp files are swept at start", async () => {
    const ud = path.join(env.dir, "pages", USER);
    await mkdir(path.join(ud, `${FILE}.tmp-${JOB}`), { recursive: true });
    await mkdir(path.join(ud, `${FILE}.old-${JOB}`), { recursive: true });
    await mkdir(path.join(ud, FILE), { recursive: true });
    await mkdir(path.join(env.dir, "queue", "done"), { recursive: true });
    await writeFile(path.join(env.dir, "queue", "done", `.tmp-1-abcd-${JOB}.json`), "{");
    await makeWorker(env, new FakeConverter());
    expect(await env.list(`pages/${USER}`)).toEqual([FILE]);
    expect(await env.list("queue/done")).toEqual([]);
  });

  test("an unreadable job in processing is failed, not retried forever", async () => {
    const proc = path.join(env.dir, "queue", "processing");
    await mkdir(proc, { recursive: true });
    await writeFile(path.join(proc, `${JOB}.json`), "garbage");
    await makeWorker(env, new FakeConverter());
    expect(await env.read(`queue/failed/${JOB}.json`)).toMatchObject({ reason: "invalid_job" });
  });

  test("starting without the originals volume mounted is refused", async () => {
    await rm(path.join(env.dir, "originals"), { recursive: true });
    const w = new Worker(env.cfg, new FakeConverter(), silentLogger);
    await expect(w.init()).rejects.toThrow(/originals directory not found/);
  });
});

describe("shutdown and heartbeat", () => {
  test("stop() while converting abandons the job back to pending without using an attempt", async () => {
    const sha = await env.original("x");
    await env.drop({ jobId: JOB, sha256: sha });
    let started!: () => void;
    const hasStarted = new Promise<void>((r) => (started = r));
    const conv = new FakeConverter(
      (req, signal) =>
        new Promise((_res, rej) => {
          void writeFile(path.join(req.outDir, "partial.webp"), "x");
          started();
          signal.addEventListener("abort", () =>
            rej(Object.assign(new Error("aborted"), { name: "AbortError" })),
          );
        }),
    );
    const w = await makeWorker(env, conv);
    const running = w.run();
    await hasStarted;
    w.stop();
    await running;
    expect(await env.list("queue/pending")).toEqual([`${JOB}.json`]);
    expect(await env.list("queue/processing")).toEqual([]);
    expect(await env.list("queue/done")).toEqual([]);
    expect(await env.list("queue/failed")).toEqual([]);
    expect(await env.list(`pages/${USER}`)).toEqual([]);
    expect(await env.read(`queue/pending/${JOB}.json`)).toMatchObject({ attempts: 0 });
    const hb = (await env.read("queue/heartbeat")) as Record<string, unknown>;
    expect(hb.state).toBe("stopping");
  });

  test("run() picks up work dropped while idle, and the heartbeat reports it", async () => {
    const sha = await env.original("x");
    const w = await makeWorker(env, new FakeConverter());
    const running = w.run();
    await new Promise((r) => setTimeout(r, 30));
    await env.drop({ jobId: JOB, sha256: sha });
    await until(async () => (await env.list("queue/done")).includes(`${JOB}.json`));
    expect(await env.list("queue/done")).toEqual([`${JOB}.json`]);
    await until(
      async () => ((await env.read("queue/heartbeat")) as { processed: number }).processed === 1,
    );
    const hb = (await env.read("queue/heartbeat")) as Record<string, unknown>;
    expect(hb).toMatchObject({
      state: "idle",
      processed: 1,
      failed: 0,
      lastJobId: JOB,
      pid: process.pid,
    });
    w.stop();
    await running;
  });

  test("the heartbeat shows the current job while one runs", async () => {
    const sha = await env.original("x");
    await env.drop({ jobId: JOB, sha256: sha });
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const w = await makeWorker(
      env,
      new FakeConverter(async () => {
        await gate;
        return okResult(1);
      }),
    );
    const step = w.processNext();
    await until(
      async () => ((await env.read("queue/heartbeat")) as { state: string }).state === "processing",
    );
    expect(await env.read("queue/heartbeat")).toMatchObject({
      state: "processing",
      currentJobId: JOB,
    });
    release();
    await step;
    await utimes(path.join(env.dir, "queue", "heartbeat"), new Date(), new Date());
    expect(await env.read("queue/heartbeat")).toMatchObject({ state: "idle", currentJobId: null });
  });
});
