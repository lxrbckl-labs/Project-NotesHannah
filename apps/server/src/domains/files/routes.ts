import { createReadStream, rmSync } from "node:fs";
import { Readable } from "node:stream";
import {
  FileStatus,
  NodeId,
  RequestUploadsInput,
  SaveTranscriptInput,
  UPLOAD_LIMITS,
} from "@notes/schema";
import { Hono } from "hono";
import { z } from "zod";
import {
  type AppEnv,
  getAuth,
  requireAuth,
  requireSession,
  requireWrite,
} from "../../http/auth-context.js";
import { AppError } from "../../http/errors.js";
import { boundaryOf, parseMultipart } from "./multipart.js";
import { contentDisposition } from "./names.js";
import {
  createFilesService,
  type FilesDeps,
  type FilesService,
  type FilesServiceOptions,
  INLINE_CONTENT_TYPES,
  type StoredFile,
} from "./service.js";
import type { Received } from "./sink.js";

const Limit = z.coerce.number().int().min(1).max(200).default(50);
const Cursor = z.string().max(200).optional();
const Flag = z.enum(["true", "false"]).transform((v) => v === "true");

const ListFilesQuery = z.object({
  status: FileStatus.optional(),
  nodeId: NodeId.optional(),
  inbox: Flag.optional(),
  trashed: Flag.optional(),
  cursor: Cursor,
  limit: Limit,
});
const PageQuery = z.object({ cursor: Cursor, limit: Limit });
const SizeQuery = z.object({ size: z.enum(["page", "thumb"]).default("page") });
const ImageQuery = SizeQuery.extend({
  exp: z.coerce.number().int().optional(),
  sig: z.string().max(200).optional(),
});
const DownloadQuery = z.object({ download: Flag.optional() });
const FileBody = z.object({
  nodeId: NodeId.nullable(),
  /** An agent filing a file with untranscribed pages must say why. She is never asked. */
  force: z.boolean().optional(),
  reason: z.string().trim().min(3).max(200).optional(),
});
const TranscriptBody = SaveTranscriptInput.omit({ pageId: true }).extend({
  pageId: SaveTranscriptInput.shape.pageId.optional(),
});
const RenameBody = z.object({ originalName: z.string().trim().min(1).max(255) });
const ReviewBody = z.object({ reviewed: z.boolean().default(true) });

const EXAMPLE_NODE = "nod_01HZX3K9Q2V7M4N8P6R5T0W1YB";
const EXAMPLES = {
  tickets: { files: [{ name: "Lecture 7.pdf", bytes: 2_500_000 }], nodeId: EXAMPLE_NODE },
  file: { nodeId: EXAMPLE_NODE },
  transcript: {
    text: "Metoprolol 50 mg PO BID",
    flags: [{ kind: "dose", quote: "50 mg" }],
  },
  review: { reviewed: true },
  rename: { originalName: "Lecture 7 slides.pptx" },
  list: { status: "converted", inbox: "true", limit: 50 },
};

function parse<T extends z.ZodType>(schema: T, data: unknown, example: unknown): z.infer<T> {
  const result = schema.safeParse(data);
  if (result.success) return result.data;
  const problems = result.error.issues.map((issue) => {
    const field = issue.path.length > 0 ? issue.path.join(".") : "body";
    return `${field}: ${issue.message}`;
  });
  throw new AppError("invalid_input", problems.join("; "), {
    hint: `Fix the field${problems.length > 1 ? "s" : ""} named above and send again.`,
    example,
  });
}

async function readJson(
  c: { req: { text(): Promise<string> } },
  example: unknown,
  optional = false,
): Promise<unknown> {
  const text = await c.req.text();
  if (optional && text.trim() === "") return {};
  try {
    return JSON.parse(text);
  } catch {
    throw new AppError("invalid_input", "The request body must be JSON.", {
      hint: "Send a JSON object with the header Content-Type: application/json.",
      example,
    });
  }
}

