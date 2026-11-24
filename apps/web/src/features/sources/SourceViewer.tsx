import type { NormalizedBox, Page, SourceFile } from "@notes/schema";
import { useQuery } from "@tanstack/react-query";
import { ChevronLeft, ChevronRight, Download, FileSearch, RotateCw } from "lucide-react";
import { type ReactNode, useEffect, useRef, useState } from "react";
import { Link } from "react-router";
import { Button, IconButton } from "../../components/ui/button";
import { segmentItemClass } from "../../components/ui/segmented";
import { EmptyState, ErrorState, Skeleton } from "../../components/ui/states";
import { Tooltip } from "../../components/ui/tooltip";
import { api, originalUrl, pageImageUrl } from "../../lib/api";
import { cn } from "../../lib/cn";
import { FILE_TYPE_LABELS, formatBytes } from "../../lib/fileTypes";
import { formatDate } from "../../lib/format";
import { failureWords, IN_PROGRESS, STATUS_INFO } from "../../lib/messages";
import { useLayout } from "../../lib/useMedia";
import { useHotkey, useHotkeyAria } from "../hotkeys";
import { useFileActions } from "../library/fileActions";
import { FileStatusBadge, FileTypeIcon } from "../library/LibraryTree";
import { fileKeys, useNode } from "../library/queries";
import { TranscriptPanel } from "./TranscriptPanel";
import { type ZoomPaging, ZoomPan } from "./ZoomPan";

export interface SourceViewerProps {
  fileId: string;
  /** Open at this page (a deep link, e.g. from a citation). Defaults to the first page. */
  pageId?: string | undefined;
  /** A passage to highlight in the transcript. */
  highlightQuote?: string | undefined;
  /** A box on the page image to outline (normalised 0..1, as in citations). */
  region?: NormalizedBox | undefined;
  /** Called when she moves to another page, so a route can keep the address in step. */
  onPageChange?: ((pageId: string) => void) | undefined;
  /** A screen's own lead for the header (its back button), shown before the title. */
  headerLead?: ReactNode;
  /** A screen's own actions for the header toolbar (ask an agent), ahead of Download. */
  headerActions?: ReactNode;
}

const pagesKey = (fileId: string) => ["files", "pages", fileId] as const;

/**
 * The source viewer (C6): the page image beside its transcript (tabs on a phone), a strip of
 * thumbnails, zoom and pan, native text and speaker notes, flags, review and history.
 * Embeddable: the documents feature opens it from a citation with `pageId` and `highlightQuote`.
 */
