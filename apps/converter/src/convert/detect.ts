import { open } from "node:fs/promises";

export type SniffedType =
  | "pdf"
  | "jpeg"
  | "png"
  | "heic"
  | "webp"
  | "gif"
  | "tiff"
  | "avif"
  | "bmp"
  | "zip"
  | "ole"
  | "unknown";

const HEIC_BRANDS = new Set([
  "heic",
  "heix",
  "hevc",
  "hevx",
  "heim",
  "heis",
  "hevm",
  "hevs",
  "mif1",
  "msf1",
]);
/** AVIF files say so in their brands; checked before HEIC because AVIF also lists the generic `mif1`. */
const AVIF_BRANDS = new Set(["avif", "avis"]);
/** The DIB header sizes a real BMP has (core, info, v2, v3, os2 v2, v4, v5). Two letters alone are no proof. */
const BMP_HEADER_SIZES = new Set([12, 40, 52, 56, 64, 108, 124]);
const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const OLE_MAGIC = Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]);

/** Classify the first bytes of a file. The name and extension are never consulted. */
export function sniff(b: Buffer): SniffedType {
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return "jpeg";
  if (b.length >= 8 && b.subarray(0, 8).equals(PNG_MAGIC)) return "png";
  if (b.subarray(0, 1024).includes(Buffer.from("%PDF-"))) return "pdf";
  if (b.length >= 12 && b.subarray(4, 8).toString("latin1") === "ftyp") {
    const brands = [b.subarray(8, 12).toString("latin1")];
    for (let o = 16; o + 4 <= Math.min(b.length, 64); o += 4)
      brands.push(b.subarray(o, o + 4).toString("latin1"));
    if (brands.some((x) => AVIF_BRANDS.has(x))) return "avif";
    return brands.some((x) => HEIC_BRANDS.has(x)) ? "heic" : "unknown";
  }
  if (
    b.length >= 12 &&
    b.subarray(0, 4).toString("latin1") === "RIFF" &&
    b.subarray(8, 12).toString("latin1") === "WEBP"
  )
    return "webp";
  if (b.length >= 6 && /^GIF8[79]a$/.test(b.subarray(0, 6).toString("latin1"))) return "gif";
  // Classic TIFF only (little or big endian). BigTIFF (version 43) is not offered.
  if (
    b.length >= 8 &&
    ((b[0] === 0x49 && b[1] === 0x49 && b[2] === 0x2a && b[3] === 0) ||
      (b[0] === 0x4d && b[1] === 0x4d && b[2] === 0 && b[3] === 0x2a))
  )
    return "tiff";
  if (
    b.length >= 26 &&
    b[0] === 0x42 &&
    b[1] === 0x4d &&
    b.readUInt32LE(6) === 0 &&
    BMP_HEADER_SIZES.has(b.readUInt32LE(14))
  )
    return "bmp";
  if (
    b.length >= 4 &&
    b[0] === 0x50 &&
    b[1] === 0x4b &&
    (b[2] === 3 || b[2] === 5) &&
    (b[3] === 4 || b[3] === 6)
  )
    return "zip";
  if (b.length >= 8 && b.subarray(0, 8).equals(OLE_MAGIC)) return "ole";
  return "unknown";
}

export async function sniffFile(path: string): Promise<SniffedType> {
  const fh = await open(path, "r");
  try {
    const head = Buffer.alloc(2048);
    const { bytesRead } = await fh.read(head, 0, head.length, 0);
    return sniff(head.subarray(0, bytesRead));
  } finally {
    await fh.close();
  }
}

/** Content types a PowerPoint package may declare for ppt/presentation.xml (macro-enabled ones included). */
const PRESENTATION_TYPES =
  /^application\/vnd\.(openxmlformats-officedocument\.presentationml\.(presentation|slideshow|template)|ms-powerpoint\.(presentation|slideshow|template)\.macroEnabled)\.main\+xml$/;

/** Content types a Word package may declare for word/document.xml (document, template, macro-enabled or not). */
const WORD_TYPES =
  /^application\/vnd\.(openxmlformats-officedocument\.wordprocessingml\.(document|template)|ms-word\.(document|template)\.macroEnabled)\.main\+xml$/;

function mainPartType(contentTypesXml: string, partName: string): string | null {
  for (const m of contentTypesXml.match(/<Override\b[^>]*>/g) ?? []) {
    const name = /PartName\s*=\s*"([^"]*)"/i.exec(m)?.[1];
    if (name?.toLowerCase() !== partName) continue;
    return /ContentType\s*=\s*"([^"]*)"/i.exec(m)?.[1] ?? "";
  }
  return null;
}

export function isPresentationContentTypes(contentTypesXml: string): {
  ok: boolean;
  macroEnabled: boolean;
} {
  const ct = mainPartType(contentTypesXml, "/ppt/presentation.xml");
  if (ct === null) return { ok: false, macroEnabled: false };
  return { ok: PRESENTATION_TYPES.test(ct), macroEnabled: /macroEnabled/.test(ct) };
}

export function isWordContentTypes(contentTypesXml: string): {
  ok: boolean;
  macroEnabled: boolean;
} {
  const ct = mainPartType(contentTypesXml, "/word/document.xml");
  if (ct === null) return { ok: false, macroEnabled: false };
  return { ok: WORD_TYPES.test(ct), macroEnabled: /macroEnabled/.test(ct) };
}

/** OpenDocument packages say what they are in their `mimetype` entry (presentation or text; templates too). */
export function odfKind(mimetype: string): "odp" | "odt" | null {
  const m = mimetype.trim();
  if (m === "application/vnd.oasis.opendocument.presentation") return "odp";
  if (m === "application/vnd.oasis.opendocument.presentation-template") return "odp";
  if (m === "application/vnd.oasis.opendocument.text") return "odt";
  if (m === "application/vnd.oasis.opendocument.text-template") return "odt";
  return null;
}
