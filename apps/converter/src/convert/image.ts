import { mkdir, open, readdir, rm } from "node:fs/promises";
import path from "node:path";
import sharp, { type Sharp } from "sharp";
import type { Limits } from "../config.js";
import { ConvertError, cleanMessage } from "../errors.js";
import { type Deadline, run } from "./exec.js";
import type { ImageRef } from "./types.js";

sharp.cache(false);
sharp.concurrency(2);

export function pageName(n: number): string {
  return String(n).padStart(4, "0");
}

/** Encode one decoded page into pages/NNNN.webp and thumbs/NNNN.webp inside the staging dir. */
export async function writePage(
  staging: string,
  n: number,
  base: Sharp,
  lim: Limits,
): Promise<{ image: ImageRef; thumb: ImageRef }> {
  const name = `${pageName(n)}.webp`;
  await mkdir(path.join(staging, "thumbs"), { recursive: true });
  const pipeline = base.clone().flatten({ background: "#ffffff" });
  const pageInfo = await pipeline
    .clone()
    .resize({
      width: lim.pageLongEdge,
      height: lim.pageLongEdge,
      fit: "inside",
      withoutEnlargement: true,
    })
    .webp({ quality: lim.webpQuality, effort: 4 })
    .toFile(path.join(staging, name));
  const thumbInfo = await pipeline
    .clone()
    .resize({
      width: lim.thumbLongEdge,
      height: lim.thumbLongEdge,
      fit: "inside",
      withoutEnlargement: true,
    })
    .webp({ quality: 72, effort: 4 })
    .toFile(path.join(staging, "thumbs", name));
  return {
    image: { file: name, width: pageInfo.width, height: pageInfo.height, bytes: pageInfo.size },
    thumb: {
      file: `thumbs/${name}`,
      width: thumbInfo.width,
      height: thumbInfo.height,
      bytes: thumbInfo.size,
    },
  };
}

/**
 * Open an image file with decode limits; EXIF orientation is applied by rotate() with no argument.
 * `page` picks one image of a multi-image file (TIFF); `pixelBudget` is what is left for all the pages of one
 * file together. The size is read from the header and refused before any pixel is decoded.
 */
export async function openPhoto(
  file: string,
  lim: Limits,
  opts: { page?: number; pixelBudget?: number } = {},
): Promise<{
  img: Sharp;
  exifOrientation: number | null;
  width: number;
  height: number;
  /** Images or frames in the file (more than one: a multi-page TIFF or an animation). */
  pages: number;
}> {
  const page = opts.page ?? 0;
  try {
    const probe = sharp(file, { limitInputPixels: false, failOn: "error", page });
    const meta = await probe.metadata();
    if (!meta.width || !meta.height)
      throw new ConvertError("corrupt_file", "image has no dimensions");
    // For a multi-page file libvips reports the height of the whole stack, so use the page height.
    const height = meta.pageHeight ?? meta.height;
    if (meta.width * height > lim.maxPixelsPerImage)
      throw new ConvertError(
        "too_large",
        `image is ${meta.width}x${height} (limit ${lim.maxPixelsPerImage} pixels)`,
        "pixel_bomb",
      );
    if (opts.pixelBudget !== undefined && meta.width * height > opts.pixelBudget)
      throw new ConvertError(
        "too_large",
        `the pages together are over ${lim.maxTotalPixels} pixels`,
        "pixel_bomb",
      );
    const img = sharp(file, {
      limitInputPixels: lim.maxPixelsPerImage,
      failOn: "error",
      sequentialRead: true,
      page,
    }).rotate();
    // Force a full decode now so a truncated file fails here, not halfway through writing.
    await img.clone().resize(8, 8, { fit: "inside" }).raw().toBuffer();
    return {
      img,
      exifOrientation: meta.orientation ?? null,
      width: meta.width,
      height,
      pages: meta.pages ?? 1,
    };
  } catch (e) {
    if (e instanceof ConvertError) throw e;
    const msg = e instanceof Error ? e.message : String(e);
    if (/pixel limit/i.test(msg))
      throw new ConvertError("too_large", cleanMessage(msg), "pixel_bomb");
    throw new ConvertError("corrupt_file", `image decode failed: ${cleanMessage(msg)}`);
  }
}

