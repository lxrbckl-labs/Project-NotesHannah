import {
  type Block,
  type BlockType,
  type CitationStatus,
  citationKey,
  countUnverified,
  isBlockType,
  newId,
  richTextToPlain,
} from "@notes/schema";
import type { Editor } from "@tiptap/core";
import {
  ArrowDown,
  BookOpen,
  Check,
  CircleCheckBig,
  CloudAlert,
  CloudCheck,
  History,
  ListTree,
  LoaderCircle,
  MessageSquareText,
  Pencil,
  Plus,
  Redo2,
  TriangleAlert,
  Undo2,
} from "lucide-react";
import {
  type CSSProperties,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { Button, IconButton } from "../../components/ui/button";
import { Sheet } from "../../components/ui/sheet";
import { useToast } from "../../components/ui/toast";
import { HotkeyTooltip } from "../../components/ui/tooltip";
import { cn } from "../../lib/cn";
import { useHotkey, useHotkeyAria } from "../hotkeys";
import { BlockShell } from "./blocks/BlockShell";
import {
  ActionsContext,
  type CaretEditor,
  type DocActions,
  type DocView,
  type FocusRequest,
  Signal,
  ViewContext,
} from "./context";
import { KeyboardDock, SelectionBubble } from "./editor/FormatToolbar";
import { InsertMenu, type InsertMenuState } from "./editor/InsertMenu";
import { Ribbon } from "./editor/Ribbon";
import {
  insertBlock,
  isListType,
  isTextType,
  moveTo,
  NEEDS_PAGE,
  newBlockInput,
} from "./model/gestures";
import type { PendingCall } from "./model/ops";
import { buildReferenceIndex, type ReferenceIndex } from "./model/references";
import { CitationPanel } from "./panels/CitationPanel";
import { PagePicker, RequestDialog } from "./panels/dialogs";
import { DocumentDock, type PanelData, PanelsSheet } from "./panels/dock/DocumentPanels";
import { type PanelId, sideOf } from "./panels/dock/layout";
import { PanelsMenu } from "./panels/dock/PanelsMenu";
import { headingsOf, ReadingTracker } from "./panels/dock/position";
import { type DockApi, useDock } from "./panels/dock/useDock";
import { HistoryPanel } from "./panels/HistoryPanel";
import { SideNotesModel } from "./panels/notes/model";
import type { OutlineItem } from "./panels/OutlinePanel";
import { References } from "./panels/References";
import { DocumentController } from "./state/controller";
import type { DocumentStore, RequestKind } from "./store/types";
import { formatWhen, useIsTouch, useLayout, useReducedMotion } from "./ui/hooks";
import "./documents.css";

export interface DocumentViewProps {
  /** Where documents come from and go to: `HttpDocumentStore` in the app. */
  store: DocumentStore;
  documentId: string;
  /** Open a concept page (concept mentions, comparison rows, hotspots). */
  onOpenConcept?: (conceptId: string) => void;
  /** Open a practice question placed in the document. */
  onOpenQuestion?: (questionId: string) => void;
  /** Start reading or editing; defaults to editing on a computer, reading on touch. */
  initialMode?: "read" | "edit";
  /** Ask about a block: the shell opens its request composer. Without it the module has its own small dialog. */
  onAskAboutBlock?: ((target: { blockId: string; kind: RequestKind }) => void) | undefined;
  /** Scroll to this block and flash it once the document has loaded (a search hit, a link). */
  focusBlockId?: string | undefined;
  /** Open the side notes at this note once they have loaded (a search hit). */
  focusNoteId?: string | undefined;
  /** An empty document gets one empty paragraph with the caret in it, ready to type (once). */
  startWriting?: boolean;
  className?: string;
}

const KIND_LABEL = {
  lecture_note: "Lecture note",
  study_guide: "Study guide",
  practice_set: "Practice set",
  free: "Document",
};

/**
 * The document page (D1): read and edit a document's blocks, with citations,
 * trust signals, outline, history and references. Mount it in a container
 * with a definite height; it scrolls inside.
 */
export function DocumentView(props: DocumentViewProps) {
  // Toasts come from the app's ToastProvider (the shell, the demo page and tests provide one).
  return <DocumentScreen {...props} />;
}

function useStableRefs(blocks: readonly Block[] | undefined): ReferenceIndex {
  const last = useRef<{ signature: string; index: ReferenceIndex } | null>(null);
  return useMemo(() => {
    // Schema helpers assume known types; a block from a newer app version is left out.
    const index = buildReferenceIndex((blocks ?? []).filter((b) => isBlockType(b.type)));
    const signature = index.references.map((r) => citationKey(r.citation)).join("\n");
    if (last.current && last.current.signature === signature) return last.current.index;
    last.current = { signature, index };
    return index;
  }, [blocks]);
}

function DocumentScreen({
  store,
  documentId,
  onOpenConcept,
  onOpenQuestion,
  initialMode,
  focusBlockId,
  focusNoteId,
  onAskAboutBlock,
  startWriting,
  className,
}: DocumentViewProps) {
  const controller = useMemo(() => new DocumentController(store, documentId), [store, documentId]);
  useEffect(() => {
    void controller.load();
  }, [controller]);
  const state = useSyncExternalStore(
    controller.subscribe,
    controller.getState,
    controller.getState,
  );
  const doc = state.doc;
  const layout = useLayout();
  const isTouch = useIsTouch();
  const reduced = useReducedMotion();
  const toast = useToast();
  // The mode she last chose on this device; until she has, writing on a computer and reading on touch.
  const [editing, setEditingState] = useState(() =>
    initialMode
      ? initialMode === "edit"
      : (rememberedMode() ?? (isTouch ? "read" : "edit")) === "edit",
  );
  const setEditing = useCallback((next: boolean) => {
    setEditingState(next);
    try {
      localStorage.setItem(MODE_KEY, next ? "edit" : "read");
    } catch {
      // Not remembered, but the mode still changes.
    }
  }, []);
  const refs = useStableRefs(doc?.blocks);
  const [status, setStatus] = useState<Map<string, CitationStatus>>(() => new Map());
  const [names, setNames] = useState<
    Map<string, { fileName: string | null; pageIndex: number | null }>
  >(() => new Map());
  const [citation, setCitation] = useState<number | null>(null);
  const [historyOpen, setHistoryOpen] = useState(false);
  // The sidebars (P5) and, on a phone, the sheet that stands in for them.
  const dock = useDock();
  const [sheet, setSheet] = useState<{ open: boolean; tab: PanelId }>({
    open: false,
    tab: "outline",
  });
  const [request, setRequest] = useState<{ blockId: string; kind: RequestKind } | null>(null);
  const [insert, setInsert] = useState<InsertMenuState | null>(null);
  const [picker, setPicker] = useState<{
    type: "image" | "labelled_image";
    afterId: string | null;
    replaceId?: string;
  } | null>(null);
  const [panelWidth, setPanelWidth] = useState(layout === "computer" ? 460 : 400);
  const [drop, setDrop] = useState<{
    blockId: string;
    top: number;
    beforeId: string | null;
  } | null>(null);
  const scroller = useRef<HTMLDivElement>(null);
  const docRef = useRef(doc);
  docRef.current = doc;
  const lastDragEnd = useRef(0);
  // The insert logic reads the latest document; actions are created once and call it through this.
  const insertTypeRef = useRef<(type: BlockType, blockId: string | null, replace: boolean) => void>(
    () => {},
  );

  // Source status for chips and the references list (K6).
  const signature = refs.references.map((r) => citationKey(r.citation)).join("\n");
  // biome-ignore lint/correctness/useExhaustiveDependencies: refetch when the set of sources changes
  useEffect(() => {
    if (!doc) return;
    let alive = true;
    const t = setTimeout(() => {
      store.listReferences(documentId).then(
        (items) => {
          if (!alive) return;
          setStatus(new Map(items.map((i) => [citationKey(i.citation), i.status])));
          setNames(
            new Map(
              items.map((i) => [
                citationKey(i.citation),
                { fileName: i.fileName, pageIndex: i.pageIndex },
              ]),
            ),
          );
        },
        () => {},
      );
    }, 300);
    return () => {
      alive = false;
      clearTimeout(t);
    };
  }, [signature, store, documentId, doc === null]);

  // Signals and actions: created once per document.
  const signals = useMemo(
    () => ({
      focus: new Signal<FocusRequest | null>(null),
      active: new Signal<string | null>(null),
      activeEditor: new Signal<Editor | null>(null),
      caretEditor: new Signal<CaretEditor | null>(null),
      slashQuery: new Signal<{ blockId: string; query: string } | null>(null),
      slashKeyHandler: { current: null as ((key: string) => boolean) | null },
      seq: { current: 0 },
      hovered: new Signal<string | null>(null),
    }),
    [],
  );

  // Where she is reading (P6) and her side notes (P1 to P8): one of each per document.
  const tracker = useMemo(() => new ReadingTracker(), []);
  const notes = useMemo(
    () => new SideNotesModel(store, documentId, (message) => toast.error(new Error(message))),
    [store, documentId, toast],
  );
  useEffect(() => {
    void notes.load();
  }, [notes]);
  // The scroller appears once the document has loaded.
  const loaded = doc !== null;
  // biome-ignore lint/correctness/useExhaustiveDependencies: attach when the scroller exists
  useEffect(() => {
    const box = scroller.current;
    return box ? tracker.attach(box) : undefined;
  }, [tracker, loaded]);
  const order = doc ? doc.blocks.map((b) => `${b.id}:${b.type}`).join(" ") : "";
  // biome-ignore lint/correctness/useExhaustiveDependencies: keyed by the block order and types
  useEffect(() => {
    const blocks = docRef.current?.blocks ?? [];
    tracker.setHeadings(headingsOf(blocks));
    tracker.invalidate();
    notes.setBlocks(blocks.map((b) => b.id));
  }, [order, tracker, notes]);

  const scrollToBlock = useCallback(
    (blockId: string, flash = true) => {
      const el = scroller.current?.querySelector(`[data-block-id="${blockId}"]`);
      if (!el) return;
      el.scrollIntoView({ block: "center", behavior: reduced ? "auto" : "smooth" });
      const box = scroller.current;
      if (!reduced && box) {
        // Blocks off screen are sized by estimate until drawn, so a long smooth scroll can stop
        // short. When it ends, settle on the block exactly.
        const settle = () => {
          box.removeEventListener("scrollend", settle);
          clearTimeout(fallback);
          el.scrollIntoView({ block: "center", behavior: "auto" });
        };
        const fallback = setTimeout(settle, 1200);
        box.addEventListener("scrollend", settle);
      }
      if (flash) {
        el.classList.add("doc-flash");
        setTimeout(() => el.classList.remove("doc-flash"), 1300);
      }
    },
    [reduced],
  );

  // A link or search hit names a block: scroll to it once the document is there.
  const focused = useRef<string | undefined>(undefined);
  // biome-ignore lint/correctness/useExhaustiveDependencies: run once per block id, when the document has loaded
  useEffect(() => {
    if (!focusBlockId || !doc || focused.current === focusBlockId) return;
    const t = setTimeout(() => {
      focused.current = focusBlockId;
      scrollToBlock(focusBlockId);
    }, 250);
    return () => clearTimeout(t);
  }, [focusBlockId, doc === null]);

  const startDrag = useCallback(
    (blockId: string, event: PointerEvent, touch: boolean) => {
      const box = scroller.current;
      if (!box) return;
      const startX = event.clientX;
      const startY = event.clientY;
      let dragging = false;
      let lastY = startY;
      let target: { beforeId: string | null; top: number } | null = null;
      let timer: ReturnType<typeof setTimeout> | null = null;
      let raf = 0;
      const content = box.firstElementChild as HTMLElement | null;
      const compute = (y: number) => {
        if (!content) return;
        const base = content.getBoundingClientRect().top;
        const els = [...box.querySelectorAll<HTMLElement>("[data-block-id]")];
        let found: { beforeId: string | null; top: number } | null = null;
        for (const el of els) {
          const rect = el.getBoundingClientRect();
          if (y < rect.top + rect.height / 2) {
            found = { beforeId: el.dataset.blockId ?? null, top: rect.top - base - 6 };
            break;
          }
        }
        if (!found) {
          const last = els[els.length - 1];
          found = {
            beforeId: null,
            top: last ? last.getBoundingClientRect().bottom - base + 4 : 0,
          };
        }
        target = found;
        setDrop({ blockId, ...found });
      };
      const autoscroll = () => {
        if (!dragging) return;
        const rect = box.getBoundingClientRect();
        const edge = 70;
        if (lastY < rect.top + edge) box.scrollBy(0, -12);
        else if (lastY > rect.bottom - edge) box.scrollBy(0, 12);
        compute(lastY);
        raf = requestAnimationFrame(autoscroll);
      };
      const begin = () => {
        dragging = true;
        document.body.style.userSelect = "none";
        if (touch && "vibrate" in navigator) navigator.vibrate?.(10);
        compute(lastY);
        raf = requestAnimationFrame(autoscroll);
      };
      const finish = () => {
        if (timer) clearTimeout(timer);
        cancelAnimationFrame(raf);
        window.removeEventListener("pointermove", move);
        window.removeEventListener("pointerup", up);
        window.removeEventListener("pointercancel", cancel);
        document.body.style.userSelect = "";
        setDrop(null);
      };
      const move = (e: PointerEvent) => {
        lastY = e.clientY;
        if (!dragging) {
          const dist = Math.hypot(e.clientX - startX, e.clientY - startY);
          if (!touch && dist > 4) begin();
          else if (touch && dist > 10) finish();
          return;
        }
        e.preventDefault();
      };
      const up = () => {
        const wasDragging = dragging;
        const t = target as { beforeId: string | null; top: number } | null;
        finish();
        if (!wasDragging || !t) return;
        lastDragEnd.current = Date.now();
        const order = docRef.current?.blockIds ?? [];
        const next = order[order.indexOf(blockId) + 1] ?? null;
        if (t.beforeId === blockId || t.beforeId === next) return;
        controller.perform(moveTo(documentId, blockId, t.beforeId), "Move block");
      };
      const cancel = () => finish();
      if (touch) timer = setTimeout(begin, 380);
      window.addEventListener("pointermove", move, { passive: false });
      window.addEventListener("pointerup", up);
      window.addEventListener("pointercancel", cancel);
    },
    [controller, documentId],
  );

  // The actions are made once; showing a panel needs the dock as it is now.
  const showPanelRef = useRef<(id: PanelId) => void>(() => {});
  showPanelRef.current = (id) => {
    if (layout === "phone") setSheet({ open: true, tab: id });
    // On screen is not enough: a panel folded down to its header is unfolded too, or a new note would
    // open where she cannot see it.
    else if (!dock.visible(id) || dock.state.folded.includes(id)) dock.reveal(id);
  };

  const actions: DocActions = useMemo(
    () => ({
      controller,
      store,
      documentId,
      perform: (calls: PendingCall[], label: string) => controller.perform(calls, label),
      openCitation: (number) => setCitation(number),
      openConcept: (id) =>
        onOpenConcept ? onOpenConcept(id) : toast.show("Concept pages open from the library."),
      openQuestion: (id) =>
        onOpenQuestion ? onOpenQuestion(id) : toast.show("Practice questions open in Practice."),
      askAbout: (blockId, kind = "wrong") =>
        onAskAboutBlock ? onAskAboutBlock({ blockId, kind }) : setRequest({ blockId, kind }),
      startDrag,
      justDragged: () => Date.now() - lastDragEnd.current < 250,
      pickPage: (type, afterId, replaceId) =>
        setPicker({ type, afterId, ...(replaceId ? { replaceId } : {}) }),
      requestFocus: (blockId, at, field = "main") => {
        signals.seq.current += 1;
        signals.active.set(blockId);
        signals.focus.set({ blockId, at, field, seq: signals.seq.current });
      },
      focus: signals.focus,
      active: signals.active,
      setActive: (blockId) => signals.active.set(blockId),
      activeEditor: signals.activeEditor,
      caretEditor: signals.caretEditor,
      openInsertMenu: (blockId, replace, anchor, query = "", source) =>
        setInsert({
          blockId,
          replace,
          anchor,
          query,
          source: source ?? (replace ? "slash" : "plus"),
        }),
      insertType: (type, blockId, replace = false) => insertTypeRef.current(type, blockId, replace),
      slashQuery: signals.slashQuery,
      slashKeyHandler: signals.slashKeyHandler,
      docRef,
      notify: (message, tone = "info") =>
        tone === "error"
          ? toast.error(new Error(message))
          : tone === "success"
            ? toast.success(message)
            : toast.show(message),
      hovered: signals.hovered,
      reading: tracker.state,
      sideNotes: {
        model: notes,
        compose: (blockId) => {
          const id = blockId ?? tracker.state.get().blockId;
          if (!id) return;
          notes.compose({ blockId: id, quote: selectedQuote(scroller.current, id) });
          showPanelRef.current("notes");
        },
        show: (noteId) => {
          const note = notes.state.get().notes.find((n) => n.id === noteId);
          notes.focus(noteId);
          showPanelRef.current("notes");
          if (note && !tracker.state.get().inView.includes(note.blockId)) {
            const el = scroller.current?.querySelector(`[data-block-id="${note.blockId}"]`);
            el?.scrollIntoView({ block: "center" });
          }
        },
      },
    }),
    [
      controller,
      store,
      documentId,
      onOpenConcept,
      onOpenQuestion,
      toast,
      signals,
      startDrag,
      onAskAboutBlock,
      tracker,
      notes,
    ],
  );

  // A search hit names a side note: open the notes at it once they are loaded.
  const shownNote = useRef<string | undefined>(undefined);
  const notesPhase = useSyncExternalStore(
    notes.state.subscribe,
    () => notes.state.get().phase,
    () => notes.state.get().phase,
  );
  // biome-ignore lint/correctness/useExhaustiveDependencies: once per note id, when both have loaded
  useEffect(() => {
    if (!focusNoteId || !loaded || notesPhase !== "ready" || shownNote.current === focusNoteId)
      return;
    shownNote.current = focusNoteId;
    const t = setTimeout(() => actions.sideNotes.show(focusNoteId), 300);
    return () => clearTimeout(t);
  }, [focusNoteId, loaded, notesPhase]);

  // The slash menu follows the editor: its query updates as she types, and it closes with the "/".
  useEffect(
    () =>
      signals.slashQuery.subscribe(() => {
        const q = signals.slashQuery.get();
        if (q === null) setInsert((s) => (s?.source === "slash" ? null : s));
      }),
    [signals],
  );

  // A new, empty document starts ready to type. Once per mount: if she deletes the paragraph
  // again, the view must not put it back under her.
  const started = useRef(false);
  const isEmpty = doc ? doc.blocks.length === 0 : null;
  // biome-ignore lint/correctness/useExhaustiveDependencies: runs when the document turns out empty; actions are stable
  useEffect(() => {
    if (!startWriting || isEmpty !== true || started.current) return;
    started.current = true;
    const clientId = newId("block");
    setEditing(true);
    if (
      controller.perform(
        insertBlock(documentId, null, newBlockInput("paragraph"), clientId),
        "Insert block",
      )
    )
      actions.requestFocus(clientId, "start");
  }, [startWriting, isEmpty]);

  const view: DocView = useMemo(
    () => ({ editing, isTouch, layout, refs, status, activeCitation: citation }),
    [editing, isTouch, layout, refs, status, citation],
  );

  useEffect(() => {
    if (!editing) signals.active.set(null);
  }, [editing, signals]);

  // Outline (D13) and the section she is reading.
  const outline: OutlineItem[] = useMemo(() => {
    if (!doc) return [];
    const items: OutlineItem[] = [];
    for (const block of doc.blocks) {
      if (block.type === "heading")
        items.push({
          id: block.id,
          level: block.content.level,
          text: richTextToPlain(block.content.text),
          unverified: block.review.status === "unverified" ? 1 : 0,
        });
      else if (items.length > 0 && block.review.status === "unverified" && block.type !== "divider")
        (items[items.length - 1] as OutlineItem).unverified += 1;
    }
    return items;
  }, [doc]);

  // Jumping from a panel that floats over the page (or the phone's sheet) puts it away.
  const putAway = () => {
    if (layout === "phone") setSheet((s) => ({ ...s, open: false }));
    else if (dock.peek && dock.modes[dock.peek] === "auto") dock.setPeek(null);
  };
  const putAwayRef = useRef(putAway);
  putAwayRef.current = putAway;

  const jumpToHeading = useCallback(
    (id: string) => {
      putAwayRef.current();
      requestAnimationFrame(() => {
        const heading = document.getElementById(`h-${id}`);
        const box = scroller.current;
        if (!heading) return;
        heading.scrollIntoView({ block: "start", behavior: reduced ? "auto" : "smooth" });
        if (reduced || !box) return;
        // Blocks off screen are not drawn until they come near, so a smooth scroll aims with
        // estimated heights and can stop short. When it ends, settle on the heading exactly.
        const settle = () => {
          box.removeEventListener("scrollend", settle);
          clearTimeout(fallback);
          heading.scrollIntoView({ block: "start", behavior: "auto" });
        };
        const fallback = setTimeout(settle, 1200);
        box.addEventListener("scrollend", settle);
      });
    },
    [reduced],
  );

  const jumpToBlock = useCallback(
    (blockId: string) => {
      if (layout === "phone") setSheet((s) => ({ ...s, open: false }));
      scrollToBlock(blockId);
    },
    [layout, scrollToBlock],
  );

  /** The Outline or Notes button: show the panel, or put its sidebar away when it is showing. */
  const togglePanel = (id: PanelId) => {
    if (layout === "phone") {
      setSheet((s) => (s.open && s.tab === id ? { ...s, open: false } : { open: true, tab: id }));
      return;
    }
    const side = sideOf(dock.state, id);
    if (side && dock.visible(id)) dock.toggleSide(side);
    else dock.reveal(id);
  };

  const unverified = doc ? countUnverified(doc.blocks) : 0;
  const nextUnverified = () => {
    if (!doc || !scroller.current) return;
    const top = scroller.current.getBoundingClientRect().top + 90;
    const ids = doc.blocks
      .filter((b) => b.type !== "divider" && b.review.status === "unverified")
      .map((b) => b.id);
    const after = ids.find((id) => {
      const el = scroller.current?.querySelector(`[data-block-id="${id}"]`);
      return el ? el.getBoundingClientRect().top > top + 4 : false;
    });
    const target = after ?? ids[0];
    if (target) scrollToBlock(target);
  };

  const markAll = () => {
    controller.review("reviewed");
    toast.success(`Marked ${unverified} block${unverified === 1 ? "" : "s"} as reviewed.`, {
      label: "Undo",
      run: () => controller.undo(),
    });
  };

  // Keyboard shortcuts on a computer.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      const typing = target?.closest("input, textarea, [contenteditable='true']");
      const mod = event.metaKey || event.ctrlKey;
      // Cmd+Option+M (Ctrl+Alt+M), as for a comment in a word processor: a side note on this block.
      if (editing && mod && event.altKey && event.code === "KeyM" && !target?.closest("textarea")) {
        event.preventDefault();
        actions.sideNotes.compose(signals.active.get());
        return;
      }
      if (typing) return;
      if (mod && event.key.toLowerCase() === "z") {
        event.preventDefault();
        if (event.shiftKey) controller.redo();
        else controller.undo();
      } else if (mod && event.key.toLowerCase() === "y") {
        event.preventDefault();
        controller.redo();
      } else if (event.altKey && event.code === "ArrowDown") {
        event.preventDefault();
        nextUnverified();
      } else if (event.altKey && event.code === "KeyO") {
        event.preventDefault();
        togglePanel("outline");
      } else if (mod && event.shiftKey && event.key === "Enter") {
        const id = signals.active.get();
        if (id) {
          event.preventDefault();
          controller.review("reviewed", [id]);
        }
      } else if (event.key === "Escape") {
        signals.active.set(null);
        notes.focus(null);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  // The page's keys in the app's hotkey list (features/hotkeys/registry.ts, "Document"). The keys above
  // and the editor's own are left as they were; these never fire while she is typing in a block.
  useHotkey("doc.mode", () => setEditing(!editing));
  useHotkey("doc.history", () => setHistoryOpen(true));
  useHotkey("doc.notes", () => togglePanel("notes"), { enabled: layout !== "phone" });
  useHotkey("doc.resources", () => togglePanel("resources"), { enabled: layout !== "phone" });

  // Choosing from the "/" or "+" menu.
  const chooseType = (type: BlockType) => {
    const st = insert;
    setInsert(null);
    signals.slashQuery.set(null);
    if (!st) return;
    insertType(type, st.blockId, st.replace);
  };

  /** Add a block after `blockId` (or in its place) and put the caret in it; shared with the ribbon. */
  const insertType = (type: BlockType, blockId: string | null, replace: boolean) => {
    if (!doc) return;
    const replaceId = replace ? blockId : null;
    if (NEEDS_PAGE.includes(type)) {
      const at = blockId ? doc.blockIds.indexOf(blockId) : -1;
      const afterId = replaceId ? (doc.blockIds[at - 1] ?? null) : blockId;
      setPicker({
        type: type as "image" | "labelled_image",
        afterId,
        ...(replaceId ? { replaceId } : {}),
      });
      return;
    }
    const editable = isTextType(type) || isListType(type);
    // A new table gets the caret in its first cell, ready to type the first heading.
    const field = type === "table" ? "cell-0-0" : "main";
    if (replaceId) {
      if (type === "paragraph") {
        signals.activeEditor.get()?.commands.clearContent(true);
        return;
      }
      const ok = controller.perform(
        [
          {
            call: {
              operation: "update_block",
              input: {
                mode: "replace",
                documentId,
                blockId: replaceId,
                block: newBlockInput(type),
              },
            },
          },
        ],
        "Turn into",
      );
      if (ok && (editable || type === "table")) actions.requestFocus(replaceId, "start", field);
      else if (ok) signals.active.set(replaceId);
      return;
    }
    const clientId = newId("block");
    const ok = controller.perform(
      insertBlock(documentId, blockId, newBlockInput(type), clientId),
      "Insert block",
    );
    if (!ok) return;
    if (editable || type === "table") actions.requestFocus(clientId, "start", field);
    else signals.active.set(clientId);
    if (!editable) requestAnimationFrame(() => scrollToBlock(clientId, false));
  };
  insertTypeRef.current = insertType;

  const onPick = (page: {
    fileId: string;
    pageId: string;
    fileName: string;
    pageIndex: number;
  }) => {
    const p = picker;
    setPicker(null);
    if (!p) return;
    const input = newBlockInput(p.type, {
      image: { fileId: page.fileId, pageId: page.pageId },
      alt: `${page.fileName}, page ${page.pageIndex}`,
    });
    const clientId = newId("block");
    const calls: PendingCall[] = p.replaceId
      ? [
          {
            call: {
              operation: "update_block",
              input: { mode: "replace", documentId, blockId: p.replaceId, block: input },
            },
          },
        ]
      : insertBlock(documentId, p.afterId, input, clientId);
    if (controller.perform(calls, "Insert image")) signals.active.set(p.replaceId ?? clientId);
  };

  const panelData: PanelData = useMemo(
    () => ({
      scroller,
      blocks: doc?.blocks ?? [],
      outline,
      refs,
      status,
      names,
      onJumpHeading: jumpToHeading,
      onJumpBlock: jumpToBlock,
    }),
    [doc?.blocks, outline, refs, status, names, jumpToHeading, jumpToBlock],
  );

  // Errors from the controller as toasts.
  useEffect(() => {
    if (state.error && !state.conflict && state.failed.length === 0)
      toast.error(new Error(state.error));
  }, [state.error, state.conflict, state.failed.length, toast]);

  if (state.phase === "loading" && !doc) {
    return (
      <div
        className={cn(
          "doc-root flex h-full items-center justify-center bg-bg text-text-muted",
          className,
        )}
        aria-busy="true"
      >
        <LoaderCircle aria-hidden className="mr-2 size-5 animate-spin" /> Loading…
      </div>
    );
  }
  if (state.phase === "error" || !doc) {
    return (
      <div
        className={cn(
          "doc-root flex h-full flex-col items-center justify-center gap-3 bg-bg p-6 text-center",
          className,
        )}
        role="alert"
      >
        <p className="m-0 font-semibold">This document couldn’t be opened.</p>
        <p className="m-0 text-ui text-text-muted">{state.loadError}</p>
        <Button variant="secondary" onClick={() => void controller.load()}>
          Try again
        </Button>
      </div>
    );
  }

  // The source panel takes the right sidebar's place while it is open.
  const sideCitation = citation !== null && layout !== "phone";

  return (
    <ActionsContext.Provider value={actions}>
      <ViewContext.Provider value={view}>
        <div
          className={cn("doc-root flex h-full min-h-0 bg-bg text-text", className)}
          data-editing={editing ? "true" : "false"}
        >
          <div className="relative flex min-w-0 flex-1 flex-col">
            <TopBar
              editing={editing}
              setEditing={setEditing}
              state={state}
              controller={controller}
              unverified={unverified}
              onNext={nextUnverified}
              onOutline={() => togglePanel("outline")}
              outlineOpen={
                layout === "phone" ? sheet.open && sheet.tab === "outline" : dock.visible("outline")
              }
              onNotes={() => togglePanel("notes")}
              notesOpen={layout !== "phone" && dock.visible("notes")}
              dock={layout === "phone" ? null : dock}
              onHistory={() => setHistoryOpen(true)}
              compact={layout === "phone"}
              // The ribbon has undo and redo from tablet width; the phone dock has them on touch.
              showUndo={editing && layout === "phone" && !isTouch}
            />
            {editing && layout !== "phone" && (
              <Ribbon
                blocks={doc.blocks}
                canUndo={state.canUndo}
                canRedo={state.canRedo}
                touch={isTouch}
              />
            )}
            <DocumentDock
              dock={dock}
              data={panelData}
              {...(sideCitation ? { suppress: ["right" as const] } : {})}
            >
              <div
                ref={scroller}
                className="@container/page min-h-0 flex-1 overflow-y-auto overscroll-contain"
                data-testid="doc-scroller"
              >
                <div className="relative">
                  <article
                    data-testid="doc-page"
                    className={cn(
                      "mx-auto max-w-[46rem] pt-8 pb-[40vh]",
                      "px-[max(20px,env(safe-area-inset-left))]",
                      // From tablet up the document is a sheet of paper on the desk, as in a word
                      // processor; the space under it lets the last lines scroll up to eye level.
                      // Measured on the page column, not the window: the sidebars take some of it.
                      "@min-[520px]/page:mt-6 @min-[520px]/page:mb-[40vh] @min-[520px]/page:w-[calc(100%-3rem)] @min-[520px]/page:max-w-[52rem] @min-[520px]/page:rounded-panel @min-[520px]/page:border @min-[520px]/page:border-border @min-[520px]/page:bg-surface @min-[520px]/page:px-14 @min-[520px]/page:pt-12 @min-[520px]/page:pb-16 @min-[520px]/page:shadow-card",
                      // The hover gutter (+ and the drag handle) needs room on the left of the text.
                      editing && !isTouch
                        ? "@min-[880px]/page:pr-16 @min-[880px]/page:pl-24"
                        : "@min-[880px]/page:px-20",
                    )}
                    aria-labelledby="doc-title"
                  >
                    <header className="mb-8 @min-[520px]/page:mb-10 @min-[520px]/page:border-b @min-[520px]/page:border-border @min-[520px]/page:pb-8">
                      <p className="m-0 text-label font-semibold uppercase tracking-[0.08em] text-text-muted">
                        {KIND_LABEL[doc.kind]}
                      </p>
                      <h1
                        id="doc-title"
                        className="mt-1.5 mb-0 font-display text-[2.1rem] leading-[1.15] font-bold tracking-[-0.02em] text-balance md:text-[2.6rem]"
                      >
                        {doc.title}
                      </h1>
                      <p className="mt-2 mb-0 text-label text-text-muted">
                        {doc.blocks.length} blocks · {refs.references.length} sources · edited{" "}
                        {formatWhen(doc.updatedAt)}
                      </p>
                      <ReviewSummary
                        unverified={unverified}
                        onNext={nextUnverified}
                        onMarkAll={markAll}
                      />
                    </header>
                    <div data-testid="blocks">
                      {doc.blocks.map((block, index) => (
                        <BlockShell
                          key={block.id}
                          block={block}
                          index={index}
                          count={doc.blocks.length}
                        />
                      ))}
                    </div>
                    {editing && (
                      <button
                        type="button"
                        data-testid="add-block-end"
                        onClick={(e) =>
                          actions.openInsertMenu(
                            doc.blockIds[doc.blockIds.length - 1] ?? null,
                            false,
                            e.currentTarget.getBoundingClientRect(),
                          )
                        }
                        className="mt-6 flex min-h-11 w-full items-center gap-2 rounded-card border border-dashed border-border-strong px-3 text-ui text-text-muted transition-colors duration-(--duration-instant) hover:border-accent-border hover:bg-accent-soft hover:text-accent"
                      >
                        <Plus aria-hidden className="size-4" /> Add a block
                      </button>
                    )}
                    <References names={names} blocks={doc.blocks} />
                  </article>
                  {drop && (
                    <div
                      aria-hidden
                      data-testid="drop-indicator"
                      className="pointer-events-none absolute right-0 left-0 mx-auto h-1 max-w-[46rem] rounded-pill bg-selection shadow-[0_0_0_3px_var(--hue-blue-soft)]"
                      style={{ top: drop.top }}
                    />
                  )}
                </div>
              </div>
            </DocumentDock>
          </div>

          {sideCitation && (
            <aside
              aria-label="Source"
              className="anim-fade relative flex shrink-0 flex-col border-l border-border bg-surface pr-[env(safe-area-inset-right)]"
              style={{ width: panelWidth } as CSSProperties}
            >
              <ResizeHandle width={panelWidth} setWidth={setPanelWidth} />
              <CitationPanel
                number={citation as number}
                onNavigate={setCitation}
                onClose={() => setCitation(null)}
                variant="side"
              />
            </aside>
          )}

          {layout === "phone" && (
            <Sheet
              open={citation !== null}
              onOpenChange={(open) => !open && setCitation(null)}
              title="Source"
              placement="bottom"
              flush
              testId="citation-sheet"
            >
              {citation !== null && (
                <div className="h-[80dvh]">
                  <CitationPanel number={citation} onNavigate={setCitation} variant="sheet" />
                </div>
              )}
            </Sheet>
          )}

          {layout === "phone" && (
            <PanelsSheet
              open={sheet.open}
              tab={sheet.tab}
              onTab={(tab) => setSheet({ open: true, tab })}
              onOpenChange={(open) => setSheet((s) => ({ ...s, open }))}
              data={panelData}
            />
          )}

          <Sheet
            open={historyOpen}
            onOpenChange={setHistoryOpen}
            title="Version history"
            description="Every saved change. Restoring keeps the current version too."
            placement="center"
            wide
            flush
            testId="history"
          >
            {historyOpen && (
              <HistoryPanel
                compact={layout === "phone"}
                onRestored={(n) => {
                  setHistoryOpen(false);
                  toast.success(`Restored revision ${n}.`);
                }}
              />
            )}
          </Sheet>

          <RequestDialog
            blockId={request?.blockId ?? null}
            initialKind={request?.kind ?? "wrong"}
            onClose={() => setRequest(null)}
          />
          <PagePicker open={picker !== null} onClose={() => setPicker(null)} onPick={onPick} />
          {insert && (
            <InsertMenu
              state={insert}
              onChoose={chooseType}
              onClose={() => {
                setInsert(null);
                signals.slashQuery.set(null);
              }}
              keyHandler={signals.slashKeyHandler}
              sheet={insert.source === "plus" && layout === "phone"}
            />
          )}
          {editing && layout === "phone" && <KeyboardDock blocks={doc.blocks} />}
          {editing && layout !== "phone" && !isTouch && <SelectionBubble />}
        </div>
      </ViewContext.Provider>
    </ActionsContext.Provider>
  );
}

function ResizeHandle({ width, setWidth }: { width: number; setWidth: (w: number) => void }) {
  const clamp = (w: number) => Math.round(Math.max(320, Math.min(w, window.innerWidth * 0.7)));
  return (
    // biome-ignore lint/a11y/useSemanticElements: a focusable splitter is the ARIA pattern for this
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label="Resize the source panel"
      aria-valuenow={width}
      aria-valuemin={320}
      aria-valuemax={Math.round(window.innerWidth * 0.7)}
      tabIndex={0}
      data-testid="panel-resize"
      className="group absolute top-0 bottom-0 -left-2 z-(--z-raised) flex w-4 cursor-col-resize touch-none justify-center"
      onKeyDown={(e) => {
        if (e.key === "ArrowLeft") setWidth(clamp(width + 24));
        if (e.key === "ArrowRight") setWidth(clamp(width - 24));
      }}
      onPointerDown={(e) => {
        const startX = e.clientX;
        const startW = width;
        const move = (ev: PointerEvent) => setWidth(clamp(startW + startX - ev.clientX));
        const up = () => {
          window.removeEventListener("pointermove", move);
          window.removeEventListener("pointerup", up);
          document.body.style.userSelect = "";
        };
        document.body.style.userSelect = "none";
        window.addEventListener("pointermove", move);
        window.addEventListener("pointerup", up);
      }}
    >
      <span className="h-full w-0.5 bg-transparent transition-colors group-hover:bg-selection group-focus-visible:bg-selection" />
      <span className="absolute top-1/2 h-10 w-1.5 -translate-y-1/2 rounded-pill bg-border-strong group-hover:bg-selection" />
    </div>
  );
}

function ReviewSummary({
  unverified,
  onNext,
  onMarkAll,
}: {
  unverified: number;
  onNext: () => void;
  onMarkAll: () => void;
}) {
  if (unverified === 0) {
    return (
      <p
        className="mt-4 mb-0 inline-flex items-center gap-2 rounded-pill border border-success-border bg-success-soft px-3 py-1 text-label font-medium text-success"
        data-testid="all-reviewed"
      >
        <CircleCheckBig aria-hidden className="size-4" /> Everything here is reviewed
      </p>
    );
  }
  return (
    <div className="@container mt-5">
      <div
        className="flex flex-col gap-3 rounded-card border border-warning-border bg-warning-soft px-4 py-3 @[34rem]:flex-row @[34rem]:items-center"
        data-testid="review-summary"
      >
        <TriangleAlert aria-hidden className="hidden size-5 shrink-0 text-warning @[34rem]:block" />
        <p className="m-0 flex-1 text-ui leading-snug text-warning">
          <strong className="font-semibold">
            {unverified} block{unverified === 1 ? "" : "s"} to review.
          </strong>{" "}
          An agent wrote {unverified === 1 ? "it" : "them"}; check against your sources.
        </p>
        <div className="flex gap-2">
          <Button size="sm" variant="secondary" onClick={onNext}>
            <ArrowDown aria-hidden className="size-3.5" /> Next
          </Button>
          <Button size="sm" variant="secondary" onClick={onMarkAll} data-testid="mark-all-reviewed">
            <Check aria-hidden className="size-3.5" /> Mark all reviewed
          </Button>
        </div>
      </div>
    </div>
  );
}

function SaveStatus({
  state,
  controller,
  compact,
}: {
  state: DocumentController["state"];
  controller: DocumentController;
  compact: boolean;
}) {
  if (state.saveStatus === "failed") {
    return (
      <span
        role="status"
        className="inline-flex items-center gap-1.5 text-label text-danger"
        data-testid="save-status"
        data-status="failed"
      >
        <CloudAlert aria-hidden className="size-4" />
        {!compact && (state.conflict ? "Changed elsewhere" : "Not saved")}
        <button
          type="button"
          className="min-h-9 rounded-control px-2 font-semibold underline underline-offset-2 pointer-coarse:min-h-11"
          onClick={() => (state.conflict ? void controller.load() : controller.retry())}
        >
          {state.conflict ? "Reload" : "Retry"}
        </button>
      </span>
    );
  }
  const saving = state.saveStatus === "saving";
  return (
    <span
      role="status"
      className="inline-flex items-center gap-1.5 text-label text-text-muted"
      data-testid="save-status"
      data-status={state.saveStatus}
    >
      {saving ? (
        <LoaderCircle aria-hidden className="size-4 animate-spin" />
      ) : (
        <CloudCheck aria-hidden className="size-4" />
      )}
      <span className={cn(compact && "sr-only")}>{saving ? "Saving…" : "Saved"}</span>
    </span>
  );
}

/** The Read and Edit choices in the document bar: one height with the rest of the bar. */
const MODE_ITEM =
  "inline-flex min-h-11 items-center gap-1.5 rounded-control px-2.5 text-label font-semibold transition-colors duration-(--duration-instant) xl:min-h-7";
const MODE_ON = "bg-accent text-accent-contrast shadow-card";
const MODE_OFF = "text-text-muted hover:text-text";

/** Where the mode she last chose is kept, on this device. */
const MODE_KEY = "notes-doc-mode";
function rememberedMode(): "read" | "edit" | null {
  try {
    const saved = localStorage.getItem(MODE_KEY);
    return saved === "read" || saved === "edit" ? saved : null;
  } catch {
    return null;
  }
}

/** The thin line between groups in the document bar. */
function BarLine() {
  return <span aria-hidden className="mx-0.5 h-5 w-px shrink-0 bg-border" />;
}

function TopBar({
  editing,
  setEditing,
  state,
  controller,
  unverified,
  onNext,
  onOutline,
  outlineOpen,
  onNotes,
  notesOpen,
  dock,
  onHistory,
  compact,
  showUndo,
}: {
  editing: boolean;
  setEditing: (e: boolean) => void;
  state: DocumentController["state"];
  controller: DocumentController;
  unverified: number;
  onNext: () => void;
  onOutline: () => void;
  outlineOpen: boolean;
  onNotes: () => void;
  notesOpen: boolean;
  /** The sidebars, from tablet width up; the phone has its sheet instead. */
  dock: DockApi | null;
  onHistory: () => void;
  compact: boolean;
  showUndo: boolean;
}) {
  const modeKeys = useHotkeyAria("doc.mode");
  return (
    <div className="sticky top-0 z-(--z-sticky) flex shrink-0 items-center gap-2 border-b border-border bg-surface/85 px-2 pb-1.5 pt-[max(0.375rem,env(safe-area-inset-top))] backdrop-blur md:px-3">
      <div className="flex min-w-0 flex-1 items-center gap-1">
        <SaveStatus state={state} controller={controller} compact={compact} />
        {showUndo && (
          <>
            <span aria-hidden className="mx-1 h-5 w-px bg-border" />
            <IconButton
              label="Undo (⌘Z)"
              size="sm"
              disabled={!state.canUndo}
              onClick={() => controller.undo()}
            >
              <Undo2 className="size-4" />
            </IconButton>
            <IconButton
              label="Redo (⇧⌘Z)"
              size="sm"
              disabled={!state.canRedo}
              onClick={() => controller.redo()}
            >
              <Redo2 className="size-4" />
            </IconButton>
          </>
        )}
      </div>
      {/* One bar for everything on the right: every control the same height (44px on touch, 32px on a
          computer) and the same corners, grouped by what it does with a thin line between the groups:
          review, the side panels, history, and Edit. */}
      <div
        role="toolbar"
        aria-label="Document"
        data-testid="doc-toolbar"
        className="inline-flex shrink-0 items-center gap-0.5 rounded-card border border-border-strong bg-surface p-1 shadow-card"
      >
        {unverified > 0 && (
          <>
            <button
              type="button"
              onClick={onNext}
              data-testid="unverified-count"
              aria-label={`${unverified} unverified: jump to the next`}
              className="inline-flex min-h-11 items-center gap-1.5 rounded-control bg-warning-soft px-2.5 text-label font-semibold text-warning tabular-nums transition-colors duration-(--duration-instant) hover:brightness-95 xl:min-h-8"
            >
              <TriangleAlert aria-hidden className="size-3.5" />
              <span data-testid="unverified-number">{unverified}</span>
              <span className={cn(compact && "sr-only")}>to review</span>
              <ArrowDown aria-hidden className="size-3.5" />
            </button>
            <BarLine />
          </>
        )}
        <IconButton
          variant="bare"
          size="sm"
          label={dock ? "Outline" : "Outline, resources and side notes"}
          hotkey="doc.outline"
          pressed={outlineOpen}
          onClick={onOutline}
          data-testid="outline-button"
        >
          <ListTree className="size-[18px]" />
        </IconButton>
        {dock && (
          <>
            <IconButton
              variant="bare"
              size="sm"
              label="Side notes"
              hotkey="doc.notes"
              pressed={notesOpen}
              onClick={onNotes}
              data-testid="notes-button"
            >
              <MessageSquareText className="size-[18px]" />
            </IconButton>
            <PanelsMenu dock={dock} />
          </>
        )}
        <BarLine />
        <IconButton
          variant="bare"
          size="sm"
          label="Version history"
          hotkey="doc.history"
          onClick={onHistory}
          data-testid="history-button"
        >
          <History className="size-[18px]" />
        </IconButton>
        <BarLine />
        {/* Two modes, always both on show. Read is for studying: no caret, no handles, no formatting
            bar, and a tap on a source or a concept just opens it. Edit is for writing. Her choice is
            remembered on this device. Pressing Edit again while editing also goes back to reading. */}
        <fieldset
          aria-label="Mode"
          className="m-0 inline-flex gap-0.5 rounded-control border-0 bg-surface-muted p-0.5"
        >
          <button
            type="button"
            onClick={() => setEditing(false)}
            data-testid="mode-read"
            aria-pressed={!editing}
            className={cn(MODE_ITEM, !editing ? MODE_ON : MODE_OFF)}
          >
            <BookOpen aria-hidden className="size-3.5" />
            <span className={cn(compact && "sr-only")}>Read</span>
          </button>
          {/* The bar is tight: the key for the two modes shows in a hint, not as a badge. */}
          <HotkeyTooltip hotkey="doc.mode" content="Switch between Read and Edit">
            <button
              type="button"
              onClick={() => setEditing(!editing)}
              data-testid="mode-toggle"
              aria-pressed={editing}
              aria-keyshortcuts={modeKeys}
              className={cn(MODE_ITEM, editing ? MODE_ON : MODE_OFF)}
            >
              <Pencil aria-hidden className="size-3.5" />
              <span className={cn(compact && "sr-only")}>Edit</span>
            </button>
          </HotkeyTooltip>
        </fieldset>
      </div>
    </div>
  );
}

/** Words she has selected inside a block, as a side note's quote (at most 300 characters). */
function selectedQuote(scroller: HTMLElement | null, blockId: string): string | null {
  const selection = typeof window === "undefined" ? null : window.getSelection();
  if (!selection || selection.isCollapsed || !scroller) return null;
  const block = scroller.querySelector(`[data-block-id="${blockId}"]`);
  const node = selection.anchorNode;
  if (!block || !node || !block.contains(node)) return null;
  const text = selection.toString().replace(/\s+/g, " ").trim();
  return text ? text.slice(0, 300) : null;
}
