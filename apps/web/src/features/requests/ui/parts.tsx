import type { RequestKind, RequestLink, RequestStatus, RequestTarget } from "@notes/schema";
import {
  Ban,
  BookOpen,
  CircleCheck,
  CircleHelp,
  Clock,
  FileImage,
  FileText,
  FolderOpen,
  Library,
  LoaderCircle,
  Network,
  RotateCcw,
  TextCursorInput,
} from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "../../../lib/cn";
import {
  kindLabel,
  linkLabel,
  type OpenAction,
  openLink,
  STATUS_LABEL,
  type StatusTone,
  statusTone,
} from "../model/wording";
import { useRequestsEnv } from "./context";

const TONE: Record<StatusTone, string> = {
  neutral: "bg-surface-muted text-text-muted",
  accent: "bg-accent-soft text-accent",
  success: "bg-accent text-accent-contrast",
  danger: "bg-(--rq-amber-bg) text-(--rq-amber-fg)",
};

const STATUS_ICON: Record<RequestStatus, ReactNode> = {
  waiting: <Clock size={14} aria-hidden />,
  in_progress: <LoaderCircle size={14} aria-hidden className="rq-spin" />,
  done: <CircleCheck size={14} aria-hidden />,
  declined: <RotateCcw size={14} aria-hidden />,
  cancelled: <Ban size={14} aria-hidden />,
};

/** The status in plain words, never colour alone: an icon and the words. */
export function StatusPill({ status, className }: { status: RequestStatus; className?: string }) {
  return (
    <span
      data-testid="status"
      data-status={status}
      className={cn(
        "inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 py-1 text-xs font-medium",
        TONE[statusTone(status)],
        className,
      )}
    >
      {STATUS_ICON[status]}
      {STATUS_LABEL[status]}
    </span>
  );
}

export function TargetIcon({ type, size = 18 }: { type: RequestTarget["type"]; size?: number }) {
  const props = { size, "aria-hidden": true as const };
  switch (type) {
    case "library":
      return <Library {...props} />;
    case "node":
      return <FolderOpen {...props} />;
    case "document":
      return <FileText {...props} />;
    case "block":
      return <TextCursorInput {...props} />;
    case "source":
      return <FileImage {...props} />;
    case "question":
      return <CircleHelp {...props} />;
  }
}

function LinkIcon({ type }: { type: RequestLink["type"] }) {
  switch (type) {
    case "concept":
      return <Network size={14} aria-hidden />;
    case "question":
      return <CircleHelp size={14} aria-hidden />;
    case "source":
      return <FileImage size={14} aria-hidden />;
    case "node":
      return <FolderOpen size={14} aria-hidden />;
    default:
      return <BookOpen size={14} aria-hidden />;
  }
}

/** A link in an agent's reply: opens what it made or changed. */
export function LinkChip({ link }: { link: RequestLink }) {
  const { open } = useRequestsEnv();
  const action: OpenAction = openLink(link);
  return (
    <button
      type="button"
      data-testid="reply-link"
      data-type={link.type}
      onClick={() => open(action)}
      className="inline-flex min-h-11 max-w-full items-center gap-1.5 rounded-full border border-border-strong bg-surface px-3.5 py-1 text-sm font-medium text-accent hover:bg-accent-soft xl:min-h-8"
    >
      <LinkIcon type={link.type} />
      <span className="truncate">{linkLabel(link)}</span>
    </button>
  );
}

/** The quick action she picked, as a small label. */
export function KindTag({ kind }: { kind: RequestKind }) {
  if (kind === "other") return null;
  return (
    <span className="inline-flex shrink-0 items-center rounded-full bg-surface-muted px-2.5 py-0.5 text-xs font-medium text-text-muted">
      {kindLabel(kind)}
    </span>
  );
}

/** A soft note that never alarms. */
export function Note({ children, icon }: { children: ReactNode; icon: ReactNode }) {
  return (
    <p className="flex items-start gap-2.5 rounded-2xl bg-accent-soft px-3.5 py-3 text-sm text-text">
      <span className="mt-0.5 shrink-0 text-accent">{icon}</span>
      <span>{children}</span>
    </p>
  );
}
