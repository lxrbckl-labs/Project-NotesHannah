import {
  type Block,
  type CitedText,
  citationKey,
  citationMarkers,
  type RichText,
} from "@notes/schema";
import { Flag, Globe } from "lucide-react";
import { Popover } from "../../../components/ui/popover";
import { cn } from "../../../lib/cn";
import { DOCUMENT_HUE } from "../../../lib/roles";
import { RichField } from "../editor/RichField";
import { RemoveButton } from "./common";
import { CiteChip, FlagNote } from "./RichText";

/** Citations of a field that no marker in its text already shows. */
export function unreferenced(field: Pick<CitedText, "citations" | "text">) {
  const used = new Set(citationMarkers(field.text));
  return field.citations.filter((_, i) => !used.has(i + 1));
}

/** Flags of a field, as a small tappable indicator listing every note. */
export function FlagIndicator({
  flags,
  className,
}: {
  flags: CitedText["flags"];
  className?: string;
}) {
  if (flags.length === 0) return null;
  const danger = flags.some((f) => f.kind === "dose" || f.kind === "unit" || f.kind === "decimal");
  return (
    <Popover
      label="Things to check"
      trigger={
        <button
          type="button"
          data-testid="flag-indicator"
          aria-label={`${flags.length} thing${flags.length === 1 ? "" : "s"} to check`}
          data-hue={danger ? DOCUMENT_HUE.flagDose : DOCUMENT_HUE.flag}
          className={cn(
            "relative inline-flex h-6 items-center gap-1 rounded-pill border border-tone-border bg-tone-soft px-2 align-[0.1em] text-caption font-semibold text-tone-text after:absolute after:-inset-2.5 after:content-['']",
            className,
          )}
        >
          <Flag aria-hidden className="size-3" />
          {flags.length > 1 ? flags.length : "Check"}
        </button>
      }
    >
      <div className="flex flex-col gap-3">
        {flags.map((flag, i) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: flags have no IDs
          <FlagNote key={i} flag={flag} />
        ))}
      </div>
    </Popover>
  );
}

export function GeneralKnowledgeTag({ compact }: { compact?: boolean }) {
  return (
    <span
      className="inline-flex items-center gap-1 rounded-pill border border-hue-purple-border bg-hue-purple-soft px-2 py-px align-[0.1em] text-caption font-medium whitespace-nowrap text-hue-purple-text"
      title={compact ? "Not from your notes" : undefined}
    >
      <Globe aria-hidden className="size-3" />
      {compact ? "General" : "Not from your notes"}
    </span>
  );
}

/**
 * One cited field (a drug card line, a comparison cell): its text with any
 * flagged words, its own source chips, flag indicator and general-knowledge
 * label. Editable in place.
 */
export function CitedEntry({
  block,
  field,
  value,
  onCommit,
  onRemove,
  label,
  editing,
  removable,
  className,
}: {
  block: Block;
  field: string;
  value: CitedText;
  onCommit: (text: RichText) => void;
  onRemove?: () => void;
  label: string;
  editing: boolean;
  /** Show the remove button (when the block is selected for editing). */
  removable?: boolean;
  className?: string;
}) {
  const chips = unreferenced(value);
  return (
    <div className={cn("group/entry flex items-start gap-1", className)} data-testid="cited-entry">
      <div className={cn("min-w-0 flex-1", editing && "flex flex-wrap items-baseline gap-x-1")}>
        <RichField
          blockId={block.id}
          field={field}
          value={value.text}
          onCommit={onCommit}
          block={block}
          cited={value}
          flags={value.flags}
          label={label}
          placeholder="Add text"
          as="span"
          className={editing ? "min-w-[4ch]" : "inline"}
        />
        {(chips.length > 0 || value.flags.length > 0 || value.generalKnowledge) && (
          <span className="ml-0.5 inline-flex flex-wrap items-center gap-1 align-baseline">
            {chips.map((citation) => (
              <CiteChip key={citationKey(citation)} citation={citation} />
            ))}
            <FlagIndicator flags={value.flags} />
            {value.generalKnowledge && <GeneralKnowledgeTag compact />}
          </span>
        )}
      </div>
      {editing && removable && onRemove && (
        <RemoveButton label={`Remove ${label}`} onClick={onRemove} className="mt-0.5" />
      )}
    </div>
  );
}
