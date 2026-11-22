import type { SourceFile } from "@notes/schema";
import {
  FolderInput,
  GripVertical,
  Inbox,
  MoreHorizontal,
  Pencil,
  RotateCw,
  Trash2,
} from "lucide-react";
import { useState } from "react";
import { Link } from "react-router";
import { Button, IconButton } from "../../components/ui/button";
import { ActionMenu, ContextActions, type MenuEntry } from "../../components/ui/menu";
import { cn } from "../../lib/cn";
import { FILE_TYPE_SHORT } from "../../lib/fileTypes";
import { formatAgo } from "../../lib/format";
import type { Hue } from "../../lib/hues";
import { failureWords, STATUS_INFO } from "../../lib/messages";
import { useFinePointer } from "../../lib/useMedia";
import { useLibraryDialogs } from "../library/dialogs";
import { fileLeafDragProps } from "../library/dnd";
import { useFileActions } from "../library/fileActions";
import { InlineName } from "../library/InlineName";
import { FileStatusBadge } from "../library/LibraryTree";
import { FileTile } from "../library/NodeIcon";

/**
 * One source file in a list (inbox, a lecture's files): name, what its status means in plain
 * words, and the things she can do with it.
 */
export function FileRow({
  file,
  showPlace,
  placeName,
  hue,
}: {
  file: SourceFile;
  showPlace?: boolean;
  placeName?: string;
  /** The course colour of the page the row is on; the inbox has none (neutral). */
  hue?: Hue | null | undefined;
}) {
  const actions = useFileActions();
  const dialogs = useLibraryDialogs();
  const fine = useFinePointer();
  const [renaming, setRenaming] = useState(false);
  const failed = file.status === "failed";
  const canRetry = failed || file.status === "uploaded";
  const words = failed ? failureWords(file) : STATUS_INFO[file.status].words;
  const pages = file.pageCount
    ? `${file.pageCount} ${file.pageCount === 1 ? "page" : "pages"}`
    : null;

  const entries: MenuEntry[] = [
    { type: "label", text: file.originalName },
    { type: "separator" },
    ...(canRetry
      ? [
          {
            type: "item" as const,
            label: "Retry conversion",
            icon: <RotateCw size={16} />,
            onSelect: () => void actions.retry(file),
          },
        ]
      : []),
    {
      type: "item",
      label: "File under…",
      icon: <FolderInput size={16} />,
      onSelect: () => dialogs.openMoveFile(file),
    },
    ...(file.nodeId
      ? [
          {
            type: "item" as const,
            label: "Back to inbox",
            icon: <Inbox size={16} />,
            onSelect: () => void actions.moveTo(file, null),
          },
        ]
      : []),
    {
      type: "item",
      label: "Rename",
      icon: <Pencil size={16} />,
      onSelect: () => setRenaming(true),
    },
    { type: "separator" },
    {
      type: "item",
      label: "Move to trash",
      icon: <Trash2 size={16} />,
      danger: true,
      onSelect: () => void actions.trash(file),
    },
  ];

  return (
    <ContextActions entries={entries}>
      <li
        data-testid="file-row"
        data-status={file.status}
        {...fileLeafDragProps(file, fine)}
        className="group flex flex-wrap items-center gap-x-3 gap-y-2 rounded-card border border-border bg-surface py-2.5 pl-3 pr-1.5 shadow-card hover:border-border-strong"
      >
        {fine ? (
          <GripVertical
            size={16}
            aria-hidden
            className="hidden shrink-0 text-text-muted opacity-0 group-hover:opacity-100 xl:block"
          />
        ) : null}
        <FileTile type={file.type} hue={hue} />
        <div className="min-w-0 flex-1 basis-52">
          {renaming ? (
            <InlineName
              value={file.originalName}
              label={`Rename ${file.originalName}`}
              onCancel={() => setRenaming(false)}
              onCommit={(name) => {
                setRenaming(false);
                void actions.rename(file, name);
              }}
            />
          ) : (
            <Link
              to={`/files/${file.id}`}
              draggable={false}
              className="block break-words rounded-inline font-medium [overflow-wrap:anywhere] hover:underline"
            >
              {file.originalName}
            </Link>
          )}
          <p className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-text-muted">
            <FileStatusBadge status={file.status} />
            <span>{FILE_TYPE_SHORT[file.type]}</span>
            {pages ? <span>{pages}</span> : null}
            <span>{formatAgo(file.createdAt)}</span>
            {showPlace ? (
              <span>{file.nodeId ? `Filed under ${placeName ?? "a lecture"}` : "Not filed"}</span>
            ) : null}
          </p>
          <p className={cn("mt-1 text-sm", failed ? "text-danger" : "text-text-muted")}>{words}</p>
        </div>
        <div className="flex items-center gap-1">
          {canRetry ? (
            <Button
              aria-label={`Retry ${file.originalName}`}
              onClick={() => void actions.retry(file)}
            >
              <RotateCw size={16} aria-hidden />
              Retry
            </Button>
          ) : null}
          {!file.nodeId && !failed ? (
            <Button
              aria-label={`File ${file.originalName} under…`}
              onClick={() => dialogs.openMoveFile(file)}
            >
              <FolderInput size={16} aria-hidden />
              File under…
            </Button>
          ) : null}
          <ActionMenu
            trigger={
              <IconButton aria-label={`Actions for ${file.originalName}`}>
                <MoreHorizontal size={20} />
              </IconButton>
            }
            entries={entries}
          />
        </div>
      </li>
    </ContextActions>
  );
}
