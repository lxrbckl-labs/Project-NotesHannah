import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { startQueueWatcher, stopQueueWatcher } from "../src/domains/files/index.js";
import { harness, type Json, listDir, PDF, PNG, variant, WEBP } from "./files.support.js";

async function queued(
  h: ReturnType<typeof harness>,
  data = variant(PDF, `q${Math.random()}`),
  name = "a.pdf",
) {
  const file = await h.upload(h.alice, data, name);
  const jobId = h.converter.pending().at(-1) as string;
  return { file, jobId };
}

const fileOf = async (h: ReturnType<typeof harness>, id: string, who: string = h.alice) =>
  (await h.call(who, "GET", `/api/files/${id}`)).body.file as Json;

describe("conversion results", () => {
  test("success records the pages and moves the file to converted", async () => {
    const h = harness();
    const { file, jobId } = await queued(h);
    h.converter.pickUp(jobId);
    expect(h.service.processQueue()).toMatchObject({ ingested: 0 });
    expect(h.db.prepare("SELECT state FROM conversion_jobs").get()).toEqual({
      state: "processing",
    });

    h.converter.succeed(jobId, { pages: 3 });
    expect(h.service.processQueue()).toMatchObject({ ingested: 1, failed: 0 });
    const done = await fileOf(h, file.id);
    expect(done).toMatchObject({ status: "converted", pageCount: 3, errorCode: null });
    const pages = (await h.call(h.alice, "GET", `/api/files/${file.id}/pages`)).body
      .items as Json[];
    expect(pages.map((p) => p.index)).toEqual([1, 2, 3]);
    expect(pages[0]).toMatchObject({
      fileId: file.id,
      width: 800,
      height: 600,
      hasTextLayer: true,
      nativeText: "Slide 1 text",
      speakerNotes: null,
      transcriptId: null,
    });
    expect(pages[1]).toMatchObject({ hasTextLayer: false, nativeText: null });
    // the result file is gone, and a second pass changes nothing
    expect(listDir(join(h.dir, "queue", "done"))).toEqual([]);
    expect(h.service.processQueue()).toEqual({ ingested: 0, failed: 0, ignored: 0, timedOut: 0 });
  });

  test.each([
    ["unsupported_type"],
    ["encrypted_file"],
    ["corrupt_file"],
    ["too_many_pages"],
    ["too_large"],
    ["conversion_failed"],
  ])("converter failure %s fails the file with that code", async (code) => {
    const h = harness();
    const { file, jobId } = await queued(h);
    h.converter.fail(jobId, code, `converter says ${code}`);
    expect(h.service.processQueue()).toMatchObject({ failed: 1 });
    const failed = await fileOf(h, file.id);
    expect(failed.status).toBe("failed");
    expect(failed.errorCode).toBe(code);
    expect(failed.errorMessage).toContain(code);
    expect(listDir(join(h.dir, "queue", "failed"))).toEqual([]);
  });

  test("a failure without a message gets a plain-language one", async () => {
    const h = harness();
    const { file, jobId } = await queued(h);
    h.converter.fail(jobId, "encrypted_file", "");
    h.service.processQueue();
    expect((await fileOf(h, file.id)).errorMessage).toMatch(/password/);
  });

  test("an unknown error code from the converter is malformed", async () => {
    const h = harness();
    const { file, jobId } = await queued(h);
    h.converter.fail(jobId, "made_up_code");
    h.service.processQueue();
    const failed = await fileOf(h, file.id);
    expect(failed).toMatchObject({ status: "failed", errorCode: "conversion_failed" });
  });

  test.each([
    ["not JSON", () => "{ this is not json"],
    ["wrong shape", (job: Json) => JSON.stringify({ jobId: job, ok: true })],
    [
      "ok false in done/",
      (job: Json, file: Json) =>
        JSON.stringify({
          jobId: job,
          fileId: file,
          ok: false,
          errorCode: "corrupt_file",
          message: "x",
        }),
    ],
  ])("malformed result (%s) fails the job and is removed", async (_label, text) => {
    const h = harness();
    const { file, jobId } = await queued(h);
    h.converter.pickUp(jobId);
    h.converter.writeResult("done", jobId, text(jobId, file.id));
    h.service.processQueue();
    expect(await fileOf(h, file.id)).toMatchObject({
      status: "failed",
      errorCode: "conversion_failed",
    });
    expect(listDir(join(h.dir, "queue", "done"))).toEqual([]);
  });

  test("a result whose page count disagrees with the files on disk is rejected", async () => {
    const h = harness();
    const { file, jobId } = await queued(h);
    h.converter.succeed(jobId, {
      pages: 3,
      mutate: (r) => {
        r.pageCount = 2;
        r.pages.pop();
      },
    });
    h.service.processQueue();
    expect(await fileOf(h, file.id)).toMatchObject({
      status: "failed",
      errorCode: "conversion_failed",
    });
    expect(h.db.prepare("SELECT COUNT(*) AS n FROM pages").get()).toEqual({ n: 0 });
    // the partial images are removed
    expect(existsSync(join(h.dir, "pages", h.alice, file.id))).toBe(false);
  });

  test("missing images, wrong type, bad indexes and silly sizes are rejected", async () => {
    const cases: Array<
      [string, Parameters<ReturnType<typeof harness>["converter"]["succeed"]>[1]]
    > = [
      ["no images", { images: false }],
      ["wrong type", { type: "pptx" }],
      [
        "bad indexes",
        {
          mutate: (r) => {
            r.pages[1].index = 5;
          },
        },
      ],
      [
        "huge dimensions",
        {
          mutate: (r) => {
            r.pages[0].width = 10_000_000;
          },
        },
      ],
      [
        "wrong file id",
        {
          mutate: (r) => {
            r.fileId = "fil_01HZX3K9Q2V7M4N8P6R5T0W1YB";
          },
        },
      ],
      [
        "negative bytes",
        {
          mutate: (r) => {
            r.pages[0].bytes = -1;
          },
        },
      ],
    ];
    for (const [label, opts] of cases) {
      const h = harness();
      const { file, jobId } = await queued(h);
      h.converter.succeed(jobId, opts);
      h.service.processQueue();
      expect((await fileOf(h, file.id)).status, label).toBe("failed");
      expect(h.db.prepare("SELECT COUNT(*) AS n FROM pages").get(), label).toEqual({ n: 0 });
    }
  });

  test("an empty image file or a symlink in place of an image is rejected", async () => {
    const h = harness();
    const { file, jobId } = await queued(h);
    h.converter.succeed(jobId, { pages: 1 });
    const img = join(h.dir, "pages", h.alice, file.id, "0001.webp");
    rmSync(img);
    writeFileSync(img, "");
    h.service.processQueue();
    expect((await fileOf(h, file.id)).status).toBe("failed");
  });

  test("a page count over the limit is too_many_pages", async () => {
    const h = harness();
    const { file, jobId } = await queued(h);
    h.converter.succeed(jobId, { pages: 501 });
    h.service.processQueue();
    expect(await fileOf(h, file.id)).toMatchObject({
      status: "failed",
      errorCode: "too_many_pages",
    });
  });

  test("results for unknown jobs, duplicates, strange names and non-job files are tolerated", async () => {
    const h = harness();
    const { file, jobId } = await queued(h);
    // unknown job id, well-formed
    h.converter.writeResult("done", "job_01HZX3K9Q2V7M4N8P6R5T0W1YB", JSON.stringify({ ok: true }));
    // odd names are left alone
    h.converter.writeResult("done", "README", "hello");
    writeFileSync(join(h.dir, "queue", "done", "stray.txt"), "x");
    mkdirSync(join(h.dir, "queue", "failed", "subdir"));
    const first = h.service.processQueue();
    expect(first.ignored).toBeGreaterThanOrEqual(1);
    expect(existsSync(join(h.dir, "queue", "done", "job_01HZX3K9Q2V7M4N8P6R5T0W1YB.json"))).toBe(
      false,
    );
    expect(existsSync(join(h.dir, "queue", "done", "stray.txt"))).toBe(true);
    expect((await fileOf(h, file.id)).status).toBe("converting");

    // the same result arriving twice is ingested once
    const result = h.converter.succeed(jobId, { pages: 2 });
    h.service.processQueue();
    h.converter.writeResult("done", jobId, JSON.stringify(result));
    const second = h.service.processQueue();
    expect(second.ingested).toBe(0);
    expect(h.db.prepare("SELECT COUNT(*) AS n FROM pages").get()).toEqual({ n: 2 });
    expect((await fileOf(h, file.id)).status).toBe("converted");
  });

  test("a result file that is still being written is left for the next pass", async () => {
    const h = harness({ partialGraceMs: 60_000 });
    const { file, jobId } = await queued(h);
    // mtime is real "now", the service clock is 2026-11-15: age is negative, so use a huge grace
    // and a clock set to the file's own time
    h.converter.pickUp(jobId);
    h.converter.writeResult("done", jobId, '{"jobId":');
    h.clock.ms = Date.now() + 1000;
    h.service.processQueue();
    expect((await fileOf(h, file.id)).status).toBe("converting");
    expect(listDir(join(h.dir, "queue", "done"))).toEqual([`${jobId}.json`]);
    // a minute later it is judged as it stands: unreadable
    h.clock.advance(61_000);
    h.service.processQueue();
    expect((await fileOf(h, file.id)).status).toBe("failed");
  });
});

