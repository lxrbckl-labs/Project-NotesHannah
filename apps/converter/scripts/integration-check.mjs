// Helper for integration.sh. Subcommands:
//   prepare <dataDir> <workDir> <phase|limits:<label>>   put originals in place and drop one job per case
//   verify  <dataDir> <workDir>                          check every result against fixtures/expectations.json
//   limits-labels                                        print "<label>\tKEY=VALUE ..." per limits case
//   status  <dataDir> <workDir>                          print how many dropped jobs have a result
import { createHash } from "node:crypto";
import { createReadStream, readdirSync } from "node:fs";
import {
  copyFile,
  mkdir,
  readdir,
  readFile,
  rename,
  stat,
  truncate,
  writeFile,
} from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { newId } from "@notes/schema";
import sharp from "sharp";

const here = path.dirname(fileURLToPath(import.meta.url));
const fixtures = path.resolve(here, "../../../fixtures");
const generated = path.join(fixtures, "generated");
const expectations = JSON.parse(await readFile(path.join(fixtures, "expectations.json"), "utf8"));
const MiB = 1024 * 1024;

async function sha256(file) {
  const h = createHash("sha256");
  for await (const c of createReadStream(file)) h.update(c);
  return h.digest("hex");
}
const exists = (p) =>
  stat(p).then(
    () => true,
    () => false,
  );
const readJson = async (p) => JSON.parse(await readFile(p, "utf8"));

/** Cases made at run time because they are too big or too silly to commit. */
function runtimeCases() {
  return [
    {
      file: "@oversize.bin",
      phase: "default",
      expect: { ok: false, errorCode: "too_large", reason: "file_too_large" },
      make: async (p) => {
        await writeFile(p, "");
        await truncate(p, 201 * MiB);
      },
    },
    {
      file: "@empty.bin",
      phase: "default",
      expect: { ok: false, errorCode: "corrupt_file" },
      make: (p) => writeFile(p, ""),
    },
    {
      file: "@legacy.ppt",
      phase: "default",
      expect: { ok: false, errorCode: "unsupported_type", reason: "legacy_office" },
      make: (p) =>
        writeFile(
          p,
          Buffer.concat([
            Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]),
            Buffer.alloc(2000),
          ]),
        ),
    },
    {
      file: "@garbage.bin",
      phase: "default",
      expect: { ok: false, errorCode: "unsupported_type" },
      make: (p) =>
        writeFile(p, Buffer.from(Array.from({ length: 4096 }, (_, i) => (i * 37 + 11) & 0xff))),
    },
  ];
}

async function dropJob(dataDir, job) {
  const pending = path.join(dataDir, "queue", "pending");
  const tmp = path.join(pending, `.${job.jobId}.tmp`);
  await writeFile(tmp, JSON.stringify(job));
  await rename(tmp, path.join(pending, `${job.jobId}.json`));
}

