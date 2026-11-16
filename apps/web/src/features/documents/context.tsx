import type { BlockType, CitationStatus, DocumentWithBlocks } from "@notes/schema";
import type { Editor } from "@tiptap/core";
import { createContext, useContext, useSyncExternalStore } from "react";
import type { PendingCall } from "./model/ops";
import type { ReferenceIndex } from "./model/references";
import type { ReadingState } from "./panels/dock/position";
import type { SideNotesModel } from "./panels/notes/model";
import type { DocumentController } from "./state/controller";
import type { DocumentStore, RequestKind } from "./store/types";
import type { Layout } from "./ui/hooks";

/** A tiny observable value, so per-block state does not re-render every block. */
export class Signal<T> {
  private listeners = new Set<() => void>();
  constructor(private value: T) {}
  get = () => this.value;
  set(value: T) {
    if (Object.is(value, this.value)) return;
    this.value = value;
    for (const listener of this.listeners) listener();
  }
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };
}

export function useSignal<T, S>(signal: Signal<T>, select: (value: T) => S): S {
  return useSyncExternalStore(
    signal.subscribe,
    () => select(signal.get()),
    () => select(signal.get()),
  );
}

export interface FocusRequest {
  blockId: string;
  /** Which field; "main" for a text block's text or a list's lines. */
  field: string;
  at: "start" | "end" | number;
  seq: number;
}

/** An editor that had the caret, and the block it edits. */
export interface CaretEditor {
  editor: Editor;
  blockId: string;
}

/** Stable things: the controller, the store and the actions. Never changes for a document. */
export interface DocActions {
  controller: DocumentController;
  store: DocumentStore;
  documentId: string;
  perform: (calls: PendingCall[], label: string) => boolean;
  openCitation: (number: number) => void;
  openConcept: (conceptId: string) => void;
  openQuestion: (questionId: string) => void;
  askAbout: (blockId: string, kind?: RequestKind) => void;
  /** Start dragging a block (mouse at once; touch after a long press). */
  startDrag: (blockId: string, event: PointerEvent, touch: boolean) => void;
  /** True for a moment after a drag ends, so the click that ends it opens nothing. */
  justDragged: () => boolean;
  /** Ask for a page, then insert an image block of that type after a block. */
  pickPage: (type: "image" | "labelled_image", afterId: string | null, replaceId?: string) => void;
  requestFocus: (blockId: string, at: FocusRequest["at"], field?: string) => void;
  focus: Signal<FocusRequest | null>;
  active: Signal<string | null>;
  setActive: (blockId: string | null) => void;
  activeEditor: Signal<Editor | null>;
  /**
   * The editor the caret was last in, kept while it stays mounted. `activeEditor` clears
   * soon after a blur; this one survives a ribbon menu taking the focus, so the menu's
   * choice still lands in the right place.
   */
  caretEditor: Signal<CaretEditor | null>;
  /** Show the slash/insert menu for a block (after it, or replacing it when empty). */
  openInsertMenu: (
    blockId: string | null,
    replace: boolean,
    anchor: DOMRect | null,
    query?: string,
    /** "plus" shows the search field even when replacing (the ribbon's Insert button). */
    source?: "slash" | "plus",
  ) => void;
  /** Add a block of this type after a block (or in its place) and put the caret in it. */
  insertType: (type: BlockType, blockId: string | null, replace?: boolean) => void;
  slashQuery: Signal<{ blockId: string; query: string } | null>;
  /** The open slash menu's key handler, called by the editor for arrows, Enter and Escape. */
  slashKeyHandler: { current: ((key: string) => boolean) | null };
  docRef: { current: DocumentWithBlocks | null };
  notify: (message: string, tone?: "info" | "success" | "error") => void;
  /** Her side notes (P1 to P8) and how a block reaches them. */
  sideNotes: SideNotesActions;
  /** The block under the pointer, or the one a panel entry points at: the two light up together. */
  hovered: Signal<string | null>;
  /** Where she is reading (P6): the block at the reading line and the blocks in view. */
  reading: Signal<ReadingState>;
}

export interface SideNotesActions {
  model: SideNotesModel;
  /** Start a note on a block (words she selected in it become its quote); null: the block she is reading. */
  compose: (blockId: string | null) => void;
  /** Show a note: opens the Notes panel (or the phone sheet) at it. */
  show: (noteId: string) => void;
}

/** What blocks need to draw themselves; changes rarely. */
export interface DocView {
  editing: boolean;
  isTouch: boolean;
  layout: Layout;
  refs: ReferenceIndex;
  /** Source status by citation key; missing means available or not yet known. */
  status: Map<string, CitationStatus>;
  activeCitation: number | null;
}

export const ActionsContext = createContext<DocActions | null>(null);
export const ViewContext = createContext<DocView | null>(null);

export function useActions(): DocActions {
  const value = useContext(ActionsContext);
  if (!value) throw new Error("useActions outside DocumentView");
  return value;
}

export function useView(): DocView {
  const value = useContext(ViewContext);
  if (!value) throw new Error("useView outside DocumentView");
  return value;
}
