import { spawnSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, describe, expect, test } from "vitest";
import { type Limits, loadLimits } from "../src/config.js";
import { isWordContentTypes, odfKind, sniff } from "../src/convert/detect.js";
import { bmpDimensions } from "../src/convert/image.js";
import { readOle } from "../src/convert/ole.js";
import { runPipeline } from "../src/convert/pipeline.js";
import { ConvertError } from "../src/errors.js";

/**
 * The image formats, run through the real pipeline with the host's sharp. The office formats and BMP need
 * LibreOffice and netpbm, which only the container image has: `apps/converter/scripts/integration.sh` runs
 * every fixture (these and the office ones) inside the real image, and is the proof for those.
 */
const FIXTURES = path.join(import.meta.dirname, "../../../fixtures/generated");
const scratchRoot = await mkdtemp(path.join(tmpdir(), "notes-formats-"));
afterAll(() => rm(scratchRoot, { recursive: true, force: true }));

let counter = 0;
async function convert(input: string, limits: Partial<Limits> = {}) {
  const base = path.join(scratchRoot, String(counter++));
  await mkdir(path.join(base, "scratch"), { recursive: true });
  return runPipeline({
    input,
    outDir: path.join(base, "out"),
    scratch: path.join(base, "scratch"),
    limits: { ...loadLimits({}), ...limits },
  });
}
const fx = (name: string) => path.join(FIXTURES, name);

async function failure(input: string, limits: Partial<Limits> = {}): Promise<ConvertError> {
  try {
    await convert(input, limits);
  } catch (e) {
    if (e instanceof ConvertError) return e;
    throw e;
  }
  throw new Error("expected the conversion to be refused");
}

async function made(name: string, bytes: Buffer): Promise<string> {
  const file = path.join(scratchRoot, name);
  await writeFile(file, bytes);
  return file;
}

describe("sniffing the new image types", () => {
  const brand = (major: string, ...compat: string[]) =>
    Buffer.concat([
      Buffer.from([0, 0, 0, 16 + compat.length * 4]),
      Buffer.from(`ftyp${major}`, "latin1"),
      Buffer.alloc(4),
      ...compat.map((c) => Buffer.from(c, "latin1")),
      Buffer.alloc(16),
    ]);
  const bmp = (dib: number) => {
    const b = Buffer.alloc(64);
    b.write("BM");
    b.writeUInt32LE(dib, 14);
    return b;
  };
  test.each([
    ["webp", Buffer.concat([Buffer.from("RIFF"), Buffer.alloc(4), Buffer.from("WEBPVP8 ")])],
    ["gif", Buffer.from("GIF87a\x01\0\x01\0\0\0\0")],
    ["gif", Buffer.from("GIF89a\x01\0\x01\0\0\0\0")],
    ["tiff", Buffer.from([0x49, 0x49, 0x2a, 0, 8, 0, 0, 0])],
    ["tiff", Buffer.from([0x4d, 0x4d, 0, 0x2a, 0, 0, 0, 8])],
    ["avif", brand("avif", "mif1", "miaf")],
    ["avif", brand("avis", "avif")],
    ["avif", brand("mif1", "avif", "miaf")],
    ["heic", brand("heic", "mif1")],
    ["bmp", bmp(40)],
    ["bmp", bmp(12)],
    ["bmp", bmp(124)],
    // look-alikes that are not what they seem
    ["unknown", Buffer.concat([Buffer.from("RIFF"), Buffer.alloc(4), Buffer.from("WAVEfmt ")])],
    ["unknown", Buffer.from("GIF88a\x01\0\x01\0\0\0\0")],
    ["unknown", Buffer.from([0x49, 0x49, 0x2b, 0, 8, 0, 0, 0])], // BigTIFF
    ["unknown", bmp(7)],
    ["unknown", Buffer.from("BM is how this sentence starts, it is not a bitmap")],
    [
      "unknown",
      Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>'),
    ],
  ] as const)("%s", (want, bytes) => {
    expect(sniff(bytes)).toBe(want);
  });

  test("every generated image fixture is recognised from its own bytes", async () => {
    for (const [name, want] of [
      ["figure.webp", "webp"],
      ["figure.gif", "gif"],
      ["animated.gif", "gif"],
      ["scan-3pages.tiff", "tiff"],
      ["figure.avif", "avif"],
      ["figure.bmp", "bmp"],
      ["figure-8bit.bmp", "bmp"],
      ["handout.docx", "zip"],
      ["handout.doc", "ole"],
      ["figure.svg", "unknown"],
      ["plain-text.webp", "unknown"],
    ] as const) {
      expect(sniff((await readFile(fx(name))).subarray(0, 2048)), name).toBe(want);
    }
  });
});

