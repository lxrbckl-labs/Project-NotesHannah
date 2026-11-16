import { ChevronDown, Pencil, RotateCcw, TriangleAlert, X } from "lucide-react";
import { useState } from "react";
import { Button } from "../../components/ui/button";
import { cn } from "../../lib/cn";
import { formatAgo, formatDateTime } from "../../lib/format";
import {
  actionsFor,
  headline,
  openTarget,
  STATUS_HELP,
  targetName,
  targetTypeLabel,
} from "./model/wording";
import type { StudyRequestWithContext } from "./types";
import { useRequestsEnv } from "./ui/context";
import { KindTag, LinkChip, StatusPill, TargetIcon } from "./ui/parts";

export interface CardActions {
  onEdit: (request: StudyRequestWithContext) => void;
  onCancel: (request: StudyRequestWithContext) => void;
  onReopen: (request: StudyRequestWithContext) => void;
}

function When({ iso, prefix }: { iso: string; prefix: string }) {
  return (
    <time dateTime={iso} title={formatDateTime(iso)} className="text-xs text-text-muted">
      {prefix} {formatAgo(iso)}
    </time>
  );
}

export function RequestCard({
  request,
  unread,
  actions,
}: {
  request: StudyRequestWithContext;
  unread: boolean;
  actions: CardActions;
}) {
  const { open } = useRequestsEnv();
  const [showHistory, setShowHistory] = useState(false);
  const can = actionsFor(request.status);
  const target = openTarget(request);
  const name = targetName(request);
  const reply = request.reply;
  const answered = request.status === "done" || request.status === "declined";

  const title = (
    <>
      <span className="mt-0.5 shrink-0 text-text-muted">
        <TargetIcon type={request.target.type} />
      </span>
      <span className="min-w-0 text-left">
        <span className="block truncate text-sm font-semibold">{name}</span>
        <span className="block truncate text-xs text-text-muted">
          {request.context.path ?? targetTypeLabel(request.target.type)}
        </span>
      </span>
    </>
  );

  return (
    <li
      data-testid="request-card"
      data-status={request.status}
      data-unread={unread ? "true" : undefined}
      className={cn(
        "rounded-2xl border bg-surface p-4 shadow-card md:p-5",
        unread ? "border-accent" : "border-border",
        request.status === "cancelled" && "opacity-80",
      )}
    >
      <div className="flex items-start justify-between gap-3">
        {target ? (
          <button
            type="button"
            data-testid="open-target"
            aria-label={`Open ${name}`}
            onClick={() => open(target)}
            className="-ml-2 -mt-1.5 flex min-h-11 min-w-0 items-start gap-2.5 rounded-xl px-2 py-2 hover:bg-surface-muted"
          >
            {title}
          </button>
        ) : (
          <div className="flex min-h-11 min-w-0 items-start gap-2.5 py-0.5">{title}</div>
        )}
        <div className="flex shrink-0 flex-col items-end gap-1.5">
          <StatusPill status={request.status} />
          {unread ? (
            <span className="rounded-full bg-accent-soft px-2 py-0.5 text-xs font-semibold text-accent">
              New answer
            </span>
          ) : null}
        </div>
      </div>

      <div className="mt-2 flex flex-wrap items-start gap-2">
        {request.message.trim() ? <KindTag kind={request.kind} /> : null}
        <p
          data-testid="request-message"
          className="min-w-0 flex-1 basis-56 whitespace-pre-wrap text-base leading-relaxed [overflow-wrap:anywhere]"
        >
          {headline(request)}
        </p>
      </div>
      {request.context.note ? (
        <p className="mt-1.5 text-sm text-text-muted">{request.context.note}</p>
      ) : null}

      {answered && reply ? (
        <section
          aria-label={request.status === "done" ? "The agent's reply" : "Why it was not done"}
          data-testid="reply"
          className="mt-3 rounded-2xl bg-surface-muted px-4 py-3.5"
        >
          <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-text-muted">
            {request.status === "done" ? "Reply" : "Why not"}
            {reply.by.type === "agent" && reply.by.label ? ` from ${reply.by.label}` : ""}
          </p>
          <p className="whitespace-pre-wrap text-sm leading-relaxed [overflow-wrap:anywhere]">
            {reply.text}
          </p>
          {reply.unsourcedFigures ? (
            <p
              data-testid="unsourced-figures"
              className="mt-2.5 flex items-start gap-2 rounded-xl border border-border bg-surface px-3 py-2 text-sm text-text-muted"
            >
              <TriangleAlert size={16} aria-hidden className="mt-0.5 shrink-0 text-accent" />
              <span>
                Contains figures not found in your notes
                {reply.unsourcedFigureList?.length
                  ? `: ${reply.unsourcedFigureList.join(", ")}`
                  : ""}
                . Worth double-checking.
              </span>
            </p>
          ) : null}
          {reply.links.length > 0 ? (
            <div className="mt-3">
              <p className="mb-1.5 text-xs text-text-muted">Changed or made for you</p>
              <div className="flex flex-wrap gap-2">
                {reply.links.map((link) => (
                  <LinkChip key={JSON.stringify(link)} link={link} />
                ))}
              </div>
            </div>
          ) : null}
        </section>
      ) : request.status === "waiting" || request.status === "in_progress" ? (
        <p className="mt-3 text-sm text-text-muted" data-testid="status-help">
          {STATUS_HELP[request.status]}
        </p>
      ) : null}

      {request.reopens.length > 0 ? (
        <div className="mt-3">
          <button
            type="button"
            aria-expanded={showHistory}
            data-testid="history-toggle"
            onClick={() => setShowHistory((value) => !value)}
            className="-ml-2 inline-flex min-h-11 items-center gap-1.5 rounded-xl px-2 text-sm font-medium text-text-muted hover:bg-surface-muted"
          >
            <ChevronDown
              size={16}
              aria-hidden
              className={cn("transition-transform", showHistory && "rotate-180")}
            />
            History ({request.reopens.length} follow-up{request.reopens.length === 1 ? "" : "s"})
          </button>
          {showHistory ? (
            <ol className="mt-1 grid gap-3 border-l-2 border-border pl-4" data-testid="history">
              {request.reopens.map((reopen) => (
                <li key={reopen.at} className="text-sm">
                  {reopen.previousReply ? (
                    <p className="text-text-muted">
                      <span className="font-medium">Earlier answer: </span>
                      {reopen.previousReply.text}
                    </p>
                  ) : null}
                  <p className="mt-1">
                    <span className="font-medium">You reopened it </span>
                    <When iso={reopen.at} prefix="" />
                    {reopen.note ? <span className="block">“{reopen.note}”</span> : null}
                  </p>
                </li>
              ))}
            </ol>
          ) : null}
        </div>
      ) : null}

      <div className="mt-3 flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
        <div className="flex flex-wrap items-center gap-x-3">
          <When iso={request.createdAt} prefix="Left" />
          {reply ? <When iso={reply.at} prefix="Answered" /> : null}
        </div>
        <div className="-mr-2 flex flex-wrap items-center gap-1">
          {can.edit ? (
            <Button variant="ghost" data-testid="edit" onClick={() => actions.onEdit(request)}>
              <Pencil size={15} aria-hidden /> Edit
            </Button>
          ) : null}
          {can.cancel ? (
            <Button
              variant="ghostDanger"
              data-testid="cancel"
              onClick={() => actions.onCancel(request)}
            >
              <X size={15} aria-hidden /> Cancel
            </Button>
          ) : null}
          {can.reopen ? (
            <Button
              variant="ghostAccent"
              data-testid="reopen"
              onClick={() => actions.onReopen(request)}
            >
              <RotateCcw size={15} aria-hidden /> Not right? Reopen
            </Button>
          ) : null}
        </div>
      </div>
    </li>
  );
}
