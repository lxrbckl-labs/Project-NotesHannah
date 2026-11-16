import type { Sticker } from "@notes/schema";
import { memo } from "react";

/**
 * The built-in sticker set: simple original shapes drawn for this app.
 * Colours are the palette's solid shades and the app's text and surface, so dark mode gets its own ink.
 */

const INK = "var(--color-text)";
const PAPER = "var(--color-surface)";

const SHAPES: Record<Sticker, { label: string; body: React.ReactNode }> = {
  pin: {
    label: "Pin",
    body: (
      <>
        <path d="M33 34 L22 56" stroke={INK} strokeWidth="3.5" strokeLinecap="round" />
        <circle cx="38" cy="22" r="14" fill="var(--hue-red-solid)" stroke={INK} strokeWidth="3" />
        <circle cx="33" cy="17" r="4" fill="#fff" opacity="0.75" />
      </>
    ),
  },
  star: {
    label: "Star",
    body: (
      <path
        d="M32 6 L39.5 22.5 L57 24.5 L44 36.5 L47.5 54 L32 45 L16.5 54 L20 36.5 L7 24.5 L24.5 22.5 Z"
        fill="var(--hue-yellow-solid)"
        stroke={INK}
        strokeWidth="3"
        strokeLinejoin="round"
      />
    ),
  },
  eyes: {
    label: "Eyes",
    body: (
      <>
        <ellipse cx="21" cy="32" rx="12" ry="16" fill={PAPER} stroke={INK} strokeWidth="3" />
        <ellipse cx="43" cy="32" rx="12" ry="16" fill={PAPER} stroke={INK} strokeWidth="3" />
        <circle cx="25" cy="36" r="5.5" fill={INK} />
        <circle cx="47" cy="36" r="5.5" fill={INK} />
      </>
    ),
  },
  lightbulb: {
    label: "Light bulb",
    body: (
      <>
        <path
          d="M32 7 C19 7 12 17 12 26 C12 34 18 38 21 44 L43 44 C46 38 52 34 52 26 C52 17 45 7 32 7 Z"
          fill="var(--hue-yellow-solid)"
          stroke={INK}
          strokeWidth="3"
          strokeLinejoin="round"
        />
        <rect
          x="22"
          y="44"
          width="20"
          height="8"
          rx="2"
          fill={PAPER}
          stroke={INK}
          strokeWidth="3"
        />
        <path d="M26 57 H38" stroke={INK} strokeWidth="3.5" strokeLinecap="round" />
        <path
          d="M27 30 L32 36 L37 30"
          fill="none"
          stroke={INK}
          strokeWidth="2.5"
          strokeLinecap="round"
        />
      </>
    ),
  },
  warning: {
    label: "Warning",
    body: (
      <>
        <path
          d="M32 7 L58 53 C59 55 58 57 55.5 57 L8.5 57 C6 57 5 55 6 53 Z"
          fill="var(--hue-orange-solid)"
          stroke={INK}
          strokeWidth="3"
          strokeLinejoin="round"
        />
        <path d="M32 23 L32 39" stroke={INK} strokeWidth="5" strokeLinecap="round" />
        <circle cx="32" cy="48" r="3.2" fill={INK} />
      </>
    ),
  },
  heart: {
    label: "Heart",
    body: (
      <path
        d="M32 55 C22 47 7 38 7 23 C7 14 14 9 21 9 C26 9 30 12 32 16 C34 12 38 9 43 9 C50 9 57 14 57 23 C57 38 42 47 32 55 Z"
        fill="var(--hue-pink-solid)"
        stroke={INK}
        strokeWidth="3"
        strokeLinejoin="round"
      />
    ),
  },
  question: {
    label: "Question",
    body: (
      <>
        <circle cx="32" cy="32" r="25" fill="var(--hue-blue-solid)" stroke={INK} strokeWidth="3" />
        <path
          d="M24 25 C24 19 28 16 32.5 16 C37.5 16 41 19 41 24 C41 30 33 30 33 37"
          fill="none"
          stroke="#fff"
          strokeWidth="5"
          strokeLinecap="round"
        />
        <circle cx="33" cy="46" r="3.4" fill="#fff" />
      </>
    ),
  },
  check: {
    label: "Check",
    body: (
      <>
        <circle cx="32" cy="32" r="25" fill="var(--hue-green-solid)" stroke={INK} strokeWidth="3" />
        <path
          d="M20 33 L28.5 41.5 L45 24"
          fill="none"
          stroke="#fff"
          strokeWidth="6"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </>
    ),
  },
  arrow: {
    label: "Arrow",
    body: (
      <>
        <path
          d="M10 46 C16 26 30 18 46 20"
          fill="none"
          stroke="var(--hue-blue-solid)"
          strokeWidth="7"
          strokeLinecap="round"
        />
        <path
          d="M40 9 L55 21 L39 31 Z"
          fill="var(--hue-blue-solid)"
          stroke={INK}
          strokeWidth="2.5"
          strokeLinejoin="round"
        />
      </>
    ),
  },
};

export function stickerLabel(sticker: Sticker): string {
  return SHAPES[sticker].label;
}

export const StickerArt = memo(function StickerArt({
  sticker,
  size,
  className,
}: {
  sticker: Sticker;
  size?: number;
  className?: string;
}) {
  const shape = SHAPES[sticker];
  return (
    <svg
      viewBox="0 0 64 64"
      width={size}
      height={size}
      className={className}
      role="img"
      aria-label={`${shape.label} sticker`}
    >
      {shape.body}
    </svg>
  );
});
