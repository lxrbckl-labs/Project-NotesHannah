import type { NodeWithLinks, SourceFile } from "@notes/schema";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ChevronRight,
  FileSearch,
  FileText,
  FolderInput,
  Image as ImageIcon,
  Inbox,
  Pencil,
  Presentation,
  Trash2,
} from "lucide-react";
import {
  createContext,
  type KeyboardEvent,
  type ReactNode,
  use,
  useEffect,
  useId,
  useMemo,
  useState,
} from "react";
import { useMatch, useNavigate } from "react-router";
import { Badge } from "../../components/ui/badge";
import { ContextActions, type MenuEntry } from "../../components/ui/menu";
import { MiddleTruncate } from "../../components/ui/middle-truncate";
import { api } from "../../lib/api";
import { cn } from "../../lib/cn";
import { SLIDE_TYPES, TEXT_TYPES } from "../../lib/fileTypes";
import type { Hue } from "../../lib/hues";
import { IN_PROGRESS } from "../../lib/messages";
import { FILE_STATUS_HUE } from "../../lib/roles";
import { useFinePointer } from "../../lib/useMedia";
import { useUploadManager } from "../uploads/UploadProvider";
import { useNodeActions } from "./actions";
import { courseHue } from "./courseHue";
import { useLibraryDialogs } from "./dialogs";
import { fileLeafDragProps, useInboxDrop, useRowDnd } from "./dnd";
import { useFileActions } from "./fileActions";
import { InlineName } from "./InlineName";
import { NodeIcon, NodeTile } from "./NodeIcon";
import { lectureParts, nodeTitle } from "./NodeRow";
import { canHoldFiles } from "./picker";
import { fileKeys, folderDepthOf, useChildren, useNode } from "./queries";
import { type Destination, isPending, nodeHref, toDestination } from "./rules";
import { useTreeState } from "./treeState";
import { useNodeMenu } from "./useNodeMenu";

type Variant = "sidebar" | "page";

interface TreeState {
  variant: Variant;
  go: (to: string) => void;
  currentId: string | undefined;
  tabbableId: string | undefined;
  setFocusId: (id: string) => void;
  dnd: boolean;
}

const TreeContext = createContext<TreeState | null>(null);
const useTree = () => {
  const value = use(TreeContext);
  if (!value) throw new Error("TreeItem outside SidebarTree");
  return value;
};

/** The library as an accessible, lazily loaded tree: arrows move, Enter opens. */
export function LibraryTree({
  label = "Library",
  variant = "sidebar",
  withInbox,
}: {
  label?: string;
  variant?: Variant;
  withInbox?: boolean;
}) {
  const roots = useChildren(null);
  const match = useMatch("/library/:nodeId");
  const currentId = match?.params.nodeId;
  const current = useNode(currentId);
  const fine = useFinePointer();
  const treeState = useTreeState();
  const navigate = useNavigate();
  const [focusId, setFocusId] = useState<string>();

  const ancestors = current.data?.ancestors;
  const { expandMany } = treeState;
  useEffect(() => {
    if (variant === "sidebar" && ancestors?.length) expandMany(ancestors);
  }, [ancestors, expandMany, variant]);

  const state = useMemo<TreeState>(
    () => ({
      variant,
      go: (to) => {
        if (variant === "page") {
          const main = document.getElementById("main");
          if (main) treeState.saveScroll(main.scrollTop);
        }
        navigate(to);
      },
      currentId,
      tabbableId: focusId ?? currentId ?? roots.data?.[0]?.id,
      setFocusId,
      dnd: fine,
    }),
    [variant, navigate, treeState, currentId, focusId, roots.data, fine],
  );

  if (roots.isPending) {
    return (
      <div role="status" aria-label="Loading library" className="grid gap-2 px-3 py-2">
        {[0, 1, 2].map((i) => (
          <div key={i} className="skeleton h-7" aria-hidden />
        ))}
      </div>
    );
  }
  if (roots.isError) {
    return (
      <p role="alert" className="px-3 py-2 text-sm text-danger">
        The library could not load.{" "}
        <button type="button" className="underline" onClick={() => roots.refetch()}>
          Try again
        </button>
      </p>
    );
  }
  if (roots.data.length === 0) {
    return <p className="px-3 py-2 text-sm text-text-muted">No terms yet. Add one above.</p>;
  }
  return (
    <TreeContext value={state}>
      <ul
        // biome-ignore lint/a11y/noNoninteractiveElementToInteractiveRole: ARIA tree pattern
        role="tree"
        aria-label={label}
        className={cn(
          "grid grid-cols-[minmax(0,1fr)] gap-px [--indent:12px] md:[--indent:16px]",
          variant === "sidebar" ? "px-2" : "gap-0.5",
        )}
      >
        {withInbox ? <InboxRow /> : null}
        {roots.data.map((node, i) => (
          <TreeItem
            key={node.id}
            node={node}
            depth={0}
            parent={null}
            previousId={roots.data[i - 1]?.id ?? null}
            hue={null}
          />
        ))}
      </ul>
    </TreeContext>
  );
}

