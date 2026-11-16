import { z } from "zod";
import { Actor, ErrorCode, Timestamp } from "./common.js";
import { FileId, NodeId, PageId, TranscriptId, UploadId, UserId } from "./ids.js";

/**
 * File types accepted on upload. Detected from content, never from the extension.
 * Slides and handouts become pages through LibreOffice (`pptx` also covers macro-enabled and show/template
 * files, `docx` covers Word templates and macro-enabled files); photos become one page, a TIFF one page per
 * image in it. SVG is not accepted: it can carry scripts.
 */
export const FileType = z.enum([
  "pdf",
  "pptx",
  "ppt",
  "docx",
  "doc",
  "odp",
  "odt",
  "jpeg",
  "png",
  "heic",
  "webp",
  "gif",
  "tiff",
  "avif",
  "bmp",
]);
export type FileType = z.infer<typeof FileType>;

export const UPLOAD_LIMITS = {
  /** Largest single upload. */
  maxBytes: 200 * 1024 * 1024,
  /** Most pages or slides in one file. */
  maxPages: 500,
  /** Most files in one batch of agent upload links. */
  maxBatch: 100,
  /** How long an agent upload link stays valid, in seconds. */
  linkTtlSeconds: 600,
} as const;

/**
 * Where a file is in the inbox workflow.
 *
 *   uploaded → converting → converted → transcribed → filed
 *                  ↘ failed
 */
export const FileStatus = z.enum([
  "uploaded",
  "converting",
  "converted",
  "transcribed",
  "filed",
  "failed",
]);
export type FileStatus = z.infer<typeof FileStatus>;

export const SourceFile = z.object({
  id: FileId,
  userId: UserId,
  /** The lecture or folder it is filed under; null while it is still in the inbox. */
  nodeId: NodeId.nullable(),
  originalName: z.string().min(1).max(255),
  /** Fingerprint of the original bytes. The original is stored once under this and never modified. */
  sha256: z.string().regex(/^[0-9a-f]{64}$/),
  bytes: z.number().int().positive(),
  type: FileType,
  status: FileStatus,
  /** Set when status is "failed". */
  errorCode: ErrorCode.nullable(),
  errorMessage: z.string().nullable(),
  pageCount: z.number().int().min(0).nullable(),
  uploadedBy: Actor,
  /** The agent that has claimed this file for processing, if any. */
  claimedBy: Actor.nullable(),
  claimedAt: Timestamp.nullable(),
  createdAt: Timestamp,
  updatedAt: Timestamp,
  trashedAt: Timestamp.nullable(),
  /**
   * What the converter wants her to know about the file as a whole, in plain words: an animated image
   * kept to its first frame, macros that were not run. Empty for most files.
   */
  conversionNotes: z.array(z.string().max(300)).max(10),
});
export type SourceFile = z.infer<typeof SourceFile>;

/** One page or slide of a source file. */
export const Page = z.object({
  id: PageId,
  fileId: FileId,
  /** 1-based position in the file. */
  index: z.number().int().min(1),
  width: z.number().int().positive(),
  height: z.number().int().positive(),
  /** False for image-only pages such as exported handwriting; then the image is the only source. */
  hasTextLayer: z.boolean(),
  /** Text taken straight from the file. May be in the wrong reading order; the image is the authority. */
  nativeText: z.string().nullable(),
  speakerNotes: z.string().nullable(),
  /** The current transcript, if the page has been transcribed. */
  transcriptId: TranscriptId.nullable(),
});
export type Page = z.infer<typeof Page>;

/**
 * A spot in a transcript the reader should check against the original.
 * Doses, units and decimals are always flagged, because a misread there matters most.
 */
export const TranscriptFlag = z.object({
  kind: z.enum(["uncertain", "illegible", "dose", "unit", "decimal", "drug_name"]),
  /** The exact characters in `text` this flag is about. */
  quote: z.string().min(1).max(500),
  note: z.string().max(500).optional(),
});
export type TranscriptFlag = z.infer<typeof TranscriptFlag>;

export const ReviewStatus = z.enum(["unverified", "reviewed"]);
export type ReviewStatus = z.infer<typeof ReviewStatus>;

export const Transcript = z.object({
  id: TranscriptId,
  pageId: PageId,
  /** What the page says, verbatim. Never silently corrected. */
  text: z.string().max(200_000),
  flags: z.array(TranscriptFlag).max(500),
  author: Actor,
  reviewStatus: ReviewStatus,
  reviewedAt: Timestamp.nullable(),
  /** Increases by one each time the transcript is replaced; earlier revisions are kept. */
  revision: z.number().int().min(1),
  createdAt: Timestamp,
});
export type Transcript = z.infer<typeof Transcript>;

export const SaveTranscriptInput = z.object({
  pageId: PageId,
  text: z.string().max(200_000),
  flags: z.array(TranscriptFlag).max(500).default([]),
});
export type SaveTranscriptInput = z.infer<typeof SaveTranscriptInput>;

/** Ask for upload links, one per file. */
export const RequestUploadsInput = z.object({
  files: z
    .array(
      z.object({
        name: z.string().min(1).max(255),
        bytes: z.number().int().positive().max(UPLOAD_LIMITS.maxBytes),
      }),
    )
    .min(1)
    .max(UPLOAD_LIMITS.maxBatch),
  /** File the uploads here once converted; omit to leave them in the inbox. */
  nodeId: NodeId.optional(),
});
export type RequestUploadsInput = z.infer<typeof RequestUploadsInput>;

/** A single-use link an agent sends one file to with an HTTP PUT. */
export const UploadTicket = z.object({
  id: UploadId,
  name: z.string(),
  url: z.url(),
  method: z.literal("PUT"),
  maxBytes: z.number().int().positive(),
  expiresAt: Timestamp,
});
export type UploadTicket = z.infer<typeof UploadTicket>;
