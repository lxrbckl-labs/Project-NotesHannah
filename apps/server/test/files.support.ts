import {
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  renameSync,
  utimesSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { crc32, deflateRawSync } from "node:zlib";
import { type Actor, newId } from "@notes/schema";
import { Hono } from "hono";
import { expect } from "vitest";
import { createTestDatabase, type Db } from "../src/db/client.js";
import {
  createFilesService,
  type FilesService,
  type FilesServiceOptions,
  filesRoutes,
} from "../src/domains/files/index.js";
import { createLibraryService } from "../src/domains/library/index.js";
import type { AppEnv } from "../src/http/auth-context.js";
import { handleError } from "../src/http/errors.js";
import { initStorage, type Storage } from "../src/storage/storage.js";
import { Clock } from "./helpers.js";

// biome-ignore lint/suspicious/noExplicitAny: response bodies are inspected loosely in tests
export type Json = any;

// ---- sample files -----------------------------------------------------------

export const PDF = Buffer.from(
  "%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n" +
    "3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 72 72]>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF\n",
);
export const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==",
  "base64",
);
export const JPEG = Buffer.from(
  "/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAAMCAgICAgMCAgIDAwMDBAYEBAQEBAgGBgUGCQgKCgkICQkKDA8MCgsOCwkJDRENDg8QEBEQCgwSExIQEw8QEBD/yQALCAABAAEBAREA/8wABgAQEAX/2gAIAQEAAD8A0s8g/9k=",
  "base64",
);
export const HEIC = Buffer.concat([
  Buffer.from([0, 0, 0, 24]),
  Buffer.from("ftypheic", "latin1"),
  Buffer.alloc(4),
  Buffer.from("mif1heic", "latin1"),
  Buffer.alloc(64, 7),
]);
export const WEBP = Buffer.from("UklGRhoAAABXRUJQVlA4TA0AAAAvAAAAEAcQERGIiP4HAA==", "base64");

