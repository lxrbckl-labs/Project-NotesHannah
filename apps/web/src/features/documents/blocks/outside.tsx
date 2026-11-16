import { attributionLabel, type Block, type ReferenceAttribution } from "@notes/schema";
import { BookMarked, ExternalLink } from "lucide-react";

/**
 * A chip for an outside reference a block draws on ("PharmGuides · DoseDex"). Deliberately not a
 * numbered source chip: her slides are numbered and open in the viewer; a reference is named and
 * opens the live page in a new tab, so the two can never be mistaken for each other.
 */
export function OutsideRefChip({ reference }: { reference: ReferenceAttribution }) {
  const label = attributionLabel(reference);
  return (
    <a
      href={reference.url}
      target="_blank"
      rel="noopener noreferrer"
      data-testid="outside-ref"
      data-hue="teal"
      title={reference.url}
      className="hit-area inline-flex max-w-full items-center gap-1 rounded-pill border border-tone-border bg-tone-soft px-2 py-px text-caption font-medium text-tone-text hover:border-tone-solid"
    >
      <BookMarked aria-hidden className="size-3 shrink-0" />
      <span className="min-w-0 truncate">{label}</span>
      <ExternalLink aria-hidden className="size-3 shrink-0" />
      <span className="sr-only"> (outside reference, opens in a new tab)</span>
    </a>
  );
}

/** The block's outside references, after its own sources. */
export function OutsideRefsRow({ block }: { block: Block }) {
  const refs = block.references ?? [];
  if (refs.length === 0) return null;
  return (
    <span
      className="inline-flex flex-wrap items-center gap-x-1 gap-y-1"
      data-testid="block-outside-refs"
    >
      <span className="mr-0.5 text-caption font-medium text-text-muted">From</span>
      {refs.map((r) => (
        <OutsideRefChip key={r.url} reference={r} />
      ))}
    </span>
  );
}

/** Each outside reference of a document once, in order of first use, with how often it is used. */
export function outsideReferences(
  blocks: readonly Block[],
): Array<{ reference: ReferenceAttribution; uses: number }> {
  const seen = new Map<string, { reference: ReferenceAttribution; uses: number }>();
  for (const block of blocks) {
    for (const r of block.references ?? []) {
      const entry = seen.get(r.url);
      if (entry) entry.uses += 1;
      else seen.set(r.url, { reference: r, uses: 1 });
    }
  }
  return [...seen.values()];
}