/** How long a branch takes to open or close; styles.css (.tree-collapse) uses the same figure. */
const COLLAPSE_MS = 200;

/**
 * A branch that opens and closes with a short slide instead of appearing and vanishing: its rows grow
 * from nothing and shrink back, fading as they go. The rows stay mounted until the closing slide has
 * finished (untouchable meanwhile), and a branch that is already open when the tree loads does not animate.
 */
function Collapse({ open, children }: { open: boolean; children: ReactNode }) {
  const [present, setPresent] = useState(open);
  // `shown` drives the slide; `settled` lifts the clipping once open, so focus rings are not cut off.
  const [shown, setShown] = useState(open);
  const [settled, setSettled] = useState(open);
  useEffect(() => {
    const still =
      typeof window.matchMedia === "function" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const wait = still ? 0 : COLLAPSE_MS;
    if (open) {
      setPresent(true);
      // One frame after mounting, so the browser has the closed state to slide from.
      const frame = requestAnimationFrame(() => setShown(true));
      const done = setTimeout(() => setSettled(true), wait + 20);
      return () => {
        cancelAnimationFrame(frame);
        clearTimeout(done);
      };
    }
    setSettled(false);
    setShown(false);
    const gone = setTimeout(() => setPresent(false), wait);
    return () => clearTimeout(gone);
  }, [open]);
  if (!present) return null;
  return (
    <div className="tree-collapse" data-open={shown} inert={!open}>
      <div className={cn("min-h-0", !settled && "overflow-hidden")}>{children}</div>
    </div>
  );
}

function TreeBranch({
  parent,
  depth,
  hue,
}: {
  parent: NodeWithLinks;
  depth: number;
  hue: Hue | null;
}) {
  const children = useChildren(parent.id);
  const pad = { paddingLeft: `calc(var(--indent) * ${depth} + 40px)` };
  const hasFiles = parent.kind === "lecture" || parent.kind === "folder";
  const files = useQuery({
    queryKey: fileKeys.of(parent.id),
    queryFn: () => api.filesOf(parent.id),
    enabled: hasFiles,
    refetchInterval: (query) =>
      query.state.data?.some((f) => IN_PROGRESS.has(f.status)) ? 3000 : false,
  });
  if (children.isPending) {
    return (
      <li role="none" className="py-1 text-xs text-text-muted" style={pad}>
        Loading
      </li>
    );
  }
  if (children.isError) {
    return (
      <li role="none" className="py-1 text-xs text-danger" style={pad}>
        Could not load
      </li>
    );
  }
  return (
    <>
      {children.data.map((node, i) => (
        <TreeItem
          key={node.id}
          node={node}
          depth={depth}
          parent={parent}
          previousId={children.data[i - 1]?.id ?? null}
          hue={hue}
        />
      ))}
      {files.data?.map((file) => (
        <FileLeaf key={file.id} file={file} depth={depth} hue={hue} />
      ))}
      {hasFiles && files.isPending ? (
        <li role="none" className="py-1 text-xs text-text-muted" style={pad}>
          Loading files
        </li>
      ) : null}
      {hasFiles && files.isError ? (
        <li role="none" className="py-1 text-xs text-danger" style={pad}>
          Could not load files
        </li>
      ) : null}
      {children.data.length === 0 && files.data?.length === 0 ? (
        <li role="none" className="py-1 text-xs text-text-muted" style={pad}>
          Nothing here yet
        </li>
      ) : null}
    </>
  );
}

