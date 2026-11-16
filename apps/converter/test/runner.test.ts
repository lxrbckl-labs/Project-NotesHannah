import { mkdir, mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { loadWorkerConfig } from "../src/config.js";
import { silentLogger } from "../src/log.js";
import { ProcessConverter, type RunnerOptions } from "../src/runner.js";

let root: string;
beforeEach(async () => {
  root = await mkdtemp(path.join(os.tmpdir(), "runner-test-"));
});
afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

/** Run a tiny node script as the "child" in place of convert/child.js. Its args: input outDir scratch. */
function runnerWith(
  script: string,
  extra: Partial<RunnerOptions> = {},
  env: Record<string, string> = {},
) {
  const cfg = { ...loadWorkerConfig({ DATA_DIR: root, ...env }), killGraceMs: 50 };
  const scratchRoot = path.join(root, "scratch");
  const conv = new ProcessConverter({
    cfg,
    logger: silentLogger,
    scratchRoot,
    sampleMs: 20,
    toolVersions: async () => ({ node: "test" }),
    childSpec: (req, scratch) => ({
      cmd: process.execPath,
      args: ["-e", script, req.inputPath, req.outDir, scratch],
    }),
    ...extra,
  });
  return { conv, scratchRoot };
}
const req = () => ({
  jobId: "job_X",
  inputPath: path.join(root, "in.bin"),
  outDir: path.join(root, "out"),
});
// -e puts user args after the script, so argv[1..] = input outDir scratch
const writeResult = (o: unknown) =>
  `require('fs').writeFileSync(require('path').join(process.argv[3], 'result.json'), ${JSON.stringify(JSON.stringify(o))});`;

describe("ProcessConverter", () => {
  test("returns the child's result with tool versions and cleans the scratch directory", async () => {
    const result = {
      type: "pdf",
      pages: [
        {
          index: 1,
          width: 1,
          height: 1,
          bytes: 1,
          hasTextLayer: false,
          nativeText: null,
          speakerNotes: null,
        },
      ],
      warnings: [],
      timings: { total: 3 },
    };
    const { conv, scratchRoot } = runnerWith(writeResult({ ok: true, result }));
    await mkdir(scratchRoot, { recursive: true });
    const r = await conv.convert(req(), new AbortController().signal);
    expect(r).toMatchObject({ type: "pdf", toolVersions: { node: "test" }, timings: { total: 3 } });
    expect(await readdir(scratchRoot)).toEqual([]);
  });

  test("a failure outcome becomes a ConvertError with code and reason", async () => {
    const { conv } = runnerWith(
      writeResult({ ok: false, code: "too_large", message: "pixels", reason: "pixel_bomb" }),
    );
    await mkdir(path.join(root, "scratch"), { recursive: true });
    await expect(conv.convert(req(), new AbortController().signal)).rejects.toMatchObject({
      code: "too_large",
      reason: "pixel_bomb",
    });
  });

  test("a child that dies without a result is conversion_failed (crashed) and the scratch dir is still removed", async () => {
    const { conv, scratchRoot } = runnerWith("process.exit(3)");
    await mkdir(scratchRoot, { recursive: true });
    await expect(conv.convert(req(), new AbortController().signal)).rejects.toMatchObject({
      code: "conversion_failed",
      reason: "crashed",
    });
    expect(await readdir(scratchRoot)).toEqual([]);
  });

  test("a child killed by a signal is reported as a resource limit", async () => {
    const { conv, scratchRoot } = runnerWith("process.kill(process.pid, 'SIGKILL')");
    await mkdir(scratchRoot, { recursive: true });
    await expect(conv.convert(req(), new AbortController().signal)).rejects.toMatchObject({
      code: "conversion_failed",
      reason: "resource_limit",
    });
  });

  test("the wall clock kills a hung child", async () => {
    const { conv, scratchRoot } = runnerWith(
      "setInterval(()=>{}, 1000)",
      {},
      { WALL_CLOCK_MS: "150" },
    );
    await mkdir(scratchRoot, { recursive: true });
    const t0 = Date.now();
    await expect(conv.convert(req(), new AbortController().signal)).rejects.toMatchObject({
      code: "conversion_failed",
      reason: "timeout",
    });
    expect(Date.now() - t0).toBeLessThan(3000);
  });

  test("the memory watchdog kills a child over the limit and reports memory_limit", async () => {
    const { conv, scratchRoot } = runnerWith("setInterval(()=>{}, 1000)", {
      sampleRss: async () => 10 * 1024 * 1024 * 1024,
    });
    await mkdir(scratchRoot, { recursive: true });
    await expect(conv.convert(req(), new AbortController().signal)).rejects.toMatchObject({
      code: "conversion_failed",
      reason: "memory_limit",
    });
  });

  test("peak memory is the largest sample taken", async () => {
    let n = 0;
    const samples = [10, 50, 30];
    const { conv, scratchRoot } = runnerWith(
      `${writeResult({ ok: true, result: { type: "png", pages: [], warnings: [], timings: {} } })} setTimeout(()=>{}, 250)`,
      {
        sampleRss: async () => samples[Math.min(n++, samples.length - 1)] ?? null,
      },
    );
    await mkdir(scratchRoot, { recursive: true });
    const r = await conv.convert(req(), new AbortController().signal);
    expect(r.peakRssBytes).toBe(50);
  });

  test("aborting kills the child and rejects with an AbortError", async () => {
    const { conv, scratchRoot } = runnerWith("setInterval(()=>{}, 1000)");
    await mkdir(scratchRoot, { recursive: true });
    const ac = new AbortController();
    const p = conv.convert(req(), ac.signal);
    setTimeout(() => ac.abort(), 100);
    await expect(p).rejects.toMatchObject({ name: "AbortError" });
    expect(await readdir(scratchRoot)).toEqual([]);
  });

  test("the child's environment holds only PATH, locale, scratch paths and the limits", async () => {
    const dump = path.join(root, "env.json");
    const { conv, scratchRoot } = runnerWith(
      `require('fs').writeFileSync(${JSON.stringify(dump)}, JSON.stringify(Object.keys(process.env).sort())); ${writeResult({ ok: false, code: "corrupt_file", message: "x" })}`,
    );
    await mkdir(scratchRoot, { recursive: true });
    process.env.SOME_SECRET_FOR_TEST = "hunter2";
    await conv.convert(req(), new AbortController().signal).catch(() => undefined);
    delete process.env.SOME_SECRET_FOR_TEST;
    const keys = JSON.parse(await readFile(dump, "utf8")) as string[];
    expect(keys).not.toContain("SOME_SECRET_FOR_TEST");
    expect(keys).toEqual(
      expect.arrayContaining(["PATH", "HOME", "TMPDIR", "MAX_PAGES", "WALL_CLOCK_MS"]),
    );
  });
});