async function prepare(dataDir, workDir, which) {
  const limits = which.startsWith("limits:");
  const label = limits ? which.slice(7) : null;
  let cases = expectations.cases.filter((c) =>
    limits ? c.phase === "limits" && c.label === label : c.phase === "default",
  );
  if (!limits) cases = [...cases, ...runtimeCases()];
  const userId = newId("user");
  const manifestPath = path.join(workDir, "jobs.json");
  const jobs = (await exists(manifestPath)) ? await readJson(manifestPath) : [];
  await mkdir(path.join(dataDir, "originals", userId), { recursive: true });
  for (const c of cases) {
    const src = path.join(workDir, "src", c.file.replace("@", "rt-"));
    let file = path.join(generated, c.file);
    if (c.make) {
      await mkdir(path.dirname(src), { recursive: true });
      await c.make(src);
      file = src;
    }
    const sha = await sha256(file);
    const dest = path.join(dataDir, "originals", userId, sha);
    if (!(await exists(dest))) await copyFile(file, dest);
    const job = {
      jobId: newId("job"),
      userId,
      fileId: newId("file"),
      sha256: sha,
      createdAt: new Date().toISOString(),
    };
    jobs.push({ case: c, ...job });
    await dropJob(dataDir, job);
  }
  if (!limits) {
    // Hostile or broken job files: refused without touching anything outside the expected paths.
    const bad = [
      { name: "path-escape-userId", reason: "invalid_job", patch: { userId: "../../../tmp" } },
      { name: "path-escape-fileId", reason: "invalid_job", patch: { fileId: "fil_../../../../x" } },
      {
        name: "path-escape-sha256",
        reason: "invalid_job",
        patch: { sha256: "../../../../etc/passwd" },
      },
      { name: "missing-original", reason: "original_missing", patch: { sha256: "e".repeat(64) } },
    ];
    for (const b of bad) {
      const job = {
        jobId: newId("job"),
        userId,
        fileId: newId("file"),
        sha256: "f".repeat(64),
        createdAt: new Date().toISOString(),
        ...b.patch,
      };
      jobs.push({
        case: {
          file: `@${b.name}`,
          phase: "default",
          expect: { ok: false, errorCode: "conversion_failed", reason: b.reason },
        },
        ...job,
        jobIdOnly: true,
      });
      await dropJob(dataDir, job);
    }
    // A second job for the same file id: its pages replace the first run's.
    const first = jobs.find((j) => j.case.file === "text-layer.pdf");
    const replay = {
      jobId: newId("job"),
      userId,
      fileId: first.fileId,
      sha256: first.sha256,
      createdAt: new Date().toISOString(),
    };
    jobs.push({
      case: {
        file: "text-layer.pdf",
        label: "replay-same-file-id",
        phase: "default",
        expect: { ok: true, type: "pdf", pageCount: 5, allHaveText: true },
      },
      ...replay,
    });
    await dropJob(dataDir, replay);
  }
  await writeFile(manifestPath, JSON.stringify(jobs, null, 1));
  if (cases.length === 0) throw new Error(`no cases for ${which}`);
  console.log(`prepared ${cases.length} jobs (${which})`);
}

async function status(dataDir, workDir) {
  const jobs = await readJson(path.join(workDir, "jobs.json"));
  let finished = 0;
  for (const j of jobs) {
    if (
      (await exists(path.join(dataDir, "queue", "done", `${j.jobId}.json`))) ||
      (await exists(path.join(dataDir, "queue", "failed", `${j.jobId}.json`)))
    )
      finished += 1;
  }
  console.log(`${finished} ${jobs.length}`);
}

function ink(buf, w, h, y0, y1) {
  let n = 0;
  for (let y = Math.floor(h * y0); y < Math.floor(h * y1); y++)
    for (let x = Math.floor(w * 0.15); x < Math.floor(w * 0.85); x++)
      if ((buf[y * w + x] ?? 255) < 110) n++;
  return n;
}

