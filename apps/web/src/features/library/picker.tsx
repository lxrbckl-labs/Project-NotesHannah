import type { NodeWithLinks, SourceFile } from "@notes/schema";
import { Check, ChevronRight, Folder, Inbox } from "lucide-react";
import { type ReactNode, useId, useState } from "react";
import { Tooltip } from "../../components/ui/tooltip";
import { cn } from "../../lib/cn";
import { NodeIcon } from "./NodeIcon";
import { useChildren } from "./queries";
import { moveBlockedReason, NOT_ALLOWED, toDestination } from "./rules";

/** What is being placed, and the rules for where it may go. Nodes and source files share the picker. */
export interface PickerSubject {
  id: string;
  name: string;
  /** Places to open on the way down (the ancestors of where it is now). */
  ancestors: string[];
  currentParentId: string | null;
  /** True when lectures cannot be destinations (only documents go into a lecture). */
  hideLectures: boolean;
  rootLabel: string;
  rootReason: string | null;
  reasonFor: (child: NodeWithLinks, folderDepth: number) => string | null;
}

export function nodeSubject(node: NodeWithLinks): PickerSubject {
  return {
    id: node.id,
    name: node.name,
    ancestors: node.ancestors,
    currentParentId: node.parentId,
    hideLectures: node.kind !== "document",
    rootLabel: "Top of library",
    rootReason: moveBlockedReason(node, null) ?? (node.parentId === null ? "Already here." : null),
    reasonFor: (child, folderDepth) => moveBlockedReason(node, toDestination(child, folderDepth)),
  };
}

/** A source file is filed under a lecture, a folder or a course's Sources section; or the inbox. */
export function canHoldFiles(node: Pick<NodeWithLinks, "kind" | "section">): boolean {
  return (
    node.kind === "lecture" ||
    node.kind === "folder" ||
    (node.kind === "section" && node.section === "sources")
  );
}

export function fileSubject(file: SourceFile, ancestors: string[]): PickerSubject {
  return {
    id: file.id,
    name: file.originalName,
    ancestors,
    currentParentId: file.nodeId,
    hideLectures: false,
    rootLabel: "Inbox (not filed)",
    rootReason: file.nodeId === null ? "Already here." : null,
    reasonFor: (child) => (canHoldFiles(child) ? null : NOT_ALLOWED),
  };
}

/** A lazy tree of places the node could go. Invalid places are shown, disabled, with the reason. */
export function TreePicker({
  subject,
  picked,
  onPick,
}: {
  subject: PickerSubject;
  picked: string | null | undefined;
  onPick: (dest: { id: string | null; name: string }) => void;
}) {
  const rootDisabled = subject.rootReason;
  return (
    <fieldset className="m-0 grid min-w-0 gap-0.5 border-0 p-0">
      <legend className="sr-only">{`Where to put ${subject.name}`}</legend>
      <PickerRow
        label={subject.rootLabel}
        icon={
          subject.rootLabel.startsWith("Inbox") ? (
            <Inbox size={18} aria-hidden />
          ) : (
            <Folder size={18} aria-hidden />
          )
        }
        depth={0}
        disabled={rootDisabled}
        selected={picked === null}
        onSelect={() => onPick({ id: null, name: subject.rootLabel })}
      />
      <PickerBranch
        subject={subject}
        parentId={null}
        depth={1}
        folderDepth={0}
        picked={picked}
        onPick={onPick}
      />
    </fieldset>
  );
}

function PickerBranch({
  subject,
  parentId,
  depth,
  folderDepth,
  picked,
  onPick,
}: {
  subject: PickerSubject;
  parentId: string | null;
  depth: number;
  folderDepth: number;
  picked: string | null | undefined;
  onPick: (dest: { id: string | null; name: string }) => void;
}) {
  const children = useChildren(parentId);
  if (children.isPending)
    return (
      <p className="px-3 py-2 text-sm text-text-muted" style={{ paddingLeft: depth * 20 + 12 }}>
        Loading
      </p>
    );
  if (children.isError)
    return (
      <p className="px-3 py-2 text-sm text-danger" style={{ paddingLeft: depth * 20 + 12 }}>
        Could not load this level.
      </p>
    );
  const items = children.data.filter(
    (n) =>
      n.id !== subject.id &&
      n.kind !== "document" &&
      (n.kind !== "lecture" || !subject.hideLectures),
  );
  return items.map((child) => (
    <PickerNode
      key={child.id}
      subject={subject}
      child={child}
      depth={depth}
      folderDepth={child.kind === "folder" ? folderDepth + 1 : folderDepth}
      picked={picked}
      onPick={onPick}
    />
  ));
}

