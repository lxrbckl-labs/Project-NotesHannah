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
import { Badge, Chip } from "../../../components/ui/badge";
import { REQUEST_STATUS_HUE } from "../../../lib/roles";
import { kindLabel, linkLabel, type OpenAction, openLink, STATUS_LABEL } from "../model/wording";
import { useRequestsEnv } from "./context";

const STATUS_ICON: Record<RequestStatus, ReactNode> = {
  waiting: <Clock size={14} aria-hidden />,
  in_progress: <LoaderCircle size={14} aria-hidden className="anim-spin" />,
  done: <CircleCheck size={14} aria-hidden />,
  declined: <RotateCcw size={14} aria-hidden />,
  cancelled: <Ban size={14} aria-hidden />,
};

/** The status in plain words, never colour alone: an icon and the words. */
export function StatusPill({ status, className }: { status: RequestStatus; className?: string }) {
  return (
    <span data-testid="status" data-status={status} className="inline-flex shrink-0">
      <Badge hue={REQUEST_STATUS_HUE[status]} icon={STATUS_ICON[status]} className={className}>
        {STATUS_LABEL[status]}
      </Badge>
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
    <Chip
      hue="accent"
      data-testid="reply-link"
      data-type={link.type}
      onClick={() => open(action)}
      icon={<LinkIcon type={link.type} />}
    >
      {linkLabel(link)}
    </Chip>
  );
}

/** The quick action she picked, as a small label. */
export function KindTag({ kind }: { kind: RequestKind }) {
  if (kind === "other") return null;
  return <Badge className="shrink-0">{kindLabel(kind)}</Badge>;
}
