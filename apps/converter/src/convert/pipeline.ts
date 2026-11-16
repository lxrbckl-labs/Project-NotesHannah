import { copyFile, mkdir, stat } from "node:fs/promises";
import path from "node:path";
import type { Limits } from "../config.js";
import { ConvertError } from "../errors.js";
import { isPresentationContentTypes, oleIsEncryptedPackage, sniffFile } from "./detect.js";
import { Deadline } from "./exec.js";
import { heicToPng, openPhoto, pngBufferToSharp, writePage } from "./image.js";
import { pptxToPdf } from "./libreoffice.js";
import { hasTextLayer, pdfInfo, pdfText, renderPage } from "./pdf.js";
import { extractPptxText, type SlideText } from "./pptx.js";
import type { DetectedType, PageResult, PipelineResult, Warning } from "./types.js";
import { scanZip } from "./zipscan.js";

export interface PipelineRequest {
  /** The original file (read only). */
  input: string;
  /** Empty directory that receives 0001.webp ... and thumbs/0001.webp ... */
  outDir: string;
  /** Private scratch directory, wiped by the caller afterwards. */
  scratch: string;
  limits: Limits;
}

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

interface Ctx extends PipelineRequest {
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
  slides?: SlideText[],
): Promise<PageResult[]> {
  const { limits: lim, deadline, timer, warnings } = ctx;
  const info = await timer.stage("pdfinfo", () => pdfInfo(pdfPath, deadline));
  if (info.pages > lim.maxPages)
    throw new ConvertError("too_many_pages", `${info.pages} pages (limit ${lim.maxPages})`);
  if (info.encryptedButReadable)
    warnings.push({
      code: "PDF_OWNER_RESTRICTED",
      message: "PDF is encrypted with an empty user password; opened read-only",
    });

  const texts = slides
    ? null
    : await timer.stage("pdftotext", () => pdfText(pdfPath, info.pages, deadline));
  if (texts?.restricted)
    warnings.push({
      code: "PDF_TEXT_RESTRICTED",
      message: "text extraction refused by the PDF permissions",
    });
  if (slides && slides.length !== info.pages)
    warnings.push({
      code: "PAGE_COUNT_MISMATCH",
      message: `${slides.length} slides in the XML but ${info.pages} pages rendered`,
    });

  const pages = await timer.stage("render+encode", () =>
    inPool(info.pages, lim.renderConcurrency, async (i): Promise<PageResult> => {
      const n = i + 1;
      const png = await renderPage(pdfPath, n, lim, ctx.scratch, deadline);
      const img = await pngBufferToSharp(png, lim);
      const { image } = await writePage(ctx.outDir, n, img, lim);
      let text: string | null;
      let notes: string | null = null;
      let layer: boolean;
      if (slides) {
        const s = slides[i];
        text = s && s.text.trim() !== "" ? s.text : null;
        notes = s?.notes ?? null;
        layer = text !== null;
      } else {
        const t = texts?.texts[i] ?? "";
        layer = hasTextLayer(t);
        text = layer ? t : null;
        if (!layer)
          warnings.push({ code: "NO_TEXT_LAYER", message: `page ${n} has no text layer`, page: n });
      }
      return {
        index: n,
        width: image.width,
        height: image.height,
        bytes: image.bytes,
        hasTextLayer: layer,
        nativeText: text,
        speakerNotes: notes,
      };
    }),
  );
  return pages;
}

async function convertPptx(ctx: Ctx, macroEnabled: boolean): Promise<PageResult[]> {
  const { limits: lim, timer, warnings, scratch, deadline } = ctx;
  const scan = await timer.stage("zipscan", () => scanZip(ctx.input, lim));
  if (macroEnabled || scan.entries.some((e) => /vbaProject\.bin$/i.test(e)))
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
      "too_many_pages",
      `${text.slides.length} slides (limit ${lim.maxPages})`,
    );
  for (const s of text.slides) {
    if (s.hidden)
      warnings.push({
        code: "HIDDEN_SLIDE",
        message: "hidden slide, kept as a page",
        page: s.slideNumber,
      });
    if (s.hasUnextractedObjects)
      warnings.push({
        code: "UNEXTRACTED_OBJECTS",
        message:
          "slide has a chart, SmartArt or embedded object whose text was not extracted (it is still rendered)",
        page: s.slideNumber,
      });
  }
  const work = path.join(scratch, "input.pptx");
  await copyFile(ctx.input, work);
  const pdf = await timer.stage("libreoffice", () => pptxToPdf(work, scratch, deadline));
  return convertPdfFile(ctx, pdf, text.slides);
}

async function convertPhoto(ctx: Ctx, type: "jpeg" | "png" | "heic"): Promise<PageResult[]> {
  const { limits: lim, timer, warnings } = ctx;
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
  const { image } = await timer.stage("encode", () => writePage(ctx.outDir, 1, img, lim));
  return [
    {
      index: 1,
      width: image.width,
      height: image.height,
      bytes: image.bytes,
      hasTextLayer: false,
      nativeText: null,
      speakerNotes: null,
    },
  ];
}

/** Convert one untrusted file to page images plus native text. Throws ConvertError for every expected failure. */
export async function runPipeline(req: PipelineRequest): Promise<PipelineResult> {
  const timer = new Timer();
  const warnings: Warning[] = [];
  const deadline = new Deadline(req.limits.wallClockMs);
  const st = await stat(req.input).catch(() => null);
  if (!st?.isFile())
    throw new ConvertError("conversion_failed", "input is not a readable file", "internal");
  if (st.size > req.limits.maxInputBytes)
    throw new ConvertError(
      "too_large",
      `${st.size} bytes (limit ${req.limits.maxInputBytes})`,
      "file_too_large",
    );
  if (st.size === 0) throw new ConvertError("corrupt_file", "file is empty");
  await mkdir(req.outDir, { recursive: true });

  const ctx: Ctx = { ...req, deadline, timer, warnings };
  const sniffed = await timer.stage("detect", () => sniffFile(req.input));
  let type: DetectedType;
  let macroEnabled = false;
  switch (sniffed) {
    case "pdf":
    case "jpeg":
    case "png":
    case "heic":
      type = sniffed;
      break;
    case "ole":
      if (await oleIsEncryptedPackage(req.input))
        throw new ConvertError("encrypted_file", "Office file is password protected");
      throw new ConvertError(
        "unsupported_type",
        "legacy Office binary format (.ppt/.doc/.xls) is not supported; export as PPTX or PDF",
        "legacy_office",
      );
    case "zip": {
      const scan = await timer.stage("zipscan-detect", () => scanZip(req.input, req.limits));
      const kind = scan.entries.includes("ppt/presentation.xml")
        ? isPresentationContentTypes(scan.contentTypesXml)
        : { ok: false, macroEnabled: false };
      if (!kind.ok)
        throw new ConvertError(
          "unsupported_type",
          "zip container is not a PowerPoint presentation",
          "other_zip",
        );
      macroEnabled = kind.macroEnabled;
      type = "pptx";
      break;
    }
    default:
      throw new ConvertError(
        "unsupported_type",
        "unrecognised file type (detected by content, not extension)",
      );
  }

  let pages: PageResult[];
  if (type === "pptx") pages = await convertPptx(ctx, macroEnabled);
  else if (type === "pdf") pages = await convertPdfFile(ctx, req.input);
  else pages = await convertPhoto(ctx, type);
  warnings.sort((a, b) => (a.page ?? 0) - (b.page ?? 0));
  return { type, pages, warnings, timings: { ...timer.stages, total: timer.total() } };
}