async function verify(dataDir, workDir) {
  const jobs = await readJson(path.join(workDir, "jobs.json"));
  const rows = [];
  let failures = 0;
  const oracles = {};
  for (const j of jobs) {
    const problems = [];
    const c = j.case;
    const e = c.expect;
    const name = c.label ?? c.file.replace(/^@/, "");
    const donePath = path.join(dataDir, "queue", "done", `${j.jobId}.json`);
    const failPath = path.join(dataDir, "queue", "failed", `${j.jobId}.json`);
    const isDone = await exists(donePath);
    const isFail = await exists(failPath);
    let r = null;
    if (isDone && isFail) problems.push("both done and failed exist");
    if (isDone) r = await readJson(donePath);
    else if (isFail) r = await readJson(failPath);
    else problems.push("no result");
    const pageDir = path.join(dataDir, "pages", j.userId, j.fileId);
    let detail = "";
    let peak = "";
    let ms = "";
    if (r) {
      if (r.jobId !== j.jobId) problems.push("jobId mismatch");
      if (r.ok !== e.ok)
        problems.push(
          `ok=${r.ok}, wanted ${e.ok}${r.ok ? "" : ` (${r.errorCode}/${r.reason}: ${r.message})`}`,
        );
      else if (!e.ok) {
        detail = `${r.errorCode}${r.reason ? `/${r.reason}` : ""}`;
        if (r.errorCode !== e.errorCode)
          problems.push(`errorCode ${r.errorCode}, wanted ${e.errorCode} (${r.message})`);
        if (e.reason && r.reason !== e.reason)
          problems.push(`reason ${r.reason}, wanted ${e.reason}`);
        if (!j.jobIdOnly && r.fileId !== j.fileId) problems.push("fileId mismatch");
        if (await exists(pageDir)) problems.push("pages directory exists for a failed job");
        if (typeof r.message !== "string" || r.message.length === 0) problems.push("no message");
      } else {
        ms = String(r.timings.elapsed);
        peak = r.peakRssBytes ? String(Math.round(r.peakRssBytes / MiB)) : "";
        detail = `${r.type}:${r.pageCount}`;
        await verifyOk(r, e, j, pageDir, problems, oracles);
      }
    }
    if (problems.length) failures += 1;
    rows.push({ name, detail, ms, peak, ok: problems.length === 0, problems });
  }
  // Global state of the queue.
  for (const d of ["pending", "processing"]) {
    const left = readdirSync(path.join(dataDir, "queue", d)).filter((n) => !n.startsWith("."));
    if (left.length) {
      failures += 1;
      rows.push({
        name: `queue/${d}`,
        detail: `${left.length} left`,
        ms: "",
        peak: "",
        ok: false,
        problems: [left.join(",")],
      });
    }
  }
  for (const d of ["done", "failed"]) {
    const tmp = readdirSync(path.join(dataDir, "queue", d)).filter((n) => n.startsWith(".tmp-"));
    if (tmp.length) {
      failures += 1;
      rows.push({
        name: `queue/${d}`,
        detail: "temp files left",
        ms: "",
        peak: "",
        ok: false,
        problems: tmp,
      });
    }
  }
  for (const u of readdirSync(path.join(dataDir, "pages"))) {
    const stray = readdirSync(path.join(dataDir, "pages", u)).filter((n) => /\.(tmp|old)-/.test(n));
    if (stray.length) {
      failures += 1;
      rows.push({
        name: "pages",
        detail: "staging left",
        ms: "",
        peak: "",
        ok: false,
        problems: stray,
      });
    }
  }
  const pad = (s, n) => String(s).padEnd(n);
  console.log(`${pad("CASE", 28)}${pad("RESULT", 36)}${pad("MS", 8)}${pad("PEAK_MB", 9)}VERDICT`);
  for (const r of rows) {
    console.log(
      `${pad(r.name, 28)}${pad(r.detail, 36)}${pad(r.ms, 8)}${pad(r.peak, 9)}${r.ok ? "PASS" : "FAIL"}`,
    );
    for (const p of r.problems) console.log(`    - ${p}`);
  }
  await writeFile(path.join(workDir, `report-${Date.now()}.json`), JSON.stringify(rows, null, 1));
  console.log(`${rows.length - failures} of ${rows.length} checks passed`);
  process.exit(failures ? 1 : 0);
}

