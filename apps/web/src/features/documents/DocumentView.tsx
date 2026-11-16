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
  Check,
  CircleCheckBig,
  CloudAlert,
  CloudCheck,
  History,
  ListTree,
  LoaderCircle,
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
import { BlockShell } from "./blocks/BlockShell";
import {
  ActionsContext,
  type DocActions,
  type DocView,
  type FocusRequest,
  Signal,
  ViewContext,
} from "./context";
import { FormatToolbar } from "./editor/FormatToolbar";
import { InsertMenu, type InsertMenuState } from "./editor/InsertMenu";
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
import { HistoryPanel } from "./panels/HistoryPanel";
import { type OutlineItem, OutlinePanel } from "./panels/OutlinePanel";
import { References } from "./panels/References";
import { DocumentController } from "./state/controller";
import type { DocumentStore, RequestKind } from "./store/types";
import { formatWhen, useIsTouch, useLayout, useReducedMotion } from "./ui/hooks";
import { Button, cx, IconButton, Sheet, ToastProvider, useToast } from "./ui/primitives";
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
  /** Scroll to this block and flash it once the document has loaded (a search hit, a link). */
  focusBlockId?: string | undefined;
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
  return (
    <ToastProvider>
      <DocumentScreen {...props} />
    </ToastProvider>
  );
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
  const [editing, setEditing] = useState(() => (initialMode ? initialMode === "edit" : !isTouch));
  const refs = useStableRefs(doc?.blocks);
  const [status, setStatus] = useState<Map<string, CitationStatus>>(() => new Map());
  const [names, setNames] = useState<
    Map<string, { fileName: string | null; pageIndex: number | null }>
  >(() => new Map());
  const [citation, setCitation] = useState<number | null>(null);
  const [outlineOpen, setOutlineOpen] = useState(layout === "computer");
  const [historyOpen, setHistoryOpen] = useState(false);
  const [request, setRequest] = useState<{ blockId: string; kind: RequestKind } | null>(null);
  const [insert, setInsert] = useState<InsertMenuState | null>(null);
  const [picker, setPicker] = useState<{
    type: "image" | "labelled_image";
    afterId: string | null;
    replaceId?: string;
  } | null>(null);
  const [panelWidth, setPanelWidth] = useState(layout === "computer" ? 460 : 400);
  const [currentHeading, setCurrentHeading] = useState<string | null>(null);
  const [drop, setDrop] = useState<{
    blockId: string;
    top: number;
    beforeId: string | null;
  } | null>(null);
  const scroller = useRef<HTMLDivElement>(null);
  const docRef = useRef(doc);
  docRef.current = doc;
  const lastDragEnd = useRef(0);

  useEffect(() => {
    if (layout === "computer") setOutlineOpen(true);
    else setOutlineOpen(false);
  }, [layout]);

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
      slashQuery: new Signal<{ blockId: string; query: string } | null>(null),
      slashKeyHandler: { current: null as ((key: string) => boolean) | null },
      seq: { current: 0 },
    }),
    [],
  );

  const scrollToBlock = useCallback(
    (blockId: string, flash = true) => {
      const el = scroller.current?.querySelector(`[data-block-id="${blockId}"]`);
      if (!el) return;
      el.scrollIntoView({ block: "center", behavior: reduced ? "auto" : "smooth" });
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
      askAbout: (blockId, kind = "wrong") => setRequest({ blockId, kind }),
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
      openInsertMenu: (blockId, replace, anchor, query = "") =>
        setInsert({ blockId, replace, anchor, query, source: replace ? "slash" : "plus" }),
      slashQuery: signals.slashQuery,
      slashKeyHandler: signals.slashKeyHandler,
      docRef,
      notify: (message, tone = "info") => toast.show(message, { tone }),
    }),
    [controller, store, documentId, onOpenConcept, onOpenQuestion, toast, signals, startDrag],
  );

  // The slash menu follows the editor: its query updates as she types, and it closes with the "/".
  useEffect(
    () =>
      signals.slashQuery.subscribe(() => {
        const q = signals.slashQuery.get();
        if (q === null) setInsert((s) => (s?.source === "slash" ? null : s));
      }),
    [signals],
  );

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

  useEffect(() => {
    const box = scroller.current;
    if (!box) return;
    let frame = 0;
    const update = () => {
      frame = 0;
      const top = box.getBoundingClientRect().top + 96;
      let current: string | null = outline[0]?.id ?? null;
      for (const item of outline) {
        const el = document.getElementById(`h-${item.id}`);
        if (el && el.getBoundingClientRect().top <= top) current = item.id;
      }
      setCurrentHeading(current);
    };
    const onScroll = () => {
      if (!frame) frame = requestAnimationFrame(update);
    };
    update();
    box.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      box.removeEventListener("scroll", onScroll);
      cancelAnimationFrame(frame);
    };
  }, [outline]);

  const jumpToHeading = (id: string) => {
    if (layout !== "computer") setOutlineOpen(false);
    requestAnimationFrame(() =>
      document
        .getElementById(`h-${id}`)
        ?.scrollIntoView({ block: "start", behavior: reduced ? "auto" : "smooth" }),
    );
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
    toast.show(`Marked ${unverified} block${unverified === 1 ? "" : "s"} as reviewed.`, {
      tone: "success",
      action: { label: "Undo", run: () => controller.undo() },
    });
  };

  // Keyboard shortcuts on a computer.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      const typing = target?.closest("input, textarea, [contenteditable='true']");
      const mod = event.metaKey || event.ctrlKey;
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
        setOutlineOpen((o) => !o);
      } else if (mod && event.shiftKey && event.key === "Enter") {
        const id = signals.active.get();
        if (id) {
          event.preventDefault();
          controller.review("reviewed", [id]);
        }
      } else if (event.key === "Escape") {
        signals.active.set(null);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  // Choosing from the "/" or "+" menu.
  const chooseType = (type: BlockType) => {
    const st = insert;
    setInsert(null);
    signals.slashQuery.set(null);
    if (!st || !doc) return;
    const replaceId = st.replace ? st.blockId : null;
    if (NEEDS_PAGE.includes(type)) {
      const at = st.blockId ? doc.blockIds.indexOf(st.blockId) : -1;
      const afterId = replaceId ? (doc.blockIds[at - 1] ?? null) : st.blockId;
      setPicker({
        type: type as "image" | "labelled_image",
        afterId,
        ...(replaceId ? { replaceId } : {}),
      });
      return;
    }
    const editable = isTextType(type) || isListType(type);
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
      if (ok && editable) actions.requestFocus(replaceId, "start");
      else if (ok) signals.active.set(replaceId);
      return;
    }
    const clientId = newId("block");
    const ok = controller.perform(
      insertBlock(documentId, st.blockId, newBlockInput(type), clientId),
      "Insert block",
    );
    if (!ok) return;
    if (editable) actions.requestFocus(clientId, "start");
    else {
      signals.active.set(clientId);
      requestAnimationFrame(() => scrollToBlock(clientId, false));
    }
  };

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

  // Errors from the controller as toasts.
  useEffect(() => {
    if (state.error && !state.conflict && state.failed.length === 0)
      toast.show(state.error, { tone: "error" });
  }, [state.error, state.conflict, state.failed.length, toast]);

  if (state.phase === "loading" && !doc) {
    return (
      <div
        className={cx(
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
        className={cx(
          "doc-root flex h-full flex-col items-center justify-center gap-3 bg-bg p-6 text-center",
          className,
        )}
        role="alert"
      >
        <p className="m-0 font-semibold">This document couldn’t be opened.</p>
        <p className="m-0 text-sm text-text-muted">{state.loadError}</p>
        <Button variant="outline" onClick={() => void controller.load()}>
          Try again
        </Button>
      </div>
    );
  }

  const sideCitation = citation !== null && layout !== "phone";
  const sideOutline = !sideCitation && outlineOpen && layout === "computer";
  const showSide = sideCitation || sideOutline;

  return (
    <ActionsContext.Provider value={actions}>
      <ViewContext.Provider value={view}>
        <div
          className={cx("doc-root flex h-full min-h-0 bg-bg text-text", className)}
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
              onOutline={() => setOutlineOpen((o) => !o)}
              outlineOpen={outlineOpen && layout === "computer"}
              onHistory={() => setHistoryOpen(true)}
              compact={layout === "phone"}
              touch={isTouch}
            />
            <div
              ref={scroller}
              className="min-h-0 flex-1 overflow-y-auto overscroll-contain"
              data-testid="doc-scroller"
            >
              <div className="relative">
                <article
                  className={cx(
                    "mx-auto max-w-[46rem] pt-8 pb-[40vh]",
                    "px-[max(20px,env(safe-area-inset-left))] md:px-12",
                    editing && !isTouch ? "xl:pr-12 xl:pl-24" : "xl:px-16",
                  )}
                  aria-labelledby="doc-title"
                >
                  <header className="mb-8">
                    <p className="m-0 text-[12.5px] font-semibold uppercase tracking-[0.08em] text-text-muted">
                      {KIND_LABEL[doc.kind]}
                    </p>
                    <h1
                      id="doc-title"
                      className="mt-1 mb-0 text-[2.1rem] leading-[1.15] font-bold tracking-[-0.02em] md:text-[2.5rem]"
                    >
                      {doc.title}
                    </h1>
                    <p className="mt-2 mb-0 text-[13.5px] text-text-muted">
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
                      className="mt-4 flex min-h-11 w-full items-center gap-2 rounded-2xl px-3 text-[14px] text-text-muted transition-colors hover:bg-surface"
                    >
                      <Plus aria-hidden className="size-4" /> Add a block
                    </button>
                  )}
                  <References names={names} />
                </article>
                {drop && (
                  <div
                    aria-hidden
                    data-testid="drop-indicator"
                    className="pointer-events-none absolute right-0 left-0 mx-auto h-1 max-w-[46rem] rounded-full bg-[var(--doc-blue-solid)] shadow-[0_0_0_3px_var(--doc-blue-bg)]"
                    style={{ top: drop.top }}
                  />
                )}
              </div>
            </div>
          </div>

          {showSide && (
            <aside
              aria-label={sideCitation ? "Source" : "Outline"}
              className="doc-anim-fade relative flex shrink-0 flex-col border-l border-border bg-surface pr-[env(safe-area-inset-right)]"
              style={{ width: sideCitation ? panelWidth : 288 } as CSSProperties}
            >
              {sideCitation ? (
                <>
                  <ResizeHandle width={panelWidth} setWidth={setPanelWidth} />
                  <CitationPanel
                    number={citation as number}
                    onNavigate={setCitation}
                    onClose={() => setCitation(null)}
                    variant="side"
                  />
                </>
              ) : (
                <>
                  <p className="m-0 border-b border-border px-5 py-3 text-[12px] font-semibold uppercase tracking-[0.08em] text-text-muted">
                    On this page
                  </p>
                  <div className="min-h-0 flex-1 overflow-y-auto">
                    <OutlinePanel items={outline} current={currentHeading} onJump={jumpToHeading} />
                  </div>
                </>
              )}
            </aside>
          )}

          {layout === "phone" && (
            <Sheet
              open={citation !== null}
              onOpenChange={(open) => !open && setCitation(null)}
              title="Source"
              side="bottom"
              testId="citation-sheet"
            >
              {citation !== null && (
                <div className="h-[80dvh]">
                  <CitationPanel number={citation} onNavigate={setCitation} variant="sheet" />
                </div>
              )}
            </Sheet>
          )}

          {layout !== "computer" && (
            <Sheet
              open={outlineOpen}
              onOpenChange={setOutlineOpen}
              title="Outline"
              side={layout === "phone" ? "bottom" : "right"}
              testId="outline-sheet"
            >
              <OutlinePanel items={outline} current={currentHeading} onJump={jumpToHeading} />
            </Sheet>
          )}

          <Sheet
            open={historyOpen}
            onOpenChange={setHistoryOpen}
            title="Version history"
            description="Every saved change. Restoring keeps the current version too."
            side={layout === "phone" ? "bottom" : "center"}
            wide
            testId="history"
          >
            {historyOpen && (
              <HistoryPanel
                compact={layout === "phone"}
                onRestored={(n) => {
                  setHistoryOpen(false);
                  toast.show(`Restored revision ${n}.`, { tone: "success" });
                }}
              />
            )}
          </Sheet>

          <RequestDialog
            blockId={request?.blockId ?? null}
            initialKind={request?.kind ?? "wrong"}
            onClose={() => setRequest(null)}
            layout={layout}
          />
          <PagePicker
            open={picker !== null}
            onClose={() => setPicker(null)}
            onPick={onPick}
            layout={layout}
          />
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
          {editing && <FormatToolbar touch={isTouch} />}
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
      className="group absolute top-0 bottom-0 -left-2 z-10 flex w-4 cursor-col-resize touch-none justify-center"
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
      <span className="h-full w-0.5 bg-transparent transition-colors group-hover:bg-[var(--doc-blue-solid)] group-focus-visible:bg-[var(--doc-blue-solid)]" />
      <span className="absolute top-1/2 h-10 w-1.5 -translate-y-1/2 rounded-full bg-border group-hover:bg-[var(--doc-blue-solid)]" />
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
        className="mt-4 mb-0 inline-flex items-center gap-2 rounded-full border border-[var(--doc-green-border)] bg-[var(--doc-green-bg)] px-3 py-1 text-[13px] font-medium text-[var(--doc-green-fg)]"
        data-testid="all-reviewed"
      >
        <CircleCheckBig aria-hidden className="size-4" /> Everything here is reviewed
      </p>
    );
  }
  return (
    <div className="@container mt-5">
      <div
        className="flex flex-col gap-3 rounded-2xl border border-[var(--doc-yellow-border)] bg-[var(--doc-yellow-bg)] px-4 py-3 @[34rem]:flex-row @[34rem]:items-center"
        data-testid="review-summary"
      >
        <TriangleAlert
          aria-hidden
          className="hidden size-5 shrink-0 text-[var(--doc-yellow-fg)] @[34rem]:block"
        />
        <p className="m-0 flex-1 text-[14px] leading-snug text-[var(--doc-yellow-fg)]">
          <strong className="font-semibold">
            {unverified} block{unverified === 1 ? "" : "s"} to review.
          </strong>{" "}
          An agent wrote {unverified === 1 ? "it" : "them"}; check against your sources.
        </p>
        <div className="flex gap-2">
          <Button size="sm" variant="outline" onClick={onNext}>
            <ArrowDown aria-hidden className="size-3.5" /> Next
          </Button>
          <Button size="sm" variant="outline" onClick={onMarkAll} data-testid="mark-all-reviewed">
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
        className="inline-flex items-center gap-1.5 text-[13px] text-[var(--doc-red-fg)]"
        data-testid="save-status"
        data-status="failed"
      >
        <CloudAlert aria-hidden className="size-4" />
        {!compact && (state.conflict ? "Changed elsewhere" : "Not saved")}
        <button
          type="button"
          className="min-h-9 rounded-lg px-2 font-semibold underline underline-offset-2 pointer-coarse:min-h-11"
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
      className="inline-flex items-center gap-1.5 text-[13px] text-text-muted"
      data-testid="save-status"
      data-status={state.saveStatus}
    >
      {saving ? (
        <LoaderCircle aria-hidden className="size-4 animate-spin" />
      ) : (
        <CloudCheck aria-hidden className="size-4" />
      )}
      <span className={cx(compact && "sr-only")}>{saving ? "Saving…" : "Saved"}</span>
    </span>
  );
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
  onHistory,
  compact,
  touch,
}: {
  editing: boolean;
  setEditing: (e: boolean) => void;
  state: DocumentController["state"];
  controller: DocumentController;
  unverified: number;
  onNext: () => void;
  onOutline: () => void;
  outlineOpen: boolean;
  onHistory: () => void;
  compact: boolean;
  touch: boolean;
}) {
  return (
    <div className="sticky top-0 z-20 flex shrink-0 items-center gap-1 border-b border-border bg-surface/85 px-2 pt-[env(safe-area-inset-top)] backdrop-blur md:px-3">
      <div className="flex min-h-14 flex-1 items-center gap-1">
        <SaveStatus state={state} controller={controller} compact={compact} />
        {editing && !touch && (
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
      {unverified > 0 && (
        <button
          type="button"
          onClick={onNext}
          data-testid="unverified-count"
          aria-label={`${unverified} unverified: jump to the next`}
          className="inline-flex min-h-9 items-center gap-1.5 rounded-full border border-[var(--doc-yellow-border)] bg-[var(--doc-yellow-bg)] px-3 text-[13px] font-semibold text-[var(--doc-yellow-fg)] tabular-nums pointer-coarse:min-h-11"
        >
          <TriangleAlert aria-hidden className="size-3.5" />
          <span data-testid="unverified-number">{unverified}</span>
          <span className={cx(compact && "sr-only")}>to review</span>
          <ArrowDown aria-hidden className="size-3.5" />
        </button>
      )}
      <IconButton
        label="Outline"
        aria-pressed={outlineOpen}
        onClick={onOutline}
        data-testid="outline-button"
      >
        <ListTree className="size-[18px]" />
      </IconButton>
      <IconButton label="Version history" onClick={onHistory} data-testid="history-button">
        <History className="size-[18px]" />
      </IconButton>
      <Button
        variant={editing ? "primary" : "outline"}
        size="sm"
        onClick={() => setEditing(!editing)}
        data-testid="mode-toggle"
        aria-pressed={editing}
        className="ml-1"
      >
        {editing ? (
          <Check aria-hidden className="size-4" />
        ) : (
          <Pencil aria-hidden className="size-3.5" />
        )}
        {editing ? "Done" : "Edit"}
      </Button>
    </div>
  );
}
