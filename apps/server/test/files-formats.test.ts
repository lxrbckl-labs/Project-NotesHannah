import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { classifyZip, sniffHeader } from "../src/domains/files/detect.js";
import { readOle } from "../src/domains/files/ole.js";
import { fileNotes } from "../src/domains/files/queue.js";
import { harness, type Json, listDir, multipart, PNG } from "./files.support.js";

const FIXTURES = join(import.meta.dirname, "../../../fixtures/generated");
const fixture = (name: string): Buffer => readFileSync(join(FIXTURES, name));

/** [fixture, the type the server must store]. Every one is uploaded under a name that lies about it. */
const CASES = [
  ["figure.webp", "webp"],
  ["photo-exif6.webp", "webp"],
  ["figure.gif", "gif"],
  ["animated.gif", "gif"],
  ["scan-3pages.tiff", "tiff"],
  ["figure.avif", "avif"],
  ["figure.bmp", "bmp"],
  ["figure-8bit.bmp", "bmp"],
  ["handout.docx", "docx"],
  ["macro.docm", "docx"],
  ["handout.doc", "doc"],
  ["handout.odt", "odt"],
  ["lecture.ppt", "ppt"],
  ["lecture.odp", "odp"],
  ["lecture.pptx", "pptx"],
  ["macro.pptm", "pptx"],
  ["photo.heic", "heic"],
  ["photo-exif6.jpg", "jpeg"],
  ["text-layer.pdf", "pdf"],
] as const;

const CONTENT_TYPE: Record<string, string> = {
  webp: "image/webp",
  gif: "image/gif",
  tiff: "image/tiff",
  avif: "image/avif",
  bmp: "image/bmp",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  doc: "application/msword",
  odt: "application/vnd.oasis.opendocument.text",
  ppt: "application/vnd.ms-powerpoint",
  odp: "application/vnd.oasis.opendocument.presentation",
};

async function tryUpload(
  h: ReturnType<typeof harness>,
  data: Buffer | string,
  filename: string,
): Promise<{ status: number; body: Json }> {
  const m = multipart([{ name: "file", filename, type: "application/octet-stream", data }]);
  return h.send(h.alice, "POST", "/api/uploads", {
    body: m.body,
    headers: { "content-type": m.contentType },
  });
}

describe("each accepted format is detected by content", () => {
  test.each(CASES)("%s is stored as %s whatever it is called", async (name, type) => {
    const h = harness();
    const data = fixture(name);
    // A name that claims something else entirely: the bytes decide.
    const file = await h.upload(h.alice, data, "lecture-notes.txt");
    expect(file.type).toBe(type);
    expect(file.status).toBe("converting");
    expect(file.conversionNotes).toEqual([]);
    expect(h.converter.pending()).toHaveLength(1);
  });

  test("a file named .pdf that is a WebP is a webp; a text file named .webp is refused", async () => {
    const h = harness();
    const webp = await h.upload(h.alice, fixture("figure.webp"), "scan.pdf");
    expect(webp.type).toBe("webp");
    const text = await tryUpload(h, "This is just a text file with a webp extension.\n", "a.webp");
    expect(text.status).toBe(415);
    expect(text.body.error.code).toBe("unsupported_type");
    const png = await h.upload(h.alice, PNG, "scan.docx");
    expect(png.type).toBe("png");
    expect(listDir(join(h.dir, "tmp"))).toEqual([]);
  });

  test("agrees with the converter's expectations for every fixture that converts", () => {
    const { cases } = JSON.parse(readFileSync(join(FIXTURES, "../expectations.json"), "utf8")) as {
      cases: Array<{ file: string; phase: string; expect: { ok: boolean; type?: string } }>;
    };
    const checked: string[] = [];
    return (async () => {
      for (const c of cases) {
        if (c.phase !== "default" || !c.expect.ok || c.file.startsWith("@") || !c.expect.type)
          continue;
        const data = fixture(c.file);
        let type: string | null = sniffHeader(data.subarray(0, 1024));
        const path = join(FIXTURES, c.file);
        if (type === "zip") type = await classifyZip(path);
        else if (type === "ole") type = (await readOle(path)).kind;
        expect(type, c.file).toBe(c.expect.type);
        checked.push(c.file);
      }
      expect(checked.length).toBeGreaterThan(10);
    })();
  });
});

