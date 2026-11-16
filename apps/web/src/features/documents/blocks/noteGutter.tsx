import { MessageSquarePlus, MessageSquareText } from "lucide-react";
import { cn } from "../../../lib/cn";
import { useActions, useSignal, useView } from "../context";

/**
 * The right margin of a block (P4): a marker with the number of her side notes on it (tap to
 * open them), or, on the block under the pointer (computer) or at the reading line (touch), a
 * small button to write one.
 */
export function NoteGutter({ blockId }: { blockId: string }) {
  const { sideNotes, reading } = useActions();
  const { isTouch } = useView();
  const count = useSignal(sideNotes.model.counts, (m) => m.get(blockId));
  const atLine = useSignal(reading, (s) => s.blockId === blockId);
  const where =
    "absolute top-0 right-[-18px] z-(--z-raised) @min-[520px]/page:right-[-44px] print:hidden";

  if (count) {
    const label = `${count.all} side note${count.all === 1 ? "" : "s"}${
      count.open < count.all ? `, ${count.all - count.open} done` : ""
    }`;
    return (
      <button
        type="button"
        data-testid="note-marker"
        aria-label={label}
        onClick={(e) => {
          e.stopPropagation();
          sideNotes.show(count.firstId);
        }}
        className={cn(
          where,
          "flex h-6 min-w-6 after:absolute after:-inset-2.5 after:content-[''] items-center justify-center gap-0.5 rounded-pill border px-1 text-caption font-semibold tabular-nums shadow-card",
          count.open > 0
            ? "border-warning-border bg-warning-soft text-warning"
            : "border-border bg-surface text-text-muted",
        )}
      >
        <MessageSquareText aria-hidden className="size-3" />
        {count.all}
      </button>
    );
  }
  return (
    <button
      type="button"
      data-testid="note-add"
      aria-label="Add a side note"
      onClick={(e) => {
        e.stopPropagation();
        sideNotes.compose(blockId);
      }}
      className={cn(
        where,
        "flex size-6 after:absolute after:-inset-2.5 after:content-[''] items-center justify-center rounded-pill border border-border bg-surface text-text-muted shadow-card transition-opacity duration-(--duration-fast) hover:text-accent focus-visible:opacity-100",
        // Computer: only with the pointer over the block. Touch: beside the block she is reading.
        isTouch
          ? atLine
            ? "opacity-100"
            : "pointer-events-none opacity-0"
          : "opacity-0 group-hover/block:opacity-100",
      )}
      // One tab stop per block would bury the page; the keyboard has the shortcut and the block menu.
      tabIndex={isTouch && atLine ? 0 : -1}
    >
      <MessageSquarePlus aria-hidden className="size-3.5" />
    </button>
  );
}
