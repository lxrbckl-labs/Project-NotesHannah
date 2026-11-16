import type { LectureMeta, NodeWithLinks } from "@notes/schema";
import { useQueryClient } from "@tanstack/react-query";
import { Check, ChevronRight, Folder } from "lucide-react";
import {
  createContext,
  type FormEvent,
  type ReactNode,
  use,
  useId,
  useMemo,
  useState,
} from "react";
import { useNavigate } from "react-router";
import { Button } from "../../components/ui/button";
import { Modal } from "../../components/ui/dialog";
import { Field, TextInput } from "../../components/ui/field";
import { useToast } from "../../components/ui/toast";
import { cn } from "../../lib/cn";
import { useNodeActions } from "./actions";
import { NodeIcon } from "./NodeIcon";
import { nodeKeys, useChildren } from "./queries";
import {
  type CreatableKind,
  KIND_NAME,
  moveBlockedReason,
  NOT_ALLOWED,
  toDestination,
} from "./rules";

interface DialogApi {
  openCreate: (parent: NodeWithLinks | null, kind: CreatableKind) => void;
  openMove: (node: NodeWithLinks) => void;
}

const DialogContext = createContext<DialogApi | null>(null);

export function useLibraryDialogs(): DialogApi {
  const value = use(DialogContext);
  if (!value) throw new Error("useLibraryDialogs needs LibraryDialogs");
  return value;
}

/** Mounts the create dialog and the move sheet once, for the whole shell. */
export function LibraryDialogs({ children }: { children: ReactNode }) {
  const [create, setCreate] = useState<{
    parent: NodeWithLinks | null;
    kind: CreatableKind;
  } | null>(null);
  const [moving, setMoving] = useState<NodeWithLinks | null>(null);
  const api = useMemo<DialogApi>(
    () => ({
      openCreate: (parent, kind) => setCreate({ parent, kind }),
      openMove: (node) => setMoving(node),
    }),
    [],
  );
  return (
    <DialogContext value={api}>
      {children}
      <CreateDialog target={create} onClose={() => setCreate(null)} />
      <MoveSheet node={moving} onClose={() => setMoving(null)} />
    </DialogContext>
  );
}

const today = () => {
  const d = new Date();
  const month = String(d.getMonth() + 1).padStart(2, "0");
  return `${d.getFullYear()}-${month}-${String(d.getDate()).padStart(2, "0")}`;
};

function CreateDialog({
  target,
  onClose,
}: {
  target: { parent: NodeWithLinks | null; kind: CreatableKind } | null;
  onClose: () => void;
}) {
  return (
    <Modal
      open={!!target}
      onOpenChange={(open) => !open && onClose()}
      title={target ? `New ${KIND_NAME[target.kind].toLowerCase()}` : "New"}
      description={target?.parent ? `In ${target.parent.name}` : "At the top of your library"}
    >
      {target ? (
        <CreateForm key={`${target.parent?.id}-${target.kind}`} {...target} onClose={onClose} />
      ) : null}
    </Modal>
  );
}

function CreateForm({
  parent,
  kind,
  onClose,
}: {
  parent: NodeWithLinks | null;
  kind: CreatableKind;
  onClose: () => void;
}) {
  const client = useQueryClient();
  const actions = useNodeActions();
  const navigate = useNavigate();
  const siblings = client.getQueryData<NodeWithLinks[]>(nodeKeys.children(parent?.id ?? null));
  const nextNumber = Math.max(0, ...(siblings ?? []).map((n) => n.lecture?.number ?? 0)) + 1;
  const [name, setName] = useState("");
  const [code, setCode] = useState("");
  const [number, setNumber] = useState(String(nextNumber));
  const [date, setDate] = useState(today());

  async function submit(event: FormEvent) {
    event.preventDefault();
    const trimmed = name.trim();
    if (!trimmed) return;
    onClose();
    const lecture: LectureMeta | undefined =
      kind === "lecture"
        ? { number: number === "" ? null : Number(number), date: date || null }
        : undefined;
    const node = await actions.create({
      parentId: parent?.id ?? null,
      kind,
      name: trimmed,
      course: kind === "course" ? { code: code.trim() || null } : undefined,
      lecture,
    });
    if (node && (kind === "term" || kind === "course")) navigate(`/library/${node.id}`);
  }

  const placeholder: Record<string, string> = {
    term: "Spring 2027",
    course: "Pharmacology II",
    folder: "Cardiovascular",
    lecture: "Beta blockers",
    document: "Study guide",
  };

  return (
    <form onSubmit={submit} className="grid gap-4">
      <Field label="Name">
        {(p) => (
          <TextInput
            {...p}
            autoFocus
            value={name}
            maxLength={200}
            placeholder={placeholder[kind]}
            onChange={(e) => setName(e.target.value)}
          />
        )}
      </Field>
      {kind === "course" ? (
        <Field label="Course code" hint="Optional, like PHAR 7340.">
          {(p) => (
            <TextInput
              {...p}
              value={code}
              maxLength={40}
              onChange={(e) => setCode(e.target.value)}
            />
          )}
        </Field>
      ) : null}
      {kind === "lecture" ? (
        <div className="grid grid-cols-[6rem_1fr] gap-3">
          <Field label="Number">
            {(p) => (
              <TextInput
                {...p}
                type="number"
                inputMode="numeric"
                min={0}
                max={999}
                value={number}
                onChange={(e) => setNumber(e.target.value)}
              />
            )}
          </Field>
          <Field label="Date taught">
            {(p) => (
              <TextInput
                {...p}
                type="date"
                value={date}
                onChange={(e) => setDate(e.target.value)}
              />
            )}
          </Field>
        </div>
      ) : null}
      <div className="flex justify-end gap-2 pt-1">
        <Button onClick={onClose}>Cancel</Button>
        <Button type="submit" variant="primary" disabled={!name.trim()}>
          Create
        </Button>
      </div>
    </form>
  );
}