/** A minimal ZIP. `deflate` entries are compressed; the rest are stored. */
export function zip(entries: Record<string, string>, deflate: string[] = []): Buffer {
  const locals: Buffer[] = [];
  const central: Buffer[] = [];
  let offset = 0;
  for (const [name, text] of Object.entries(entries)) {
    const data = Buffer.from(text);
    const packed = deflate.includes(name) ? deflateRawSync(data) : data;
    const method = deflate.includes(name) ? 8 : 0;
    const nameBuf = Buffer.from(name);
    const crc = crc32(data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(method, 8);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(packed.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(nameBuf.length, 26);
    locals.push(local, nameBuf, packed);
    const entry = Buffer.alloc(46);
    entry.writeUInt32LE(0x02014b50, 0);
    entry.writeUInt16LE(20, 4);
    entry.writeUInt16LE(20, 6);
    entry.writeUInt16LE(method, 10);
    entry.writeUInt32LE(crc, 16);
    entry.writeUInt32LE(packed.length, 20);
    entry.writeUInt32LE(data.length, 24);
    entry.writeUInt16LE(nameBuf.length, 28);
    entry.writeUInt32LE(offset, 42);
    central.push(entry, nameBuf);
    offset += 30 + nameBuf.length + packed.length;
  }
  const directory = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(Object.keys(entries).length, 8);
  end.writeUInt16LE(Object.keys(entries).length, 10);
  end.writeUInt32LE(directory.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, directory, end]);
}

export const PPTX = zip(
  {
    "[Content_Types].xml":
      '<?xml version="1.0"?><Types><Override PartName="/ppt/presentation.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml"/></Types>',
    "ppt/presentation.xml": "<p:presentation/>",
  },
  ["[Content_Types].xml"],
);
export const DOCX = zip({
  "[Content_Types].xml":
    '<Types><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>',
  "word/document.xml": "<w:document/>",
});

/** Distinct bytes of a given kind, so two uploads differ in content. */
export function variant(base: Buffer, tag: string): Buffer {
  return Buffer.concat([base, Buffer.from(`\n% ${tag}\n`)]);
}

export function multipart(
  parts: Array<{ name: string; filename?: string; type?: string; data: Buffer | string }>,
): { body: Buffer; contentType: string } {
  const boundary = `----test${Math.random().toString(16).slice(2)}`;
  const chunks: Buffer[] = [];
  for (const part of parts) {
    let head = `--${boundary}\r\nContent-Disposition: form-data; name="${part.name}"`;
    if (part.filename !== undefined) head += `; filename="${part.filename}"`;
    head += "\r\n";
    if (part.type) head += `Content-Type: ${part.type}\r\n`;
    chunks.push(Buffer.from(`${head}\r\n`), Buffer.from(part.data), Buffer.from("\r\n"));
  }
  chunks.push(Buffer.from(`--${boundary}--\r\n`));
  return { body: Buffer.concat(chunks), contentType: `multipart/form-data; boundary=${boundary}` };
}

// ---- storage and converter ----------------------------------------------------

export function tempStorage(): { dir: string; storage: Storage } {
  const dir = mkdtempSync(join(tmpdir(), "notes-files-"));
  return { dir, storage: initStorage(dir).storage };
}

export function listDir(path: string): string[] {
  try {
    return readdirSync(path).sort();
  } catch {
    return [];
  }
}

/** Plays the converter's side of the file protocol. */
export class FakeConverter {
  constructor(private readonly root: string) {}

  private q(state: string, name = ""): string {
    return join(this.root, "queue", state, name);
  }

  pending(): string[] {
    return listDir(this.q("pending"))
      .filter((n) => n.endsWith(".json"))
      .map((n) => n.slice(0, -5));
  }

  job(jobId: string): {
    jobId: string;
    userId: string;
    fileId: string;
    sha256: string;
    attempt: number;
  } {
    for (const state of ["pending", "processing"]) {
      try {
        return JSON.parse(readFileSync(this.q(state, `${jobId}.json`), "utf8"));
      } catch {
        // try the next directory
      }
    }
    throw new Error(`no job file for ${jobId}`);
  }

  pickUp(jobId: string): void {
    renameSync(this.q("pending", `${jobId}.json`), this.q("processing", `${jobId}.json`));
  }

  /** Write page images and the done file, as the real converter does. */
  succeed(
    jobId: string,
    opts: { pages?: number; type?: string; mutate?: (result: Json) => void; images?: boolean } = {},
  ): Json {
    const job = this.job(jobId);
    const count = opts.pages ?? 2;
    if (this.pending().includes(jobId)) this.pickUp(jobId);
    const base = join(this.root, "pages", job.userId, job.fileId);
    if (opts.images !== false) {
      mkdirSync(join(base, "thumbs"), { recursive: true });
      for (let i = 1; i <= count; i++) {
        const name = `${String(i).padStart(4, "0")}.webp`;
        writeFileSync(join(base, name), WEBP);
        writeFileSync(join(base, "thumbs", name), WEBP);
      }
    }
    const result: Json = {
      jobId,
      fileId: job.fileId,
      ok: true,
      type: opts.type ?? "pdf",
      pageCount: count,
      pages: Array.from({ length: count }, (_, i) => ({
        index: i + 1,
        width: 800,
        height: 600,
        bytes: WEBP.length,
        hasTextLayer: i % 2 === 0,
        nativeText: i % 2 === 0 ? `Slide ${i + 1} text` : null,
        speakerNotes: null,
      })),
      toolVersions: { test: "1" },
      timings: { totalMs: 5 },
      warnings: [],
    };
    opts.mutate?.(result);
    this.writeResult("done", jobId, JSON.stringify(result));
    return result;
  }

  fail(jobId: string, errorCode: string, message = "nope"): void {
    const job = this.job(jobId);
    if (this.pending().includes(jobId)) this.pickUp(jobId);
    this.writeResult(
      "failed",
      jobId,
      JSON.stringify({ jobId, fileId: job.fileId, ok: false, errorCode, message }),
    );
  }

  /** Write a result file with arbitrary text, atomically. */
  writeResult(state: "done" | "failed", name: string, text: string): void {
    const tmp = this.q(state, `${name}.tmp`);
    writeFileSync(tmp, text);
    renameSync(tmp, this.q(state, `${name}.json`));
  }

  heartbeat(atMs: number, body: Json = { converter: "fake", version: 1 }): void {
    const path = this.q("", "heartbeat").replace(/\/$/, "");
    writeFileSync(path, JSON.stringify(body));
    utimesSync(path, atMs / 1000, atMs / 1000);
  }
}

// ---- an app with a header-driven fake sign-in --------------------------------

export interface Caller {
  user: string | null;
  via?: "session" | "key";
  scope?: "read" | "write";
  key?: string;
}

export interface Harness {
  db: Db;
  clock: Clock;
  storage: Storage;
  dir: string;
  app: Hono<AppEnv>;
  service: FilesService;
  converter: FakeConverter;
  library: ReturnType<typeof createLibraryService>;
  alice: string;
  bob: string;
  call(
    who: Caller | string | null,
    method: string,
    path: string,
    body?: unknown,
  ): Promise<{ status: number; body: Json; headers: Headers }>;
  send(
    who: Caller | string | null,
    method: string,
    path: string,
    init: { body?: RequestInit["body"]; headers?: Record<string, string> },
  ): Promise<{ status: number; body: Json; headers: Headers; raw: Buffer }>;
  /** Upload a buffer through the browser route and return the file. */
  upload(
    who: string,
    data: Buffer,
    name?: string,
    extra?: Array<{ name: string; data: string }>,
  ): Promise<Json>;
  /** Make a converted file: upload, play the converter, ingest. */
  converted(
    who: string,
    data?: Buffer,
    pages?: number,
    name?: string,
  ): Promise<{ file: Json; pages: Json[] }>;
  lecture(userId: string, name?: string): string;
  agent(user: string, key?: string): Caller;
}

export function harness(options: FilesServiceOptions = {}): Harness {
  const db = createTestDatabase();
  const clock = new Clock();
  const { dir, storage } = tempStorage();
  const config = { DATA_DIR: dir, APP_ORIGIN: "http://localhost:5173" };
  const opts: FilesServiceOptions = {
    storage,
    signingSecret: "test-signing-secret",
    partialGraceMs: 0,
    log: () => {},
    ...options,
  };
  const deps = { config, db, now: clock.now };
  const app = new Hono<AppEnv>();
  app.use("*", async (c, next) => {
    const user = c.req.header("x-user");
    const via = c.req.header("x-via") ?? "session";
    const key = c.req.header("x-key") ?? newId("apiKey");
    const actor: Actor =
      via === "session"
        ? { type: "user", userId: user ?? "" }
        : { type: "agent", keyId: key, label: "Test agent" };
    c.set(
      "auth",
      (user
        ? { userId: user, actor, via, scope: c.req.header("x-scope") ?? "write" }
        : null) as never,
    );
    await next();
  });
  app.route("/", filesRoutes(deps, opts));
  app.onError(handleError);
  const service = createFilesService(deps, opts);
  const converter = new FakeConverter(storage.root);
  const library = createLibraryService(db);
  const alice = newId("user");
  const bob = newId("user");

  const headersFor = (who: Caller | string | null): Record<string, string> => {
    const caller: Caller = typeof who === "string" || who === null ? { user: who } : who;
    const headers: Record<string, string> = {};
    if (caller.user) headers["x-user"] = caller.user;
    if (caller.via) headers["x-via"] = caller.via;
    if (caller.scope) headers["x-scope"] = caller.scope;
    if (caller.key) headers["x-key"] = caller.key;
    return headers;
  };

  const h: Harness = {
    db,
    clock,
    storage,
    dir,
    app,
    service,
    converter,
    library,
    alice,
    bob,
    async send(who, method, path, init) {
      const headers = { ...headersFor(who), ...init.headers };
      const req: RequestInit & { duplex?: string } = { method, headers };
      if (init.body != null) {
        req.body = init.body;
        req.duplex = "half";
      }
      const res = await app.request(path, req);
      const raw = Buffer.from(await res.arrayBuffer());
      let body: Json = raw.toString("utf8");
      try {
        body = body ? JSON.parse(body) : null;
      } catch {
        // keep text
      }
      return { status: res.status, body, headers: res.headers, raw };
    },
    async call(who, method, path, body) {
      const headers: Record<string, string> = {};
      if (body !== undefined) headers["content-type"] = "application/json";
      const res = await h.send(who, method, path, {
        headers,
        ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
      });
      return { status: res.status, body: res.body, headers: res.headers };
    },
    async upload(who, data, name = "notes.pdf", extra = []) {
      const m = multipart([
        ...extra,
        { name: "file", filename: name, type: "application/octet-stream", data },
      ]);
      const res = await h.send(who, "POST", "/api/uploads", {
        body: m.body,
        headers: { "content-type": m.contentType },
      });
      expect(res.status, JSON.stringify(res.body)).toBe(201);
      return res.body.file;
    },
    async converted(
      who,
      data = variant(PDF, `c${Math.random()}`),
      pages = 2,
      name = "lecture.pdf",
    ) {
      const file = await h.upload(who, data, name);
      const [jobId] = h.converter.pending();
      if (!jobId) throw new Error("no job queued");
      h.converter.succeed(jobId, { pages, type: file.type });
      service.processQueue();
      const got = await h.call(who, "GET", `/api/files/${file.id}`);
      const list = await h.call(who, "GET", `/api/files/${file.id}/pages`);
      return { file: got.body.file, pages: list.body.items };
    },
    lecture(userId, name = "Lecture 1") {
      const term = library.create(userId, { parentId: null, kind: "term", name: "Fall 2026" });
      const course = library.create(userId, { parentId: term.id, kind: "course", name: "Pharm" });
      const sources = library
        .list(userId, { parentId: course.id })
        .items.find((n) => n.section === "lectures");
      if (!sources) throw new Error("no lectures section");
      return library.create(userId, { parentId: sources.id, kind: "lecture", name }).id;
    },
    agent(user, key) {
      return { user, via: "key", scope: "write", ...(key ? { key } : {}) };
    },
  };
  return h;
}
