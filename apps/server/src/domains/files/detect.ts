import { open } from "node:fs/promises";
import { inflateRawSync } from "node:zlib";
import type { FileType } from "@notes/schema";

/** Bytes of the start of a file that detection looks at. */
export const SNIFF_BYTES = 1024;

/** AVIF says so in its brands, and also lists the generic `mif1`, so it is checked before HEIC. */
const AVIF_BRANDS = new Set(["avif", "avis"]);
/** DIB header sizes of a real BMP. Two letters alone are no proof of anything. */
const BMP_HEADER_SIZES = new Set([12, 40, 52, 56, 64, 108, 124]);
const OLE_MAGIC = Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]);

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
 * What the first bytes say. "zip" needs a second look inside the archive (`classifyZip`) and "ole" one
 * into the directory of streams (`readOle`). Never trusts an extension or a declared content type.
 */
export function sniffHeader(head: Uint8Array): FileType | "zip" | "ole" | null {
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
    const brands = [b.subarray(8, 12).toString("latin1")];
    // Compatible brands follow a 4-byte minor version.
    const boxSize = Math.min(b.readUInt32BE(0), b.length);
    for (let at = 16; at + 4 <= boxSize; at += 4)
      brands.push(b.subarray(at, at + 4).toString("latin1"));
    if (brands.some((x) => AVIF_BRANDS.has(x))) return "avif";
    if (brands.some((x) => HEIC_BRANDS.has(x))) return "heic";
    return null;
  }
  if (
    b.length >= 12 &&
    b.subarray(0, 4).toString("latin1") === "RIFF" &&
    b.subarray(8, 12).toString("latin1") === "WEBP"
  )
    return "webp";
  if (b.length >= 6 && /^GIF8[79]a$/.test(b.subarray(0, 6).toString("latin1"))) return "gif";
  // Classic TIFF only (either byte order). BigTIFF has another version number and is not offered.
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
  if (b.length >= 8 && b.subarray(0, 8).equals(OLE_MAGIC)) return "ole";
  return null;
}

const EOCD = 0x06054b50;
const CENTRAL = 0x02014b50;
const LOCAL = 0x04034b50;
const MAX_DIRECTORY_BYTES = 4 * 1024 * 1024;
const MAX_ENTRY_BYTES = 1024 * 1024;

/** Content types a PowerPoint package may declare for ppt/presentation.xml (slide shows, templates, macro-enabled too). */
const PRESENTATION_TYPES =
  /^application\/vnd\.(openxmlformats-officedocument\.presentationml\.(presentation|slideshow|template)|ms-powerpoint\.(presentation|slideshow|template)\.macroEnabled)\.main\+xml$/;
/** The same for word/document.xml. */
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

function odfKind(mimetype: string): "odp" | "odt" | null {
  const m = mimetype.trim();
  if (m === "application/vnd.oasis.opendocument.presentation") return "odp";
  if (m === "application/vnd.oasis.opendocument.presentation-template") return "odp";
  if (m === "application/vnd.oasis.opendocument.text") return "odt";
  if (m === "application/vnd.oasis.opendocument.text-template") return "odt";
  return null;
}

/**
 * Which document a ZIP is: a PowerPoint package (`pptx`), a Word package (`docx`) or an OpenDocument
 * presentation or text file (`odp`, `odt`), or null for any other archive. Only the central directory and
 * the one or two small entries that say what it is are read, never the whole archive.
 */
export async function classifyZip(path: string): Promise<"pptx" | "docx" | "odp" | "odt" | null> {
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
    if (eocd < 0) return null;
    const entries = tail.readUInt16LE(eocd + 10);
    const directorySize = tail.readUInt32LE(eocd + 12);
    const directoryOffset = tail.readUInt32LE(eocd + 16);
    if (entries === 0xffff || directorySize === 0xffffffff || directoryOffset === 0xffffffff) {
      return null; // ZIP64: not something a deck or handout needs
    }
    if (directorySize > MAX_DIRECTORY_BYTES || directoryOffset + directorySize > size) return null;
    const directory = Buffer.alloc(directorySize);
    await handle.read(directory, 0, directorySize, directoryOffset);

    interface Entry {
      method: number;
      compressed: number;
      offset: number;
    }
    const wanted = new Map<string, Entry>();
    let hasPresentation = false;
    let hasWord = false;
    let at = 0;
    for (let n = 0; n < entries && at + 46 <= directory.length; n++) {
      if (directory.readUInt32LE(at) !== CENTRAL) return null;
      const method = directory.readUInt16LE(at + 10);
      const compressed = directory.readUInt32LE(at + 20);
      const nameLength = directory.readUInt16LE(at + 28);
      const extraLength = directory.readUInt16LE(at + 30);
      const commentLength = directory.readUInt16LE(at + 32);
      const offset = directory.readUInt32LE(at + 42);
      const name = directory.subarray(at + 46, at + 46 + nameLength).toString("utf8");
      if (name === "[Content_Types].xml" || name === "mimetype")
        wanted.set(name, { method, compressed, offset });
      if (name === "ppt/presentation.xml") hasPresentation = true;
      if (name === "word/document.xml") hasWord = true;
      at += 46 + nameLength + extraLength + commentLength;
    }

    const read = async (entry: Entry): Promise<string | null> => {
      if (entry.compressed > MAX_ENTRY_BYTES) return null;
      const local = Buffer.alloc(30);
      await handle.read(local, 0, 30, entry.offset);
      if (local.readUInt32LE(0) !== LOCAL) return null;
      const dataStart = entry.offset + 30 + local.readUInt16LE(26) + local.readUInt16LE(28);
      if (dataStart + entry.compressed > size) return null;
      const raw = Buffer.alloc(entry.compressed);
      await handle.read(raw, 0, raw.length, dataStart);
      if (entry.method === 0) return raw.toString("utf8");
      if (entry.method === 8)
        return inflateRawSync(raw, { maxOutputLength: MAX_ENTRY_BYTES }).toString("utf8");
      return null;
    };

    const contentTypes = wanted.get("[Content_Types].xml");
    if (contentTypes && (hasPresentation || hasWord)) {
      const xml = await read(contentTypes);
      if (xml !== null) {
        const deck = mainPartType(xml, "/ppt/presentation.xml");
        if (hasPresentation && deck !== null && PRESENTATION_TYPES.test(deck)) return "pptx";
        const word = mainPartType(xml, "/word/document.xml");
        if (hasWord && word !== null && WORD_TYPES.test(word)) return "docx";
      }
    }
    const mimetype = wanted.get("mimetype");
    if (mimetype) {
      const text = await read(mimetype);
      if (text !== null) return odfKind(text);
    }
    return null;
  } catch {
    return null;
  } finally {
    await handle.close();
  }
}
