import { COLOR_TOKENS, type ColorToken } from "@notes/schema";

/**
 * The palette's hues. They are the schema's colour tokens, so a colour stored on a canvas card,
 * a frame, a mind-map node, a highlight or a block style is already a hue. Each hue has five
 * shades in src/app/styles.css: solid, soft, text, border and mark.
 */
export const HUES = COLOR_TOKENS;
export type Hue = ColorToken;

/** The eight lively hues, for things that need a colour of their own (courses, pairs, series). */
export const CATEGORICAL_HUES = [
  "green",
  "teal",
  "blue",
  "purple",
  "pink",
  "red",
  "orange",
  "yellow",
] as const satisfies readonly Hue[];
export type CategoricalHue = (typeof CATEGORICAL_HUES)[number];

/** The neutral hue: "no colour chosen". */
export const NEUTRAL_HUE = "gray" satisfies Hue;

/** A tone is a hue, or the brand accent. Set it with data-hue; read it with the tone-* utilities. */
export type Tone = Hue | "accent";

/** Plain names for pickers and screen readers. */
export const HUE_LABEL: Record<Hue, string> = {
  gray: "Grey",
  brown: "Brown",
  red: "Red",
  orange: "Orange",
  yellow: "Yellow",
  green: "Green",
  teal: "Teal",
  blue: "Blue",
  purple: "Purple",
  pink: "Pink",
};

export function isHue(value: unknown): value is Hue {
  return typeof value === "string" && (HUES as readonly string[]).includes(value);
}

/** FNV-1a, 32 bits: small, fast and the same in every browser. */
function hash(text: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/**
 * A stable hue for something with no chosen colour: the same id always gets the same hue, on
 * every device. Picks from the eight lively hues, never grey or brown.
 */
export function hueForId(id: string): CategoricalHue {
  return CATEGORICAL_HUES[hash(id) % CATEGORICAL_HUES.length] as CategoricalHue;
}

/** The chosen colour if there is one, otherwise the stable hue for the id. */
export function hueOf(id: string, chosen?: Hue | null): Hue {
  return chosen ?? hueForId(id);
}

/** The n-th colour of a series (matching pairs, chart lines), cycling through the lively hues. */
export function seriesHue(n: number): CategoricalHue {
  const i =
    ((Math.trunc(n) % CATEGORICAL_HUES.length) + CATEGORICAL_HUES.length) % CATEGORICAL_HUES.length;
  return CATEGORICAL_HUES[i] as CategoricalHue;
}

/** CSS custom property for one shade of a hue, for inline styles and SVG: hueVar("blue", "solid"). */
export function hueVar(hue: Tone, shade: "solid" | "soft" | "text" | "border" | "mark"): string {
  if (hue === "accent") {
    const accent = {
      solid: "--color-accent",
      soft: "--color-accent-soft",
      text: "--color-accent",
      border: "--color-accent-border",
      mark: "--color-accent-soft",
    } as const;
    return `var(${accent[shade]})`;
  }
  return `var(--hue-${hue}-${shade})`;
}
