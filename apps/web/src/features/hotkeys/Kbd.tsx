import { Keyboard } from "lucide-react";
import { cn } from "../../lib/cn";
import { useHotkeyHint } from "./HotkeyProvider";

/** The badge's look: the quick-find bar's key, and every badge after it. */
export const KBD_CLASS = "rounded-inline border border-border bg-surface px-1.5 text-caption";

/**
 * A hotkey's key, behind a small keyboard mark, as a small quiet badge at the trailing edge of a button, a link or a heading. It
 * renders nothing when her badges are off, off the computer layout, for an unknown id, or when the key
 * does nothing on this screen. It is hidden from screen readers so the control keeps its name; the
 * control carries `aria-keyshortcuts` instead (`useHotkeyAria`).
 */
export function Kbd({ hotkey, className }: { hotkey: string; className?: string }) {
  const text = useHotkeyHint(hotkey);
  if (!text) return null;
  return (
    // A span, not <kbd>: it is hidden from screen readers, which read the control's aria-keyshortcuts.
    <span
      aria-hidden="true"
      data-hotkey={hotkey}
      className={cn(
        KBD_CLASS,
        "inline-flex shrink-0 items-center gap-0.5 whitespace-nowrap font-sans font-normal text-text-muted",
        className,
      )}
    >
      <Keyboard size={12} aria-hidden />
      {text}
    </span>
  );
}
