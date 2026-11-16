import type { ColorToken, MarginNote } from "@notes/schema";
import { Signal } from "../../context";
import type { DocumentStore, MarginNotePatch } from "../../store/types";

export interface Composer {
  blockId: string;
  /** Words she had selected in the block, if any. */
  quote: string | null;
}

export interface NotesState {
  phase: "loading" | "ready" | "error";
  notes: readonly MarginNote[];
  /** The note she is looking at: it sits exactly level with its block, the others make room. */
  focusedId: string | null;
  /** A new note being written against a block. */
  composer: Composer | null;
  /** Resolved notes are shown (dimmed) rather than tucked away. */
  showResolved: boolean;
}

/** Notes per block, for the markers in the page: open ones, and all that are not detached. */
export interface NoteCount {
  open: number;
  all: number;
  /** The first note on the block, to focus from the marker. */
  firstId: string;
}

const INITIAL: NotesState = {
  phase: "loading",
  notes: [],
  focusedId: null,
  composer: null,
  showResolved: false,
};

/**
 * Her side notes on one document (P1 to P8), kept apart from the document's blocks. Changes show
 * at once and are sent in the background; a failed one is put back and reported. Whether a note
 * is detached follows the blocks in the page as well as the server's answer, so deleting a block
 * moves its notes to "Detached" straight away and undoing it brings them back, as the server does.
 */
export class SideNotesModel {
  readonly state = new Signal<NotesState>(INITIAL);
  /** Counts per live block. */
  readonly counts = new Signal<ReadonlyMap<string, NoteCount>>(new Map());
  private blockIds: ReadonlySet<string> | null = null;

  constructor(
    private readonly store: DocumentStore,
    private readonly documentId: string,
    private readonly onError: (message: string) => void = () => {},
  ) {}

  private set(patch: Partial<NotesState>) {
    this.state.set({ ...this.state.get(), ...patch });
    this.recount();
  }

  async load() {
    try {
      const notes = await this.store.listMarginNotes(this.documentId);
      this.set({ phase: "ready", notes });
    } catch {
      this.set({ phase: "error" });
    }
  }

  /** The blocks now in the document (after every change she makes). */
  setBlocks(ids: readonly string[]) {
    const next = new Set(ids);
    const prev = this.blockIds;
    if (prev && prev.size === next.size && ids.every((id) => prev.has(id))) return;
    this.blockIds = next;
    this.recount();
    // Repaint the panels: a note may have become detached or attached again.
    this.state.set({ ...this.state.get() });
  }

  isDetached(note: MarginNote): boolean {
    if (!this.blockIds) return note.detached;
    return !this.blockIds.has(note.blockId);
  }

  private recount() {
    const counts = new Map<string, NoteCount>();
    for (const note of this.state.get().notes) {
      if (this.isDetached(note)) continue;
      const c = counts.get(note.blockId) ?? { open: 0, all: 0, firstId: note.id };
      c.all += 1;
      if (!note.resolved) c.open += 1;
      counts.set(note.blockId, c);
    }
    const prev = this.counts.get();
    const same =
      prev.size === counts.size &&
      [...counts].every(([k, v]) => {
        const p = prev.get(k);
        return p && p.open === v.open && p.all === v.all && p.firstId === v.firstId;
      });
    if (!same) this.counts.set(counts);
  }

  focus(noteId: string | null) {
    if (this.state.get().focusedId === noteId) return;
    const note = this.state.get().notes.find((n) => n.id === noteId);
    // Focusing a resolved note shows the resolved ones, or it would have nowhere to be.
    this.set({
      focusedId: noteId,
      ...(note?.resolved ? { showResolved: true } : {}),
    });
  }

  compose(composer: Composer | null) {
    this.set({ composer, ...(composer ? { focusedId: null } : {}) });
  }

  setShowResolved(showResolved: boolean) {
    this.set({ showResolved });
  }

  private replace(note: MarginNote) {
    this.set({ notes: this.state.get().notes.map((n) => (n.id === note.id ? note : n)) });
  }

  async add(input: {
    blockId: string;
    text: string;
    quote?: string | null;
    colour?: ColorToken | null;
  }): Promise<MarginNote | null> {
    try {
      const note = await this.store.createMarginNote(this.documentId, input);
      this.set({ notes: [...this.state.get().notes, note], composer: null, focusedId: note.id });
      return note;
    } catch (error) {
      this.onError(messageOf(error, "The side note was not saved."));
      return null;
    }
  }

  async update(noteId: string, patch: MarginNotePatch): Promise<boolean> {
    const before = this.state.get().notes.find((n) => n.id === noteId);
    if (!before) return false;
    const now = new Date().toISOString();
    // Show it at once; the server's answer replaces it.
    this.replace({
      ...before,
      ...(patch.text !== undefined ? { text: patch.text.trim() } : {}),
      ...(patch.colour !== undefined ? { colour: patch.colour } : {}),
      ...(patch.resolved !== undefined
        ? { resolved: patch.resolved, resolvedAt: patch.resolved ? now : null }
        : {}),
      updatedAt: now,
    });
    try {
      this.replace(await this.store.updateMarginNote(this.documentId, noteId, patch));
      return true;
    } catch (error) {
      this.replace(before);
      this.onError(messageOf(error, "The side note was not changed."));
      return false;
    }
  }

  async remove(noteId: string): Promise<MarginNote | null> {
    const before = this.state.get();
    const note = before.notes.find((n) => n.id === noteId);
    if (!note) return null;
    this.set({
      notes: before.notes.filter((n) => n.id !== noteId),
      focusedId: before.focusedId === noteId ? null : before.focusedId,
    });
    try {
      await this.store.deleteMarginNote(this.documentId, noteId);
      return note;
    } catch (error) {
      this.set({ notes: this.state.get().notes.concat(note) });
      this.onError(messageOf(error, "The side note was not deleted."));
      return null;
    }
  }

  /** Undo a delete: the same words, colour and state, on the same block (a new note, as far as the server knows). */
  async restore(note: MarginNote): Promise<void> {
    const back = await this.add({
      blockId: note.blockId,
      text: note.text,
      quote: note.quote,
      colour: note.colour,
    });
    if (back && note.resolved) await this.update(back.id, { resolved: true });
  }

  async reattach(noteId: string, blockId: string): Promise<boolean> {
    try {
      const note = await this.store.reattachMarginNote(this.documentId, noteId, { blockId });
      this.replace(note);
      this.focus(note.id);
      return true;
    } catch (error) {
      this.onError(messageOf(error, "The side note was not moved."));
      return false;
    }
  }
}

function messageOf(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? `${fallback} ${error.message}` : fallback;
}