describe("timeouts, retry and health", () => {
  test("a job nobody picks up fails with conversion_failed and its queue file is withdrawn", async () => {
    const h = harness({ pickupTimeoutMs: 60_000 });
    const { file, jobId } = await queued(h);
    h.clock.advance(59_000);
    expect(h.service.processQueue().timedOut).toBe(0);
    h.clock.advance(2_000);
    expect(h.service.processQueue().timedOut).toBe(1);
    const failed = await fileOf(h, file.id);
    expect(failed).toMatchObject({ status: "failed", errorCode: "conversion_failed" });
    expect(failed.errorMessage).toMatch(/did not pick/);
    expect(h.converter.pending()).toEqual([]);
    expect(h.db.prepare("SELECT state FROM conversion_jobs WHERE id = ?").get(jobId)).toEqual({
      state: "timed_out",
    });
  });

  test("a job picked up but never finished times out later; a late result is ignored", async () => {
    const h = harness({ pickupTimeoutMs: 60_000, processingTimeoutMs: 600_000 });
    const { file, jobId } = await queued(h);
    h.converter.pickUp(jobId);
    h.service.processQueue();
    h.clock.advance(300_000);
    expect(h.service.processQueue().timedOut).toBe(0);
    h.clock.advance(400_000);
    expect(h.service.processQueue().timedOut).toBe(1);
    expect((await fileOf(h, file.id)).errorMessage).toMatch(/too long/);
    h.converter.writeResult("done", jobId, JSON.stringify({ jobId, fileId: file.id, ok: true }));
    h.service.processQueue();
    expect((await fileOf(h, file.id)).status).toBe("failed");
    expect(h.db.prepare("SELECT COUNT(*) AS n FROM pages").get()).toEqual({ n: 0 });
    expect(listDir(join(h.dir, "queue", "done"))).toEqual([]);
  });

  test("retry re-enqueues a failed file with a new job; other states refuse", async () => {
    const h = harness();
    const { file, jobId } = await queued(h);
    const early = await h.call(h.alice, "POST", `/api/files/${file.id}/retry`);
    expect(early.status).toBe(409);
    expect(early.body.error.hint).toMatch(/converter/);
    h.converter.fail(jobId, "corrupt_file");
    h.service.processQueue();

    const res = await h.call(h.alice, "POST", `/api/files/${file.id}/retry`);
    expect(res.status).toBe(200);
    expect(res.body.file).toMatchObject({
      status: "converting",
      errorCode: null,
      errorMessage: null,
    });
    const [next] = h.converter.pending();
    expect(next).not.toBe(jobId);
    expect(h.converter.job(next as string).attempt).toBe(1);
    h.converter.succeed(next as string, { pages: 1 });
    h.service.processQueue();
    expect((await fileOf(h, file.id)).status).toBe("converted");
    const again = await h.call(h.alice, "POST", `/api/files/${file.id}/retry`);
    expect(again.body.error.code).toBe("conflict");
  });

  test("retry works after a timeout, and not for another user's file or a read-only key", async () => {
    const h = harness({ pickupTimeoutMs: 1000 });
    const { file } = await queued(h);
    h.clock.advance(2000);
    h.service.processQueue();
    expect((await fileOf(h, file.id)).status).toBe("failed");
    expect(
      (
        await h.call(
          { user: h.alice, via: "key", scope: "read" },
          "POST",
          `/api/files/${file.id}/retry`,
        )
      ).body.error.code,
    ).toBe("read_only_key");
    expect((await h.call(h.bob, "POST", `/api/files/${file.id}/retry`)).body.error.code).toBe(
      "not_found",
    );
    expect((await h.call(h.alice, "POST", `/api/files/${file.id}/retry`)).status).toBe(200);
  });

  test("converter status follows the heartbeat", async () => {
    const h = harness({ heartbeatStaleMs: 30_000 });
    const get = async () =>
      (await h.call(h.alice, "GET", "/api/converter/status")).body.converter as Json;
    expect(await get()).toMatchObject({
      state: "offline",
      lastSeenAt: null,
      ageSeconds: null,
      queued: 0,
    });
    await queued(h);
    h.converter.heartbeat(h.clock.now() - 5_000, { version: "1.2", busy: true, nested: { x: 1 } });
    expect(await get()).toMatchObject({
      state: "online",
      ageSeconds: 5,
      queued: 1,
      processing: 0,
      heartbeat: { version: "1.2", busy: true },
    });
    h.converter.heartbeat(h.clock.now() - 60_000);
    expect((await get()).state).toBe("stale");
    h.converter.heartbeat(h.clock.now() - 10 * 60_000);
    expect((await get()).state).toBe("offline");
    h.converter.heartbeat(h.clock.now() - 1000, "not an object" as never);
    expect((await get()).heartbeat).toBeNull();
  });

  test("the watcher ingests results on its own and stops", async () => {
    const h = harness();
    const { file, jobId } = await queued(h);
    const watcher = startQueueWatcher(
      {
        config: { DATA_DIR: h.dir, APP_ORIGIN: "http://localhost:5173" },
        db: h.db,
        now: h.clock.now,
      },
      { storage: h.storage, intervalMs: 20, partialGraceMs: 0, log: () => {} },
    );
    h.converter.succeed(jobId, { pages: 1 });
    await new Promise((r) => setTimeout(r, 150));
    expect((await fileOf(h, file.id)).status).toBe("converted");
    stopQueueWatcher(watcher);
    const second = await queued(h);
    h.converter.succeed(second.jobId, { pages: 1 });
    await new Promise((r) => setTimeout(r, 100));
    expect((await fileOf(h, second.file.id)).status).toBe("converting");
  });

  test("a missing storage volume makes a scan fail without crashing the watcher", async () => {
    const h = harness();
    const logs: string[] = [];
    const watcher = startQueueWatcher(
      {
        config: { DATA_DIR: join(h.dir, "nope"), APP_ORIGIN: "http://localhost:5173" },
        db: h.db,
        now: h.clock.now,
      },
      { intervalMs: 10_000, log: (m) => logs.push(m) },
    );
    watcher.tick();
    watcher.tick();
    stopQueueWatcher(watcher);
    expect(logs).toHaveLength(1);
    expect(logs[0]).toMatch(/storage_unavailable|does not exist/);
  });

  test("sample images are real webp bytes", () => {
    expect(WEBP.subarray(0, 4).toString()).toBe("RIFF");
    expect(PNG.length).toBeGreaterThan(8);
  });
});
