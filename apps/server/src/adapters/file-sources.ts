import type { Db } from "../db/client.js";
import type { SourceInfo, SourceLookup, SourceRef } from "../domains/documents/ports.js";

interface PageRow {
  idx: number;
  native_text: string | null;
  speaker_notes: string | null;
  transcript_id: string | null;
  file_name: string;
  file_trashed_at: number | null;
}

/** Whitespace runs count as one space, and the ends do not count: a quote copied across a line break still matches. */
export function normaliseText(text: string): string {
  return text.replace(/\s+/gu, " ").trim();
}

/**
 * The documents domain's `SourceLookup`, answered from the files tables.
 *
 * - A page that does not belong to the cited file, or to this user, does not exist.
 *   (Someone else's page looks exactly like a deleted one.)
 * - Trashed files still exist; they are reported `trashed`.
 * - `quoteFound` looks in the page's current transcript, its native text (the text layer of
 *   a PDF or slide) and its speaker notes, so slide text can be cited before anyone has
 *   transcribed the page. It is `null` while the page has no text at all, `false` when it
 *   has some and the quote is in none of it.
 */
export function createFileSourceLookup(db: Db): SourceLookup {
  const pageStmt = db.prepare(
    `SELECT p.idx, p.native_text, p.speaker_notes, p.transcript_id,
            f.original_name AS file_name, f.trashed_at AS file_trashed_at
     FROM pages p JOIN source_files f ON f.id = p.file_id
     WHERE p.id = ? AND p.file_id = ? AND p.user_id = ? AND f.user_id = ?`,
  );
  const transcriptStmt = db.prepare("SELECT text, revision FROM transcripts WHERE id = ?");

  function resolveOne(userId: string, ref: SourceRef): SourceInfo {
    const page = pageStmt.get(ref.pageId, ref.fileId, userId, userId) as PageRow | undefined;
    if (!page) {
      return {
        known: true,
        exists: false,
        trashed: false,
        fileName: null,
        pageIndex: null,
        currentTranscriptRevision: null,
        quoteFound: null,
      };
    }
    const transcript = page.transcript_id
      ? (transcriptStmt.get(page.transcript_id) as { text: string; revision: number } | undefined)
      : undefined;
    const texts = [transcript?.text, page.native_text, page.speaker_notes]
      .filter((text): text is string => typeof text === "string")
      .map(normaliseText)
      .filter((text) => text !== "");
    const quote = normaliseText(ref.quote);
    return {
      known: true,
      exists: true,
      trashed: page.file_trashed_at !== null,
      fileName: page.file_name,
      pageIndex: page.idx,
      currentTranscriptRevision: transcript?.revision ?? null,
      quoteFound: texts.length === 0 ? null : quote !== "" && texts.some((t) => t.includes(quote)),
    };
  }

  const pageExists = db.prepare("SELECT 1 FROM pages WHERE id = ? AND user_id = ?");
  const fileExists = db.prepare("SELECT 1 FROM source_files WHERE id = ? AND user_id = ?");

  return {
    resolve: (userId, refs) => refs.map((ref) => resolveOne(userId, ref)),
    exists: (userId, target) =>
      "pageId" in target
        ? pageExists.get(target.pageId, userId) !== undefined
        : fileExists.get(target.fileId, userId) !== undefined,
  };
}
