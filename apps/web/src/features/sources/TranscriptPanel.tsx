import type { Page, SourceFile, Transcript } from "@notes/schema";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ChevronRight, CircleCheck, History, RotateCcw, ShieldQuestion, Undo2 } from "lucide-react";
import { type ReactNode, useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { Button } from "../../components/ui/button";
import { Collapse } from "../../components/ui/collapse";
import { Badge } from "../../components/ui/field";
import { EmptyState, ErrorState, LoadingList } from "../../components/ui/states";
import { useToast } from "../../components/ui/toast";
import { api } from "../../lib/api";
import { cn } from "../../lib/cn";
import { formatDateTime } from "../../lib/format";
import { DOCUMENT_HUE } from "../../lib/roles";
import { FLAG_LABEL, segmentText } from "./highlight";

const transcriptKey = (pageId: string) => ["files", "transcript", pageId] as const;
const revisionsKey = (pageId: string) => ["files", "revisions", pageId] as const;

/** Dose, unit and decimal flags are worth a second look in red; the others in the flag colour. */
function flagHue(kind: string) {
  return kind === "dose" || kind === "unit" || kind === "decimal"
    ? DOCUMENT_HUE.flagDose
    : DOCUMENT_HUE.flag;
}

function whoWrote(t: Transcript): string {
  if (t.author.type === "user") return "you";
  return t.author.label ?? "an agent";
}

/** The transcript of one page: flags inline, review state, native text, speaker notes and history. */
export function TranscriptPanel({
  file,
  page,
  highlightQuote,
  actionsSlot,
}: {
  file: SourceFile;
  page: Page;
  highlightQuote?: string | undefined;
  /**
   * A place in the page's row of bars (SourceViewer's header) for the review and history buttons. When
   * given, they are drawn there as a bar of their own; without it (a phone) they stay under the transcript.
   */
  actionsSlot?: HTMLElement | null | undefined;
}) {
  const client = useQueryClient();
  const toast = useToast();
  const current = useQuery({
    queryKey: transcriptKey(page.id),
    queryFn: () => api.transcriptOf(page.id),
  });
  const [historyOpen, setHistoryOpen] = useState(false);
  const [viewing, setViewing] = useState<number | null>(null);
  const revisions = useQuery({
    queryKey: revisionsKey(page.id),
    queryFn: () => api.revisionsOf(page.id),
    enabled: historyOpen,
  });

  const refresh = () => {
    void client.invalidateQueries({ queryKey: ["files"] });
  };
  const review = useMutation({
    mutationFn: (reviewed: boolean) => api.reviewTranscript(page.id, reviewed),
    onSuccess: (t) => {
      toast.show(t.reviewStatus === "reviewed" ? "Marked as reviewed" : "Review taken back");
      refresh();
    },
    onError: (error) => toast.error(error),
  });
  const restore = useMutation({
    mutationFn: (revision: number) => api.restoreRevision(page.id, revision),
    onSuccess: (t) => {
      toast.show(`Restored. Saved as revision ${t.revision}.`);
      setViewing(null);
      refresh();
    },
    onError: (error) => toast.error(error),
  });

  if (current.isPending) return <LoadingList rows={3} label="Loading transcript" />;
  if (current.isError)
    return <ErrorState error={current.error} onRetry={() => current.refetch()} />;

  const t = current.data;
  const shown: Transcript | null =
    viewing !== null ? (revisions.data?.find((r) => r.revision === viewing) ?? t) : t;
  const total = revisions.data?.length ?? t?.revision ?? 0;

  return (
    <div className="grid gap-4" data-testid="transcript-panel">
      {!t ? (
        <EmptyState icon={<ShieldQuestion size={26} />} title="Nothing transcribed yet">
          {file.status === "failed" || file.status === "converting"
            ? "This file is not ready."
            : "An agent will transcribe this page. Until then you can read the original beside it."}
        </EmptyState>
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-2">
            {t.reviewStatus === "reviewed" ? (
              <Badge tone="success">Reviewed</Badge>
            ) : (
              <Badge tone="warning">Unverified</Badge>
            )}
            <span className="text-xs text-text-muted">
              Revision {t.revision} by {whoWrote(t)} · {formatDateTime(t.createdAt)}
            </span>
          </div>

          {t.reviewStatus === "unverified" ? (
            <p className="rounded-control bg-surface-muted px-3.5 py-2.5 text-sm text-text-muted">
              Unverified: nobody has checked this against the page yet. Doses, units and decimals
              are flagged for a closer look.
            </p>
          ) : t.reviewedAt ? (
            <p className="flex items-center gap-2 text-sm text-text-muted">
              <CircleCheck size={16} className="text-accent" aria-hidden />
              You reviewed this on {formatDateTime(t.reviewedAt)}.
            </p>
          ) : null}

          {viewing !== null && shown && viewing !== t.revision ? (
            <p
              role="status"
              className="flex flex-wrap items-center gap-2 rounded-control bg-accent-soft px-3.5 py-2.5 text-sm text-accent"
            >
              Viewing revision {shown.revision}, not the current one.
              <Button className="ml-auto" onClick={() => setViewing(null)}>
                Back to current
              </Button>
            </p>
          ) : null}

          {shown ? (
            <Fold title="Transcript" startOpen resetKey={page.id}>
              <div
                data-testid="transcript-text"
                className="whitespace-pre-wrap break-words px-4 pb-4 pt-1 text-body leading-relaxed"
              >
                {segmentText(shown.text, shown.flags, highlightQuote).map((seg, i) => {
                  const key = `seg-${i}`;
                  if (seg.flag || seg.quoted) {
                    return (
                      <mark
                        key={key}
                        data-flag={seg.flag?.kind}
                        data-quote={seg.quoted ? "true" : undefined}
                        title={
                          seg.flag ? (seg.flag.note ?? FLAG_LABEL[seg.flag.kind]) : "Cited passage"
                        }
                        data-hue={seg.flag ? flagHue(seg.flag.kind) : DOCUMENT_HUE.highlight}
                        className={cn(
                          "rounded-inline bg-tone-mark px-0.5 text-text",
                          seg.flag && "border-b-2 border-dotted border-tone-solid",
                          seg.quoted && seg.flag && "outline-2 outline-hue-yellow-solid",
                        )}
                      >
                        {seg.text}
                        {seg.flag ? (
                          <sup className="ml-0.5 rounded-inline bg-surface px-1 text-[10px] font-medium text-text">
                            {FLAG_LABEL[seg.flag.kind]}
                          </sup>
                        ) : null}
                      </mark>
                    );
                  }
                  return <span key={key}>{seg.text}</span>;
                })}
                {shown.text === "" ? (
                  <span className="text-text-muted">This page has no text.</span>
                ) : null}
              </div>
            </Fold>
          ) : null}

          {shown && shown.flags.length > 0 ? (
            <section aria-label="Flags">
              <h3 className="mb-1.5 font-sans text-sm font-semibold">Worth a closer look</h3>
              <ul className="grid gap-1.5 text-sm">
                {shown.flags.map((flag, i) => (
                  <li
                    // biome-ignore lint/suspicious/noArrayIndexKey: flags have no id; the list is static
                    key={`${flag.kind}-${flag.quote}-${i}`}
                    data-testid="flag-note"
                    className="flex flex-wrap items-baseline gap-x-2"
                  >
                    <Badge hue={flagHue(flag.kind)}>{FLAG_LABEL[flag.kind]}</Badge>
                    <code className="rounded-inline bg-surface-muted px-1.5">{flag.quote}</code>
                    {flag.note ? <span className="text-text-muted">{flag.note}</span> : null}
                  </li>
                ))}
              </ul>
            </section>
          ) : null}

          {(() => {
            const buttons = (
              <>
                {t.reviewStatus === "unverified" ? (
                  <Button
                    variant="primary"
                    className="doc-head-main"
                    disabled={review.isPending}
                    onClick={() => review.mutate(true)}
                  >
                    <CircleCheck size={16} aria-hidden />
                    Mark as reviewed
                  </Button>
                ) : (
                  <Button disabled={review.isPending} onClick={() => review.mutate(false)}>
                    <Undo2 size={16} aria-hidden />
                    Take back review
                  </Button>
                )}
                <Button aria-expanded={historyOpen} onClick={() => setHistoryOpen((v) => !v)}>
                  <History size={16} aria-hidden />
                  History{t.revision > 1 ? ` (${t.revision})` : ""}
                </Button>
              </>
            );
            return actionsSlot ? (
              // Inside the file's one bar: a thin line, then these, as the next group along.
              createPortal(
                <>
                  <span aria-hidden className="mx-0.5 h-5 w-px shrink-0 bg-border" />
                  {buttons}
                </>,
                actionsSlot,
              )
            ) : (
              <div className="flex flex-wrap gap-2">{buttons}</div>
            );
          })()}

          {historyOpen ? (
            <section aria-label="Transcript history" data-testid="revision-list">
              {revisions.isPending ? (
                <LoadingList rows={2} label="Loading history" />
              ) : revisions.isError ? (
                <ErrorState error={revisions.error} onRetry={() => revisions.refetch()} />
              ) : (
                <ol className="grid gap-2">
                  {revisions.data.map((r) => (
                    <li
                      key={r.id}
                      data-testid="revision"
                      className="flex flex-wrap items-center gap-2 rounded-control border border-border bg-surface px-3 py-2 text-sm"
                    >
                      <span className="font-medium">Revision {r.revision}</span>
                      <span className="text-text-muted">
                        {whoWrote(r)} · {formatDateTime(r.createdAt)}
                        {r.revision === t.revision ? " · current" : ""}
                      </span>
                      <span className="ml-auto flex gap-1.5">
                        {r.revision !== t.revision ? (
                          <>
                            <Button onClick={() => setViewing(r.revision)}>View</Button>
                            <Button
                              aria-label={`Restore revision ${r.revision}`}
                              disabled={restore.isPending}
                              onClick={() => restore.mutate(r.revision)}
                            >
                              <RotateCcw size={16} aria-hidden />
                              Restore
                            </Button>
                          </>
                        ) : null}
                      </span>
                    </li>
                  ))}
                </ol>
              )}
              <p className="mt-2 text-xs text-text-muted">
                Restoring adds a new revision with that text; nothing is lost. {total > 0 ? "" : ""}
              </p>
            </section>
          ) : null}
        </>
      )}

      {page.nativeText ? (
        <Fold title="Text from the file" startOpen={!t} resetKey={page.id}>
          <p className="whitespace-pre-wrap break-words px-4 pb-3 pt-1 text-sm text-text-muted">
            {page.nativeText}
          </p>
        </Fold>
      ) : null}
      {page.speakerNotes ? (
        <Fold title="Speaker notes" startOpen resetKey={page.id}>
          <p className="whitespace-pre-wrap break-words px-4 pb-3 pt-1 text-sm text-text-muted">
            {page.speakerNotes}
          </p>
        </Fold>
      ) : null}
    </div>
  );
}

/**
 * A titled card that folds away: the transcript, the text layer of the file, the speaker notes. The arrow turns
 * and the text slides open and closed (components/ui/collapse), like the other folding parts of the app.
 */
function Fold({
  title,
  startOpen,
  resetKey,
  children,
}: {
  title: string;
  startOpen: boolean;
  /** The page: each page starts as `startOpen` says, whatever she did on the last one. */
  resetKey: string;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(startOpen);
  // biome-ignore lint/correctness/useExhaustiveDependencies: start again for each page
  useEffect(() => setOpen(startOpen), [resetKey, startOpen]);
  return (
    <section className="rounded-card border border-border bg-surface">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className="flex min-h-11 w-full items-center gap-2 rounded-card px-4 text-left text-sm font-medium transition-colors duration-(--duration-instant) hover:bg-surface-muted"
      >
        <ChevronRight
          size={16}
          aria-hidden
          className={cn(
            "shrink-0 text-text-muted transition-transform duration-300 ease-(--ease-calm)",
            open && "rotate-90",
          )}
        />
        {title}
      </button>
      <Collapse open={open} ms={260}>
        {children}
      </Collapse>
    </section>
  );
}
