import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import {
  copyFile,
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  rename,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import sharp from "sharp";
import { type Limits, limits } from "./config.js";
import { detectType, oleIsEncryptedPackage } from "./detect.js";
import { ConvertError } from "./errors.js";
import { Deadline, run } from "./exec.js";
import { heicToPng, openPhoto, pngBufferToSharp, writePage } from "./image.js";
import { pptxToPdf } from "./libreoffice.js";
import type { Manifest, NativeText, PageRecord, Warning } from "./manifest.js";
import { hasTextLayer, pdfInfo, pdfText, renderPage } from "./pdf.js";
import { extractPptxText } from "./pptx.js";
import { scanZip } from "./zipscan.js";

const CONVERTER_VERSION = "0.0.1-spike";

class Timer {
  readonly stages: Record<string, number> = {};
  private readonly t0 = performance.now();
  async stage<T>(name: string, fn: () => Promise<T>): Promise<T> {
    const s = performance.now();
    try {
      return await fn();
    } finally {
      this.stages[name] = Math.round(performance.now() - s);
    }
  }
  total(): number {
    return Math.round(performance.now() - this.t0);
  }
}

async function sha256(file: string): Promise<string> {
  const h = createHash("sha256");
  for await (const chunk of createReadStream(file)) h.update(chunk as Buffer);
  return h.digest("hex");
}

async function peakMemory(): Promise<number | null> {
  for (const f of [
    "/sys/fs/cgroup/memory.peak",
    "/sys/fs/cgroup/memory/memory.max_usage_in_bytes",
  ]) {
    try {
      return Number((await readFile(f, "utf8")).trim());
    } catch {
      /* try next */
    }
  }
  return null;
}

async function dpkgVersion(pkg: string): Promise<string> {
  try {
    const r = await run(new Deadline(5000), "dpkg-query", ["-W", "-f=${Version}", pkg]);
    return r.stdout.toString("utf8").trim() || "unknown";
  } catch {
    return "unknown";
  }
}

async function toolVersions(): Promise<Record<string, string>> {
  const [lo, poppler, heif, de265] = await Promise.all([
    dpkgVersion("libreoffice-core"),
    dpkgVersion("poppler-utils"),
    dpkgVersion("libheif1"),
    dpkgVersion("libde265-0"),
  ]);
  return {
    converter: CONVERTER_VERSION,
    node: process.version,
    sharp: sharp.versions.sharp ?? "unknown",
    libvips: sharp.versions.vips ?? "unknown",
    libreoffice: lo,
    poppler: poppler,
    libheif: heif,
    libde265: de265,
  };
}

const MIME: Record<string, string> = {
  pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  pdf: "application/pdf",
  jpeg: "image/jpeg",
  png: "image/png",
  heic: "image/heic",
};

interface Ctx {
  input: string;
  staging: string;
  scratch: string;
  lim: Limits;
  deadline: Deadline;
  timer: Timer;
  warnings: Warning[];
}

async function inPool<T>(
  count: number,
  concurrency: number,
  fn: (i: number) => Promise<T>,
): Promise<T[]> {
  const results = new Array<T>(count);
  let next = 0;
  const workers = Array.from({ length: Math.min(concurrency, count) }, async () => {
    for (;;) {
      const i = next++;
      if (i >= count) return;
      results[i] = await fn(i);
    }
  });
  await Promise.all(workers);
  return results;
}

async function convertPdfFile(
  ctx: Ctx,
  pdfPath: string,
  slideText?: Awaited<ReturnType<typeof extractPptxText>>["slides"],
): Promise<PageRecord[]> {
  const { lim, deadline, timer, warnings } = ctx;
  const info = await timer.stage("pdfinfo", () => pdfInfo(pdfPath, deadline));
  if (info.pages > lim.maxPages)
    throw new ConvertError("TOO_MANY_PAGES", `${info.pages} pages (limit ${lim.maxPages})`, {
      pages: info.pages,
    });
  if (info.encryptedButReadable)
    warnings.push({
      code: "PDF_OWNER_RESTRICTED",
      message: "PDF is encrypted with an empty user password; opened read-only",
    });

  const texts = slideText
    ? null
    : await timer.stage("pdftotext", () => pdfText(pdfPath, info.pages, deadline));
  if (texts?.restricted)
    warnings.push({
      code: "PDF_TEXT_RESTRICTED",
      message: "text extraction refused by the PDF permissions",
    });
  if (slideText && slideText.length !== info.pages)
    warnings.push({
      code: "PAGE_COUNT_MISMATCH",
      message: `${slideText.length} slides in the XML but ${info.pages} pages rendered`,
    });

  const records = await timer.stage("render+encode", () =>
    inPool(info.pages, lim.renderConcurrency, async (i): Promise<PageRecord> => {
      const n = i + 1;
      const png = await renderPage(pdfPath, n, lim, ctx.scratch, deadline);
      const img = await pngBufferToSharp(png, lim);
      const { image, thumb } = await writePage(ctx.staging, n, img, lim);
      let native: NativeText | null;
      if (slideText) {
        const s = slideText[i];
        native = s
          ? {
              kind: "slide",
              title: s.title,
              text: s.text,
              notes: s.notes,
              hidden: s.hidden,
              hasUnextractedObjects: s.hasUnextractedObjects,
              blocks: s.blocks,
            }
          : null;
      } else {
        const t = texts!.texts[i] ?? "";
        const layer = hasTextLayer(t);
        native = { kind: "pdf", text: t, hasTextLayer: layer };
        if (!layer)
          warnings.push({ code: "NO_TEXT_LAYER", message: `page ${n} has no text layer`, page: n });
      }
      return { page: n, image, thumb, native };
    }),
  );
  warnings.sort((a, b) => (a.page ?? 0) - (b.page ?? 0));
  return records;
}

async function convertPptx(ctx: Ctx): Promise<PageRecord[]> {
  const { lim, timer, warnings, scratch, deadline } = ctx;
  const scan = await timer.stage("zipscan", () => scanZip(ctx.input, lim));
  if (scan.entries.some((e) => /vbaProject\.bin$/i.test(e)))
    warnings.push({
      code: "MACROS_PRESENT",
      message: "file contains a VBA project; macros are disabled and were not run",
    });
  const text = await timer.stage("pptx-text", () => extractPptxText(ctx.input, lim, warnings));
  if (text.externalLinks > 0)
    warnings.push({
      code: "EXTERNAL_LINKS",
      message: `${text.externalLinks} external link(s) in slide relationships; not fetched (no network, link updates off)`,
    });
  if (text.slides.length > lim.maxPages)
    throw new ConvertError(
      "TOO_MANY_PAGES",
      `${text.slides.length} slides (limit ${lim.maxPages})`,
      { pages: text.slides.length },
    );
  if (text.slides.some((s) => s.hasUnextractedObjects))
    warnings.push({
      code: "UNEXTRACTED_OBJECTS",
      message:
        "some slides contain charts/SmartArt/OLE whose text was not extracted (they are still rendered)",
    });
  const work = path.join(scratch, "input.pptx");
  await copyFile(ctx.input, work);
  const pdf = await timer.stage("libreoffice", () => pptxToPdf(work, scratch, deadline));
  return convertPdfFile(ctx, pdf, text.slides);
}

async function convertPhoto(ctx: Ctx, type: "jpeg" | "png" | "heic"): Promise<PageRecord[]> {
  const { lim, timer, warnings } = ctx;
  let file = ctx.input;
  if (type === "heic")
    file = await timer.stage("heic-decode", () =>
      heicToPng(ctx.input, ctx.scratch, lim, ctx.deadline),
    );
  const { img, exifOrientation, width, height } = await timer.stage("decode", () =>
    openPhoto(file, lim),
  );
  if (exifOrientation && exifOrientation > 1)
    warnings.push({
      code: "EXIF_ORIENTATION_APPLIED",
      message: `EXIF orientation ${exifOrientation} applied (source ${width}x${height})`,
    });
  const { image, thumb } = await timer.stage("encode", () => writePage(ctx.staging, 1, img, lim));
  return [{ page: 1, image, thumb, native: null }];
}

async function main(): Promise<void> {
  const [input, outDir] = process.argv.slice(2);
  if (!input || !outDir || process.argv.length !== 4)
    throw new ConvertError("BAD_USAGE", "usage: convert <input-file> <output-dir>");
  const timer = new Timer();
  const deadline = new Deadline(limits.wallClockMs);
  const warnings: Warning[] = [];

  const st = await stat(input).catch(() => null);
  if (!st || !st.isFile()) throw new ConvertError("BAD_USAGE", "input is not a readable file");
  if (st.size > limits.maxInputBytes)
    throw new ConvertError("FILE_TOO_LARGE", `${st.size} bytes (limit ${limits.maxInputBytes})`, {
      bytes: st.size,
    });
  if (st.size === 0) throw new ConvertError("CORRUPT_FILE", "file is empty");
  await mkdir(outDir, { recursive: true });
  if ((await readdir(outDir)).length > 0)
    throw new ConvertError("BAD_USAGE", "output dir must be empty");

  const staging = path.join(outDir, `.staging-${process.pid}`);
  const scratch = await mkdtemp(path.join(os.tmpdir(), "conv-"));
  try {
    await mkdir(staging);
    const hash = await timer.stage("sha256", () => sha256(input));
    const det = await timer.stage("detect", () => detectType(input));
    let type = det.type;
    if (type === "ole-encrypted-or-legacy") {
      if (await oleIsEncryptedPackage(input))
        throw new ConvertError("ENCRYPTED", "Office file is password protected");
      throw new ConvertError(
        "UNSUPPORTED_TYPE",
        "legacy Office binary format (.ppt/.doc/.xls) is not supported; export as PPTX or PDF",
      );
    }
    if (type === "zip-other") {
      const scan = await timer.stage("zipscan-detect", () => scanZip(input, limits));
      const isPptx =
        scan.entries.includes("ppt/presentation.xml") &&
        /presentationml\.(presentation|slideshow)/.test(scan.contentTypesXml);
      if (!isPptx)
        throw new ConvertError(
          "UNSUPPORTED_TYPE",
          "zip container is not a PowerPoint presentation",
        );
      type = "pptx";
    }
    if (type === "unknown")
      throw new ConvertError(
        "UNSUPPORTED_TYPE",
        "unrecognised file type (detected by content, not extension)",
      );

    const ctx: Ctx = { input, staging, scratch, lim: limits, deadline, timer, warnings };
    let pages: PageRecord[];
    if (type === "pptx") pages = await convertPptx(ctx);
    else if (type === "pdf") pages = await convertPdfFile(ctx, input);
    else pages = await convertPhoto(ctx, type);

    const manifest: Manifest = {
      schemaVersion: 1,
      source: {
        sha256: hash,
        bytes: st.size,
        detectedType: type,
        mime: MIME[type] ?? "application/octet-stream",
      },
      pageCount: pages.length,
      pages,
      tools: await toolVersions(),
      limits: { ...limits },
      timingsMs: { ...timer.stages, total: timer.total() },
      peakMemoryBytes: await peakMemory(),
      warnings,
    };
    await writeFile(path.join(staging, "manifest.json"), JSON.stringify(manifest, null, 2));
    // Commit: move finished files into the output dir; manifest.json goes last so its presence means success.
    for (const entry of await readdir(staging)) {
      if (entry !== "manifest.json")
        await rename(path.join(staging, entry), path.join(outDir, entry));
    }
    await rename(path.join(staging, "manifest.json"), path.join(outDir, "manifest.json"));
    process.stdout.write(
      JSON.stringify({
        ok: true,
        type,
        pageCount: pages.length,
        warnings: warnings.length,
        totalMs: timer.total(),
      }) + "\n",
    );
  } finally {
    await rm(staging, { recursive: true, force: true }).catch(() => undefined);
    await rm(scratch, { recursive: true, force: true }).catch(() => undefined);
  }
}

main().then(
  () => process.exit(0),
  (e: unknown) => {
    const err =
      e instanceof ConvertError
        ? e
        : new ConvertError("INTERNAL_ERROR", e instanceof Error ? e.message : String(e));
    process.stdout.write(
      JSON.stringify({
        ok: false,
        error: { code: err.code, message: err.message, detail: err.detail },
      }) + "\n",
    );
    process.exit(err.code === "BAD_USAGE" ? 64 : 2);
  },
);
