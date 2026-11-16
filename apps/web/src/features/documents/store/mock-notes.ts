import {
  type Block,
  blockPlainText,
  type DocumentWithBlocks,
  isBlockType,
  MARGIN_NOTE_LIMITS,
  type MarginNote,
  marginNoteSnippet,
  newId,
} from "@notes/schema";
import { type MarginNoteDraft, type MarginNotePatch, StoreError } from "./types";

const clone = <T>(value: T): T => structuredClone(value);

function snippetOf(block: Block): string {
  return marginNoteSnippet(isBlockType(block.type) ? blockPlainText(block) : "");
}

/**
 * The mock's side notes, kept apart from its documents the way the server keeps them, with the
 * same rules as the server's margin-notes domain: a note follows its block's id, detaches when
 * the block is gone (keeping the block's last text), and re-attaches if the block comes back.
 */
export class MockNotes {
  private notes = new Map<string, MarginNote>();

  constructor(private readonly getDoc: (documentId: string) => DocumentWithBlocks) {}

  /** After every save of a document. */
  follow(doc: DocumentWithBlocks, at: string) {
    const byId = new Map(doc.blocks.map((b) => [b.id, b]));
    for (const note of this.notes.values()) {
      if (note.documentId !== doc.id) continue;
      const block = byId.get(note.blockId);
      if (block) {
        note.detached = false;
        note.detachedAt = null;
        note.snippet = snippetOf(block);
      } else if (!note.detached) {
        note.detached = true;
        note.detachedAt = at;
      }
    }
  }

  /** A few of her notes on the demo guide, so the panel has something to show. */
  seed(doc: DocumentWithBlocks) {
    const prose = doc.blocks.filter((b) => b.type === "paragraph" || b.type === "callout");
    const seed: Array<[Block | undefined, string, MarginNote["colour"], boolean]> = [
      [prose[0], "Ask in OH: why does selectivity fade at higher doses?", "yellow", false],
      [prose[1], "This was on the quiz. Know it cold.", "pink", false],
      [prose[2], "I mix this up with labetalol every time.", null, false],
      [prose[4], "Looked it up: fine now.", "green", true],
    ];
    let t = Date.parse(doc.updatedAt) - 3_600_000;
    for (const [block, text, colour, resolved] of seed) {
      if (!block) continue;
      t += 60_000;
      const when = new Date(t).toISOString();
      const note: MarginNote = {
        id: newId("marginNote", t),
        documentId: doc.id,
        blockId: block.id,
        quote: null,
        text,
        colour,
        resolved,
        resolvedAt: resolved ? when : null,
        detached: false,
        detachedAt: null,
        snippet: snippetOf(block),
        createdAt: when,
        updatedAt: when,
      };
      this.notes.set(note.id, note);
    }
  }

  private need(documentId: string, noteId: string): MarginNote {
    const note = this.notes.get(noteId);
    if (!note || note.documentId !== documentId)
      throw new StoreError("No such side note.", "not_found", 404);
    return note;
  }

  private block(documentId: string, blockId: string): Block {
    const block = this.getDoc(documentId).blocks.find((b) => b.id === blockId);
    if (!block) throw new StoreError("That block is not in the document.", "not_found", 404);
    return block;
  }

  private text(raw: string): string {
    const text = raw.trim();
    if (!text) throw new StoreError("Write something in the note.", "invalid_input", 400);
    if (text.length > MARGIN_NOTE_LIMITS.textChars)
      throw new StoreError(
        `At most ${MARGIN_NOTE_LIMITS.textChars} characters.`,
        "invalid_input",
        400,
      );
    return text;
  }

  list(documentId: string): MarginNote[] {
    this.getDoc(documentId);
    return clone(
      [...this.notes.values()]
        .filter((n) => n.documentId === documentId)
        .sort((a, b) => a.createdAt.localeCompare(b.createdAt)),
    );
  }

  create(documentId: string, input: MarginNoteDraft): MarginNote {
    const block = this.block(documentId, input.blockId);
    const now = new Date().toISOString();
    const note: MarginNote = {
      id: newId("marginNote"),
      documentId,
      blockId: block.id,
      quote: input.quote ?? null,
      text: this.text(input.text),
      colour: input.colour ?? null,
      resolved: false,
      resolvedAt: null,
      detached: false,
      detachedAt: null,
      snippet: snippetOf(block),
      createdAt: now,
      updatedAt: now,
    };
    this.notes.set(note.id, note);
    return clone(note);
  }

  update(documentId: string, noteId: string, patch: MarginNotePatch): MarginNote {
    const note = this.need(documentId, noteId);
    const now = new Date().toISOString();
    if (patch.text !== undefined) note.text = this.text(patch.text);
    if (patch.colour !== undefined) note.colour = patch.colour;
    if (patch.resolved !== undefined && patch.resolved !== note.resolved) {
      note.resolved = patch.resolved;
      note.resolvedAt = patch.resolved ? now : null;
    }
    note.updatedAt = now;
    return clone(note);
  }

  remove(documentId: string, noteId: string): void {
    this.need(documentId, noteId);
    this.notes.delete(noteId);
  }

  reattach(documentId: string, noteId: string, blockId: string, quote: string | null): MarginNote {
    const note = this.need(documentId, noteId);
    const block = this.block(documentId, blockId);
    note.blockId = block.id;
    note.quote = quote;
    note.detached = false;
    note.detachedAt = null;
    note.snippet = snippetOf(block);
    note.updatedAt = new Date().toISOString();
    return clone(note);
  }
}
