import { useEffect, useRef } from "react";
import type { GradeResult, Reveal } from "../types";
import { Markdown } from "../ui/Markdown";

export interface AnswerProps<S, A> {
  question: S;
  /** The draft answer; null until she has chosen something. */
  value: A | null;
  onChange: (answer: A | null) => void;
  /** True while submitting and after the result is shown. */
  disabled?: boolean;
  /** The grade, once answered. */
  result?: GradeResult | null;
  /** Asks the server for the back of a card or the model answer and rubric. */
  reveal?: () => Promise<Reveal>;
  /** Self-graded types submit themselves. */
  onCommit?: (answer: A) => void;
  /** Called when Enter is pressed on the last field and the answer is complete. */
  onSubmitRequest?: () => void;
  /** "part" = shown inside a case: no own submit button. */
  mode?: "single" | "part";
}

export function Prompt({
  text,
  id,
  emphasiseNumbers,
}: {
  text: string;
  id?: string;
  emphasiseNumbers?: boolean;
}) {
  return (
    <div id={id} className="text-reading font-medium md:text-title">
      <Markdown text={text} {...(emphasiseNumbers ? { emphasiseNumbers } : {})} />
    </div>
  );
}

/** True when a keystroke belongs to a text field and must not trigger a shortcut. */
export function isTyping(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  if (!el) return false;
  return (
    el.tagName === "INPUT" ||
    el.tagName === "TEXTAREA" ||
    el.tagName === "SELECT" ||
    el.isContentEditable
  );
}

/** Calls `handler(index)` for keys 1-9 and a-z (a = 0 ... ) while enabled. */
export function useOptionShortcuts(count: number, enabled: boolean, handler: (i: number) => void) {
  const ref = useRef(handler);
  ref.current = handler;
  useEffect(() => {
    if (!enabled) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey || isTyping(e.target)) return;
      if (document.querySelector('[role="alertdialog"]')) return;
      const k = e.key.toLowerCase();
      let i = -1;
      if (/^[1-9]$/.test(k)) i = Number(k) - 1;
      else if (/^[a-f]$/.test(k)) i = k.charCodeAt(0) - 97;
      if (i >= 0 && i < count) {
        e.preventDefault();
        ref.current(i);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [count, enabled]);
}

export const LETTERS = "ABCDEFGH";
