import { cn } from "../../lib/cn";
import type { Hue } from "../../lib/hues";

/**
 * Pill art: small drawings of capsules and tablets, our own, for the places where the app has room
 * for a picture (sign-in, the library title, empty states). Decoration only: every drawing is hidden
 * from a screen reader and never carries meaning. Colours come from the palette (data-hue sets the
 * tone), so the art follows light and dark like everything else.
 */

interface ArtProps {
  /** The palette hue of the coloured part. */
  hue?: Hue;
  className?: string;
}

/** A two-part capsule: one half in the hue, one half white, with a soft shine. */
export function Capsule({ hue = "teal", className }: ArtProps) {
  return (
    <svg
      viewBox="0 0 64 28"
      data-hue={hue}
      aria-hidden
      focusable="false"
      className={cn("h-7 w-16 shrink-0", className)}
    >
      <path d="M14 2h18v24H14a12 12 0 0 1 0-24z" className="fill-tone-solid" />
      <path d="M32 2h18a12 12 0 0 1 0 24H32z" className="fill-surface" />
      <rect
        x="2"
        y="2"
        width="60"
        height="24"
        rx="12"
        fill="none"
        strokeWidth="2"
        className="stroke-tone-text"
      />
      <path d="M32 2v24" strokeWidth="2" className="stroke-tone-text" />
      <path
        d="M13 8.5h13"
        strokeWidth="2.5"
        strokeLinecap="round"
        className="stroke-surface"
        opacity="0.55"
      />
      <path
        d="M37 8.5h11"
        strokeWidth="2.5"
        strokeLinecap="round"
        className="stroke-tone-soft"
        opacity="0.9"
      />
    </svg>
  );
}

/** A round tablet with a score line. */
export function Tablet({ hue = "pink", className }: ArtProps) {
  return (
    <svg
      viewBox="0 0 32 32"
      data-hue={hue}
      aria-hidden
      focusable="false"
      className={cn("size-8 shrink-0", className)}
    >
      <circle cx="16" cy="16" r="13" strokeWidth="2" className="fill-tone-soft stroke-tone-text" />
      <circle
        cx="16"
        cy="16"
        r="9.5"
        fill="none"
        strokeWidth="1.5"
        className="stroke-tone-border"
      />
      <path d="M9 16h14" strokeWidth="2" strokeLinecap="round" className="stroke-tone-text" />
    </svg>
  );
}

/** An oblong caplet in one colour, scored across the middle. */
export function Caplet({ hue = "yellow", className }: ArtProps) {
  return (
    <svg
      viewBox="0 0 48 24"
      data-hue={hue}
      aria-hidden
      focusable="false"
      className={cn("h-6 w-12 shrink-0", className)}
    >
      <rect
        x="2"
        y="2"
        width="44"
        height="20"
        rx="10"
        strokeWidth="2"
        className="fill-tone-mark stroke-tone-text"
      />
      <path d="M24 6v12" strokeWidth="2" strokeLinecap="round" className="stroke-tone-text" />
      <path
        d="M10 8h9"
        strokeWidth="2.5"
        strokeLinecap="round"
        className="stroke-surface"
        opacity="0.7"
      />
    </svg>
  );
}

/** A capsule, a tablet and a caplet, loosely scattered: the picture beside a title. */
export function PillCluster({ className }: { className?: string }) {
  return (
    <div aria-hidden className={cn("relative h-16 w-28 shrink-0", className)}>
      <Capsule hue="teal" className="absolute left-1 top-1 -rotate-[24deg]" />
      <Tablet hue="pink" className="absolute right-2 top-0 size-7" />
      <Caplet hue="yellow" className="absolute bottom-0 right-5 h-5 w-10 rotate-[14deg]" />
      <Tablet hue="blue" className="absolute bottom-1 left-6 size-5" />
    </div>
  );
}

/** The app's mark: one capsule on a slant, drawn in the current text colour. */
export function PillMark({ size = 20, className }: { size?: number; className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      aria-hidden
      focusable="false"
      className={className}
    >
      <g transform="rotate(-45 12 12)" fill="none" stroke="currentColor" strokeWidth="2">
        <rect x="2" y="7" width="20" height="10" rx="5" />
        <path d="M12 7v10" />
        <path d="M2.5 12a4.5 4.5 0 0 1 4.5-4.5h5v9H7A4.5 4.5 0 0 1 2.5 12z" fill="currentColor" />
      </g>
    </svg>
  );
}
