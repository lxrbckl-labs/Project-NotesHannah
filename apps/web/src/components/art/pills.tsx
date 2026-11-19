import { cn } from "../../lib/cn";
import type { Hue } from "../../lib/hues";

/**
 * Pill art: small drawings of capsules and tablets, our own, for the places where the app has room
 * for a picture (sign-in, the library title, empty states). Decoration only: every drawing is hidden
 * from a screen reader and never carries meaning. Colours come from the palette (data-hue sets the
 * tone), so the art follows light and dark like everything else.
 */

interface ArtProps {
  /** The palette hue of the colored part. */
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

/** An oblong caplet in one color, scored across the middle. */
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

/** A pharmacy bottle with a cap and a label. */
export function PillBottle({ hue = "orange", className }: ArtProps) {
  return (
    <svg
      viewBox="0 0 40 56"
      data-hue={hue}
      aria-hidden
      focusable="false"
      className={cn("h-14 w-10 shrink-0", className)}
    >
      <rect
        x="9"
        y="2"
        width="22"
        height="10"
        rx="3"
        strokeWidth="2"
        className="fill-surface stroke-tone-text"
      />
      <path
        d="M14 5v4M20 5v4M26 5v4"
        strokeWidth="1.5"
        strokeLinecap="round"
        className="stroke-tone-border"
      />
      <rect
        x="5"
        y="12"
        width="30"
        height="42"
        rx="7"
        strokeWidth="2"
        className="fill-tone-mark stroke-tone-text"
      />
      <rect
        x="5"
        y="24"
        width="30"
        height="18"
        strokeWidth="2"
        className="fill-surface stroke-tone-text"
      />
      <path
        d="M12 30h16M12 36h10"
        strokeWidth="2"
        strokeLinecap="round"
        className="stroke-tone-text"
      />
      <path
        d="M10.5 16v5"
        strokeWidth="2.5"
        strokeLinecap="round"
        className="stroke-surface"
        opacity="0.7"
      />
    </svg>
  );
}

/** A mortar and pestle. */
export function MortarPestle({ hue = "teal", className }: ArtProps) {
  return (
    <svg
      viewBox="0 0 56 48"
      data-hue={hue}
      aria-hidden
      focusable="false"
      className={cn("h-12 w-14 shrink-0", className)}
    >
      <path
        d="M36 3.5a4 4 0 0 1 6.6 4.4L31 23h-9z"
        strokeWidth="2"
        strokeLinejoin="round"
        className="fill-surface stroke-tone-text"
      />
      <path
        d="M6 22h44a2 2 0 0 1 0 4h-1c0 9-5.5 15.5-13 17.5V46H20v-2.5C12.5 41.5 7 35 7 26H6a2 2 0 0 1 0-4z"
        strokeWidth="2"
        strokeLinejoin="round"
        className="fill-tone-soft stroke-tone-text"
      />
      <path d="M8 26h40" strokeWidth="2" className="stroke-tone-text" />
      <path
        d="M14 31c1.5 4 4 6.5 7 8"
        strokeWidth="2.5"
        strokeLinecap="round"
        className="stroke-tone-border"
      />
    </svg>
  );
}

/** A blister pack: a card of six tablets, one already pressed out. */
export function BlisterPack({ hue = "blue", className }: ArtProps) {
  const spots = [
    [12, 12],
    [28, 12],
    [44, 12],
    [12, 28],
    [28, 28],
    [44, 28],
  ] as const;
  return (
    <svg
      viewBox="0 0 56 40"
      data-hue={hue}
      aria-hidden
      focusable="false"
      className={cn("h-10 w-14 shrink-0", className)}
    >
      <rect
        x="2"
        y="2"
        width="52"
        height="36"
        rx="7"
        strokeWidth="2"
        className="fill-tone-soft stroke-tone-text"
      />
      {spots.map(([cx, cy], i) =>
        i === 4 ? (
          <circle
            key={`${cx}-${cy}`}
            cx={cx}
            cy={cy}
            r="5.5"
            fill="none"
            strokeWidth="1.5"
            strokeDasharray="2.5 2.5"
            className="stroke-tone-text"
          />
        ) : (
          <circle
            key={`${cx}-${cy}`}
            cx={cx}
            cy={cy}
            r="5.5"
            strokeWidth="1.5"
            className="fill-surface stroke-tone-text"
          />
        ),
      )}
    </svg>
  );
}

/** The prescription sign, Rx, on a small label. */
export function RxMark({ hue = "green", className }: ArtProps) {
  return (
    <svg
      viewBox="0 0 40 40"
      data-hue={hue}
      aria-hidden
      focusable="false"
      className={cn("size-10 shrink-0", className)}
    >
      <rect
        x="2"
        y="2"
        width="36"
        height="36"
        rx="9"
        strokeWidth="2"
        className="fill-tone-soft stroke-tone-text"
      />
      <path
        d="M12 29V11h7.5a5 5 0 0 1 0 10H12m6 0 11 9m0-9-9 9"
        fill="none"
        strokeWidth="2.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        className="stroke-tone-text"
      />
    </svg>
  );
}

/** Art for a page's header: a main drawing with a pill or two beside it. */
export function HeaderArt({
  kind,
  className,
}: {
  kind: "practice" | "concepts" | "inbox" | "references" | "requests" | "activity" | "calendar";
  className?: string;
}) {
  return (
    <div aria-hidden className={cn("flex h-14 shrink-0 items-end gap-1.5", className)}>
      {kind === "practice" ? (
        <>
          <Tablet hue="pink" className="mb-0.5 size-5" />
          <PillBottle hue="orange" />
          <Capsule hue="teal" className="mb-1 h-5 w-11 -rotate-12" />
        </>
      ) : kind === "concepts" ? (
        <>
          <Caplet hue="yellow" className="mb-1 h-4 w-8 rotate-12" />
          <MortarPestle hue="teal" />
        </>
      ) : kind === "inbox" ? (
        <>
          <BlisterPack hue="blue" />
          <Tablet hue="blue" className="mb-0.5 size-4" />
        </>
      ) : kind === "calendar" ? (
        <>
          <Capsule hue="red" className="mb-1 h-5 w-11 rotate-12" />
          <BlisterPack hue="teal" className="h-12 w-[4.2rem]" />
        </>
      ) : kind === "references" ? (
        <>
          <RxMark hue="green" />
          <PillBottle hue="purple" className="h-12 w-9" />
        </>
      ) : kind === "requests" ? (
        <>
          <Capsule hue="red" className="mb-2 h-5 w-11 rotate-[18deg]" />
          <RxMark hue="teal" className="size-9" />
        </>
      ) : (
        <>
          <BlisterPack hue="purple" className="h-9 w-12" />
          <Capsule hue="teal" className="mb-1 h-5 w-11 -rotate-[20deg]" />
        </>
      )}
    </div>
  );
}

/** The app's mark: one capsule on a slant, drawn in the current text color. */
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
