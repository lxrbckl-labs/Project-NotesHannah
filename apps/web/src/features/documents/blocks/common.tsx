import type { Block } from "@notes/schema";
import { Plus, X } from "lucide-react";
import { type InputHTMLAttributes, type ReactNode, useEffect, useState } from "react";
import { cn } from "../../../lib/cn";
import { useActions, useSignal, useView } from "../context";
import { patchContent, replaceContent } from "../model/gestures";

/** What a block renderer needs to edit itself. */
export function useBlockEdit(block: Block) {
  const actions = useActions();
  const { editing, isTouch, layout } = useView();
  const active = useSignal(actions.active, (id) => id === block.id);
  const patch = (content: Record<string, unknown>, label = "Edit") =>
    actions.perform(
      Object.values(content).some((value) => value === undefined)
        ? replaceContent(actions.documentId, block, content)
        : patchContent(actions.documentId, block.id, content),
      label,
    );
  return { actions, editing, active, isTouch, layout, patch };
}

/**
 * A short plain-text field (names, labels, titles) that looks like text and
 * commits on blur or Enter. Empty values are refused when `required`.
 */
export function PlainInput({
  value,
  onCommit,
  label,
  required,
  className,
  multiline,
  ...rest
}: {
  value: string;
  onCommit: (value: string) => void;
  label: string;
  required?: boolean;
  className?: string;
  multiline?: boolean;
} & Omit<InputHTMLAttributes<HTMLInputElement>, "value" | "onChange" | "className">) {
  const [draft, setDraft] = useState(value);
  useEffect(() => setDraft(value), [value]);
  const commit = () => {
    const next = draft.trim();
    if (required && !next) {
      setDraft(value);
      return;
    }
    if (next !== value) onCommit(next);
  };
  const classes = cn(
    "w-full min-w-0 rounded-control border border-transparent bg-transparent px-1.5 -mx-1.5 outline-none transition-colors",
    "hover:border-border-strong focus:border-accent focus:bg-surface placeholder:text-text-muted/70",
    className,
  );
  if (multiline) {
    return (
      <textarea
        aria-label={label}
        value={draft}
        rows={2}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        className={cn(classes, "resize-none py-1")}
        placeholder={rest.placeholder}
      />
    );
  }
  return (
    <input
      aria-label={label}
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          (e.target as HTMLInputElement).blur();
        }
        if (e.key === "Escape") {
          setDraft(value);
          (e.target as HTMLInputElement).blur();
        }
      }}
      className={classes}
      {...rest}
    />
  );
}

export function AddButton({
  children,
  onClick,
  testId,
}: {
  children: ReactNode;
  onClick: () => void;
  testId?: string;
}) {
  return (
    <button
      type="button"
      data-testid={testId}
      onClick={onClick}
      className="inline-flex min-h-9 items-center gap-1.5 rounded-control border border-dashed border-border-strong px-3 text-label font-medium text-text-muted transition-colors duration-(--duration-instant) hover:border-accent hover:text-text pointer-coarse:min-h-11"
    >
      <Plus aria-hidden className="size-3.5" />
      {children}
    </button>
  );
}

export function RemoveButton({
  label,
  onClick,
  className,
}: {
  label: string;
  onClick: () => void;
  className?: string;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      onClick={onClick}
      className={cn(
        "relative inline-flex size-7 shrink-0 items-center justify-center rounded-control text-text-muted transition-colors duration-(--duration-instant) hover:bg-danger-soft hover:text-danger after:absolute after:-inset-2 after:content-['']",
        className,
      )}
    >
      <X aria-hidden className="size-3.5" />
    </button>
  );
}

/** Small uppercase section label used inside cards. */
export function Eyebrow({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <p
      className={cn(
        "text-caption font-semibold uppercase tracking-[0.06em] text-text-muted",
        className,
      )}
    >
      {children}
    </p>
  );
}
