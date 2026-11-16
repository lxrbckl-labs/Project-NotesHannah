import type { MarginNote } from "@notes/schema";
import { Plus, Unlink } from "lucide-react";
import { memo, type RefObject, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Button, IconButton } from "../../../../components/ui/button";
import { ConfirmDialog } from "../../../../components/ui/dialog";
import { useToast } from "../../../../components/ui/toast";
import { cn } from "../../../../lib/cn";
import { useActions, useSignal } from "../../context";
import { AlignedLayout } from "./align";
import type { NotesState } from "./model";
import { NoteCard, NoteEditor } from "./NoteCard";

const COMPOSER = "composer";

/**
 * Side notes (P3): beside the page, each note level with its block and moving with it as she
 * scrolls ("aligned", in a sidebar), or as a list in page order (the phone's sheet). Detached
 * notes, whose block is gone, wait under "Detached" until she attaches them again or deletes them.
 */
export const NotesPanel = memo(function NotesPanel({
  mode,
  scroller,
  blockOrder,
  onShowBlock,
}: {
  mode: "aligned" | "list";
  scroller: RefObject<HTMLDivElement | null>;
  /** The document's block ids in order, for the list and for "in view". */
  blockOrder: readonly string[];
  /** Go to a block in the page (and, on the phone, out of the sheet). */
  onShowBlock: (blockId: string) => void;
}) {
  const { sideNotes, reading } = useActions();
  const model = sideNotes.model;
  const state = useSignal(model.state, (s) => s);
  const readingBlock = useSignal(reading, (s) => s.blockId);
  const inView = useSignal(reading, (s) => s.inView);
  const toast = useToast();
  const [showDetached, setShowDetached] = useState(false);
  const [confirm, setConfirm] = useState<MarginNote | null>(null);
  const list = useRef<HTMLDivElement>(null);

  // In the phone's list, bring the note she is looking at into view (only this list scrolls).
  useEffect(() => {
    const box = list.current;
    const id = state.focusedId;
    if (mode !== "list" || !box || !id) return;
    const card = box.querySelector<HTMLElement>(`[data-note-id="${id}"]`);
    if (!card) return;
    const top = card.offsetTop - box.offsetTop;
    if (top < box.scrollTop || top + card.offsetHeight > box.scrollTop + box.clientHeight)
      box.scrollTop = Math.max(0, top - 8);
  }, [mode, state.focusedId]);

  const { attached, detached, resolvedCount } = useMemo(() => {
    const att: MarginNote[] = [];
    const det: MarginNote[] = [];
    let resolved = 0;
    for (const note of state.notes) {
      if (model.isDetached(note)) det.push(note);
      else {
        if (note.resolved) resolved += 1;
        if (!note.resolved || state.showResolved || note.id === state.focusedId) att.push(note);
      }
    }
    const order = new Map(blockOrder.map((id, i) => [id, i]));
    att.sort((a, b) => (order.get(a.blockId) ?? 0) - (order.get(b.blockId) ?? 0));
    return { attached: att, detached: det, resolvedCount: resolved };
  }, [state, model, blockOrder]);

  const remove = async (note: MarginNote) => {
    const gone = await model.remove(note.id);
    if (gone && !model.isDetached(gone))
      toast.show("Side note deleted.", { label: "Undo", run: () => void model.restore(gone) });
  };
  const onDelete = (note: MarginNote) => {
    // A detached note cannot come back with "Undo" (its block is gone), so it asks first.
    if (model.isDetached(note)) setConfirm(note);
    else void remove(note);
  };
  const add = () => {
    if (!readingBlock) {
      toast.show("Scroll to the part of the page the note is about, then add it.");
      return;
    }
    sideNotes.compose(readingBlock);
  };
  const reattach = (note: MarginNote) => {
    if (!readingBlock) return;
    void model.reattach(note.id, readingBlock).then((ok) => {
      if (ok) {
        setShowDetached(false);
        toast.success("Attached to the part of the page you are reading.");
      }
    });
  };

  const card = (note: MarginNote, extra: Partial<Parameters<typeof NoteCard>[0]> = {}) => (
    <NoteCard
      key={note.id}
      note={note}
      focused={state.focusedId === note.id}
      detached={model.isDetached(note)}
      onFocus={() => model.focus(note.id)}
      onUpdate={(patch) => void model.update(note.id, patch)}
      onDelete={() => onDelete(note)}
      onReattach={() => reattach(note)}
      {...extra}
    />
  );

  const composer = state.composer ? (
    <div
      className="rounded-card border border-accent-border bg-surface p-2.5 shadow-pop"
      data-testid="note-composer"
    >
      <NoteEditor
        label="New side note"
        saveLabel="Add note"
        quote={state.composer.quote}
        onSave={(text, colour) => {
          const c = state.composer;
          if (c) void model.add({ blockId: c.blockId, text, quote: c.quote, colour });
        }}
        onCancel={() => model.compose(null)}
      />
    </div>
  ) : null;

  const toggles = (
    <>
      {resolvedCount > 0 && (
        <Button
          size="sm"
          aria-pressed={state.showResolved}
          onClick={() => model.setShowResolved(!state.showResolved)}
          data-testid="notes-show-resolved"
          className="aria-pressed:border-accent-border aria-pressed:bg-accent-soft aria-pressed:text-accent"
        >
          Done ({resolvedCount})
        </Button>
      )}
      {detached.length > 0 && mode === "aligned" && (
        <Button
          size="sm"
          aria-pressed={showDetached}
          aria-expanded={showDetached}
          onClick={() => setShowDetached((v) => !v)}
          data-testid="notes-detached-toggle"
          className="aria-pressed:border-accent-border aria-pressed:bg-accent-soft aria-pressed:text-accent"
        >
          <Unlink aria-hidden className="size-3.5" />
          Detached ({detached.length})
        </Button>
      )}
    </>
  );
  // On the phone the tools sit on top; beside the page they sit at the foot, so the top of the
  // panel stays level with the top of the page.
  const toolbar = (
    <div className="flex shrink-0 flex-wrap items-center gap-1.5 border-b border-border px-2 py-1.5">
      <Button size="sm" onClick={add} data-testid="notes-add">
        <Plus aria-hidden className="size-4 text-accent" strokeWidth={2.5} />
        Note here
      </Button>
      {toggles}
    </div>
  );

  const confirmDialog = (
    <ConfirmDialog
      open={confirm !== null}
      onOpenChange={(open) => !open && setConfirm(null)}
      title="Delete this side note?"
      description="Its block is gone, so it cannot be brought back afterwards."
      confirmLabel="Delete"
      danger
      onConfirm={() => {
        const note = confirm;
        setConfirm(null);
        if (note) void remove(note);
      }}
    />
  );

  const empty =
    state.phase === "ready" && state.notes.length === 0 && !state.composer ? (
      <p className="m-0 px-3 py-3 text-ui text-text-muted" data-testid="notes-empty">
        Notes to yourself go here, beside the part of the page they are about. They are yours alone:
        agents can read them, but they never change your document.
      </p>
    ) : state.phase === "error" ? (
      <p className="m-0 px-3 py-3 text-ui text-danger">Your side notes could not be loaded.</p>
    ) : null;

  if (mode === "list") {
    const here = new Set(inView);
    return (
      <div className="flex min-h-0 flex-1 flex-col" data-testid="notes-panel" data-mode="list">
        {toolbar}
        <div
          ref={list}
          className="relative min-h-0 flex-1 overflow-y-auto overscroll-contain p-2.5"
        >
          {empty}
          <div className="flex flex-col gap-2">
            {composer}
            {attached.map((note) =>
              card(note, {
                here: here.has(note.blockId),
                onShowBlock: () => onShowBlock(note.blockId),
              }),
            )}
          </div>
          {detached.length > 0 && (
            <section className="mt-4" data-testid="notes-detached">
              <h3 className="m-0 mb-2 px-1 text-caption font-semibold uppercase tracking-[0.08em] text-text-muted">
                Detached
              </h3>
              <div className="flex flex-col gap-2">{detached.map((note) => card(note))}</div>
            </section>
          )}
        </div>
        {confirmDialog}
      </div>
    );
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col" data-testid="notes-panel" data-mode="aligned">
      <Aligned
        scroller={scroller}
        notes={attached}
        composer={composer}
        composerBlock={state.composer?.blockId ?? null}
        state={state}
        card={card}
        empty={empty}
      />
      {showDetached && detached.length > 0 && (
        <section
          className="flex max-h-[55%] shrink-0 flex-col border-t border-border bg-surface"
          data-testid="notes-detached"
          aria-label="Detached side notes"
        >
          <p className="m-0 px-3 pt-2.5 pb-1 text-label text-text-muted">
            Their blocks were deleted or replaced. Scroll to where one belongs and choose “Attach
            here”.
          </p>
          <div className="flex min-h-0 flex-col gap-2 overflow-y-auto p-2.5">
            {detached.map((note) => card(note))}
          </div>
        </section>
      )}
      {(resolvedCount > 0 || detached.length > 0) && (
        <div className="flex shrink-0 flex-wrap items-center gap-1.5 border-t border-border px-2 py-1.5">
          {toggles}
        </div>
      )}
      {confirmDialog}
    </div>
  );
});