function PickerNode({
  subject,
  child,
  depth,
  folderDepth,
  picked,
  onPick,
}: {
  subject: PickerSubject;
  child: NodeWithLinks;
  depth: number;
  folderDepth: number;
  picked: string | null | undefined;
  onPick: (dest: { id: string | null; name: string }) => void;
}) {
  const containsSomething = child.childCount > 0 && child.kind !== "lecture";
  const [open, setOpen] = useState(() => subject.ancestors.includes(child.id));
  const reason =
    subject.reasonFor(child, folderDepth) ??
    (child.id === subject.currentParentId ? "Already here." : null);
  return (
    <div>
      <PickerRow
        label={child.name}
        icon={<NodeIcon kind={child.kind} section={child.section} size={18} />}
        depth={depth}
        disabled={reason}
        selected={picked === child.id}
        expandable={containsSomething}
        expanded={open}
        onToggle={() => setOpen((v) => !v)}
        onSelect={() => onPick({ id: child.id, name: child.name })}
      />
      {open && containsSomething ? (
        <div>
          <PickerBranch
            subject={subject}
            parentId={child.id}
            depth={depth + 1}
            folderDepth={folderDepth}
            picked={picked}
            onPick={onPick}
          />
        </div>
      ) : null}
    </div>
  );
}

function PickerRow({
  label,
  icon,
  depth,
  disabled,
  selected,
  expandable,
  expanded,
  onToggle,
  onSelect,
}: {
  label: string;
  icon: ReactNode;
  depth: number;
  disabled: string | null;
  selected: boolean;
  expandable?: boolean;
  expanded?: boolean;
  onToggle?: () => void;
  onSelect: () => void;
}) {
  const reasonId = useId();
  return (
    <div
      className={cn(
        "flex min-h-11 items-center gap-1 rounded-xl pr-2 xl:min-h-9",
        selected ? "bg-accent-soft text-accent" : "hover:bg-surface-muted",
      )}
      style={{ paddingLeft: depth * 18 }}
    >
      {expandable ? (
        <Tooltip content={`${expanded ? "Collapse" : "Expand"} ${label}`}>
          <button
            type="button"
            aria-label={`${expanded ? "Collapse" : "Expand"} ${label}`}
            aria-expanded={expanded}
            onClick={onToggle}
            className="flex size-9 shrink-0 items-center justify-center rounded-lg text-text-muted hover:bg-surface-muted"
          >
            <ChevronRight
              size={16}
              className={cn("transition-transform", expanded && "rotate-90")}
            />
          </button>
        </Tooltip>
      ) : (
        <span className="size-9 shrink-0" />
      )}
      <button
        type="button"
        disabled={!!disabled}
        aria-pressed={selected}
        aria-describedby={disabled ? reasonId : undefined}
        onClick={onSelect}
        className={cn(
          "flex min-h-11 min-w-0 flex-1 items-center gap-2.5 rounded-lg px-1.5 text-left text-sm xl:min-h-9",
          disabled ? "cursor-not-allowed text-text-muted opacity-60" : "",
        )}
      >
        <span className="shrink-0">{icon}</span>
        <span className="min-w-0 flex-1 truncate">{label}</span>
        {disabled ? (
          <span
            id={reasonId}
            aria-hidden
            className={cn("shrink-0 text-xs", disabled === NOT_ALLOWED && "sr-only")}
          >
            {disabled}
          </span>
        ) : null}
        {selected ? <Check size={16} aria-hidden /> : null}
      </button>
    </div>
  );
}
