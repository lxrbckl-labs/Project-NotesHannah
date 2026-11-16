import { mkdir, readdir } from "node:fs/promises";
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

/** Open a JPEG/PNG file with decode limits; EXIF orientation is applied by rotate() with no argument. */
export async function openPhoto(
  file: string,
  lim: Limits,
): Promise<{ img: Sharp; exifOrientation: number | null; width: number; height: number }> {
  try {
    const probe = sharp(file, { limitInputPixels: false, failOn: "error" });
    const meta = await probe.metadata();
    if (!meta.width || !meta.height)
      throw new ConvertError("corrupt_file", "image has no dimensions");
    if (meta.width * meta.height > lim.maxPixelsPerImage)
      throw new ConvertError(
        "too_large",
        `image is ${meta.width}x${meta.height} (limit ${lim.maxPixelsPerImage} pixels)`,
        "pixel_bomb",
      );
    const img = sharp(file, {
      limitInputPixels: lim.maxPixelsPerImage,
      failOn: "error",
      sequentialRead: true,
    }).rotate();
    // Force a full decode now so a truncated file fails here, not halfway through writing.
    await img.clone().resize(8, 8, { fit: "inside" }).raw().toBuffer();
    return {
      img,
      exifOrientation: meta.orientation ?? null,
      width: meta.width,
      height: meta.height,
    };
  } catch (e) {
    if (e instanceof ConvertError) throw e;
    const msg = e instanceof Error ? e.message : String(e);
    if (/pixel limit/i.test(msg))
      throw new ConvertError("too_large", cleanMessage(msg), "pixel_bomb");
    throw new ConvertError("corrupt_file", `image decode failed: ${cleanMessage(msg)}`);
  }
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