const STATUS_LABEL: Record<SourceFile["status"], string> = {
  uploaded: "Uploaded",
  converting: "Converting",
  converted: "Converted",
  transcribed: "Transcribed",
  filed: "Filed",
  failed: "Failed",
};

export function FileTypeIcon({ type, size = 17 }: { type: SourceFile["type"]; size?: number }) {
  if (SLIDE_TYPES.has(type)) return <Presentation size={size} aria-hidden />;
  if (TEXT_TYPES.has(type)) return <FileText size={size} aria-hidden />;
  return <ImageIcon size={size} aria-hidden />;
}

export function FileStatusBadge({ status }: { status: SourceFile["status"] }) {
  return <Badge hue={FILE_STATUS_HUE[status]}>{STATUS_LABEL[status]}</Badge>;
}

/** A source file as a leaf: opens the source viewer; move, rename and trash like any item. */
function FileLeaf({ file, depth, hue }: { file: SourceFile; depth: number; hue: Hue | null }) {
  const tree = useTree();
  const nameId = useId();
  const actions = useFileActions();
  const dialogs = useLibraryDialogs();
  const [renaming, setRenaming] = useState(false);
  const pages = file.pageCount
    ? `${file.pageCount} ${file.pageCount === 1 ? "page" : "pages"}`
    : null;
  const entries: MenuEntry[] = [
    { type: "label", text: file.originalName },
    { type: "separator" },
    {
      type: "item",
      label: "Open",
      icon: <FileSearch size={16} />,
      onSelect: () => tree.go(`/files/${file.id}`),
    },
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
      shortcut: "F2",
      onSelect: () => setRenaming(true),
    },
    { type: "separator" },
    {
      type: "item",
      label: "Move to trash",
      icon: <Trash2 size={16} />,
      danger: true,
      shortcut: "Del",
      onSelect: () => void actions.trash(file),
    },
  ];
  const row = (
    <div
      role="treeitem"
      aria-labelledby={nameId}
      aria-level={depth + 1}
      aria-selected={false}
      tabIndex={tree.tabbableId === file.id ? 0 : -1}
      data-testid="tree-file"
      data-type={file.type}
      data-hue={hue ?? undefined}
      title={file.originalName}
      onFocus={(e) => e.target === e.currentTarget && tree.setFocusId(file.id)}
      onClick={() => !renaming && tree.go(`/files/${file.id}`)}
      onKeyDown={(e) => {
        if (e.target !== e.currentTarget) return;
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          tree.go(`/files/${file.id}`);
        } else if (e.key === "F2") {
          e.preventDefault();
          setRenaming(true);
        } else if (e.key === "Delete") {
          e.preventDefault();
          void actions.trash(file);
        } else {
          treeArrowKeys(e, depth);
        }
      }}
      {...fileLeafDragProps(file, tree.dnd)}
      className={cn(
        "flex cursor-pointer items-center gap-2 rounded-control py-1.5 pr-2 text-text transition-colors duration-(--duration-instant) hover:bg-surface-muted",
        tree.variant === "page" ? "min-h-12 text-body" : "min-h-11 text-ui xl:min-h-8",
      )}
      style={{ paddingLeft: `calc(var(--indent) * ${depth} + 40px)` }}
    >
      <span className={cn("shrink-0", hue ? "text-tone-text" : "text-text-muted")}>
        <FileTypeIcon type={file.type} />
      </span>
      <span className="min-w-0 flex-1">
        {renaming ? (
          <InlineName
            value={file.originalName}
            label={`Rename ${file.originalName}`}
            className="min-h-8 py-0 text-sm"
            onCancel={() => setRenaming(false)}
            onCommit={(name) => {
              setRenaming(false);
              void actions.rename(file, name);
            }}
          />
        ) : (
          <span id={nameId} className="line-clamp-2 block break-words md:truncate">
            {file.originalName}
          </span>
        )}
        {tree.variant === "page" && !renaming ? (
          <span className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-caption text-text-muted">
            {pages ? <span>{pages}</span> : null}
            <FileStatusBadge status={file.status} />
          </span>
        ) : null}
      </span>
    </div>
  );
  return (
    <li role="none">
      <ContextActions entries={entries}>{row}</ContextActions>
    </li>
  );
}

