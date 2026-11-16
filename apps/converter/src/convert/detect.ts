import { open, readFile } from "node:fs/promises";

export type SniffedType = "pdf" | "jpeg" | "png" | "heic" | "zip" | "ole" | "unknown";

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
    return brands.some((x) => HEIC_BRANDS.has(x)) ? "heic" : "unknown";
  }
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

/** An OOXML file protected with a password is wrapped in an OLE container holding an EncryptedPackage stream. */
export async function oleIsEncryptedPackage(path: string): Promise<boolean> {
  // The input size cap has already been enforced, so reading the whole file is bounded.
  const buf = await readFile(path);
  return buf.includes(Buffer.from("EncryptedPackage", "utf16le"));
}

/** Content types a PowerPoint package may declare for ppt/presentation.xml (macro-enabled ones included). */
const PRESENTATION_TYPES =
  /^application\/vnd\.(openxmlformats-officedocument\.presentationml\.(presentation|slideshow|template)|ms-powerpoint\.(presentation|slideshow|template)\.macroEnabled)\.main\+xml$/;

export function isPresentationContentTypes(contentTypesXml: string): {
  ok: boolean;
  macroEnabled: boolean;
} {
  const re = /<Override\b[^>]*>/g;
  for (const m of contentTypesXml.match(re) ?? []) {
    if (!/PartName\s*=\s*"\/ppt\/presentation\.xml"/i.test(m)) continue;
    const ct = /ContentType\s*=\s*"([^"]*)"/i.exec(m)?.[1] ?? "";
    return { ok: PRESENTATION_TYPES.test(ct), macroEnabled: /macroEnabled/.test(ct) };
  }
  return { ok: false, macroEnabled: false };
}
