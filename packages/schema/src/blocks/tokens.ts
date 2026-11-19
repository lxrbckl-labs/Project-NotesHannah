import { z } from "zod";

/**
 * The fixed colour palette. Blocks and highlights name a token, never a raw
 * colour, so the theme can pick a shade that reads well in light and in dark
 * mode. Adding a token is a design change, not a content change.
 */
export const COLOR_TOKENS = [
  "gray",
  "brown",
  "red",
  "orange",
  "yellow",
  "green",
  "teal",
  "blue",
  "purple",
  "pink",
] as const;

export const ColorToken = z
  .enum(COLOR_TOKENS, {
    error: `Use a color token (${COLOR_TOKENS.join(", ")}), not a raw color like "#ff0000", so light and dark themes both work.`,
  })
  .meta({ id: "ColorToken" });
export type ColorToken = z.infer<typeof ColorToken>;

/** Optional look of a block. The theme turns tokens into real colours. */
export const BlockStyle = z
  .strictObject({
    /** Accent colour: text colour for text blocks, border and icon for callouts and cards. */
    color: ColorToken.optional(),
    /** Background tint. */
    background: ColorToken.optional(),
  })
  .meta({ id: "BlockStyle" });
export type BlockStyle = z.infer<typeof BlockStyle>;

/** What a callout is for. Each kind has an icon and a default colour. */
export const CALLOUT_KINDS = [
  "info",
  "tip",
  "warning",
  "important",
  "definition",
  "exam_tip",
] as const;
export const CalloutKind = z.enum(CALLOUT_KINDS);
export type CalloutKind = z.infer<typeof CalloutKind>;

/** Colour a callout gets when its block has no `style.color`. */
export const CALLOUT_DEFAULT_COLORS: Record<CalloutKind, ColorToken> = {
  info: "blue",
  tip: "green",
  warning: "orange",
  important: "red",
  definition: "purple",
  exam_tip: "yellow",
};
