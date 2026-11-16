import { createHash, type Hash } from "node:crypto";
import { type FileHandle, open, unlink } from "node:fs/promises";
import { type FileType, newId } from "@notes/schema";
import { AppError } from "../../http/errors.js";
import { ensureDir, resolveInside, type Storage, tmpDir } from "../../storage/storage.js";
import { classifyZip, SNIFF_BYTES, sniffHeader } from "./detect.js";
import { readOle } from "./ole.js";

export interface Received {
  /** Staged file under tmp/; the caller moves it into place or removes it. */
  path: string;
  sha256: string;
  bytes: number;
  type: FileType;
}

/** What may be uploaded, in words (also the first line of every refusal's hint). */
export const SUPPORTED_TYPES_WORDS =
  "PDF, PowerPoint (.pptx, .ppt), Word (.docx, .doc), OpenDocument (.odp, .odt), JPEG, PNG, HEIC, WebP, GIF, TIFF, AVIF or BMP";

export const SUPPORTED_TYPES_HINT = `Send a ${SUPPORTED_TYPES_WORDS} file. The type is read from the file's content, not its name. Export anything else (a spreadsheet, an SVG) as a PDF.`;

const NOT_SUPPORTED = `This file is not a ${SUPPORTED_TYPES_WORDS}.`;

export function unsupported(detail: string): AppError {
  return new AppError("unsupported_type", detail, { hint: SUPPORTED_TYPES_HINT });
}

export function tooLarge(maxBytes: number): AppError {
  const mb = Math.floor(maxBytes / (1024 * 1024));
  return new AppError("too_large", `The file is larger than the limit of ${maxBytes} bytes.`, {
    hint: `Files can be at most ${mb > 0 ? `${mb} MB` : `${maxBytes} bytes`}. Split or compress it and upload again.`,
  });
}

/**
 * Receives one upload into `tmp/` on the data volume: counts and hashes the
 * bytes as they arrive, refuses early when the first bytes are not a
 * supported type or the size cap is passed, and removes its staging file on
 * any failure. Nothing is ever held in memory beyond the current chunk.
 */
export class UploadSink {
  private handle: FileHandle | null = null;
  private hash: Hash = createHash("sha256");
  private count = 0;
  private head = Buffer.alloc(0);
  private sniffed: FileType | "zip" | "ole" | null = null;
  private path = "";
  private closed = false;

  constructor(
    private readonly storage: Storage,
    private readonly maxBytes: number,
  ) {}

  async start(): Promise<void> {
    const dir = ensureDir(this.storage, tmpDir(this.storage));
    this.path = resolveInside(dir, `${newId("upload")}.part`);
    this.handle = await open(this.path, "wx", 0o600);
  }

  async write(chunk: Uint8Array): Promise<void> {
    if (!this.handle) throw new Error("sink not started");
    this.count += chunk.length;
    if (this.count > this.maxBytes) throw tooLarge(this.maxBytes);
    if (this.sniffed === null && this.head.length < SNIFF_BYTES) {
      this.head = Buffer.concat([
        this.head,
        Buffer.from(chunk.subarray(0, SNIFF_BYTES - this.head.length)),
      ]);
      this.sniffed = sniffHeader(this.head);
      if (this.sniffed === null && this.head.length >= SNIFF_BYTES) {
        throw unsupported(NOT_SUPPORTED);
      }
    }
    this.hash.update(chunk);
    let offset = 0;
    while (offset < chunk.length) {
      const { bytesWritten } = await this.handle.write(chunk, offset, chunk.length - offset);
      offset += bytesWritten;
    }
  }

  /** Close the staging file and decide the type. On refusal the staging file is removed. */
  async finish(): Promise<Received> {
    try {
      const type = this.sniffed ?? sniffHeader(this.head);
      if (type === null) {
        throw unsupported(this.count === 0 ? "The upload is empty." : NOT_SUPPORTED);
      }
      await this.handle?.sync();
      await this.handle?.close();
      this.handle = null;
      let final: FileType;
      if (type === "zip") {
        const kind = await classifyZip(this.path);
        if (kind === null) {
          throw unsupported(
            "This ZIP archive is not a PowerPoint, Word or OpenDocument file (spreadsheets and other archives are not supported).",
          );
        }
        final = kind;
      } else if (type === "ole") {
        const ole = await readOle(this.path);
        if (ole.kind === "encrypted") {
          throw unsupported(
            "This Office file is password protected. Remove the password and upload it again.",
          );
        }
        if (ole.kind !== "ppt" && ole.kind !== "doc") {
          throw unsupported(
            "This old Office file is not a PowerPoint or Word document (spreadsheets are not supported).",
          );
        }
        final = ole.kind;
      } else final = type;
      this.closed = true;
      return { path: this.path, sha256: this.hash.digest("hex"), bytes: this.count, type: final };
    } catch (error) {
      await this.abort();
      throw error;
    }
  }

  /** Remove the staging file. Safe to call at any point, more than once. */
  async abort(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    try {
      await this.handle?.close();
    } catch {
      // already closed
    }
    this.handle = null;
    if (this.path) {
      try {
        await unlink(this.path);
      } catch {
        // never created or already gone
      }
    }
  }
}
