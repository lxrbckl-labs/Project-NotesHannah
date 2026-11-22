import { type KeyboardEvent, useEffect, useRef, useState } from "react";
import { cn } from "../../lib/cn";

/** An input that replaces a label while renaming: Enter or blur saves, Escape cancels. */
export function InlineName({
  value,
  label,
  onCommit,
  onCancel,
  className,
}: {
  value: string;
  label: string;
  onCommit: (name: string) => void;
  onCancel: () => void;
  className?: string;
}) {
  const [draft, setDraft] = useState(value);
  const ref = useRef<HTMLInputElement>(null);
  const done = useRef(false);

  useEffect(() => {
    ref.current?.focus();
    ref.current?.select();
  }, []);

  function commit() {
    if (done.current) return;
    done.current = true;
    const next = draft.trim();
    if (next && next !== value) onCommit(next);
    else onCancel();
  }

  function onKey(event: KeyboardEvent) {
    event.stopPropagation();
    if (event.key === "Enter") {
      event.preventDefault();
      commit();
    } else if (event.key === "Escape") {
      done.current = true;
      onCancel();
    }
  }

  return (
    <input
      ref={ref}
      aria-label={label}
      value={draft}
      maxLength={200}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={onKey}
      onClick={(e) => e.stopPropagation()}
      className={cn(
        "min-h-9 w-full min-w-0 rounded-control border border-accent bg-surface px-2.5 text-base text-text xl:text-sm",
        className,
      )}
    />
  );
}