async function verifyOk(r, e, j, pageDir, problems, oracles) {
  if (r.type !== e.type) problems.push(`type ${r.type}, wanted ${e.type}`);
  if (r.pageCount !== e.pageCount || r.pages.length !== e.pageCount)
    problems.push(`pageCount ${r.pageCount}/${r.pages.length}, wanted ${e.pageCount}`);
  if (r.fileId !== j.fileId) problems.push("fileId mismatch");
  if (!r.toolVersions?.libreoffice) problems.push("toolVersions missing");
  const pad4 = (n) => String(n).padStart(4, "0");
  const files = (await readdir(pageDir).catch(() => [])).sort();
  const expectedTop = [
    ...Array.from({ length: e.pageCount }, (_, i) => `${pad4(i + 1)}.webp`),
    "thumbs",
  ].sort();
  if (JSON.stringify(files) !== JSON.stringify(expectedTop))
    problems.push(`page directory holds ${files.length} entries, wanted ${expectedTop.length}`);
  const thumbs = (await readdir(path.join(pageDir, "thumbs")).catch(() => [])).sort();
  if (thumbs.length !== e.pageCount) problems.push(`${thumbs.length} thumbnails`);
  const textOf = (p) => p.nativeText ?? "";
  for (const p of r.pages) {
    const img = path.join(pageDir, `${pad4(p.index)}.webp`);
    const th = path.join(pageDir, "thumbs", `${pad4(p.index)}.webp`);
    try {
      const m = await sharp(img).metadata();
      if (m.format !== "webp") problems.push(`page ${p.index} is ${m.format}`);
      if (m.width !== p.width || m.height !== p.height)
        problems.push(
          `page ${p.index} size ${m.width}x${m.height} != result ${p.width}x${p.height}`,
        );
      if (Math.max(m.width, m.height) > 1568) problems.push(`page ${p.index} long edge over 1568`);
      if (m.exif || m.icc || m.xmp) problems.push(`page ${p.index} still carries metadata`);
      if ((await stat(img)).size !== p.bytes) problems.push(`page ${p.index} bytes mismatch`);
      const tm = await sharp(th).metadata();
      if (Math.max(tm.width, tm.height) > 320) problems.push(`thumb ${p.index} long edge over 320`);
    } catch (err) {
      problems.push(`page ${p.index} unreadable: ${err.message}`);
    }
  }
  if (e.allHaveText && !r.pages.every((p) => p.hasTextLayer && textOf(p).length > 0))
    problems.push("not every page has text");
  if (e.noText && !r.pages.every((p) => !p.hasTextLayer && p.nativeText === null))
    problems.push("some page claims a text layer");
  for (const [pg, list] of Object.entries(e.textIncludes ?? {})) {
    const t = textOf(r.pages[Number(pg) - 1] ?? {});
    for (const s of list)
      if (!t.includes(s)) problems.push(`page ${pg} text lacks ${JSON.stringify(s)}`);
  }
  for (const [pg, want] of Object.entries(e.notes ?? {})) {
    const got = r.pages[Number(pg) - 1]?.speakerNotes ?? null;
    if (got !== want)
      problems.push(`page ${pg} notes ${JSON.stringify(got)} != ${JSON.stringify(want)}`);
  }
  for (const w of e.warningCodes ?? []) {
    const [code, pg] = w.split("@");
    const hit = r.warnings.some((x) => x.code === code && (pg === "-" || x.page === Number(pg)));
    if (!hit)
      problems.push(
        `warning ${w} missing (have ${r.warnings.map((x) => `${x.code}@${x.page ?? "-"}`).join(", ") || "none"})`,
      );
  }
  if (e.portrait && !r.pages.every((p) => p.height > p.width)) problems.push("not portrait");
  if (e.upright) {
    const p = r.pages[0];
    const { data, info } = await sharp(path.join(pageDir, "0001.webp"))
      .greyscale()
      .raw()
      .toBuffer({ resolveWithObject: true });
    const top = ink(data, info.width, info.height, 0.08, 0.3);
    const bottom = ink(data, info.width, info.height, 0.7, 0.92);
    if (!(top > 5 * Math.max(bottom, 1)))
      problems.push(`not upright: ink top ${top} vs bottom ${bottom} (${p.width}x${p.height})`);
  }
  if (e.oracle) {
    oracles[e.oracle] ??= await readJson(path.join(generated, e.oracle));
    const slides = oracles[e.oracle];
    slides.forEach((s, i) => {
      const p = r.pages[i];
      if (!p) return;
      const t = textOf(p);
      if (!t.includes(s.title))
        problems.push(`slide ${i + 1} title ${JSON.stringify(s.title)} not in text`);
      let pos = -1;
      for (const b of s.bullets ?? s.lines ?? []) {
        const bt = typeof b === "string" ? b : b[0];
        const k = t.indexOf(bt);
        if (k < 0) problems.push(`slide ${i + 1} bullet ${JSON.stringify(bt)} missing`);
        else if (k <= pos)
          problems.push(`slide ${i + 1} bullet ${JSON.stringify(bt)} out of order`);
        else pos = k;
      }
      for (const row of s.table ?? [])
        for (const cell of row)
          if (!t.includes(cell))
            problems.push(`slide ${i + 1} table cell ${JSON.stringify(cell)} missing`);
      if (e.oracle.startsWith("lecture") && (p.speakerNotes ?? null) !== (s.notes ?? null))
        problems.push(`slide ${i + 1} notes differ`);
      if (e.oracle.startsWith("lecture")) {
        const hidden = r.warnings.some((x) => x.code === "HIDDEN_SLIDE" && x.page === i + 1);
        if (hidden !== Boolean(s.hidden))
          problems.push(`slide ${i + 1} hidden=${hidden}, wanted ${Boolean(s.hidden)}`);
      }
    });
  }
}

const [cmd, ...args] = process.argv.slice(2);
if (cmd === "prepare") await prepare(args[0], args[1], args[2]);
else if (cmd === "verify") await verify(args[0], args[1]);
else if (cmd === "status") await status(args[0], args[1]);
else if (cmd === "limits-labels") {
  for (const c of expectations.cases.filter((x) => x.phase === "limits"))
    console.log(
      `${c.label}\t${Object.entries(c.env)
        .map(([k, v]) => `${k}=${v}`)
        .join(" ")}`,
    );
} else {
  console.error("usage: integration-check.mjs prepare|verify|status|limits-labels ...");
  process.exit(64);
}
