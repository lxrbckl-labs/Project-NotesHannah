import { type CSSProperties, type ReactNode, useEffect, useState } from "react";
import { cn } from "../../lib/cn";

/**
 * Content that opens and closes with a slide: its height runs from nothing to its own height and back,
 * with a fade (`.tree-collapse` in styles.css; the library tree has the same thing built in). The
 * content stays on the page until the closing slide is over, untouchable meanwhile, and content that is
 * already open when it first appears does not animate. Reduced motion makes it instant.
 *
 * `ms` is how long the slide takes: 200 for a quick list, about 300 where things open by themselves as she
 * reads and a slower move is easier to follow.
 */
export function Collapse({
  open,
  ms = 200,
  children,
}: {
  open: boolean;
  ms?: number;
  children: ReactNode;
}) {
  const [present, setPresent] = useState(open);
  // `shown` drives the slide; `settled` lifts the clipping once open, so focus rings are not cut off.
  const [shown, setShown] = useState(open);
  const [settled, setSettled] = useState(open);
  useEffect(() => {
    const still =
      typeof window.matchMedia === "function" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const wait = still ? 0 : ms;
    if (open) {
      setPresent(true);
      // One frame after mounting, so the browser has the closed state to slide from.
      const frame = requestAnimationFrame(() => setShown(true));
      const done = setTimeout(() => setSettled(true), wait + 20);
      return () => {
        cancelAnimationFrame(frame);
        clearTimeout(done);
      };
    }
    setSettled(false);
    setShown(false);
    const gone = setTimeout(() => setPresent(false), wait);
    return () => clearTimeout(gone);
  }, [open, ms]);
  // `open` counts too: the content is on the page in the very render that opens it (closed, about to
  // slide), not one effect later, so whatever asked for it finds it there.
  if (!present && !open) return null;
  return (
    <div
      className="tree-collapse"
      data-open={shown}
      inert={!open}
      // One column exactly as wide as the place it sits in: without this a grid column grows to fit its
      // longest line, and a row that should cut its text short ran out past the panel's edge instead.
      style={
        {
          "--collapse-ms": `${ms}ms`,
          gridTemplateColumns: "minmax(0, 1fr)",
        } as CSSProperties
      }
    >
      <div className={cn("min-h-0 min-w-0", !settled && "overflow-hidden")}>{children}</div>
    </div>
  );
}
