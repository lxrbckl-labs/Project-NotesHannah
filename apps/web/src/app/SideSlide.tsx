import { type ReactNode, useEffect, useState } from "react";

/** A little longer than the slide in styles.css (.side-slide), so the panel is gone only once it has closed. */
const SLIDE_MS = 240;

/**
 * A sidebar that slides open and closed: its width runs between nothing and its own width while the
 * page beside it makes room. The left one slides out to the left, the right one to the right. It is
 * removed from the page once closed, and cannot be reached with the keyboard while it is closing.
 * Reduced motion makes it instant.
 */
export function SideSlide({
  open,
  side,
  children,
}: {
  open: boolean;
  side: "left" | "right";
  children: ReactNode;
}) {
  const [present, setPresent] = useState(open);
  const [shown, setShown] = useState(open);
  // Once open, the clipping is lifted, so a resize handle that hangs over the edge is not cut off.
  const [settled, setSettled] = useState(open);
  useEffect(() => {
    const still =
      typeof window.matchMedia === "function" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (open) {
      setPresent(true);
      // Two frames after mounting: the first paints the closed state, so there is something to slide from.
      let frame = requestAnimationFrame(() => {
        frame = requestAnimationFrame(() => setShown(true));
      });
      const done = setTimeout(() => setSettled(true), still ? 0 : SLIDE_MS + 40);
      return () => {
        cancelAnimationFrame(frame);
        clearTimeout(done);
      };
    }
    setSettled(false);
    setShown(false);
    const gone = setTimeout(() => setPresent(false), still ? 0 : SLIDE_MS);
    return () => clearTimeout(gone);
  }, [open]);
  if (!present) return null;
  return (
    <div
      className="side-slide print:hidden"
      data-open={shown}
      data-settled={settled}
      data-side={side}
      inert={!open}
    >
      <div>{children}</div>
    </div>
  );
}
