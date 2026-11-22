import type { SavedInstruction } from "@notes/schema";
import { Pencil, Plus, ScrollText, Trash2 } from "lucide-react";
import { useState } from "react";
import { Button, IconButton } from "../../components/ui/button";
import { Card, CardTitle } from "../../components/ui/card";
import { ConfirmDialog, Modal } from "../../components/ui/dialog";
import { Field, TextArea, TextInput } from "../../components/ui/field";
import { useInstructions, useSaveInstructions } from "../preferences/usePreferences";

/** The most she can keep, and how long each part may be (the schema's limits). */
const MAX_SAVED = 30;
const TITLE_CHARS = 80;
const BODY_CHARS = 4000;

const newId = () => `ins_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;

/**
 * Saved instructions: her standing rules for work she asks agents for ("how I want lecture notes
 * built"). Written here once; chosen from a dropdown in the request dialog; carried by the request,
 * so the agent that picks it up follows them. They follow her account to every device.
 */
export function InstructionsCard() {
  const list = useInstructions();
  const save = useSaveInstructions();
  const [editing, setEditing] = useState<SavedInstruction | "new" | null>(null);
  const [deleting, setDeleting] = useState<SavedInstruction | null>(null);

  return (
    <Card
      as="section"
      aria-labelledby="card-instructions"
      padding="lg"
      data-testid="instructions-card"
      id="instructions"
    >
      <CardTitle
        id="card-instructions"
        title="Instructions for agents"
        description="Write how you want something built, once. Pick it from the list when you ask an agent, and it goes with the request."
      />

      {list.length === 0 ? (
        <p className="mt-4 rounded-control border border-dashed border-border-strong px-3.5 py-3 text-ui text-text-muted">
          None yet. A good first one: how you like lecture notes laid out, what to bold, and what to
          finish with.
        </p>
      ) : (
        <ul className="mt-4 grid gap-2" aria-label="Saved instructions">
          {list.map((item) => (
            <li
              key={item.id}
              data-testid="instruction-item"
              className="flex items-start gap-3 rounded-control border border-border bg-bg px-3.5 py-2.5"
            >
              <ScrollText size={18} aria-hidden className="mt-0.5 shrink-0 text-text-muted" />
              <div className="min-w-0 flex-1">
                <p className="font-medium [overflow-wrap:anywhere]">{item.title}</p>
                <p className="line-clamp-2 whitespace-pre-wrap text-ui text-text-muted [overflow-wrap:anywhere]">
                  {item.body}
                </p>
              </div>
              <div className="flex shrink-0 gap-1">
                <IconButton label={`Edit ${item.title}`} onClick={() => setEditing(item)}>
                  <Pencil size={18} />
                </IconButton>
                <IconButton
                  label={`Delete ${item.title}`}
                  variant="ghostDanger"
                  onClick={() => setDeleting(item)}
                >
                  <Trash2 size={18} />
                </IconButton>
              </div>
            </li>
          ))}
        </ul>
      )}

      <div className="mt-4 flex flex-wrap items-center gap-3">
        <Button
          variant="primary"
          data-testid="instruction-new"
          disabled={list.length >= MAX_SAVED}
          onClick={() => setEditing("new")}
        >
          <Plus size={16} aria-hidden />
          New instruction
        </Button>
        {list.length >= MAX_SAVED ? (
          <p className="text-caption text-text-muted">
            You have {MAX_SAVED}, the most that can be kept. Delete one to add another.
          </p>
        ) : null}
      </div>

      {editing ? (
        <InstructionForm
          // A fresh form for each one she opens.
          key={editing === "new" ? "new" : editing.id}
          initial={editing === "new" ? null : editing}
          busy={save.isPending}
          onClose={() => setEditing(null)}
          onSave={(title, body) => {
            const next =
              editing === "new"
                ? [...list, { id: newId(), title, body }]
                : list.map((i) => (i.id === editing.id ? { ...i, title, body } : i));
            save.mutate(next, { onSuccess: () => setEditing(null) });
          }}
        />
      ) : null}

      <ConfirmDialog
        open={deleting !== null}
        onOpenChange={(open) => {
          if (!open) setDeleting(null);
        }}
        title={deleting ? `Delete "${deleting.title}"?` : ""}
        description="Requests you already left keep their own copy of it. It is only removed from this list."
        confirmLabel="Delete"
        danger
        busy={save.isPending}
        onConfirm={() => {
          if (!deleting) return;
          save.mutate(
            list.filter((i) => i.id !== deleting.id),
            { onSuccess: () => setDeleting(null) },
          );
        }}
      />
    </Card>
  );
}

function InstructionForm({
  initial,
  busy,
  onSave,
  onClose,
}: {
  initial: SavedInstruction | null;
  busy: boolean;
  onSave: (title: string, body: string) => void;
  onClose: () => void;
}) {
  const [title, setTitle] = useState(initial?.title ?? "");
  const [body, setBody] = useState(initial?.body ?? "");
  const ready = title.trim().length > 0 && body.trim().length > 0;
  return (
    <Modal
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      title={initial ? "Edit instruction" : "New instruction"}
      description="An agent reads this word for word, so write it the way you would explain it to a study partner."
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button
            variant="primary"
            data-testid="instruction-save"
            disabled={!ready || busy}
            onClick={() => onSave(title.trim(), body.trim())}
          >
            {busy ? "Saving" : "Save"}
          </Button>
        </>
      }
    >
      <div className="grid gap-4">
        <Field label="Name" hint="What you will see in the list, like “Lecture notes”.">
          {(p) => (
            <TextInput
              {...p}
              data-testid="instruction-title"
              value={title}
              maxLength={TITLE_CHARS}
              onChange={(e) => setTitle(e.target.value)}
              autoFocus
            />
          )}
        </Field>
        <Field
          label="Instructions"
          hint={`${body.length} of ${BODY_CHARS} characters. For example: one section per slide, bold every drug name, a table for anything compared, five questions at the end.`}
        >
          {(p) => (
            <TextArea
              {...p}
              data-testid="instruction-body"
              value={body}
              maxLength={BODY_CHARS}
              rows={8}
              onChange={(e) => setBody(e.target.value)}
            />
          )}
        </Field>
      </div>
    </Modal>
  );
}
