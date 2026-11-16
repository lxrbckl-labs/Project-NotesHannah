import type { Page, SourceFile, Transcript } from "@notes/schema";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CheckCircle2, History, RotateCcw, ShieldQuestion } from "lucide-react";
import { useState } from "react";
import { Button } from "../../components/ui/button";
import { Badge } from "../../components/ui/field";
import { EmptyState, ErrorState, LoadingList } from "../../components/ui/states";
import { useToast } from "../../components/ui/toast";
import { api } from "../../lib/api";
import { cn } from "../../lib/cn";
import { formatDateTime } from "../../lib/format";
import { FLAG_LABEL, segmentText } from "./highlight";

const transcriptKey = (pageId: string) => ["files", "transcript", pageId] as const;
const revisionsKey = (pageId: string) => ["files", "revisions", pageId] as const;

function whoWrote(t: Transcript): string {
  if (t.author.type === "user") return "you";
  return t.author.label ?? "an agent";
}

/** The transcript of one page: flags inline, review state, native text, speaker notes and history. */
export function TranscriptPanel({
  file,
  page,
  highlightQuote,
}: {
  file: SourceFile;
  page: Page;
  highlightQuote?: string | undefined;
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
        <EmptyState icon={<ShieldQuestion size={24} />} title="Nothing transcribed yet">
          {file.status === "failed" || file.status === "converting"
            ? "This file is not ready."
            : "An agent will transcribe this page. Until then you can read the original beside it."}
        </EmptyState>
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-2">
            {t.reviewStatus === "reviewed" ? (
              <Badge tone="accent">Reviewed</Badge>
            ) : (
              <Badge tone="neutral">Unverified</Badge>
            )}
            <span className="text-xs text-text-muted">
              Revision {t.revision} by {whoWrote(t)} · {formatDateTime(t.createdAt)}
            </span>
          </div>

          {t.reviewStatus === "unverified" ? (
            <p className="rounded-xl bg-surface-muted px-3.5 py-2.5 text-sm text-text-muted">
              Unverified: nobody has checked this against the page yet. Doses, units and decimals
              are flagged for a closer look.
            </p>
          ) : t.reviewedAt ? (
            <p className="flex items-center gap-2 text-sm text-text-muted">
              <CheckCircle2 size={16} className="text-accent" aria-hidden />
              You reviewed this on {formatDateTime(t.reviewedAt)}.
            </p>
          ) : null}

          {viewing !== null && shown && viewing !== t.revision ? (
            <p
              role="status"
              className="flex flex-wrap items-center gap-2 rounded-xl bg-accent-soft px-3.5 py-2.5 text-sm text-accent"
            >
              Viewing revision {shown.revision}, not the current one.
              <Button className="ml-auto" onClick={() => setViewing(null)}>
                Back to current
              </Button>
            </p>
          ) : null}

          {shown ? (
            <div
              data-testid="transcript-text"
              className="whitespace-pre-wrap break-words rounded-2xl border border-border bg-surface p-4 text-[15px] leading-relaxed"
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
                      className={cn(
                        "rounded px-0.5",
                        seg.quoted ? "bg-accent text-accent-contrast" : "bg-accent-soft text-text",
                        seg.flag && "border-b-2 border-dotted border-accent",
                      )}
                    >
                      {seg.text}
                      {seg.flag ? (
                        <sup className="ml-0.5 rounded bg-surface-muted px-1 text-[10px] font-medium text-text-muted">
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
                    <Badge>{FLAG_LABEL[flag.kind]}</Badge>
                    <code className="rounded bg-surface-muted px-1.5">{flag.quote}</code>
                    {flag.note ? <span className="text-text-muted">{flag.note}</span> : null}
                  </li>
                ))}
              </ul>
            </section>
          ) : null}

          <div className="flex flex-wrap gap-2">
            {t.reviewStatus === "unverified" ? (
              <Button
                variant="primary"
                disabled={review.isPending}
                onClick={() => review.mutate(true)}
              >
                <CheckCircle2 size={16} aria-hidden />
                Mark as reviewed
              </Button>
            ) : (
              <Button disabled={review.isPending} onClick={() => review.mutate(false)}>
                Take back review
              </Button>
            )}
            <Button aria-expanded={historyOpen} onClick={() => setHistoryOpen((v) => !v)}>
              <History size={16} aria-hidden />
              History{t.revision > 1 ? ` (${t.revision})` : ""}
            </Button>
          </div>

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
                      className="flex flex-wrap items-center gap-2 rounded-xl border border-border bg-surface px-3 py-2 text-sm"
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
        <details className="rounded-2xl border border-border bg-surface px-4 py-3" open={!t}>
          <summary className="cursor-pointer text-sm font-medium">Text from the file</summary>
          <p className="mt-2 whitespace-pre-wrap break-words text-sm text-text-muted">
            {page.nativeText}
          </p>
        </details>
      ) : null}
      {page.speakerNotes ? (
        <details className="rounded-2xl border border-border bg-surface px-4 py-3" open>
          <summary className="cursor-pointer text-sm font-medium">Speaker notes</summary>
          <p className="mt-2 whitespace-pre-wrap break-words text-sm text-text-muted">
            {page.speakerNotes}
          </p>
        </details>
      ) : null}
    </div>
  );
}
