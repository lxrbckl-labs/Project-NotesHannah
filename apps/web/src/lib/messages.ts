import { type FileStatus, type SourceFile, UPLOAD_LIMITS } from "@notes/schema";
import { describeError, isApiError } from "./api";

/** What each status means, in plain words, for the inbox and the tree. */
export const STATUS_INFO: Record<FileStatus, { label: string; words: string }> = {
  uploaded: {
    label: "Queued",
    words: "Saved, but not yet sent for conversion. Press Retry if it stays like this.",
  },
  converting: { label: "Converting", words: "Turning the file into page images." },
  converted: {
    label: "Ready",
    words: "Waiting for an agent to transcribe it. You can already read the pages.",
  },
  transcribed: {
    label: "Transcribed",
    words: "Every page is transcribed. File it under a lecture or folder.",
  },
  filed: { label: "Filed", words: "Transcribed and filed in your library." },
  failed: { label: "Failed", words: "The file could not be converted." },
};

/** Statuses that change on their own soon: the inbox polls while any file is in one. */
export const IN_PROGRESS: ReadonlySet<FileStatus> = new Set(["uploaded", "converting"]);

const FAILURE_WORDS: Record<string, string> = {
  encrypted_file: "This file is password protected. Remove the password and upload it again.",
  corrupt_file:
    "This file looks damaged and could not be read. Export it again and upload the new copy.",
  unsupported_type:
    "This is not a file type the app can read. Use PDF, PowerPoint (.pptx), JPEG, PNG or HEIC.",
  too_many_pages: "This file has more than 500 pages. Split it into smaller files.",
  too_large: "This file is too large.",
  conversion_failed:
    "Conversion did not finish. Press Retry; if it fails again, export the file again.",
};

/** Why a file failed, in words she can act on. */
export function failureWords(file: Pick<SourceFile, "errorCode" | "errorMessage">): string {
  const known = file.errorCode ? FAILURE_WORDS[file.errorCode] : undefined;
  return known ?? file.errorMessage ?? "The file could not be converted. Press Retry.";
}

const MB = 1024 * 1024;

/** A refusal from the upload route, in words she can act on. */
export function uploadFailure(error: unknown): { message: string; hint?: string } {
  if (isApiError(error)) {
    switch (error.code) {
      case "too_large":
        return {
          message: `Too large: the limit is ${Math.round(UPLOAD_LIMITS.maxBytes / MB)} MB per file.`,
          hint: "Split it, or export a smaller version.",
        };
      case "unsupported_type":
        return {
          message: "That is not a file type the app can read.",
          hint: "Use PDF, PowerPoint (.pptx), JPEG, PNG or HEIC. Export other documents as PDF.",
        };
      case "network":
        return { message: "The connection dropped.", hint: "Check it and press Retry." };
      case "cancelled":
        return { message: "Cancelled." };
      case "forbidden":
        return {
          message: "The server refused the upload.",
          hint: "Reload the page and sign in again.",
        };
      default:
        break;
    }
  }
  return describeError(error);
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < MB) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / MB).toFixed(bytes < 10 * MB ? 1 : 0)} MB`;
}