export function SourceViewer({
  fileId,
  pageId,
  highlightQuote,
  region,
  onPageChange,
  headerLead,
  headerActions,
}: SourceViewerProps) {
  const layout = useLayout();
  const actions = useFileActions();
  const file = useQuery({
    queryKey: fileKeys.one(fileId),
    queryFn: () => api.file(fileId),
    refetchInterval: (q) => (q.state.data && IN_PROGRESS.has(q.state.data.status) ? 2000 : false),
  });
  const pages = useQuery({
    queryKey: pagesKey(fileId),
    queryFn: () => api.pagesOf(fileId),
    enabled: !!file.data && !IN_PROGRESS.has(file.data.status) && file.data.status !== "failed",
  });
  const place = useNode(file.data?.nodeId ?? undefined);
  const [currentId, setCurrentId] = useState<string | undefined>(pageId);

  // A new deep link moves the viewer.
  useEffect(() => {
    if (pageId) setCurrentId(pageId);
  }, [pageId]);

  // The place in the header's row of bars where the transcript draws its review and history buttons.
  const [barSlot, setBarSlot] = useState<HTMLElement | null>(null);
  const list = pages.data ?? [];
  const page = list.find((p) => p.id === currentId) ?? list[0];
  const index = page ? list.indexOf(page) : -1;
  const go = (next: Page | undefined) => {
    if (!next) return;
    setCurrentId(next.id);
    onPageChange?.(next.id);
  };
  // Paging keys (features/hotkeys/registry.ts, "Source file"), while there is more than one page.
  useHotkey("source.prevPage", () => go(list[index - 1]), { enabled: list.length > 1 });
  useHotkey("source.nextPage", () => go(list[index + 1]), { enabled: list.length > 1 });

  if (file.isPending) {
    return (
      <div role="status" aria-label="Loading file" className="grid gap-4">
        <Skeleton className="h-10 w-72" />
        <Skeleton className="h-72" />
      </div>
    );
  }
  if (file.isError) return <ErrorState error={file.error} onRetry={() => file.refetch()} />;
  const f = file.data;

  return (
    <div className="grid grid-cols-[minmax(0,1fr)] gap-4" data-testid="source-viewer">
      <ViewerHeader
        file={f}
        placePath={place.data?.path}
        placeId={place.data?.id}
        lead={headerLead}
        actions={headerActions}
        onActionsSlot={layout === "phone" ? undefined : setBarSlot}
        // The pager sits in the header row as a bar of its own, at the right of the file's actions: one
        // page (a photo, a single image) has no pager to nowhere.
        pager={
          page && list.length > 1 ? (
            // biome-ignore lint/a11y/useSemanticElements: a group of the page's one toolbar
            <div role="group" aria-label="Pages" data-testid="file-pager" className="contents">
              <span aria-hidden className="mx-0.5 h-5 w-px shrink-0 bg-border" />
              <IconButton
                aria-label="Previous page"
                hotkey="source.prevPage"
                size="sm"
                variant="bare"
                disabled={index <= 0}
                onClick={() => go(list[index - 1])}
              >
                <ChevronLeft size={18} />
              </IconButton>
              <p
                className="min-w-28 px-2 text-center text-label font-medium text-text-muted tabular-nums"
                aria-live="polite"
                data-testid="page-position"
              >
                Page <span className="font-semibold text-text">{page.index}</span> of {list.length}
              </p>
              <IconButton
                aria-label="Next page"
                hotkey="source.nextPage"
                size="sm"
                variant="bare"
                disabled={index >= list.length - 1}
                onClick={() => go(list[index + 1])}
              >
                <ChevronRight size={18} />
              </IconButton>
            </div>
          ) : undefined
        }
      />

      {f.status === "failed" || f.status === "converting" || f.status === "uploaded" ? (
        <NotReady file={f} onRetry={() => void actions.retry(f)} />
      ) : pages.isPending ? (
        <Skeleton className="h-80" />
      ) : pages.isError ? (
        <ErrorState error={pages.error} onRetry={() => pages.refetch()} />
      ) : !page ? (
        <EmptyState icon={<FileSearch size={26} />} title="No pages">
          This file has no pages to show.
        </EmptyState>
      ) : (
        <>
          {/* One page (a photo, a single image): no strip of one thumbnail and no pager to nowhere. */}
          {list.length > 1 ? <Thumbnails pages={list} currentId={page.id} onPick={go} /> : null}
          {layout === "phone" ? (
            <PhonePanes
              key={page.id}
              file={f}
              page={page}
              highlightQuote={highlightQuote}
              region={region}
            />
          ) : (
            <div className="grid grid-cols-[minmax(0,1fr)] items-start gap-4 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
              <PageImage
                page={page}
                region={region}
                // In full screen the pager below is covered, so the picture carries its own arrows.
                paging={
                  list.length > 1
                    ? {
                        position: `Page ${page.index} of ${list.length}`,
                        onPrevious: index > 0 ? () => go(list[index - 1]) : undefined,
                        onNext: index < list.length - 1 ? () => go(list[index + 1]) : undefined,
                      }
                    : undefined
                }
              />
              <TranscriptPanel
                file={f}
                page={page}
                highlightQuote={highlightQuote}
                actionsSlot={barSlot}
              />
            </div>
          )}
        </>
      )}
    </div>
  );
}

/**
 * The header, top to bottom: back and the title with its place, then the facts as quiet text, then one
 * toolbar of the actions in groups: agent, then download. The toolbar is the document page's bar
 * (`.doc-head-bar` in styles.css): one control height, thin lines between the groups.
 */