/** Width and height a BMP header declares, or null when the header is too short or odd. */
export function bmpDimensions(head: Buffer): { width: number; height: number } | null {
  if (head.length < 26) return null;
  const dib = head.readUInt32LE(14);
  if (dib === 12) return { width: head.readUInt16LE(18), height: head.readUInt16LE(20) };
  // A negative height only means the rows are stored top-down.
  return { width: Math.abs(head.readInt32LE(18)), height: Math.abs(head.readInt32LE(22)) };
}

/**
 * BMP: libvips cannot read it, so netpbm (bmptopnm, then pnmtopng) turns it into a PNG first. The size in the
 * header is checked before either tool runs, so a huge declared size is refused without decoding anything.
 */
export async function bmpToPng(
  file: string,
  scratch: string,
  lim: Limits,
  deadline: Deadline,
): Promise<string> {
  const fh = await open(file, "r");
  let head: Buffer;
  try {
    head = Buffer.alloc(32);
    const { bytesRead } = await fh.read(head, 0, 32, 0);
    head = head.subarray(0, bytesRead);
  } finally {
    await fh.close();
  }
  const dims = bmpDimensions(head);
  if (!dims || dims.width < 1 || dims.height < 1)
    throw new ConvertError("corrupt_file", "BMP header has no usable size");
  if (dims.width * dims.height > lim.maxPixelsPerImage)
    throw new ConvertError(
      "too_large",
      `BMP is ${dims.width}x${dims.height} (limit ${lim.maxPixelsPerImage} pixels)`,
      "pixel_bomb",
    );
  const env = { PATH: process.env.PATH ?? "", HOME: scratch, TMPDIR: scratch, LANG: "C.UTF-8" };
  const pnm = path.join(scratch, "bmp-decoded.pnm");
  const png = path.join(scratch, "bmp-decoded.png");
  const dec = await run(deadline, "bmptopnm", [file], { env, stdoutTo: pnm });
  if (dec.code !== 0)
    throw new ConvertError("corrupt_file", `bmptopnm failed: ${cleanMessage(dec.stderr)}`);
  const enc = await run(deadline, "pnmtopng", [pnm], { env, stdoutTo: png });
  await rm(pnm, { force: true });
  if (enc.code !== 0)
    throw new ConvertError("corrupt_file", `pnmtopng failed: ${cleanMessage(enc.stderr)}`);
  return png;
}

/** HEIC: libheif (with libde265 for HEVC) decodes to PNG; sharp's prebuilt binaries cannot decode HEVC. */
export async function heicToPng(
  file: string,
  scratch: string,
  lim: Limits,
  deadline: Deadline,
): Promise<string> {
  const info = await run(deadline, "heif-info", [file]);
  if (info.code !== 0)
    throw new ConvertError(
      "corrupt_file",
      `heif-info failed: ${cleanMessage(info.stderr || info.stdout.toString())}`,
    );
  const m = /image:\s*(\d+)x(\d+)/.exec(info.stdout.toString("utf8"));
  if (!m) throw new ConvertError("corrupt_file", "heif-info reported no image");
  const w = Number(m[1]);
  const h = Number(m[2]);
  if (w * h > lim.maxPixelsPerImage)
    throw new ConvertError(
      "too_large",
      `HEIC is ${w}x${h} (limit ${lim.maxPixelsPerImage} pixels)`,
      "pixel_bomb",
    );
  const out = path.join(scratch, "heic-decoded.png");
  const res = await run(deadline, "heif-dec", ["--quiet", file, out]);
  if (res.code !== 0)
    throw new ConvertError("corrupt_file", `heif-dec failed: ${cleanMessage(res.stderr)}`);
  // A multi-image file may be written as heic-decoded-1.png, -2.png and so on; take the first (the primary image).
  const produced = (await readdir(scratch))
    .filter((f) => /^heic-decoded(-\d+)?\.png$/.test(f))
    .sort();
  if (produced.length === 0) throw new ConvertError("corrupt_file", "heif-dec produced no image");
  const first = produced[0];
  if (first === undefined) throw new ConvertError("corrupt_file", "heif-dec produced no image");
  return path.join(scratch, first);
}

export async function pngBufferToSharp(buf: Buffer, lim: Limits): Promise<Sharp> {
  return sharp(buf, { limitInputPixels: lim.maxPixelsPerImage, failOn: "error" });
}
