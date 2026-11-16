import type { ConceptType } from "@notes/schema";
import { TYPE_TONE, type TypeTone } from "../model/relations";

/** Literal class names so Tailwind sees them. */
export const TONE_CLASS: Record<TypeTone, string> = {
  green: "bg-(--cx-green-bg) text-(--cx-green-fg)",
  blue: "bg-(--cx-blue-bg) text-(--cx-blue-fg)",
  violet: "bg-(--cx-violet-bg) text-(--cx-violet-fg)",
  teal: "bg-(--cx-teal-bg) text-(--cx-teal-fg)",
  red: "bg-(--cx-red-bg) text-(--cx-red-fg)",
  amber: "bg-(--cx-amber-bg) text-(--cx-amber-fg)",
  grey: "bg-(--cx-grey-bg) text-(--cx-grey-fg)",
};

export const toneOf = (type: ConceptType) => TYPE_TONE[type];
