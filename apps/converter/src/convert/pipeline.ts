import { copyFile, mkdir, stat } from "node:fs/promises";
import path from "node:path";
import type { Limits } from "../config.js";
import { ConvertError } from "../errors.js";
import { isPresentationContentTypes, isWordContentTypes, odfKind, sniffFile } from "./detect.js";
import { Deadline } from "./exec.js";
import { bmpToPng, heicToPng, openPhoto, pngBufferToSharp, writePage } from "./image.js";
import { type OfficeKind, officeToPdf } from "./libreoffice.js";
import { readOle } from "./ole.js";
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

/** Word documents, ODF files and old binary Office files: no slide XML to read, the PDF is the whole story. */
async function convertOffice(
  ctx: Ctx,
  kind: OfficeKind,
  macros: boolean,
  scanned: { entries: string[] } | null,
): Promise<PageResult[]> {
  const { timer, warnings, scratch, deadline } = ctx;
  if (
    macros ||
    scanned?.entries.some((e) => /vbaProject\.bin$/i.test(e) || /^(Basic|Scripts)\//.test(e))
  )
    warnings.push({
      code: "MACROS_PRESENT",
      message: "file contains macros; they are disabled and were not run",
    });
  const work = path.join(scratch, `input.${kind}`);
  await copyFile(ctx.input, work);
  const pdf = await timer.stage("libreoffice", () => officeToPdf(work, kind, scratch, deadline));
  return convertPdfFile(ctx, pdf);
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
  const pdf = await timer.stage("libreoffice", () => officeToPdf(work, "pptx", scratch, deadline));
  return convertPdfFile(ctx, pdf, text.slides);
}

type PhotoType = "jpeg" | "png" | "heic" | "webp" | "gif" | "tiff" | "avif" | "bmp";

async function convertPhoto(ctx: Ctx, type: PhotoType): Promise<PageResult[]> {
  const { limits: lim, timer, warnings } = ctx;
  let file = ctx.input;
  if (type === "heic")
    file = await timer.stage("heic-decode", () =>
      heicToPng(ctx.input, ctx.scratch, lim, ctx.deadline),
    );
  if (type === "bmp")
    file = await timer.stage("bmp-decode", () =>
      bmpToPng(ctx.input, ctx.scratch, lim, ctx.deadline),
    );
  const first = await timer.stage("decode", () => openPhoto(file, lim));
  // A TIFF is a stack of images and each becomes a page; for every other format more than one image means
  // an animation, of which only the first frame is kept.
  let count = 1;
  if (first.pages > 1) {
    if (type === "tiff") {
      count = first.pages;
      if (count > lim.maxPages)
        throw new ConvertError("too_many_pages", `${count} pages (limit ${lim.maxPages})`);
    } else {
      warnings.push({
        code: "ANIMATED_FIRST_FRAME",
        message: `animated image with ${first.pages} frames; only the first frame is shown`,
      });
    }
  }
  const pages: PageResult[] = [];
  let pixels = 0;
  for (let i = 0; i < count; i++) {
    const n = i + 1;
    const shot =
      i === 0
        ? first
        : await timer.stage("decode", () =>
            openPhoto(file, lim, { page: i, pixelBudget: lim.maxTotalPixels - pixels }),
          );
    pixels += shot.width * shot.height;
    if (pixels > lim.maxTotalPixels)
      throw new ConvertError(
        "too_large",
        `the pages together are over ${lim.maxTotalPixels} pixels`,
        "pixel_bomb",
      );
    if (shot.exifOrientation && shot.exifOrientation > 1)
      warnings.push({
        code: "EXIF_ORIENTATION_APPLIED",
        message: `EXIF orientation ${shot.exifOrientation} applied (source ${shot.width}x${shot.height})`,
        ...(count > 1 ? { page: n } : {}),
      });
    const { image } = await timer.stage("encode", () => writePage(ctx.outDir, n, shot.img, lim));
    pages.push({
      index: n,
      width: image.width,
      height: image.height,
      bytes: image.bytes,
      hasTextLayer: false,
      nativeText: null,
      speakerNotes: null,
    });
  }
  return pages;
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
  let zipScan: { entries: string[] } | null = null;
  switch (sniffed) {
    case "pdf":
    case "jpeg":
    case "png":
    case "heic":
    case "webp":
    case "gif":
    case "tiff":
    case "avif":
    case "bmp":
      type = sniffed;
      break;
    case "ole": {
      const ole = await timer.stage("ole-detect", () => readOle(req.input));
      if (ole.kind === "encrypted")
        throw new ConvertError("encrypted_file", "Office file is password protected");
      if (ole.kind === "spreadsheet")
        throw new ConvertError(
          "unsupported_type",
          "spreadsheets are not supported; export the sheet as PDF",
          "legacy_office",
        );
      if (ole.kind !== "ppt" && ole.kind !== "doc")
        throw new ConvertError(
          "unsupported_type",
          "old Office file that is not a PowerPoint or Word document",
          "legacy_office",
        );
      type = ole.kind;
      macroEnabled = ole.macros;
      break;
    }
    case "zip": {
      const scan = await timer.stage("zipscan-detect", () => scanZip(req.input, req.limits));
      zipScan = scan;
      const deck = scan.entries.includes("ppt/presentation.xml")
        ? isPresentationContentTypes(scan.contentTypesXml)
        : { ok: false, macroEnabled: false };
      const word = scan.entries.includes("word/document.xml")
        ? isWordContentTypes(scan.contentTypesXml)
        : { ok: false, macroEnabled: false };
      const odf = scan.mimetype !== "" ? odfKind(scan.mimetype) : null;
      if (deck.ok) {
        macroEnabled = deck.macroEnabled;
        type = "pptx";
      } else if (word.ok) {
        macroEnabled = word.macroEnabled;
        type = "docx";
      } else if (odf) {
        type = odf;
      } else {
        throw new ConvertError(
          "unsupported_type",
          "zip container is not a PowerPoint presentation, Word document or OpenDocument file",
          "other_zip",
        );
      }
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
  else if (type === "ppt" || type === "doc" || type === "docx" || type === "odp" || type === "odt")
    pages = await convertOffice(ctx, type, macroEnabled, zipScan);
  else pages = await convertPhoto(ctx, type);
  warnings.sort((a, b) => (a.page ?? 0) - (b.page ?? 0));
  return { type, pages, warnings, timings: { ...timer.stages, total: timer.total() } };
}
