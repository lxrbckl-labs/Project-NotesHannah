import {
  BLOCK_REGISTRY,
  type Block,
  blockPlainText,
  type Citation,
  citationKey,
  isBlockType,
} from "@notes/schema";
import { ChevronLeft, ChevronRight, ExternalLink, FileText, FileX, Locate, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { IconButton } from "../../../components/ui/button";
import { DOCUMENT_HUE } from "../../../lib/roles";
import { openInTab } from "../../tabs/openInTab";
import { useActions, useView } from "../context";
import { locateQuote, segmentTranscript } from "../model/references";
import type { CitationSource } from "../store/types";
import { ZoomableImage } from "../ui/ZoomableImage";

const sourceCache = new Map<string, Promise<CitationSource>>();

function useSource(citation: Citation | undefined) {
  const { store } = useActions();
  const key = citation ? citationKey(citation) : "";
  const [state, setState] = useState<{
    key: string;
    source: CitationSource | null;
    error: boolean;
  }>({
    key: "",
    source: null,
    error: false,
  });
  // biome-ignore lint/correctness/useExhaustiveDependencies: keyed by the citation, not the object
  useEffect(() => {
    if (!citation) return;
    let alive = true;
    let promise = sourceCache.get(key);
    if (!promise) {
      promise = store.resolveCitation(citation);
      sourceCache.set(key, promise);
      promise.catch(() => sourceCache.delete(key));
    }
    promise.then(
      (source) => alive && setState({ key, source, error: false }),
      () => alive && setState({ key, source: null, error: true }),
    );
    return () => {
      alive = false;
    };
  }, [key, store]);
  return state.key === key ? state : { key, source: null, error: false };
}

/**
 * The source behind a citation (K2, K6): the original page (zoomable, the
 * region outlined), the transcript with the quoted passage highlighted and
 * scrolled into view, and next/previous through the document's references.
 */
export function CitationPanel({
  number,
  onNavigate,
  onClose,
  variant,
}: {
  number: number;
  onNavigate: (number: number) => void;
  onClose?: () => void;
  variant: "side" | "sheet";
}) {
  const { refs } = useView();
  const { docRef, setActive } = useActions();
  const reference = refs.byNumber(number);
  const citation = reference?.citation;
  const { source, error } = useSource(citation);
  const total = refs.references.length;
  const hit = useRef<HTMLElement>(null);
  const transcriptBox = useRef<HTMLDivElement>(null);

  // Scroll the highlighted passage into view inside the transcript box.
  useEffect(() => {
    const el = hit.current;
    const box = transcriptBox.current;
    if (!el || !box) return;
    const top = el.offsetTop - box.clientHeight / 2 + el.clientHeight / 2;
    box.scrollTo({ top: Math.max(0, top), behavior: "auto" });
  });

  if (!reference || !citation) {
    return (
      <p className="p-5 text-sm text-text-muted">This source is no longer cited in the document.</p>
    );
  }

  const jumpTo = (blockId: string) => {
    const el = document.querySelector(`[data-block-id="${blockId}"]`);
    el?.scrollIntoView({ block: "center", behavior: "smooth" });
    el?.classList.add("doc-flash");
    setTimeout(() => el?.classList.remove("doc-flash"), 1300);
    setActive(blockId);
  };

  const available = source?.status === "available" ? source : null;
  const transcript = available?.transcript ?? null;
  const range = transcript ? locateQuote(transcript, citation.quote) : null;
  const segments = transcript ? segmentTranscript(transcript, citation.quote) : [];
  const docBlocks = docRef.current?.blocks ?? [];
  const uses = reference.uses.filter(
    (u, i) => reference.uses.findIndex((v) => v.blockId === u.blockId) === i,
  );

  return (
    <section
      className="flex h-full min-h-0 flex-col"
      data-testid="citation-panel"
      aria-label={`Source ${number}`}
    >
      {/* Beside the document's own bar (DocumentView's toolbar row): the same height, so the two lines under
          them meet. That bar is 71px on a tablet and 55px on a computer; e2e/documents.spec.ts holds them equal. */}
      <div
        className={`flex shrink-0 items-center gap-1 border-b border-border px-3 py-2${variant === "side" ? " min-h-[71px] xl:min-h-[55px]" : ""}`}
        data-testid="citation-head"
      >
        <IconButton
          label="Previous source"
          size="sm"
          disabled={number <= 1}
          onClick={() => onNavigate(number - 1)}
        >
          <ChevronLeft className="size-4.5" />
        </IconButton>
        <p
          className="min-w-0 flex-1 text-center text-label font-medium text-text-muted"
          aria-live="polite"
        >
          Source <span className="font-semibold text-text tabular-nums">{number}</span> of {total}
        </p>
        <IconButton
          label="Next source"
          size="sm"
          disabled={number >= total}
          onClick={() => onNavigate(number + 1)}
        >
          <ChevronRight className="size-4.5" />
        </IconButton>
        {onClose && variant === "side" && (
          <IconButton label="Close source" size="sm" onClick={onClose}>
            <X className="size-4.5" />
          </IconButton>
        )}
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 pt-3 pb-[calc(16px+env(safe-area-inset-bottom))]">
        <div className="mb-3 flex items-start gap-2.5">
          <span
            aria-hidden
            data-hue={available ? DOCUMENT_HUE.citation : DOCUMENT_HUE.citationMissing}
            className="mt-0.5 flex size-9 shrink-0 items-center justify-center rounded-control bg-tone-soft text-tone-text"
          >
            {available || !source ? (
              <FileText className="size-4.5" />
            ) : (
              <FileX className="size-4.5" />
            )}
          </span>
          <div className="min-w-0">
            <p className="m-0 truncate text-body font-semibold" data-testid="source-file">
              {source?.fileName ?? (source ? "Deleted file" : "Loading…")}
            </p>
            <p className="m-0 text-label text-text-muted">
              {citation.label ? `${citation.label} · ` : ""}
              {source?.pageIndex
                ? `page ${source.pageIndex}${available ? ` of ${available.pageCount}` : ""}`
                : ""}
            </p>
          </div>
        </div>

        {error && (
          <p
            role="alert"
            className="rounded-control border border-danger-border bg-danger-soft p-3 text-ui text-danger"
          >
            The source couldn’t be loaded. Check the connection and try again.
          </p>
        )}

        {source && source.status !== "available" && (
          <div
            className="mb-4 rounded-card border border-dashed border-hue-gray-solid bg-surface-muted p-4"
            data-testid="source-unavailable"
          >
            <p className="m-0 font-semibold">Source unavailable</p>
            <p className="mt-1 mb-0 text-label text-text-muted">
              {source.status === "source_trashed"
                ? "This file is in the trash. Restore it from the library’s trash to see the page again."
                : "This file was permanently deleted. Only the quoted passage remains."}
            </p>
          </div>
        )}

        {available && (
          <ZoomableImage
            src={available.image.url}
            width={available.image.width}
            height={available.image.height}
            alt={`${available.fileName}, page ${available.pageIndex}`}
            region={available.region}
            testId="source-image"
            // The side panel is narrow; a sheet on a phone is already most of the screen.
            fullScreen={variant === "side"}
            // The whole file, at this page with the quote marked, in a tab of its own (the same address a
            // practice question's source link uses).
            corner={
              <IconButton
                label="Open this page in a new tab"
                size="sm"
                data-testid="source-open-tab"
                onClick={() =>
                  openInTab(
                    `/files/${citation.fileId}?page=${citation.pageId}&quote=${encodeURIComponent(citation.quote)}`,
                    available.fileName,
                  )
                }
              >
                <ExternalLink className="size-4" />
              </IconButton>
            }
          />
        )}

        <h3 className="mt-5 mb-2 flex items-center justify-between text-caption font-semibold uppercase tracking-[0.06em] text-text-muted">
          {available ? "Transcript" : "Quoted passage"}
          {range?.loose && (
            <span className="font-normal normal-case tracking-normal">
              matched across a line break
            </span>
          )}
        </h3>
        {available ? (
          transcript ? (
            <div
              ref={transcriptBox}
              className="relative max-h-[42vh] overflow-y-auto rounded-card border border-border bg-surface-muted p-3.5 text-ui leading-relaxed whitespace-pre-wrap"
              data-testid="transcript"
            >
              {segments.map((segment, i) =>
                segment.highlight ? (
                  <mark
                    // biome-ignore lint/suspicious/noArrayIndexKey: segments are positional
                    key={i}
                    ref={hit}
                    className="doc-quote-hit text-text"
                    data-testid="quote-highlight"
                  >
                    {segment.text}
                  </mark>
                ) : (
                  // biome-ignore lint/suspicious/noArrayIndexKey: segments are positional
                  <span key={i}>{segment.text}</span>
                ),
              )}
            </div>
          ) : (
            <p className="text-sm text-text-muted">This page has no transcript yet.</p>
          )
        ) : null}
        {(!available || (transcript && !range)) && (
          <blockquote
            data-hue={DOCUMENT_HUE.highlight}
            className="m-0 mt-2 rounded-card border-l-[3px] border-tone-solid bg-tone-soft px-3.5 py-2.5 text-ui italic"
          >
            “{citation.quote}”
            {available && transcript && !range && (
              <span className="mt-1 block text-label not-italic text-tone-text">
                These words weren’t found in the current transcript; it may have been corrected
                since.
              </span>
            )}
          </blockquote>
        )}

        {uses.length > 0 && (
          <>
            <h3 className="mt-5 mb-2 text-caption font-semibold uppercase tracking-[0.06em] text-text-muted">
              Cited in this document
            </h3>
            <ul className="m-0 flex list-none flex-col gap-1 p-0">
              {uses.map((use) => {
                const block = docBlocks.find((b) => b.id === use.blockId);
                return (
                  <li key={use.blockId}>
                    <button
                      type="button"
                      onClick={() => jumpTo(use.blockId)}
                      className="flex min-h-10 w-full items-center gap-2 rounded-control px-2.5 text-left text-label hover:bg-surface-muted pointer-coarse:min-h-11"
                    >
                      <Locate aria-hidden className="size-3.5 shrink-0 text-text-muted" />
                      <span className="truncate">{block ? blockTitle(block) : "A block"}</span>
                    </button>
                  </li>
                );
              })}
            </ul>
          </>
        )}
      </div>
    </section>
  );
}

function blockTitle(block: Block): string {
  const label = isBlockType(block.type) ? BLOCK_REGISTRY[block.type].label : block.type;
  const text = blockPlainText(block).split("\n")[0] ?? "";
  return text ? `${label}: ${text.slice(0, 60)}` : label;
}
