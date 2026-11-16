import type { Page, SourceFile } from "@notes/schema";
import type { AuthContext } from "../http/auth-context.js";
import type { FilesPort } from "./ports.js";

/** How far a file has got: pages known after conversion, and how many have a transcript. */
export interface Progress {
  pages: number;
  transcribed: number;
  /** Pages without a transcript, first few. */
  missing: string[];
}

export function progressOf(pages: readonly Page[]): Progress {
  const missing = pages.filter((p) => p.transcriptId === null).map((p) => p.id);
  return { pages: pages.length, transcribed: pages.length - missing.length, missing };
}

/** What an agent can do with a file in this status, in a few words. */
export function nextStepFor(f: SourceFile): string {
  switch (f.status) {
    case "uploaded":
      return "not queued: retry it";
    case "converting":
      return "converting: wait";
    case "failed":
      return `conversion failed (${f.errorCode ?? "error"}${f.errorMessage ? `: ${f.errorMessage}` : ""})`;
    case "converted":
      return "ready to transcribe";
    case "transcribed":
      return "transcribed: file it";
    default:
      return "filed";
  }
}

export function fileLine(f: SourceFile, progress?: Progress): string {
  const parts = [`${f.type}`, `status ${f.status} (${nextStepFor(f)})`];
  if (f.pageCount !== null) {
    parts.push(
      progress
        ? `${progress.transcribed} of ${f.pageCount} pages transcribed`
        : `${f.pageCount} pages`,
    );
  }
  if (f.claimedBy?.type === "agent") parts.push(`claimed by key ${f.claimedBy.keyId}`);
  parts.push(f.nodeId ? `filed under ${f.nodeId}` : "in the inbox");
  return `- ${f.id} "${f.originalName}": ${parts.join(", ")}`;
}

export function fileItem(f: SourceFile, progress?: Progress) {
  return {
    id: f.id,
    name: f.originalName,
    type: f.type,
    status: f.status,
    pageCount: f.pageCount,
    ...(progress ? { transcribedPages: progress.transcribed } : {}),
    nodeId: f.nodeId,
    claimedBy: f.claimedBy,
    errorCode: f.errorCode,
    errorMessage: f.errorMessage,
    createdAt: f.createdAt,
  };
}

/** Pages of a converted file (none while it converts or after it failed). */
export function pagesIfAny(port: FilesPort, auth: AuthContext, f: SourceFile): Page[] {
  return f.pageCount === null ? [] : port.listPages(auth, f.id);
}

/** The warning given when a file is filed with pages still lacking a transcript. */
export function untranscribedWarning(progress: Progress): string {
  if (progress.pages === 0 || progress.missing.length === 0) return "";
  const shown = progress.missing.slice(0, 5).join(", ");
  return `Warning: ${progress.missing.length} of ${progress.pages} page(s) have no transcript yet (${shown}${progress.missing.length > 5 ? ", …" : ""}). Filing is allowed, but transcribe them with save_transcript so she can read and search them.`;
}
