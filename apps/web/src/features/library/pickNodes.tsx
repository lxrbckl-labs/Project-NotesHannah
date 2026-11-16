import type { NodeWithLinks } from "@notes/schema";
import { Check, ChevronRight } from "lucide-react";
import { createContext, type ReactNode, use, useCallback, useRef, useState } from "react";
import { Button } from "../../components/ui/button";
import { Modal } from "../../components/ui/dialog";
import { cn } from "../../lib/cn";
import type { PickedNode, PickNodes } from "../exams/types";
import { NodeIcon } from "./NodeIcon";
import { useChildren } from "./queries";

const Context = createContext<PickNodes | null>(null);

/** The exam planner asks the shell for lectures and folders: this is the shell's answer. */
export function usePickNodes(): PickNodes {
  const value = use(Context);
  if (!value) throw new Error("usePickNodes needs PickNodesProvider");
  return value;
}

type PickMode = "coverage" | "places";

/**
 * Choosable for exam coverage: lectures and folders (a folder covers everything inside it). For
 * the places a reference belongs with: courses, folders, lectures and documents.
 */
const pickable = (n: NodeWithLinks, mode: PickMode) =>
  mode === "places"
    ? ["course", "folder", "lecture", "document"].includes(n.kind)
    : n.kind === "lecture" || n.kind === "folder";

const DESCRIPTION: Record<PickMode, string> = {
  coverage: "A folder covers everything inside it.",
  places: "Choose the courses, folders, lectures or documents it belongs with.",
};

export function PickNodesProvider({ children }: { children: ReactNode }) {
  const [request, setRequest] = useState<{
    selected: string[];
    title: string;
    mode: PickMode;
    allowNone: boolean;
  } | null>(null);
  const resolver = useRef<((value: PickedNode[] | null) => void) | null>(null);

  const pick = useCallback<PickNodes>(
    (options) =>
      new Promise((resolve) => {
        resolver.current?.(null);
        resolver.current = resolve;
        setRequest({
          selected: [...options.selected],
          title: options.title ?? "Choose lectures and folders",
          mode: options.pick ?? "coverage",
          allowNone: options.allowNone ?? false,
        });
      }),
    [],
  );

  const finish = (value: PickedNode[] | null) => {
    resolver.current?.(value);
    resolver.current = null;
    setRequest(null);
  };

  return (
    <Context value={pick}>
      {children}
      <Modal
        open={!!request}
        onOpenChange={(open) => !open && finish(null)}
        sheet="touch"
        title={request?.title ?? "Choose"}
        description={DESCRIPTION[request?.mode ?? "coverage"]}
      >
        {request ? (
          <PickerBody
            key={request.title}
            initial={request.selected}
            mode={request.mode}
            allowNone={request.allowNone}
            onDone={finish}
          />
        ) : null}
      </Modal>
    </Context>
  );
}

function PickerBody({
  initial,
  mode,
  allowNone,
  onDone,
}: {
  initial: string[];
  mode: PickMode;
  allowNone: boolean;
  onDone: (value: PickedNode[] | null) => void;
}) {
  const [chosen, setChosen] = useState<Map<string, PickedNode>>(
    () => new Map(initial.map((id) => [id, { id, title: "", path: "" }])),
  );
  const toggle = (n: NodeWithLinks) =>
    setChosen((prev) => {
      const next = new Map(prev);
      if (next.has(n.id)) next.delete(n.id);
      else next.set(n.id, { id: n.id, title: n.name, path: n.path });
      return next;
    });
  return (
    <div className="flex flex-col gap-4">
      <fieldset className="m-0 grid min-w-0 gap-0.5 border-0 p-0">
        <legend className="sr-only">Library</legend>
        <Branch parentId={null} depth={0} chosen={chosen} mode={mode} onToggle={toggle} />
      </fieldset>
      <div className="flex items-center justify-between gap-3 border-t border-border pt-4">
        <p className="text-sm text-text-muted">{chosen.size} chosen</p>
        <div className="flex gap-2">
          <Button onClick={() => onDone(null)}>Cancel</Button>
          <Button
            variant="primary"
            disabled={chosen.size === 0 && !allowNone}
            onClick={() => onDone([...chosen.values()])}
          >
            Use these
          </Button>
        </div>
      </div>
    </div>
  );
}

function Branch({
  parentId,
  depth,
  chosen,
  mode,
  onToggle,
}: {
  parentId: string | null;
  depth: number;
  chosen: Map<string, PickedNode>;
  mode: PickMode;
  onToggle: (n: NodeWithLinks) => void;
}) {
  const kids = useChildren(parentId);
  if (kids.isPending) return <p className="px-3 py-2 text-sm text-text-muted">Loading</p>;
  if (kids.isError) return <p className="px-3 py-2 text-sm text-danger">Could not load.</p>;
  return kids.data
    .filter((n) => mode === "places" || n.kind !== "document")
    .map((n) => (
      <Row key={n.id} node={n} depth={depth} chosen={chosen} mode={mode} onToggle={onToggle} />
    ));
}

function Row({
  node,
  depth,
  chosen,
  mode,
  onToggle,
}: {
  node: NodeWithLinks;
  depth: number;
  chosen: Map<string, PickedNode>;
  mode: PickMode;
  onToggle: (n: NodeWithLinks) => void;
}) {
  const [open, setOpen] = useState(depth < 3);
  // A lecture's documents are places a reference can belong with, so it opens for "places".
  const expandable = node.childCount > 0 && (node.kind !== "lecture" || mode === "places");
  const can = pickable(node, mode);
  const on = chosen.has(node.id);
  return (
    <div>
      <div
        className={cn(
          "flex min-h-11 items-center gap-1 rounded-xl pr-2 xl:min-h-9",
          on && "bg-accent-soft text-accent",
        )}
        style={{ paddingLeft: depth * 18 }}
      >
        {expandable ? (
          <button
            type="button"
            aria-label={`${open ? "Collapse" : "Expand"} ${node.name}`}
            aria-expanded={open}
            onClick={() => setOpen((v) => !v)}
            className="flex size-9 shrink-0 items-center justify-center rounded-lg text-text-muted hover:bg-surface-muted"
          >
            <ChevronRight size={16} className={cn("transition-transform", open && "rotate-90")} />
          </button>
        ) : (
          <span className="size-9 shrink-0" />
        )}
        <button
          type="button"
          disabled={!can}
          aria-pressed={can ? on : undefined}
          onClick={() => onToggle(node)}
          className={cn(
            "flex min-h-11 min-w-0 flex-1 items-center gap-2.5 rounded-lg px-1.5 text-left text-sm xl:min-h-9",
            !can && "cursor-default text-text-muted",
          )}
        >
          <NodeIcon kind={node.kind} section={node.section} size={18} />
          <span className="min-w-0 flex-1 truncate">{node.name}</span>
          {on ? <Check size={16} aria-hidden /> : null}
        </button>
      </div>
      {open && expandable ? (
        <Branch
          parentId={node.id}
          depth={depth + 1}
          chosen={chosen}
          mode={mode}
          onToggle={onToggle}
        />
      ) : null}
    </div>
  );
}