/** The Notes panel's header button: a note on the block at the reading line. */
export function AddNoteHere() {
  const { sideNotes, reading } = useActions();
  const toast = useToast();
  return (
    <IconButton
      label="Add a side note here"
      size="sm"
      data-testid="notes-add"
      onClick={() => {
        if (reading.get().blockId) sideNotes.compose(null);
        else toast.show("Scroll to the part of the page the note is about, then add it.");
      }}
    >
      <Plus className="size-4" strokeWidth={2.5} />
    </IconButton>
  );
}

function Aligned({
  scroller,
  notes,
  composer,
  composerBlock,
  state,
  card,
  empty,
}: {
  scroller: RefObject<HTMLDivElement | null>;
  notes: MarginNote[];
  composer: React.ReactNode;
  composerBlock: string | null;
  state: NotesState;
  card: (
    note: MarginNote,
    extra?: { cardRef?: (el: HTMLElement | null) => void },
  ) => React.ReactNode;
  empty: React.ReactNode;
}) {
  const body = useRef<HTMLDivElement>(null);
  const layer = useRef<HTMLDivElement>(null);
  const engine = useRef<AlignedLayout | null>(null);
  const anchors = useRef(new Map<string, string>());
  anchors.current = new Map(notes.map((n) => [n.id, n.blockId]));
  if (composerBlock) anchors.current.set(COMPOSER, composerBlock);
  const refs = useRef(new Map<string, (el: HTMLElement | null) => void>());
  const refFor = (id: string) => {
    let fn = refs.current.get(id);
    if (!fn) {
      fn = (el) => engine.current?.card(id, el);
      refs.current.set(id, fn);
    }
    return fn;
  };

  useEffect(() => {
    const s = scroller.current;
    const b = body.current;
    const l = layer.current;
    if (!s || !b || !l) return;
    const layout = new AlignedLayout(s, b, (id) => anchors.current.get(id) ?? null);
    engine.current = layout;
    // Cards rendered before the engine existed register now.
    for (const el of l.querySelectorAll<HTMLElement>("[data-align-id]")) {
      layout.card(el.dataset.alignId as string, el);
    }
    return () => {
      layout.destroy();
      engine.current = null;
    };
  }, [scroller]);

  // After each render of the cards (rare: notes, focus or the composer changed), lay out again.
  useLayoutEffect(() => {
    const layout = engine.current;
    if (!layout) return;
    layout.focusedId = state.composer ? COMPOSER : state.focusedId;
    layout.layout();
  });

  return (
    <div ref={body} className="relative min-h-0 flex-1 overflow-hidden">
      {empty}
      <div ref={layer} className="absolute inset-x-0 top-0">
        {notes.map((note) => (
          <div
            key={note.id}
            ref={refFor(note.id)}
            data-align-id={note.id}
            className="absolute inset-x-2 top-0 transition-transform duration-(--duration-fast) ease-out will-change-transform motion-reduce:transition-none"
          >
            {card(note)}
          </div>
        ))}
        {composer && (
          <div
            ref={refFor(COMPOSER)}
            data-align-id={COMPOSER}
            className={cn(
              "absolute inset-x-2 top-0 z-(--z-raised) transition-transform duration-(--duration-fast) ease-out motion-reduce:transition-none",
            )}
          >
            {composer}
          </div>
        )}
      </div>
    </div>
  );
}