describe("telling the office formats apart", () => {
  test("Word content types, macro-enabled ones included", () => {
    const ct = (type: string) =>
      `<Types><Override PartName="/word/document.xml" ContentType="${type}"/></Types>`;
    const base = "application/vnd.openxmlformats-officedocument.wordprocessingml";
    expect(isWordContentTypes(ct(`${base}.document.main+xml`))).toEqual({
      ok: true,
      macroEnabled: false,
    });
    expect(isWordContentTypes(ct(`${base}.template.main+xml`))).toEqual({
      ok: true,
      macroEnabled: false,
    });
    expect(
      isWordContentTypes(ct("application/vnd.ms-word.document.macroEnabled.main+xml")),
    ).toEqual({ ok: true, macroEnabled: true });
    expect(
      isWordContentTypes(ct("application/vnd.ms-word.template.macroEnabled.main+xml")),
    ).toEqual({ ok: true, macroEnabled: true });
    expect(isWordContentTypes(ct("text/plain")).ok).toBe(false);
    expect(isWordContentTypes("<Types/>").ok).toBe(false);
  });

  test("OpenDocument by its mimetype entry", () => {
    expect(odfKind("application/vnd.oasis.opendocument.presentation")).toBe("odp");
    expect(odfKind("application/vnd.oasis.opendocument.text")).toBe("odt");
    expect(odfKind("application/vnd.oasis.opendocument.text-template\n")).toBe("odt");
    expect(odfKind("application/vnd.oasis.opendocument.spreadsheet")).toBeNull();
    expect(odfKind("")).toBeNull();
  });

  test("an old binary file by the streams in its directory, not by any name", async () => {
    expect(await readOle(fx("handout.doc"))).toEqual({ kind: "doc", macros: false });
    expect(await readOle(fx("lecture.ppt"))).toEqual({ kind: "ppt", macros: false });
    expect((await readOle(fx("encrypted.docx"))).kind).toBe("encrypted");
    // the magic number and nothing else
    const bare = await made(
      "bare.ole",
      Buffer.concat([
        Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]),
        Buffer.alloc(2000),
      ]),
    );
    expect((await readOle(bare)).kind).toBe("other");
    expect((await readOle(await made("short.ole", Buffer.from("tiny")))).kind).toBe("other");
  });
});

describe("converting the new image types", () => {
  test("WebP becomes one page", async () => {
    const r = await convert(fx("figure.webp"));
    expect(r.type).toBe("webp");
    expect(r.pages).toHaveLength(1);
    expect(r.pages[0]).toMatchObject({ width: 1200, height: 800, hasTextLayer: false });
    expect(r.warnings).toEqual([]);
  });

  test("a sideways WebP is turned upright", async () => {
    const r = await convert(fx("photo-exif6.webp"));
    expect(r.pages[0]?.height).toBeGreaterThan(r.pages[0]?.width ?? 0);
    expect(r.warnings.map((w) => w.code)).toContain("EXIF_ORIENTATION_APPLIED");
  });

  test("GIF becomes one page, and an animated one says only its first frame was kept", async () => {
    const still = await convert(fx("figure.gif"));
    expect(still.type).toBe("gif");
    expect(still.pages).toHaveLength(1);
    expect(still.warnings).toEqual([]);
    const moving = await convert(fx("animated.gif"));
    expect(moving.pages).toHaveLength(1);
    expect(moving.warnings.map((w) => w.code)).toEqual(["ANIMATED_FIRST_FRAME"]);
    expect(moving.warnings[0]?.message).toMatch(/3 frames; only the first frame/);
  });

  test("every page of a multi-page TIFF becomes a page", async () => {
    const r = await convert(fx("scan-3pages.tiff"));
    expect(r.type).toBe("tiff");
    expect(r.pages.map((p) => p.index)).toEqual([1, 2, 3]);
    expect(r.pages.every((p) => p.width === 1200 && p.height === 800)).toBe(true);
    expect(r.warnings).toEqual([]);
  });

  test("AVIF becomes one page", async () => {
    const r = await convert(fx("figure.avif"));
    expect(r.type).toBe("avif");
    expect(r.pages).toHaveLength(1);
    expect(r.pages[0]).toMatchObject({ width: 1200, height: 800 });
  });
});

