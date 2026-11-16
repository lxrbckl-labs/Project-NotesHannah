/**
 * The shape of the guide, worked out from content.ts: section numbers, which part each section is
 * in, figure numbers in reading order, and the contents list. Shared by the page, the print
 * booklet and the contents lists.
 */
import {
  type FigureId,
  type GuidePart,
  type GuideSection,
  PARTS,
  QUICK_REFERENCE_ID,
  QUICK_REFERENCE_TITLE,
  SECTIONS,
  SHOWCASE_TITLE,
} from "./content";

export const SHOWCASE_ID = "what-makes-this-different";

export interface OutlineSection {
  section: GuideSection;
  /** 1-based, across the whole guide. */
  number: number;
  part: GuidePart;
}

export interface OutlinePart {
  part: GuidePart;
  /** 1-based. */
  number: number;
  sections: OutlineSection[];
}

const byId = new Map(SECTIONS.map((s) => [s.id, s]));

/** The parts with their sections, numbered in reading order. */
export const OUTLINE: OutlinePart[] = (() => {
  let n = 0;
  return PARTS.map((part, i) => ({
    part,
    number: i + 1,
    sections: part.sections.map((id) => {
      const section = byId.get(id);
      if (!section) throw new Error(`Guide part ${part.id} lists an unknown section: ${id}`);
      n += 1;
      return { section, number: n, part };
    }),
  }));
})();

export const OUTLINE_SECTIONS: OutlineSection[] = OUTLINE.flatMap((p) => p.sections);

/** Figure numbers, in the order the figures appear. */
export const FIGURE_NUMBER: Record<string, number> = (() => {
  const numbers: Record<string, number> = {};
  let n = 0;
  for (const { section } of OUTLINE_SECTIONS) {
    for (const block of section.blocks) {
      if (block.kind === "figure" && !(block.id in numbers)) {
        n += 1;
        numbers[block.id] = n;
      }
    }
  }
  return numbers;
})();

export const figureNumber = (id: FigureId): number => FIGURE_NUMBER[id] ?? 0;

/** Every place the contents lists can jump to, in reading order, for the scroll position. */
export const ANCHORS: { id: string; title: string; number?: number }[] = [
  { id: SHOWCASE_ID, title: SHOWCASE_TITLE },
  ...OUTLINE_SECTIONS.map(({ section, number }) => ({
    id: section.id,
    title: section.title,
    number,
  })),
  { id: QUICK_REFERENCE_ID, title: QUICK_REFERENCE_TITLE },
];

/** Two-digit section numbers for the openers: 01, 02 ... 13. */
export const pad = (n: number) => String(n).padStart(2, "0");
