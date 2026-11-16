import type { Block, CitationStatus } from "@notes/schema";
import { BookOpen, ListTree, MessageSquareText } from "lucide-react";
import { type ReactNode, type RefObject, useEffect, useMemo, useState } from "react";
import { Sheet } from "../../../../components/ui/sheet";
import { cn } from "../../../../lib/cn";
import { useActions, useSignal } from "../../context";
import type { ReferenceIndex } from "../../model/references";
import { AddNoteHere, NotesPanel } from "../notes/NotesPanel";
import { type OutlineItem, OutlinePanel } from "../OutlinePanel";
import { ResourcesPanel } from "../ResourcesPanel";
import { Dock, type PanelDef } from "./Dock";
import type { PanelId, Side } from "./layout";
import { PANEL_TITLE } from "./PanelsMenu";
import type { DockApi } from "./useDock";

export interface PanelData {
  scroller: RefObject<HTMLDivElement | null>;
  blocks: readonly Block[];
  outline: OutlineItem[];
  refs: ReferenceIndex;
  status: ReadonlyMap<string, CitationStatus>;
  names: ReadonlyMap<string, { fileName: string | null; pageIndex: number | null }>;
  onJumpHeading: (id: string) => void;
  onJumpBlock: (blockId: string) => void;
}

/** A value that follows another once it has stopped changing for a moment (her typing, say). */
function useSettled<T>(value: T, ms: number): T {
  const [settled, setSettled] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setSettled(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return settled;
}

/** The outline, its current section following the reading line. */
function OutlineFollow({ items, onJump }: { items: OutlineItem[]; onJump: (id: string) => void }) {
  const { reading } = useActions();
  const heading = useSignal(reading, (s) => s.headingId);
  return (
    <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
      <OutlinePanel items={items} current={heading ?? items[0]?.id ?? null} onJump={onJump} />
    </div>
  );
}

function NotesBadge() {
  const { sideNotes } = useActions();
  const open = useSignal(sideNotes.model.counts, (m) => {
    let n = 0;
    for (const c of m.values()) n += c.open;
    return n;
  });
  if (open === 0) return null;
  return (
    <span className="rounded-pill border border-warning-border bg-warning-soft px-1.5 text-caption font-semibold normal-case tracking-normal text-warning tabular-nums">
      {open}
    </span>
  );
}

/**
 * The panel contents, shared by the sidebars and the phone's sheet. The page's text changes on
 * every key she types; the panels see it a moment later (`useSettled`), so typing stays smooth.
 */
function usePanelContent(data: PanelData) {
  const blocks = useSettled(data.blocks, 350);
  const order = blocks.map((b) => b.id).join(" ");
  const blockOrder = useMemo(() => (order ? order.split(" ") : []), [order]);
  return {
    outline: <OutlineFollow items={data.outline} onJump={data.onJumpHeading} />,
    resources: (
      <ResourcesPanel
        blocks={blocks}
        refs={data.refs}
        status={data.status}
        names={data.names}
        onJump={data.onJumpBlock}
      />
    ),
    notes: (mode: "aligned" | "list") => (
      <NotesPanel
        mode={mode}
        scroller={data.scroller}
        blockOrder={blockOrder}
        onShowBlock={data.onJumpBlock}
      />
    ),
  };
}

export const PANEL_ICON: Record<PanelId, ReactNode> = {
  outline: <ListTree aria-hidden />,
  resources: <BookOpen aria-hidden />,
  notes: <MessageSquareText aria-hidden />,
};

/** The two sidebars with the Outline, Resources and Side notes panels, around the page column. */
export function DocumentDock({
  dock,
  data,
  suppress,
  children,
}: {
  dock: DockApi;
  data: PanelData;
  suppress?: readonly Side[];
  children: ReactNode;
}) {
  const content = usePanelContent(data);
  const panels: Record<PanelId, PanelDef> = {
    outline: {
      title: PANEL_TITLE.outline,
      icon: PANEL_ICON.outline,
      render: () => content.outline,
    },
    resources: {
      title: PANEL_TITLE.resources,
      icon: PANEL_ICON.resources,
      render: () => content.resources,
    },
    notes: {
      title: PANEL_TITLE.notes,
      icon: PANEL_ICON.notes,
      badge: <NotesBadge />,
      actions: <AddNoteHere />,
      // Beside the page or over it, the notes line up with their blocks.
      render: () => content.notes("aligned"),
    },
  };
  return (
    <Dock dock={dock} panels={panels} {...(suppress ? { suppress } : {})}>
      {children}
    </Dock>
  );
}

/**
 * On a phone there is no room for sidebars: the three panels share a bottom sheet with tabs
 * (portalled to the page body by the sheet, so it sits above the tab bar).
 */
export function PanelsSheet({
  open,
  tab,
  onTab,
  onOpenChange,
  data,
}: {
  open: boolean;
  tab: PanelId;
  onTab: (tab: PanelId) => void;
  onOpenChange: (open: boolean) => void;
  data: PanelData;
}) {
  const content = usePanelContent(data);
  return (
    <Sheet
      open={open}
      onOpenChange={onOpenChange}
      title={PANEL_TITLE[tab]}
      placement="bottom"
      flush
      testId="panels-sheet"
    >
      <div className="flex h-[min(70dvh,36rem)] flex-col">
        <div
          role="tablist"
          aria-label="Panels"
          className="mx-3 mb-2 flex shrink-0 gap-1 rounded-card border border-border bg-surface-muted p-1"
        >
          {(["outline", "resources", "notes"] as const).map((id) => (
            <button
              key={id}
              type="button"
              role="tab"
              aria-selected={tab === id}
              data-testid={`sheet-tab-${id}`}
              onClick={() => onTab(id)}
              className={cn(
                "flex min-h-11 flex-1 items-center justify-center gap-1.5 rounded-control px-2 text-ui font-medium [&_svg]:size-4",
                tab === id
                  ? "border border-border-strong bg-surface text-text shadow-card"
                  : "text-text-muted",
              )}
            >
              {PANEL_ICON[id]}
              {id === "notes" ? "Notes" : PANEL_TITLE[id]}
            </button>
          ))}
        </div>
        <div role="tabpanel" className="flex min-h-0 flex-1 flex-col border-t border-border">
          {tab === "outline"
            ? content.outline
            : tab === "resources"
              ? content.resources
              : content.notes("list")}
        </div>
      </div>
    </Sheet>
  );
}