describe("what is refused, and why", () => {
  test.each([
    ["figure.svg", /not a PDF/i],
    ["other-office.xlsx", /spreadsheets/i],
    ["encrypted.docx", /password/i],
    ["plain-text.webp", /not a PDF/i],
  ])("%s is refused with a message that says what to send instead", async (name, words) => {
    const h = harness();
    const res = await tryUpload(h, fixture(name), name);
    expect(res.status).toBe(415);
    expect(res.body.error.code).toBe("unsupported_type");
    expect(res.body.error.message).toMatch(words);
    expect(res.body.error.hint).toMatch(/WebP, GIF, TIFF, AVIF or BMP/);
    expect(res.body.error.hint).toMatch(/SVG/);
    expect(listDir(join(h.dir, "tmp"))).toEqual([]);
    expect(h.converter.pending()).toEqual([]);
    expect(listDir(join(h.dir, "originals"))).toEqual([]);
  });

  test("an SVG is refused even when named .png and declared image/png", async () => {
    const h = harness();
    const m = multipart([
      {
        name: "file",
        filename: "figure.png",
        type: "image/png",
        data: fixture("figure.svg"),
      },
    ]);
    const res = await h.send(h.alice, "POST", "/api/uploads", {
      body: m.body,
      headers: { "content-type": m.contentType },
    });
    expect(res.status).toBe(415);
  });

  test("two letters or a signature alone do not make a BMP, GIF or TIFF", () => {
    expect(
      sniffHeader(Buffer.from("BM is the start of this sentence, not a bitmap at all.")),
    ).toBeNull();
    expect(sniffHeader(Buffer.from("GIF88a"))).toBeNull();
    expect(sniffHeader(Buffer.from("II+\0xxxxxxxxxxxxxx"))).toBeNull(); // BigTIFF is not offered
    expect(sniffHeader(Buffer.from("RIFF\0\0\0\0WAVEfmt "))).toBeNull(); // RIFF, but not WebP
  });

  test("AVIF wins over the generic mif1 brand it also lists", () => {
    const avif = Buffer.concat([
      Buffer.from([0, 0, 0, 28]),
      Buffer.from("ftypavif", "latin1"),
      Buffer.alloc(4),
      Buffer.from("mif1miaf", "latin1"),
      Buffer.alloc(8),
    ]);
    expect(sniffHeader(avif)).toBe("avif");
  });
});

describe("the original comes back as a download, never as something that runs", () => {
  test.each(["webp", "gif", "tiff", "avif", "bmp", "docx", "doc", "odt", "ppt", "odp"])(
    "a %s original is an attachment with its type and nosniff",
    async (type) => {
      const h = harness();
      const name = CASES.find(([, t]) => t === type)?.[0] as string;
      const file = await h.upload(h.alice, fixture(name), "x.bin");
      const res = await h.send(h.alice, "GET", `/api/files/${file.id}/original`, {});
      expect(res.status).toBe(200);
      expect(res.headers.get("content-type")).toBe(CONTENT_TYPE[type]);
      expect(res.headers.get("content-disposition")).toMatch(/^attachment;/);
      expect(res.headers.get("x-content-type-options")).toBe("nosniff");
      expect(res.raw.equals(fixture(name))).toBe(true);
    },
  );

  test("session and ownership are checked", async () => {
    const h = harness();
    const file = await h.upload(h.alice, fixture("figure.webp"), "figure.webp");
    const url = `/api/files/${file.id}/original?download=true`;
    expect((await h.send(null, "GET", url, {})).status).toBe(401);
    const other = await h.send(h.bob, "GET", url, {});
    expect([403, 404]).toContain(other.status);
    expect((await h.send(h.alice, "GET", url, {})).status).toBe(200);
  });
});

describe("file-level conversion notes", () => {
  test("only warnings about the whole file are kept, as plain sentences", async () => {
    const h = harness();
    const file = await h.upload(h.alice, fixture("animated.gif"), "animated.gif");
    const [jobId] = h.converter.pending();
    h.converter.succeed(jobId as string, {
      pages: 1,
      type: "gif",
      mutate: (r) => {
        r.warnings = [
          {
            code: "ANIMATED_FIRST_FRAME",
            message: "animated image with 3 frames; only the first frame is shown",
          },
          { code: "NO_TEXT_LAYER", message: "page 1 has no text layer", page: 1 },
          {
            code: "ANIMATED_FIRST_FRAME",
            message: "animated image with 3 frames; only the first frame is shown",
          },
        ];
      },
    });
    h.service.processQueue();
    const got = await h.call(h.alice, "GET", `/api/files/${file.id}`);
    expect(got.body.file.conversionNotes).toEqual([
      "Animated image with 3 frames; only the first frame is shown.",
    ]);
  });

  test("fileNotes drops control characters and caps the list", () => {
    const many = Array.from({ length: 30 }, (_, i) => ({ message: `note ${i}\u0007` }));
    const notes = fileNotes(many);
    expect(notes).toHaveLength(10);
    expect(notes[0]).toBe("Note 0.");
    expect(fileNotes([null, "x", { message: 5 }])).toEqual([]);
    expect(fileNotes(undefined)).toEqual([]);
  });

  test("a converter that reports another type than the upload was is refused", async () => {
    const h = harness();
    const file = await h.upload(h.alice, fixture("figure.webp"), "figure.webp");
    const [jobId] = h.converter.pending();
    h.converter.succeed(jobId as string, { pages: 1, type: "png" });
    h.service.processQueue();
    const got = await h.call(h.alice, "GET", `/api/files/${file.id}`);
    expect(got.body.file.status).not.toBe("converted");
  });
});

describe("old Office files are told apart by their directory of streams", () => {
  test.each([
    ["handout.doc", "doc"],
    ["lecture.ppt", "ppt"],
    ["encrypted.docx", "encrypted"],
  ])("%s is %s", async (name, kind) => {
    expect((await readOle(join(FIXTURES, name))).kind).toBe(kind);
  });
  test("a macro-enabled Word package is a docx, and so is its macro-free twin", async () => {
    expect(await classifyZip(join(FIXTURES, "macro.docm"))).toBe("docx");
    expect(await classifyZip(join(FIXTURES, "handout.docx"))).toBe("docx");
    expect(await classifyZip(join(FIXTURES, "other-office.xlsx"))).toBeNull();
    expect(await classifyZip(join(FIXTURES, "handout.odt"))).toBe("odt");
    expect(await classifyZip(join(FIXTURES, "lecture.odp"))).toBe("odp");
  });
});
