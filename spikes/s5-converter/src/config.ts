const MiB = 1024 * 1024;

function num(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw === "") return fallback;
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) throw new Error(`bad env ${name}=${raw}`);
  return n;
}

/** All limits can be overridden by environment (the sandbox wrapper passes them through). */
export const limits = {
  maxInputBytes: num("MAX_INPUT_BYTES", 100 * MiB),
  maxPages: num("MAX_PAGES", 300),
  maxZipUncompressedBytes: num("MAX_ZIP_UNCOMPRESSED_BYTES", 400 * MiB),
  maxZipEntries: num("MAX_ZIP_ENTRIES", 10_000),
  maxXmlEntryBytes: num("MAX_XML_ENTRY_BYTES", 32 * MiB),
  maxPixelsPerImage: num("MAX_PIXELS", 120_000_000),
  wallClockMs: num("WALL_CLOCK_MS", 150_000),
  pageLongEdge: num("PAGE_LONG_EDGE", 1568),
  thumbLongEdge: num("THUMB_LONG_EDGE", 320),
  webpQuality: num("WEBP_QUALITY", 80),
  renderConcurrency: num("RENDER_CONCURRENCY", 2),
};

export type Limits = typeof limits;
