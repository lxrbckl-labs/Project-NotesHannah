import { open, readFile } from 'node:fs/promises';

export type DetectedType = 'pptx' | 'pdf' | 'jpeg' | 'png' | 'heic' | 'ole-encrypted-or-legacy' | 'zip-other' | 'unknown';

const HEIC_BRANDS = new Set(['heic', 'heix', 'hevc', 'hevx', 'heim', 'heis', 'hevm', 'hevs', 'mif1', 'msf1']);

/** Detect by magic bytes only. The file name and extension are never consulted. */
export async function detectType(path: string): Promise<{ type: DetectedType; head: Buffer }> {
  const fh = await open(path, 'r');
  try {
    const head = Buffer.alloc(2048);
    const { bytesRead } = await fh.read(head, 0, head.length, 0);
    const b = head.subarray(0, bytesRead);
    if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return { type: 'jpeg', head: b };
    if (b.length >= 8 && b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])))
      return { type: 'png', head: b };
    if (b.subarray(0, 1024).includes(Buffer.from('%PDF-'))) return { type: 'pdf', head: b };
    if (b.length >= 12 && b.subarray(4, 8).toString('latin1') === 'ftyp') {
      const major = b.subarray(8, 12).toString('latin1');
      let brands = [major];
      for (let o = 16; o + 4 <= Math.min(b.length, 64); o += 4) brands.push(b.subarray(o, o + 4).toString('latin1'));
      if (brands.some((x) => HEIC_BRANDS.has(x))) return { type: 'heic', head: b };
      return { type: 'unknown', head: b };
    }
    if (b.length >= 4 && b[0] === 0x50 && b[1] === 0x4b && (b[2] === 3 || b[2] === 5) && (b[3] === 4 || b[3] === 6))
      return { type: 'zip-other', head: b }; // refined by the zip scanner (pptx vs other OOXML)
    if (b.length >= 8 && b.subarray(0, 8).equals(Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1])))
      return { type: 'ole-encrypted-or-legacy', head: b };
    return { type: 'unknown', head: b };
  } finally {
    await fh.close();
  }
}

/** An OOXML file protected with a password is wrapped in an OLE container holding an EncryptedPackage stream. */
export async function oleIsEncryptedPackage(path: string): Promise<boolean> {
  // The input size cap has already been enforced, so reading the whole file is bounded.
  const buf = await readFile(path);
  return buf.includes(Buffer.from('EncryptedPackage', 'utf16le'));
}
