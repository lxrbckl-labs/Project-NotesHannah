import { z } from "zod";
import { ColorToken } from "./blocks/tokens.js";
import { Timestamp } from "./common.js";
import { BlockId, DocumentId, MarginNoteId, NodeId } from "./ids.js";

/**
 * Side notes (features P1 to P8, docs/side-notes.md): her private remarks in the margin of a
 * document, each anchored to one block (and, optionally, to a short quote inside it). They are
 * stored apart from the document's blocks, so writing one never edits the document, never
 * touches its review state and never adds a revision. Agents may read them (they say where she
 * is confused or what she wants); only she can write them.
 *
 * Named "margin notes" in code so they cannot be confused with documents, nor with the app,
 * which she knows as "Notes". In the app they are "side notes".
 */

export const MARGIN_NOTE_LIMITS = {
  textChars: 4000,
  /** The optional words of the block the note is about. */
  quoteChars: 300,
  /** The block's last known text, kept so a detached note still says what it was on. */
  snippetChars: 160,
  /** Side notes on one document. Generous for one person's margins. */
  perDocument: 300,
} as const;

const Text = z
  .string()
  .trim()
  .min(1, "Write something in the note")
  .max(MARGIN_NOTE_LIMITS.textChars, `At most ${MARGIN_NOTE_LIMITS.textChars} characters.`);
const Quote = z.string().trim().max(MARGIN_NOTE_LIMITS.quoteChars);

/** One side note, as the app and agents see it. */
export const MarginNote = z
  .object({
    id: MarginNoteId,
    documentId: DocumentId,
    /** The block it sits beside. When that block is gone the note is detached but keeps the id. */
    blockId: BlockId,
    /** The words of the block it is about, or null for the whole block. */
    quote: z.string().nullable(),
    /** Her words: plain text, line breaks kept. */
    text: z.string(),
    /** A colour token from the palette, or null for the default. */
    colour: ColorToken.nullable(),
    resolved: z.boolean(),
    resolvedAt: Timestamp.nullable(),
    /** Its block was deleted or replaced: shown under "Detached" until she re-attaches or deletes it. */
    detached: z.boolean(),
    detachedAt: Timestamp.nullable(),
    /** The block's text when last seen (trimmed), so a detached note still says what it was on. */
    snippet: z.string(),
    createdAt: Timestamp,
    updatedAt: Timestamp,
  })
  .meta({ id: "MarginNote" });
export type MarginNote = z.infer<typeof MarginNote>;

export const CreateMarginNoteInput = z.strictObject({
  blockId: BlockId,
  text: Text,
  quote: Quote.nullable().default(null),
  colour: ColorToken.nullable().default(null),
});
export type CreateMarginNoteInput = z.input<typeof CreateMarginNoteInput>;

export const UpdateMarginNoteInput = z
  .strictObject({
    text: Text.optional(),
    colour: ColorToken.nullable().optional(),
    resolved: z.boolean().optional(),
  })
  .refine((v) => Object.values(v).some((x) => x !== undefined), {
    error: "Send at least one of text, colour, resolved.",
  });
export type UpdateMarginNoteInput = z.input<typeof UpdateMarginNoteInput>;

/** Move a note (usually a detached one) onto another block of the same document. */
export const ReattachMarginNoteInput = z.strictObject({
  blockId: BlockId,
  /** Leave out to drop the old quote: the words were in the old block. */
  quote: Quote.nullable().default(null),
});
export type ReattachMarginNoteInput = z.input<typeof ReattachMarginNoteInput>;

/** Answer of `GET /api/documents/:id/margin-notes`: every note of hers on the document, oldest first. */
export const MarginNoteList = z.object({ items: z.array(MarginNote) });
export type MarginNoteList = z.infer<typeof MarginNoteList>;

/** A side note found by search: opens the document at the note. */
export const MarginNoteSearchHitFields = z.object({
  noteId: MarginNoteId,
  documentId: DocumentId,
  nodeId: NodeId,
  documentTitle: z.string(),
  blockId: BlockId,
  resolved: z.boolean(),
  detached: z.boolean(),
  snippet: z.string(),
});

/** A note's preview text: the first line, at most `max` characters. */
export function marginNoteSnippet(text: string, max: number = MARGIN_NOTE_LIMITS.snippetChars) {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length <= max ? flat : `${flat.slice(0, max - 1).trimEnd()}…`;
}
