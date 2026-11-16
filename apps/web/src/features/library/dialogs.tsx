import type { LectureMeta, NodeWithLinks, SourceFile } from "@notes/schema";
import { useQueryClient } from "@tanstack/react-query";
import { createContext, type FormEvent, type ReactNode, use, useMemo, useState } from "react";
import { useNavigate } from "react-router";
import { Button } from "../../components/ui/button";
import { Modal } from "../../components/ui/dialog";
import { Field, TextInput } from "../../components/ui/field";
import { useToast } from "../../components/ui/toast";
import { api } from "../../lib/api";
import { useNodeActions } from "./actions";
import { fileSubject, nodeSubject, TreePicker } from "./picker";
import { nodeKeys, useNode } from "./queries";
import { type CreatableKind, KIND_NAME, nodeHref } from "./rules";

interface DialogApi {
  openCreate: (parent: NodeWithLinks | null, kind: CreatableKind) => void;
  openMove: (node: NodeWithLinks) => void;
  openMoveFile: (file: SourceFile) => void;
  openEdit: (node: NodeWithLinks) => void;
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
  const [movingFile, setMovingFile] = useState<SourceFile | null>(null);
  const [editing, setEditing] = useState<NodeWithLinks | null>(null);
  const api = useMemo<DialogApi>(
    () => ({
      openCreate: (parent, kind) => setCreate({ parent, kind }),
      openMove: (node) => setMoving(node),
      openMoveFile: (file) => setMovingFile(file),
      openEdit: (node) => setEditing(node),
    }),
    [],
  );
  return (
    <DialogContext value={api}>
      {children}
      <CreateDialog target={create} onClose={() => setCreate(null)} />
      <MoveSheet node={moving} onClose={() => setMoving(null)} />
      <MoveFileSheet file={movingFile} onClose={() => setMovingFile(null)} />
      <EditDialog node={editing} onClose={() => setEditing(null)} />
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
    // A new document is something she is about to write in: open it with the caret ready.
    const href = node ? nodeHref(node) : "";
    if (kind === "document" && href.startsWith("/doc/")) navigate(`${href}?write=1`);
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
      <TreePicker subject={nodeSubject(node)} picked={picked?.id} onPick={setPicked} />
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

function MoveFileSheet({ file, onClose }: { file: SourceFile | null; onClose: () => void }) {
  return (
    <Modal
      open={!!file}
      onOpenChange={(open) => !open && onClose()}
      sheet="touch"
      title={file ? `File "${file.originalName}" under…` : "File under"}
      description="Choose a lecture, a folder or a course's Sources section, or send it back to the inbox."
      hideDescription
    >
      {file ? <MoveFileForm key={file.id} file={file} onClose={onClose} /> : null}
    </Modal>
  );
}

function MoveFileForm({ file, onClose }: { file: SourceFile; onClose: () => void }) {
  const client = useQueryClient();
  const toast = useToast();
  const place = useNode(file.nodeId ?? undefined);
  const [picked, setPicked] = useState<{ id: string | null; name: string } | null>(null);

  async function confirm() {
    if (!picked) return;
    onClose();
    try {
      await api.fileTo(file.id, picked.id);
      toast.show(`Filed "${file.originalName}" under ${picked.name}`);
    } catch (error) {
      toast.error(error);
    } finally {
      void client.invalidateQueries({ queryKey: ["files"] });
      void client.invalidateQueries({ queryKey: nodeKeys.all });
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <TreePicker
        subject={fileSubject(file, place.data?.ancestors ?? [])}
        picked={picked?.id}
        onPick={setPicked}
      />
      <div className="flex items-center justify-between gap-3 border-t border-border pt-4">
        <p className="min-w-0 truncate text-sm text-text-muted">
          {picked ? `To: ${picked.name}` : "Pick a destination"}
        </p>
        <div className="flex gap-2">
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" disabled={!picked} onClick={confirm}>
            File here
          </Button>
        </div>
      </div>
    </div>
  );
}

/** Change a lecture's number and date, or a course's code. */
function EditDialog({ node, onClose }: { node: NodeWithLinks | null; onClose: () => void }) {
  return (
    <Modal
      open={!!node}
      onOpenChange={(open) => !open && onClose()}
      title={node ? `Edit ${node.kind === "course" ? "course" : "lecture"} details` : "Edit"}
      description={node?.name}
    >
      {node ? <EditForm key={node.id} node={node} onClose={onClose} /> : null}
    </Modal>
  );
}

function EditForm({ node, onClose }: { node: NodeWithLinks; onClose: () => void }) {
  const actions = useNodeActions();
  const [name, setName] = useState(node.name);
  const [code, setCode] = useState(node.course?.code ?? "");
  const [number, setNumber] = useState(
    node.lecture?.number == null ? "" : String(node.lecture.number),
  );
  const [date, setDate] = useState(node.lecture?.date ?? "");

  function submit(event: FormEvent) {
    event.preventDefault();
    const trimmed = name.trim();
    if (!trimmed) return;
    onClose();
    void actions.update(node, {
      name: trimmed,
      ...(node.kind === "course" ? { course: { code: code.trim() || null } } : {}),
      ...(node.kind === "lecture"
        ? { lecture: { number: number === "" ? null : Number(number), date: date || null } }
        : {}),
    });
  }

  return (
    <form onSubmit={submit} className="grid gap-4">
      <Field label="Name">
        {(p) => (
          <TextInput
            {...p}
            value={name}
            maxLength={200}
            onChange={(e) => setName(e.target.value)}
          />
        )}
      </Field>
      {node.kind === "course" ? (
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
      ) : (
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
      )}
      <div className="flex justify-end gap-2 pt-1">
        <Button onClick={onClose}>Cancel</Button>
        <Button type="submit" variant="primary" disabled={!name.trim()}>
          Save
        </Button>
      </div>
    </form>
  );
}