function ViewerHeader({
  file,
  placePath,
  placeId,
  lead,
  actions,
  pager,
  onActionsSlot,
}: {
  file: SourceFile;
  placePath?: string | undefined;
  placeId?: string | undefined;
  lead?: ReactNode;
  actions?: ReactNode;
  /** The page pager, shown at the right of the actions bar. */
  pager?: ReactNode;
  /** Given the element that holds the transcript's bar in this row (tablet and computer). */
  onActionsSlot?: ((el: HTMLElement | null) => void) | undefined;
}) {
  const download = useRef<HTMLAnchorElement>(null);
  useHotkey("source.download", () => download.current?.click());
  const downloadKeys = useHotkeyAria("source.download");
  return (
    <header className="grid grid-cols-[minmax(0,1fr)] gap-3" data-testid="file-header">
      <div className="flex items-start gap-3">
        {lead}
        <span className="flex size-12 shrink-0 items-center justify-center rounded-card bg-accent-soft text-accent">
          <FileTypeIcon type={file.type} size={24} />
        </span>
        <div className="min-w-0 flex-1">
          <h1 className="break-words text-2xl font-semibold leading-tight [overflow-wrap:anywhere] md:text-3xl">
            {file.originalName}
          </h1>
          <p className="mt-1 text-sm">
            {file.nodeId && placePath ? (
              <>
                Filed under{" "}
                <Link
                  className="text-accent underline-offset-2 hover:underline"
                  to={`/library/${placeId}`}
                >
                  {placePath}
                </Link>
              </>
            ) : file.nodeId ? null : (
              <span className="text-text-muted">In the inbox, not filed yet.</span>
            )}
          </p>
          <div
            data-testid="file-details"
            className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-text-muted"
          >
            <span>
              Original: {FILE_TYPE_LABELS[file.type]}, {formatBytes(file.bytes)}
            </span>
            {file.pageCount ? (
              <span>
                {file.pageCount} {file.pageCount === 1 ? "page" : "pages"}
              </span>
            ) : null}
            <span>Uploaded {formatDate(file.createdAt)}</span>
            <FileStatusBadge status={file.status} />
            {file.conversionNotes.map((note) => (
              <span key={note} className="basis-full">
                {note}
              </span>
            ))}
          </div>
        </div>
      </div>
      {/* One bar for the whole page, in groups with a thin line between them: what she can do with the
          file, then the transcript's review and history (drawn in by TranscriptPanel), and at the right end
          where she is in the file. */}
      <div>
        <div
          role="toolbar"
          aria-label="This file"
          data-testid="file-toolbar"
          className="doc-head-bar flex w-full flex-wrap items-center gap-0.5 rounded-card border border-border-strong bg-surface p-1 shadow-card"
        >
          {actions}
          {actions ? <span aria-hidden className="mx-0.5 h-5 w-px shrink-0 bg-border" /> : null}
          <Tooltip content="Download original" hotkey="source.download">
            <a
              ref={download}
              href={originalUrl(file.id, true)}
              download
              aria-label="Download original"
              aria-keyshortcuts={downloadKeys}
              className="flex min-h-11 min-w-11 items-center justify-center gap-1.5 rounded-control px-2 xl:h-8 xl:min-h-8 xl:min-w-8 text-ui font-medium text-text transition-colors duration-(--duration-instant) hover:bg-surface-muted sm:px-3"
            >
              <Download size={15} aria-hidden />
              <span className="max-sm:hidden">Download original</span>
            </a>
          </Tooltip>
          {/* The transcript's buttons (review, history) are drawn into this place by TranscriptPanel. */}
          {onActionsSlot ? (
            <div ref={onActionsSlot} className="contents" data-testid="transcript-bar" />
          ) : null}
          {pager ? <div className="ml-auto flex items-center gap-0.5">{pager}</div> : null}
        </div>
      </div>
    </header>
  );
}

function NotReady({ file, onRetry }: { file: SourceFile; onRetry: () => void }) {
  const failed = file.status === "failed";
  return (
    <EmptyState
      icon={failed ? <RotateCw size={26} /> : <FileSearch size={26} />}
      title={failed ? "This file could not be converted" : STATUS_INFO[file.status].label}
      action={
        failed || file.status === "uploaded" ? (
          <Button variant="primary" onClick={onRetry}>
            Retry conversion
          </Button>
        ) : null
      }
    >
      {failed ? failureWords(file) : STATUS_INFO[file.status].words}
    </EmptyState>
  );
}