function bodyOf(c: { req: { raw: Request } }): AsyncIterable<Uint8Array> {
  const body = c.req.raw.body;
  if (!body) return (async function* () {})();
  return body as unknown as AsyncIterable<Uint8Array>;
}

function declaredLength(header: string | undefined): number | null {
  if (header === undefined) return null;
  const n = Number(header);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

const CACHE = "private, max-age=3600, must-revalidate";

function etagMatches(header: string | undefined, etag: string): boolean {
  if (!header) return false;
  return header
    .split(",")
    .map((tag) => tag.trim().replace(/^W\//, ""))
    .some((tag) => tag === "*" || tag === etag);
}

/** `Range: bytes=…` for one range. null = no usable range (send everything); "bad" = unsatisfiable. */
function parseRange(header: string, size: number): { start: number; end: number } | "bad" | null {
  const m = /^bytes=(\d*)-(\d*)$/.exec(header.trim());
  if (!m) return null; // other units, or several ranges: ignore the header
  const [, from = "", to = ""] = m;
  if (from === "" && to === "") return null;
  let start: number;
  let end: number;
  if (from === "") {
    const suffix = Number(to);
    if (suffix === 0) return "bad";
    start = Math.max(0, size - suffix);
    end = size - 1;
  } else {
    start = Number(from);
    end = to === "" ? size - 1 : Math.min(Number(to), size - 1);
  }
  if (start >= size || start > end) return "bad";
  return { start, end };
}

function sendFile(
  c: { req: { header(name: string): string | undefined; method: string } },
  file: StoredFile,
  opts: { disposition: "inline" | "attachment"; ranges: boolean },
): Response {
  const headers = new Headers({
    "Content-Type": file.contentType,
    "Content-Disposition": contentDisposition(opts.disposition, file.filename),
    "Cache-Control": CACHE,
    ETag: file.etag,
    "Last-Modified": new Date(file.mtimeMs).toUTCString(),
    "X-Content-Type-Options": "nosniff",
  });
  if (opts.ranges) headers.set("Accept-Ranges", "bytes");
  if (etagMatches(c.req.header("if-none-match"), file.etag)) {
    return new Response(null, { status: 304, headers });
  }
  let start = 0;
  let end = file.size - 1;
  let status = 200;
  const rangeHeader = c.req.header("range");
  const ifRange = c.req.header("if-range");
  if (opts.ranges && rangeHeader && (!ifRange || ifRange === file.etag)) {
    const range = parseRange(rangeHeader, file.size);
    if (range === "bad") {
      headers.set("Content-Range", `bytes */${file.size}`);
      return new Response(null, { status: 416, headers });
    }
    if (range) {
      ({ start, end } = range);
      status = 206;
      headers.set("Content-Range", `bytes ${start}-${end}/${file.size}`);
    }
  }
  headers.set("Content-Length", String(file.size === 0 ? 0 : end - start + 1));
  if (c.req.method === "HEAD" || file.size === 0) return new Response(null, { status, headers });
  const stream = Readable.toWeb(
    createReadStream(file.path, { start, end }),
  ) as unknown as ReadableStream;
  return new Response(stream, { status, headers });
}

export function filesRoutes(
  deps: FilesDeps,
  options: FilesServiceOptions = {},
  /** The app's one files service. Default: a new one made from `deps` and `options`. */
  service?: FilesService,
): Hono<AppEnv> {
  const files: FilesService = service ?? createFilesService(deps, options);
  const app = new Hono<AppEnv>();
  const maxBytes = options.maxUploadBytes ?? UPLOAD_LIMITS.maxBytes;

  // ---- uploads ----

  app.post("/api/uploads/tickets", requireWrite, async (c) => {
    const input = parse(RequestUploadsInput, await readJson(c, EXAMPLES.tickets), EXAMPLES.tickets);
    return c.json({ items: files.requestUploads(getAuth(c), input) }, 201);
  });

  app.post("/api/uploads", requireWrite, async (c) => {
    const auth = getAuth(c);
    const boundary = boundaryOf(c.req.header("content-type"));
    const length = declaredLength(c.req.header("content-length"));
    if (length !== null && length > maxBytes + 64 * 1024) {
      throw new AppError("too_large", "The upload is larger than the limit.", {
        hint: `Files can be at most ${Math.floor(maxBytes / (1024 * 1024))} MB.`,
      });
    }
    const queryNode = c.req.query("nodeId");
    if (queryNode) files.checkPlace(auth.userId, queryNode);
    const sink = files.openSink();
    const staged: { received: Received | null } = { received: null };
    let name = "file";
    let nodeId: string | null = queryNode || null;
    try {
      await parseMultipart(bodyOf(c), boundary, {
        field(field, value) {
          if (field === "nodeId" && value.trim() !== "") nodeId = value.trim();
        },
        async fileStart(info) {
          name = info.filename;
          await sink.start();
        },
        fileData: (chunk) => sink.write(chunk),
        async fileEnd() {
          staged.received = await sink.finish();
        },
      });
    } catch (error) {
      await sink.abort();
      // A file part that finished before a later part was refused is still staged.
      if (staged.received) rmSync(staged.received.path, { force: true });
      throw error;
    }
    const received = staged.received;
    if (!received) {
      throw new AppError("invalid_input", "No file was sent.", {
        hint: 'Put the file in a multipart field named "file".',
      });
    }
    return c.json({ file: files.finishBrowserUpload(auth, received, name, nodeId) }, 201);
  });

  // The token in the path is the only credential; no session or key is read.
  app.put("/api/uploads/:token", async (c) => {
    const file = await files.uploadWithTicket(
      c.req.param("token"),
      bodyOf(c),
      declaredLength(c.req.header("content-length")),
    );
    return c.json({ file }, 201);
  });

  // ---- files ----

  app.get("/api/files", requireAuth, (c) => {
    const q = parse(ListFilesQuery, c.req.query(), EXAMPLES.list);
    return c.json(files.listFiles(getAuth(c), q));
  });

  app.get("/api/files/:id", requireAuth, (c) =>
    c.json({ file: files.getFile(getAuth(c), c.req.param("id")) }),
  );

  app.post("/api/files/:id/retry", requireWrite, (c) =>
    c.json({ file: files.retry(getAuth(c), c.req.param("id")) }),
  );

  app.post("/api/files/:id/file", requireWrite, async (c) => {
    const body = parse(FileBody, await readJson(c, EXAMPLES.file), EXAMPLES.file);
    return c.json({
      file: files.fileUnder(getAuth(c), c.req.param("id"), body.nodeId, {
        force: body.force,
        reason: body.reason,
      }),
    });
  });

  app.post("/api/files/:id/claim", requireWrite, (c) =>
    c.json({ file: files.claim(getAuth(c), c.req.param("id")) }),
  );

  app.post("/api/files/:id/release", requireWrite, (c) =>
    c.json({ file: files.release(getAuth(c), c.req.param("id")) }),
  );

  app.patch("/api/files/:id", requireWrite, async (c) => {
    const body = parse(RenameBody, await readJson(c, EXAMPLES.rename), EXAMPLES.rename);
    return c.json({ file: files.rename(getAuth(c), c.req.param("id"), body.originalName) });
  });

  app.post("/api/files/:id/trash", requireWrite, (c) =>
    c.json({ file: files.trash(getAuth(c), c.req.param("id")) }),
  );

  app.post("/api/files/:id/restore", requireWrite, (c) =>
    c.json({ file: files.restore(getAuth(c), c.req.param("id")) }),
  );

  app.delete("/api/files/:id", requireWrite, requireSession, (c) => {
    files.permanentDelete(getAuth(c), c.req.param("id"));
    return c.body(null, 204);
  });

  app.get("/api/files/:id/original", requireAuth, (c) => {
    const stored = files.originalFile(getAuth(c), c.req.param("id"));
    const q = parse(DownloadQuery, c.req.query(), { download: "true" });
    const inline = INLINE_CONTENT_TYPES.has(stored.contentType) && !q.download;
    return sendFile(c, stored, { disposition: inline ? "inline" : "attachment", ranges: true });
  });

  app.get("/api/files/:id/pages", requireAuth, (c) =>
    c.json({ items: files.listPages(getAuth(c), c.req.param("id")) }),
  );

  // ---- pages ----

  app.get("/api/pages/:id", requireAuth, (c) =>
    c.json({ page: files.getPage(getAuth(c), c.req.param("id")) }),
  );

  // A valid signature (exp + sig) stands in for sign-in, for one page, one size, five minutes.
  app.get("/api/pages/:id/image", (c) => {
    const q = parse(ImageQuery, c.req.query(), { size: "page" });
    const id = c.req.param("id");
    let stored: StoredFile;
    if (q.sig !== undefined || q.exp !== undefined) {
      if (q.sig === undefined || q.exp === undefined) {
        throw new AppError("invalid_input", "A signed link needs both exp and sig.", {
          hint: "Use the url from GET /api/pages/:id/image-url unchanged.",
        });
      }
      stored = files.pageImageSigned(id, q.size, q.exp, q.sig);
    } else {
      stored = files.pageImage(getAuth(c), id, q.size);
    }
    return sendFile(c, stored, { disposition: "inline", ranges: false });
  });

  app.get("/api/pages/:id/image-url", requireAuth, (c) => {
    const q = parse(SizeQuery, c.req.query(), { size: "page" });
    return c.json(files.signedImageUrl(getAuth(c), c.req.param("id"), q.size));
  });

  app.get("/api/pages/:id/transcript", requireAuth, (c) =>
    c.json({ transcript: files.getTranscript(getAuth(c), c.req.param("id")) }),
  );

  app.put("/api/pages/:id/transcript", requireWrite, async (c) => {
    const body = parse(TranscriptBody, await readJson(c, EXAMPLES.transcript), EXAMPLES.transcript);
    const pageId = c.req.param("id");
    if (body.pageId !== undefined && body.pageId !== pageId) {
      throw new AppError(
        "invalid_input",
        "pageId in the body does not match the page in the URL.",
        {
          hint: "Leave pageId out of the body, or make it the same as the URL.",
          example: EXAMPLES.transcript,
        },
      );
    }
    const transcript = files.saveTranscript(getAuth(c), {
      pageId,
      text: body.text,
      flags: body.flags,
    });
    return c.json({ transcript }, 201);
  });

  app.post("/api/pages/:id/transcript/review", requireWrite, requireSession, async (c) => {
    const body = parse(ReviewBody, await readJson(c, EXAMPLES.review, true), EXAMPLES.review);
    return c.json({
      transcript: files.setReview(getAuth(c), c.req.param("id"), body.reviewed),
    });
  });

  app.get("/api/pages/:id/transcript/revisions", requireAuth, (c) => {
    const q = parse(PageQuery, c.req.query(), { limit: 50 });
    return c.json(files.listRevisions(getAuth(c), c.req.param("id"), q));
  });

  app.post("/api/pages/:id/transcript/revisions/:revision/restore", requireWrite, (c) => {
    const revision = Number(c.req.param("revision"));
    if (!Number.isInteger(revision) || revision < 1) {
      throw new AppError("invalid_input", "The revision must be a whole number from 1.", {
        example: { path: "/api/pages/pag_…/transcript/revisions/2/restore" },
      });
    }
    return c.json(
      { transcript: files.restoreRevision(getAuth(c), c.req.param("id"), revision) },
      201,
    );
  });

  // ---- converter ----

  app.get("/api/converter/status", requireAuth, (c) =>
    c.json({ converter: files.converterStatus() }),
  );

  return app;
}