function InboxRow() {
  const tree = useTree();
  const uploads = useUploadManager();
  const actions = useFileActions();
  const inbox = useQuery({
    queryKey: fileKeys.inbox,
    queryFn: api.inboxFiles,
    refetchInterval: (query) =>
      query.state.data?.some((f) => IN_PROGRESS.has(f.status)) ? 3000 : false,
  });
  const drop = useInboxDrop({
    enabled: tree.dnd,
    onUploadFiles: (files) => uploads.enqueue(files, { nodeId: null, label: "the inbox" }),
    onMoveFile: (file) => void actions.moveTo(file, null),
  });
  return (
    <li role="none">
      <div
        role="treeitem"
        aria-level={1}
        aria-selected={false}
        tabIndex={0}
        data-testid="tree-inbox"
        data-drop={drop.over ? "into" : undefined}
        {...drop.props}
        onClick={() => tree.go("/inbox")}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            tree.go("/inbox");
          } else if (e.target === e.currentTarget) {
            treeArrowKeys(e, 0);
          }
        }}
        className="flex min-h-12 cursor-pointer items-center gap-2 rounded-control border border-transparent pl-1 pr-3 text-body transition-colors duration-(--duration-instant) hover:border-border hover:bg-surface-muted"
      >
        <span className="size-9 shrink-0" aria-hidden />
        <Inbox size={17} className="shrink-0 opacity-80" aria-hidden />
        <span className="ml-1.5 flex-1 font-medium">Inbox</span>
        <span data-testid="inbox-count">
          <Badge tone="accent">
            {inbox.isPending ? "…" : inbox.isError ? "!" : inbox.data.length}
          </Badge>
        </span>
      </div>
    </li>
  );
}

/** Up and down move between visible rows; shared by the leaf rows. */
function treeArrowKeys(event: KeyboardEvent<HTMLElement>, _depth: number) {
  const items = Array.from(
    event.currentTarget
      .closest<HTMLElement>('[role="tree"]')
      ?.querySelectorAll<HTMLElement>('[role="treeitem"]') ?? [],
  );
  const index = items.indexOf(event.currentTarget);
  if (event.key === "ArrowDown") {
    event.preventDefault();
    items[index + 1]?.focus();
  } else if (event.key === "ArrowUp") {
    event.preventDefault();
    items[index - 1]?.focus();
  } else if (event.key === "ArrowLeft") {
    event.preventDefault();
    for (let i = index - 1; i >= 0; i--) {
      if (
        Number(items[i]?.getAttribute("aria-level")) <
        Number(event.currentTarget.getAttribute("aria-level"))
      ) {
        items[i]?.focus();
        break;
      }
    }
  }
}