describe("the safety limits hold for every new decoder", () => {
  // A real file with the pixel limit set below its size: refused from the header, before any decoding.
  test.each(["figure.webp", "figure.gif", "figure.avif", "scan-3pages.tiff", "animated.gif"])(
    "%s over the pixel limit is refused as a pixel bomb",
    async (name) => {
      const e = await failure(fx(name), { maxPixelsPerImage: 100_000 });
      expect(e.code).toBe("too_large");
      expect(e.reason).toBe("pixel_bomb");
    },
  );

  // Files that declare a huge picture but carry no pixels at all. A decoder that started to decode them would
  // fail as damaged (or run out of memory); refusing them as a pixel bomb proves the size was read first.
  test("a BMP header declaring 20000 x 20000 is refused before either tool runs", async () => {
    const b = Buffer.alloc(54);
    b.write("BM");
    b.writeUInt32LE(54, 2);
    b.writeUInt32LE(54, 10);
    b.writeUInt32LE(40, 14);
    b.writeInt32LE(20_000, 18);
    b.writeInt32LE(-20_000, 22); // top-down rows
    b.writeUInt16LE(1, 26);
    b.writeUInt16LE(24, 28);
    expect(bmpDimensions(b)).toEqual({ width: 20_000, height: 20_000 });
    const e = await failure(await made("huge.bmp", b));
    expect(e).toMatchObject({ code: "too_large", reason: "pixel_bomb" });
  });

  test("a TIFF header declaring 20000 x 20000 is refused without any pixel data", async () => {
    const entries: Array<[number, number, number]> = [
      [256, 4, 20_000], // ImageWidth
      [257, 4, 20_000], // ImageLength
      [258, 3, 8], // BitsPerSample
      [259, 3, 1], // Compression: none
      [262, 3, 1], // Photometric: black is zero
      [273, 4, 200], // StripOffsets
      [277, 3, 1], // SamplesPerPixel
      [278, 4, 20_000], // RowsPerStrip
      [279, 4, 400_000_000], // StripByteCounts
    ];
    const b = Buffer.alloc(8 + 2 + entries.length * 12 + 4);
    b.write("II");
    b.writeUInt16LE(42, 2);
    b.writeUInt32LE(8, 4);
    b.writeUInt16LE(entries.length, 8);
    entries.forEach(([tag, type, value], i) => {
      const at = 10 + i * 12;
      b.writeUInt16LE(tag, at);
      b.writeUInt16LE(type, at + 2);
      b.writeUInt32LE(1, at + 4);
      b.writeUInt32LE(value, at + 8);
    });
    const e = await failure(await made("huge.tiff", b));
    expect(e).toMatchObject({ code: "too_large", reason: "pixel_bomb" });
  });

  test("a GIF declaring 60000 x 60000 is refused without any frame data", async () => {
    const b = Buffer.alloc(13 + 10 + 4);
    b.write("GIF89a");
    b.writeUInt16LE(60_000, 6);
    b.writeUInt16LE(60_000, 8);
    b[13] = 0x2c; // image descriptor
    b.writeUInt16LE(60_000, 13 + 5);
    b.writeUInt16LE(60_000, 13 + 7);
    b[13 + 10] = 2; // LZW minimum code size
    b[13 + 11] = 0; // empty data
    b[13 + 12] = 0x3b; // trailer
    const e = await failure(await made("huge.gif", b));
    expect(e).toMatchObject({ code: "too_large", reason: "pixel_bomb" });
  });

  test("the pages of a TIFF together are held to the total pixel limit", async () => {
    // three pages of 960 000 pixels each: one page passes, the three together do not
    const e = await failure(fx("scan-3pages.tiff"), { maxTotalPixels: 2_000_000 });
    expect(e).toMatchObject({ code: "too_large", reason: "pixel_bomb" });
    expect(e.message).toMatch(/together/);
  });

  test("a TIFF with more pages than the limit is refused before any page is decoded", async () => {
    const e = await failure(fx("scan-3pages.tiff"), { maxPages: 2 });
    expect(e.code).toBe("too_many_pages");
  });

  test("the file size limit applies to the new types too", async () => {
    const e = await failure(fx("figure.webp"), { maxInputBytes: 1000 });
    expect(e).toMatchObject({ code: "too_large", reason: "file_too_large" });
  });

  test("a damaged WebP or TIFF is reported as damaged, not crashed on", async () => {
    expect((await failure(fx("truncated.webp"))).code).toBe("corrupt_file");
    expect((await failure(fx("truncated.tiff"))).code).toBe("corrupt_file");
  });

  test("text called .webp and an SVG with a script are unsupported, whatever their names", async () => {
    expect(await failure(fx("plain-text.webp"))).toMatchObject({ code: "unsupported_type" });
    expect(await failure(fx("figure.svg"))).toMatchObject({ code: "unsupported_type" });
  });
});

describe("a BMP, when netpbm is here to read it", () => {
  const hasNetpbm = spawnSync("bmptopnm", ["--version"]).error === undefined;
  test.skipIf(!hasNetpbm)("both fixtures convert", async () => {
    for (const name of ["figure.bmp", "figure-8bit.bmp"]) {
      const r = await convert(fx(name));
      expect(r.type).toBe("bmp");
      expect(r.pages[0]).toMatchObject({ width: 1200, height: 800 });
    }
  });
});
