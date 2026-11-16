import type { BlockOf } from "@notes/schema";
import { CircleHelp, FileQuestion } from "lucide-react";
import { useState } from "react";
import { useActions } from "../context";
import { Button } from "../ui/primitives";

export function DividerBlock() {
  return (
    // biome-ignore lint/a11y/useSemanticElements: a decorated divider; <hr> cannot hold the dots
    <div
      role="separator"
      className="flex items-center justify-center py-3"
      aria-label="Section break"
    >
      <span className="h-px flex-1 bg-border" />
      <span aria-hidden className="mx-3 flex gap-1.5">
        <span className="size-1 rounded-full bg-border" />
        <span className="size-1 rounded-full bg-border" />
        <span className="size-1 rounded-full bg-border" />
      </span>
      <span className="h-px flex-1 bg-border" />
    </div>
  );
}

/** Where a practice question sits; the practice feature draws the question itself. */
export function QuestionBlock({ block }: { block: BlockOf<"question"> }) {
  const { openQuestion } = useActions();
  return (
    <div className="flex items-center gap-3.5 rounded-2xl border border-[var(--doc-green-border)] bg-[var(--doc-green-bg)] px-4 py-3.5">
      <span
        aria-hidden
        className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-surface text-[var(--doc-green-fg)] shadow-sm"
      >
        <CircleHelp className="size-5" />
      </span>
      <div className="min-w-0 flex-1">
        <p className="m-0 font-semibold text-[var(--doc-green-fg)]">Practice question</p>
        <p className="m-0 text-[13.5px] text-text-muted">Test yourself on this section.</p>
      </div>
      <Button variant="outline" size="sm" onClick={() => openQuestion(block.content.questionId)}>
        Open
      </Button>
    </div>
  );
}

/** A block this version of the app does not know: shown, never a crash. */
export function UnknownBlock({ type, content }: { type: string; content: unknown }) {
  const [open, setOpen] = useState(false);
  return (
    <div
      className="rounded-2xl border border-dashed border-border bg-surface-muted/60 px-4 py-3 text-[14px]"
      data-testid="unknown-block"
    >
      <div className="flex items-center gap-2.5">
        <FileQuestion aria-hidden className="size-4.5 text-text-muted" />
        <p className="m-0 flex-1 text-text-muted">
          This part (<code>{type}</code>) can’t be shown in this version of the app yet.
        </p>
        <button
          type="button"
          className="min-h-9 text-[13px] font-medium underline underline-offset-2"
          onClick={() => setOpen((o) => !o)}
        >
          {open ? "Hide" : "Details"}
        </button>
      </div>
      {open && (
        <pre className="mt-2 max-h-48 overflow-auto rounded-lg bg-surface p-2 text-[12px] leading-snug">
          {JSON.stringify(content, null, 2)}
        </pre>
      )}
    </div>
  );
}
