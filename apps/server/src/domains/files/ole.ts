import { open } from "node:fs/promises";

/**
 * What an old-style Office file (an OLE compound file) is, read from its directory of streams, not from any
 * name. The converter has the same reader (`apps/converter/src/convert/ole.ts`); keep them in step, a test in each
 * checks both against the same fixtures.
 */
export type OleKind = "ppt" | "doc" | "encrypted" | "spreadsheet" | "other";

export interface OleInfo {
  kind: OleKind;
  /** A macro storage (VBA project) is present. Macros are never run; this only raises a warning. */
  macros: boolean;
}

const FREE = 0xffffffff;
const ENDOFCHAIN = 0xfffffffe;
/** Directory chains and FAT lists are walked to a fixed bound so a hostile file cannot make the walk long. */
const MAX_DIR_SECTORS = 2048;
const MAX_FAT_SECTORS = 4096;
const MAX_ENTRIES = 8192;

const MAGIC = Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]);

export async function readOle(path: string): Promise<OleInfo> {
  const fh = await open(path, "r");
  try {
    const size = (await fh.stat()).size;
    const header = Buffer.alloc(512);
    const { bytesRead } = await fh.read(header, 0, 512, 0);
    if (bytesRead < 512 || !header.subarray(0, 8).equals(MAGIC))
      return { kind: "other", macros: false };
    const shift = header.readUInt16LE(30);
    if (shift !== 9 && shift !== 12) return { kind: "other", macros: false };
    const sectorSize = 1 << shift;
    const at = (sector: number) => (sector + 1) * sectorSize;
    const readSector = async (sector: number): Promise<Buffer | null> => {
      if (at(sector) + sectorSize > size) return null;
      const buf = Buffer.alloc(sectorSize);
      await fh.read(buf, 0, sectorSize, at(sector));
      return buf;
    };

    // The FAT is spread over the sectors listed in the header (109) and in the DIFAT chain.
    const fatSectors: number[] = [];
    const numFat = header.readUInt32LE(44);
    for (let i = 0; i < 109 && fatSectors.length < Math.min(numFat, MAX_FAT_SECTORS); i++) {
      const id = header.readUInt32LE(76 + i * 4);
      if (id !== FREE) fatSectors.push(id);
    }
    let difat = header.readUInt32LE(68);
    for (
      let guard = 0;
      guard < header.readUInt32LE(72) &&
      difat < ENDOFCHAIN &&
      fatSectors.length < Math.min(numFat, MAX_FAT_SECTORS) &&
      guard < MAX_FAT_SECTORS;
      guard++
    ) {
      const buf = await readSector(difat);
      if (!buf) break;
      const per = sectorSize / 4 - 1;
      for (let i = 0; i < per && fatSectors.length < MAX_FAT_SECTORS; i++) {
        const id = buf.readUInt32LE(i * 4);
        if (id !== FREE) fatSectors.push(id);
      }
      difat = buf.readUInt32LE(per * 4);
    }
    const perFat = sectorSize / 4;
    const next = async (sector: number): Promise<number> => {
      const fat = fatSectors[Math.floor(sector / perFat)];
      if (fat === undefined) return ENDOFCHAIN;
      const buf = await readSector(fat);
      return buf ? buf.readUInt32LE((sector % perFat) * 4) : ENDOFCHAIN;
    };

    const names: string[] = [];
    let word: { start: number; size: number } | null = null;
    let sector = header.readUInt32LE(48);
    for (let n = 0; n < MAX_DIR_SECTORS && sector < ENDOFCHAIN; n++) {
      const buf = await readSector(sector);
      if (!buf) break;
      for (let off = 0; off + 128 <= buf.length && names.length < MAX_ENTRIES; off += 128) {
        const len = buf.readUInt16LE(off + 64);
        const objectType = buf[off + 66];
        if (objectType === 0 || len < 2 || len > 64) continue;
        const name = buf.subarray(off, off + len - 2).toString("utf16le");
        names.push(name);
        if (name === "WordDocument")
          word = { start: buf.readUInt32LE(off + 116), size: buf.readUInt32LE(off + 120) };
      }
      sector = await next(sector);
    }

    const has = (n: string) => names.includes(n);
    const macros = has("Macros") || has("_VBA_PROJECT_CUR") || has("VBA");
    if (has("EncryptedPackage")) return { kind: "encrypted", macros };
    if (word) {
      // The FIB's flags sit at offset 0x0A of the WordDocument stream; bit 0x0100 is "encrypted". Streams of
      // 4096 bytes or more start in an ordinary sector, which is the case for any real Word file.
      if (word.size >= 4096 && word.start < ENDOFCHAIN) {
        const first = await readSector(word.start);
        if (first && (first.readUInt16LE(0x0a) & 0x0100) !== 0)
          return { kind: "encrypted", macros };
      }
      return { kind: "doc", macros };
    }
    if (has("PowerPoint Document")) {
      return { kind: has("EncryptedSummary") ? "encrypted" : "ppt", macros };
    }
    if (has("Workbook") || has("Book")) return { kind: "spreadsheet", macros };
    return { kind: "other", macros };
  } finally {
    await fh.close();
  }
}