function MoveSheet({ node, onClose }: { node: NodeWithLinks | null; onClose: () => void }) {
  return (
    <Modal
      open={!!node}
      onOpenChange={(open) => !open && onClose()}
      sheet="touch"
      title={node ? `Move "${node.name}"` : "Move"}
      description="Choose where it should go."
      hideDescription
    >
      {node ? <MoveForm key={node.id} node={node} onClose={onClose} /> : null}
    </Modal>
  );
}

function MoveForm({ node, onClose }: { node: NodeWithLinks; onClose: () => void }) {
  const actions = useNodeActions();
  const toast = useToast();
  const [picked, setPicked] = useState<{ id: string | null; name: string } | null>(null);

  async function confirm() {
    if (!picked) return;
    onClose();
    const result = await actions.move(node, { parentId: picked.id });
    if (result) toast.show(`Moved "${node.name}" to ${picked.name}`);
  }

  return (
    <div className="flex flex-col gap-4">
      <TreePicker node={node} picked={picked?.id} onPick={setPicked} />
      <div className="flex items-center justify-between gap-3 border-t border-border pt-4">
        <p className="min-w-0 truncate text-sm text-text-muted">
          {picked ? `To: ${picked.name}` : "Pick a destination"}
        </p>
        <div className="flex gap-2">
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" disabled={!picked} onClick={confirm}>
            Move here
          </Button>
        </div>
      </div>
    </div>
  );
}

/** A lazy tree of places the node could go. Invalid places are shown, disabled, with the reason. */
export function TreePicker({
  node,
  picked,
  onPick,
}: {
  node: NodeWithLinks;
  picked: string | null | undefined;
  onPick: (dest: { id: string | null; name: string }) => void;
}) {
  const rootReason = moveBlockedReason(node, null);
  const rootDisabled = rootReason ?? (node.parentId === null ? "Already here." : null);
  return (
    <fieldset className="m-0 grid min-w-0 gap-0.5 border-0 p-0">
      <legend className="sr-only">{`Where to move ${node.name}`}</legend>
      <PickerRow
        label="Top of library"
        icon={<Folder size={18} aria-hidden />}
        depth={0}
        disabled={rootDisabled}
        selected={picked === null}
        onSelect={() => onPick({ id: null, name: "Top of library" })}
      />
      <PickerBranch
        node={node}
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
  node,
  parentId,
  depth,
  folderDepth,
  picked,
  onPick,
}: {
  node: NodeWithLinks;
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
      n.id !== node.id &&
      n.kind !== "document" &&
      (n.kind !== "lecture" || node.kind === "document"),
  );
  return items.map((child) => (
    <PickerNode
      key={child.id}
      node={node}
      child={child}
      depth={depth}
      folderDepth={child.kind === "folder" ? folderDepth + 1 : folderDepth}
      picked={picked}
      onPick={onPick}
    />
  ));
}

function PickerNode({
  node,
  child,
  depth,
  folderDepth,
  picked,
  onPick,
}: {
  node: NodeWithLinks;
  child: NodeWithLinks;
  depth: number;
  folderDepth: number;
  picked: string | null | undefined;
  onPick: (dest: { id: string | null; name: string }) => void;
}) {
  const containsSomething = child.childCount > 0 && child.kind !== "lecture";
  const [open, setOpen] = useState(() => node.ancestors.includes(child.id));
  const reason =
    moveBlockedReason(node, toDestination(child, folderDepth)) ??
    (child.id === node.parentId ? "Already here." : null);
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
            node={node}
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
        <button
          type="button"
          aria-label={`${expanded ? "Collapse" : "Expand"} ${label}`}
          aria-expanded={expanded}
          onClick={onToggle}
          className="flex size-9 shrink-0 items-center justify-center rounded-lg text-text-muted hover:bg-surface-muted"
        >
          <ChevronRight size={16} className={cn("transition-transform", expanded && "rotate-90")} />
        </button>
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