function TreeItem({
  node,
  depth,
  parent,
  previousId,
  hue: inherited,
}: {
  node: NodeWithLinks;
  depth: number;
  parent: NodeWithLinks | null;
  previousId: string | null;
  /** The course colour carried down from above; terms and the top have none. */
  hue: Hue | null;
}) {
  // A course starts its own colour, a term has none, everything below carries its course's.
  const hue = node.kind === "course" ? courseHue(node.id) : node.kind === "term" ? null : inherited;
  const tree = useTree();
  const open_ = useTreeState();
  const titleId = useId();
  const client = useQueryClient();
  const actions = useNodeActions();
  const [renaming, setRenaming] = useState(false);
  const { entries, trash } = useNodeMenu(node, { onRename: () => setRenaming(true) });
  // Lectures and folders may hold source files, which childCount does not count.
  const expandable = node.childCount > 0 || canHoldFiles(node);
  const open = expandable && open_.expanded.has(node.id);
  const selected = tree.currentId === node.id;

  const parentDest: Destination | null = parent
    ? toDestination(parent, folderDepthOf(client, parent))
    : null;
  const uploads = useUploadManager();
  const fileActions = useFileActions();
  const { dragProps, dropProps, dropMode } = useRowDnd({
    node,
    enabled: tree.dnd,
    fileTarget: canHoldFiles(node)
      ? {
          nodeId: node.id,
          onUploadFiles: (files) => uploads.enqueue(files, { nodeId: node.id, label: node.name }),
          onMoveFile: (file, nodeId) => void fileActions.moveTo(file, nodeId, node.name),
        }
      : undefined,
    asDestination: toDestination(node, folderDepthOf(client, node)),
    parentDestination: parentDest,
    previousSiblingId: previousId,
    onMove: (source, input) => void actions.move(source, input),
  });

  function focusItem(el: HTMLElement | undefined) {
    el?.focus();
  }

  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.target !== event.currentTarget) return;
    const items = Array.from(
      event.currentTarget
        .closest<HTMLElement>('[role="tree"]')
        ?.querySelectorAll<HTMLElement>('[role="treeitem"]') ?? [],
    );
    const index = items.indexOf(event.currentTarget);
    const stop = () => event.preventDefault();
    switch (event.key) {
      case "ArrowDown":
        stop();
        focusItem(items[index + 1]);
        break;
      case "ArrowUp":
        stop();
        focusItem(items[index - 1]);
        break;
      case "Home":
        stop();
        focusItem(items[0]);
        break;
      case "End":
        stop();
        focusItem(items.at(-1));
        break;
      case "ArrowRight":
        stop();
        if (expandable && !open) open_.toggle(node.id, true);
        else if (open) focusItem(items[index + 1]);
        break;
      case "ArrowLeft":
        stop();
        if (open) open_.toggle(node.id, false);
        else {
          const level = depth + 1;
          for (let i = index - 1; i >= 0; i--) {
            if (Number(items[i]?.getAttribute("aria-level")) === level - 1) {
              focusItem(items[i]);
              break;
            }
          }
        }
        break;
      case "Enter":
      case " ":
        stop();
        tree.go(nodeHref(node));
        break;
      case "F2":
        if (node.kind !== "section" && !isPending(node)) {
          stop();
          setRenaming(true);
        }
        break;
      case "Delete":
        if (node.kind !== "section" && !isPending(node)) {
          stop();
          trash();
        }
        break;
    }
  }

  const row: ReactNode = (
    <div
      role="treeitem"
      aria-labelledby={titleId}
      aria-level={depth + 1}
      aria-expanded={expandable ? open : undefined}
      aria-selected={selected}
      aria-current={selected ? "page" : undefined}
      tabIndex={tree.tabbableId === node.id ? 0 : -1}
      data-testid="tree-item"
      data-kind={node.kind}
      data-hue={hue ?? undefined}
      data-drop={dropMode ?? undefined}
      onFocus={(e) => e.target === e.currentTarget && tree.setFocusId(node.id)}
      onKeyDown={onKeyDown}
      onClick={() => !renaming && tree.go(nodeHref(node))}
      {...dragProps}
      {...dropProps}
      className={cn(
        "flex cursor-pointer items-center gap-1 rounded-control pr-2 transition-colors duration-(--duration-instant)",
        tree.variant === "page"
          ? "min-h-12 border border-transparent text-body hover:border-border"
          : "min-h-11 text-ui xl:min-h-8",
        selected ? "bg-accent-soft font-medium text-accent" : "text-text hover:bg-surface-muted",
        isPending(node) && "opacity-60",
      )}
      style={{ paddingLeft: `calc(var(--indent) * ${depth} + 4px)` }}
    >
      {expandable ? (
        <button
          type="button"
          tabIndex={-1}
          aria-label={`${open ? "Collapse" : "Expand"} ${node.name}`}
          onClick={(e) => {
            e.stopPropagation();
            open_.toggle(node.id);
          }}
          className="hit-area flex size-9 shrink-0 items-center justify-center rounded-inline text-text-muted hover:bg-border/50 xl:size-6"
        >
          <ChevronRight
            size={15}
            // The arrow turns with the branch, at the same pace and curve as the rows opening.
            className={cn(
              "transition-transform duration-(--duration-base) ease-(--ease-calm)",
              open && "rotate-90",
            )}
          />
        </button>
      ) : (
        <span className="size-9 shrink-0 xl:size-6" aria-hidden />
      )}
      {node.kind === "course" ? (
        <NodeTile kind="course" hue={hue} size="sm" />
      ) : (
        <NodeIcon
          kind={node.kind}
          section={node.section}
          size={17}
          className={cn("shrink-0", hue ? "text-tone-text" : "opacity-80")}
        />
      )}
      {renaming ? (
        <InlineName
          value={node.name}
          label={`Rename ${node.name}`}
          className="min-h-8 py-0 text-sm"
          onCancel={() => setRenaming(false)}
          onCommit={(name) => {
            setRenaming(false);
            void actions.rename(node, name);
          }}
        />
      ) : (
        <span id={titleId} className="ml-1.5 flex min-w-0 flex-1 items-baseline gap-2">
          {node.kind === "lecture" ? (
            <>
              <span className="sr-only">{nodeTitle(node)}</span>
              <span aria-hidden className="flex min-w-0 flex-1 items-baseline gap-2">
                <MiddleTruncate text={lectureParts(node).text} />
                {lectureParts(node).date ? (
                  <span className="shrink-0 text-caption text-text-muted">
                    {lectureParts(node).date}
                  </span>
                ) : null}
              </span>
            </>
          ) : (
            <span className="line-clamp-2 min-w-0 break-words md:truncate">{nodeTitle(node)}</span>
          )}
        </span>
      )}
      {tree.variant === "page" && !renaming && node.kind !== "lecture" && node.childCount > 0 ? (
        <span aria-hidden className="hidden shrink-0 sm:block">
          <Badge hue={hue ?? "gray"} size="sm">
            {node.childCount}
          </Badge>
        </span>
      ) : null}
    </div>
  );

  return (
    <li role="none">
      <ContextActions entries={entries}>{row}</ContextActions>
      <Collapse open={open}>
        {/* biome-ignore lint/a11y/useSemanticElements: ARIA tree pattern */}
        <ul
          role="group"
          data-hue={hue ?? undefined}
          style={{ ["--guide" as string]: `calc(var(--indent) * ${depth} + 22px)` }}
          className="relative grid grid-cols-[minmax(0,1fr)] gap-px before:pointer-events-none before:absolute before:inset-y-1 before:left-(--guide) before:w-px before:bg-tone-border before:opacity-60 xl:before:left-[calc(var(--guide)-6px)]"
        >
          <TreeBranch parent={node} depth={depth + 1} hue={hue} />
        </ul>
      </Collapse>
    </li>
  );
}
