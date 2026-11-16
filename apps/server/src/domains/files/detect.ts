import { open } from "node:fs/promises";
import { inflateRawSync } from "node:zlib";
import type { FileType } from "@notes/schema";

/** Bytes of the start of a file that detection looks at. */
export const SNIFF_BYTES = 1024;

const HEIC_BRANDS = new Set([
  "heic",
  "heix",
  "heim",
  "heis",
  "hevc",
  "hevx",
  "mif1",
  "msf1",
  "heif",
]);

/**
 * What the first bytes say. "zip" needs a second look inside the archive
 * (`isPresentationZip`). Never trusts an extension or a declared content type.
 */
export function sniffHeader(head: Uint8Array): FileType | "zip" | null {
  const b = Buffer.from(head.buffer, head.byteOffset, head.byteLength);
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return "jpeg";
  if (
    b.length >= 8 &&
    b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
  ) {
    return "png";
  }
  if (b.subarray(0, Math.min(b.length, SNIFF_BYTES)).includes("%PDF-")) return "pdf";
  if (b.length >= 4 && b[0] === 0x50 && b[1] === 0x4b && b[2] === 0x03 && b[3] === 0x04) {
    return "zip";
  }
  if (b.length >= 12 && b.subarray(4, 8).toString("latin1") === "ftyp") {
    const major = b.subarray(8, 12).toString("latin1");
    if (HEIC_BRANDS.has(major)) return "heic";
    // Compatible brands follow a 4-byte minor version.
    const boxSize = Math.min(b.readUInt32BE(0), b.length);
    for (let at = 16; at + 4 <= boxSize; at += 4) {
      if (HEIC_BRANDS.has(b.subarray(at, at + 4).toString("latin1"))) return "heic";
    }
  }
  return null;
}

const EOCD = 0x06054b50;
const CENTRAL = 0x02014b50;
const LOCAL = 0x04034b50;
const MAX_DIRECTORY_BYTES = 4 * 1024 * 1024;
const MAX_CONTENT_TYPES_BYTES = 1024 * 1024;
const PRESENTATION_TYPE = "presentationml.presentation.main+xml";

/**
 * Is this ZIP a PowerPoint presentation? It must hold `[Content_Types].xml`
 * declaring a presentation main part, and `ppt/presentation.xml`. Only the
 * central directory and that one small entry are read.
 */
export async function isPresentationZip(path: string): Promise<boolean> {
  const handle = await open(path, "r");
  try {
    const size = (await handle.stat()).size;
    const tailLength = Math.min(size, 65_557);
    const tail = Buffer.alloc(tailLength);
    await handle.read(tail, 0, tailLength, size - tailLength);
    let eocd = -1;
    for (let at = tailLength - 22; at >= 0; at--) {
      if (tail.readUInt32LE(at) === EOCD) {
        eocd = at;
        break;
      }
    }
    if (eocd < 0) return false;
    const entries = tail.readUInt16LE(eocd + 10);
    const directorySize = tail.readUInt32LE(eocd + 12);
    const directoryOffset = tail.readUInt32LE(eocd + 16);
    if (entries === 0xffff || directorySize === 0xffffffff || directoryOffset === 0xffffffff) {
      return false; // ZIP64: not something a slide deck needs
    }
    if (directorySize > MAX_DIRECTORY_BYTES || directoryOffset + directorySize > size) return false;
    const directory = Buffer.alloc(directorySize);
    await handle.read(directory, 0, directorySize, directoryOffset);

    let contentTypes: { method: number; compressed: number; offset: number } | null = null;
    let hasPresentation = false;
    let at = 0;
    for (let n = 0; n < entries && at + 46 <= directory.length; n++) {
      if (directory.readUInt32LE(at) !== CENTRAL) return false;
      const method = directory.readUInt16LE(at + 10);
      const compressed = directory.readUInt32LE(at + 20);
      const nameLength = directory.readUInt16LE(at + 28);
      const extraLength = directory.readUInt16LE(at + 30);
      const commentLength = directory.readUInt16LE(at + 32);
      const offset = directory.readUInt32LE(at + 42);
      const name = directory.subarray(at + 46, at + 46 + nameLength).toString("utf8");
      if (name === "[Content_Types].xml") contentTypes = { method, compressed, offset };
      if (name === "ppt/presentation.xml") hasPresentation = true;
      at += 46 + nameLength + extraLength + commentLength;
    }
    if (!contentTypes || !hasPresentation) return false;
    if (contentTypes.compressed > MAX_CONTENT_TYPES_BYTES) return false;

    const local = Buffer.alloc(30);
    await handle.read(local, 0, 30, contentTypes.offset);
    if (local.readUInt32LE(0) !== LOCAL) return false;
    const dataStart = contentTypes.offset + 30 + local.readUInt16LE(26) + local.readUInt16LE(28);
    if (dataStart + contentTypes.compressed > size) return false;
    const raw = Buffer.alloc(contentTypes.compressed);
    await handle.read(raw, 0, raw.length, dataStart);
    let xml: Buffer;
    if (contentTypes.method === 0) xml = raw;
    else if (contentTypes.method === 8) {
      xml = inflateRawSync(raw, { maxOutputLength: MAX_CONTENT_TYPES_BYTES });
    } else return false;
    return xml.toString("utf8").includes(PRESENTATION_TYPE);
  } catch {
    return false;
  } finally {
    await handle.close();
  }
}