function Thumbnails({
  pages,
  currentId,
  onPick,
}: {
  pages: Page[];
  currentId: string;
  onPick: (page: Page) => void;
}) {
  const strip = useRef<HTMLUListElement>(null);
  useEffect(() => {
    strip.current
      ?.querySelector('[aria-current="true"]')
      ?.scrollIntoView({ inline: "center", block: "nearest" });
  }, []);
  return (
    <nav aria-label="Pages">
      <ul ref={strip} className="flex gap-2 overflow-x-auto pb-1">
        {pages.map((p) => (
          <li key={p.id} className="shrink-0">
            <button
              type="button"
              aria-label={`Page ${p.index}`}
              aria-current={p.id === currentId ? "true" : undefined}
              data-page-id={p.id}
              data-testid="thumb"
              onClick={() => onPick(p)}
              className={cn(
                "relative block overflow-hidden rounded-control border-2 bg-surface-muted",
                p.id === currentId
                  ? "border-accent"
                  : "border-transparent hover:border-border-strong",
              )}
            >
              <img
                src={pageImageUrl(p.id, "thumb")}
                alt=""
                loading="lazy"
                className="h-20 w-auto min-w-14 max-w-32 object-contain md:h-24"
              />
              <span className="absolute bottom-1 left-1 rounded-inline bg-surface/90 px-1.5 text-xs font-medium">
                {p.index}
              </span>
            </button>
          </li>
        ))}
      </ul>
    </nav>
  );
}

function PageImage({
  page,
  region,
  paging,
}: {
  page: Page;
  region?: NormalizedBox | undefined;
  paging?: ZoomPaging | undefined;
}) {
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");
  // biome-ignore lint/correctness/useExhaustiveDependencies: reset the state for each page
  useEffect(() => setState("loading"), [page.id]);
  return (
    <div>
      <ZoomPan
        label={`Page ${page.index} image. Scroll or pinch to zoom, drag to move.`}
        paging={paging}
      >
        {state === "error" ? (
          <p role="alert" className="p-8 text-sm text-danger">
            The page image could not load.
          </p>
        ) : (
          <img
            key={page.id}
            src={pageImageUrl(page.id)}
            alt={`Page ${page.index}`}
            draggable={false}
            onLoad={() => setState("ready")}
            onError={() => setState("error")}
            className="block max-h-[min(62dvh,46rem)] w-full bg-white object-contain"
          />
        )}
        {region && state === "ready" ? (
          <div
            data-testid="region"
            title="Cited area"
            className="pointer-events-none absolute rounded-inline border-2 border-accent bg-accent/15"
            style={{
              left: `${region.x * 100}%`,
              top: `${region.y * 100}%`,
              width: `${region.width * 100}%`,
              height: `${region.height * 100}%`,
            }}
          />
        ) : null}
      </ZoomPan>
    </div>
  );
}

/** On a phone: the page and the transcript are two panes you swipe between, with tabs on top. */
function PhonePanes({
  file,
  page,
  highlightQuote,
  region,
}: {
  file: SourceFile;
  page: Page;
  highlightQuote?: string | undefined;
  region?: NormalizedBox | undefined;
}) {
  const scroller = useRef<HTMLDivElement>(null);
  const [tab, setTab] = useState(highlightQuote ? 1 : 0);

  // biome-ignore lint/correctness/useExhaustiveDependencies: jump to the starting tab once
  useEffect(() => {
    const el = scroller.current;
    if (el && tab === 1) el.scrollTo({ left: el.clientWidth });
  }, []);

  function choose(next: number) {
    setTab(next);
    const el = scroller.current;
    el?.scrollTo({ left: next * el.clientWidth, behavior: "smooth" });
  }

  return (
    <div>
      <div
        role="tablist"
        aria-label="Page or transcript"
        className="mb-3 grid grid-cols-2 gap-1 rounded-card border border-border bg-surface-muted p-1"
      >
        {["Page", "Transcript"].map((label, i) => (
          <button
            key={label}
            type="button"
            role="tab"
            aria-selected={tab === i}
            onClick={() => choose(i)}
            className={segmentItemClass(tab === i)}
          >
            {label}
          </button>
        ))}
      </div>
      <div
        ref={scroller}
        data-testid="pane-scroller"
        onScroll={(event) => {
          const el = event.currentTarget;
          setTab(Math.round(el.scrollLeft / Math.max(1, el.clientWidth)));
        }}
        className="flex snap-x snap-mandatory overflow-x-auto [scrollbar-width:none]"
      >
        <div role="tabpanel" aria-label="Page" className="w-full shrink-0 snap-center pr-1">
          <PageImage page={page} region={region} />
        </div>
        <div role="tabpanel" aria-label="Transcript" className="w-full shrink-0 snap-center pl-1">
          <TranscriptPanel file={file} page={page} highlightQuote={highlightQuote} />
        </div>
      </div>
    </div>
  );
}
