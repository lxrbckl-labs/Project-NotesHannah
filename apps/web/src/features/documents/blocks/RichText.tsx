import {
  type Block,
  type BlockFlag,
  type Citation,
  type CitedText,
  citationKey,
  type RichText,
  type TextRun,
} from "@notes/schema";
import { Flag } from "lucide-react";
import { Fragment, memo, type ReactNode } from "react";
import { useActions, useView } from "../context";
import { FLAG_LABELS, type FlagRange, flagRanges, markerCitation } from "../model/references";
import { cx, Popover } from "../ui/primitives";

/** A numbered citation chip. Tapping opens the source (K2). */
export function CiteChip({ citation, label }: { citation: Citation | undefined; label?: boolean }) {
  const { refs, status, activeCitation } = useView();
  const { openCitation } = useActions();
  const number = citation ? refs.numberOf(citation) : 0;
  const state = citation ? (status.get(citationKey(citation)) ?? "available") : "source_deleted";
  const unavailable = state !== "available";
  const name = citation?.label ?? (number ? `Source ${number}` : "Missing source");
  return (
    <button
      type="button"
      className={label ? "doc-cite doc-source" : "doc-cite"}
      data-status={state}
      data-active={number > 0 && activeCitation === number ? "true" : undefined}
      data-testid="cite-chip"
      aria-label={`Source ${number || "?"}: ${name}${unavailable ? " (source unavailable)" : ""}`}
      disabled={number === 0}
      onClick={(event) => {
        event.stopPropagation();
        if (number) openCitation(number);
      }}
    >
      {number || "?"}
      {label && citation?.label ? <span className="doc-source-label">{citation.label}</span> : null}
    </button>
  );
}

function FlagMark({ flag, children }: { flag: BlockFlag; children: ReactNode }) {
  return (
    <Popover
      label={FLAG_LABELS[flag.kind]}
      trigger={
        <button type="button" className="doc-flag" data-kind={flag.kind} data-testid="flag-mark">
          {children}
        </button>
      }
    >
      <FlagNote flag={flag} />
    </Popover>
  );
}

export function FlagNote({ flag }: { flag: BlockFlag }) {
  const danger = flag.kind === "dose" || flag.kind === "unit" || flag.kind === "decimal";
  return (
    <div className="flex gap-2.5">
      <Flag
        aria-hidden
        className={cx(
          "mt-0.5 size-4 shrink-0",
          danger ? "text-[var(--doc-red-solid)]" : "text-[var(--doc-orange-solid)]",
        )}
      />
      <div>
        <p className="font-semibold">{FLAG_LABELS[flag.kind]}</p>
        {flag.quote && <p className="mt-0.5 text-text-muted">“{flag.quote}”</p>}
        {flag.note && <p className="mt-1">{flag.note}</p>}
        {!flag.note && !flag.quote && (
          <p className="mt-1 text-text-muted">Check this against your notes.</p>
        )}
      </div>
    </div>
  );
}

function wrapMarks(run: TextRun, content: ReactNode): ReactNode {
  let node = content;
  if (run.code) node = <code>{node}</code>;
  if (run.bold) node = <strong className="font-semibold">{node}</strong>;
  if (run.italic) node = <em>{node}</em>;
  if (run.underline) node = <u className="underline-offset-3">{node}</u>;
  if (run.strike) node = <s>{node}</s>;
  if (run.highlight)
    node = (
      <mark className="doc-hl" data-color={run.highlight}>
        {node}
      </mark>
    );
  if (run.link)
    node = (
      <a
        className="doc-link"
        href={run.link}
        target="_blank"
        rel="noopener noreferrer"
        onClick={(e) => e.stopPropagation()}
      >
        {node}
      </a>
    );
  return node;
}

/** Cut [start, end) of a run's text at flag boundaries. */
function pieces(text: string, offset: number, ranges: FlagRange[]) {
  const out: Array<{ text: string; flag: FlagRange | null }> = [];
  let at = 0;
  while (at < text.length) {
    const abs = offset + at;
    const inside = ranges.find((r) => r.start <= abs && abs < r.end);
    if (inside) {
      const end = Math.min(text.length, inside.end - offset);
      out.push({ text: text.slice(at, end), flag: inside });
      at = end;
    } else {
      const next = ranges.find((r) => r.start > abs);
      const end = next ? Math.min(text.length, next.start - offset) : text.length;
      out.push({ text: text.slice(at, end), flag: null });
      at = end;
    }
  }
  return out;
}

export interface RichTextProps {
  value: RichText;
  /** The block, for resolving citation markers. */
  block: Pick<Block, "citations">;
  /** The cited field this text belongs to, if any (its own citations come first). */
  field?: Pick<CitedText, "citations"> | undefined;
  flags?: readonly BlockFlag[] | undefined;
  className?: string;
  as?: "span" | "div" | "p";
  placeholder?: string;
}

/** Rich text in the read view: marks, citation chips, concept chips and flagged words. */
export const RichTextView = memo(function RichTextView({
  value,
  block,
  field,
  flags,
  className,
  as = "span",
  placeholder,
}: RichTextProps) {
  const { openConcept } = useActions();
  const plain = value.map((item) => ("text" in item ? item.text : "")).join("");
  const ranges = flags && flags.length > 0 ? flagRanges(plain, flags) : [];
  let offset = 0;
  const children = value.map((item, i) => {
    if ("cite" in item) {
      // biome-ignore lint/suspicious/noArrayIndexKey: inline items have no identity besides position
      return <CiteChip key={i} citation={markerCitation(block, field, item.cite)} />;
    }
    if ("concept" in item) {
      offset += item.text.length;
      return (
        <button
          // biome-ignore lint/suspicious/noArrayIndexKey: position is the identity
          key={i}
          type="button"
          className="doc-concept"
          data-testid="concept-chip"
          onClick={(event) => {
            event.stopPropagation();
            openConcept(item.concept);
          }}
        >
          {item.text}
        </button>
      );
    }
    const start = offset;
    offset += item.text.length;
    if (ranges.length === 0) {
      // biome-ignore lint/suspicious/noArrayIndexKey: position is the identity
      return <Fragment key={i}>{wrapMarks(item, item.text)}</Fragment>;
    }
    return (
      // biome-ignore lint/suspicious/noArrayIndexKey: position is the identity
      <Fragment key={i}>
        {pieces(item.text, start, ranges).map((piece, j) =>
          piece.flag ? (
            // biome-ignore lint/suspicious/noArrayIndexKey: position is the identity
            <FlagMark key={j} flag={piece.flag.flag}>
              {wrapMarks(item, piece.text)}
            </FlagMark>
          ) : (
            // biome-ignore lint/suspicious/noArrayIndexKey: position is the identity
            <Fragment key={j}>{wrapMarks(item, piece.text)}</Fragment>
          ),
        )}
      </Fragment>
    );
  });
  const Tag = as;
  if (value.length === 0 && placeholder)
    return (
      <Tag className={cx("text-text-muted/70 whitespace-pre-wrap", className)}>{placeholder}</Tag>
    );
  return <Tag className={cx("whitespace-pre-wrap", className)}>{children}</Tag>;
});

/** The chips for a list of citations (a block's own, or a field's). */
export function CiteChips({ citations }: { citations: readonly Citation[] }) {
  if (citations.length === 0) return null;
  return (
    <span className="inline-flex flex-wrap items-center">
      {citations.map((citation) => (
        <CiteChip key={citationKey(citation)} citation={citation} />
      ))}
    </span>
  );
}
