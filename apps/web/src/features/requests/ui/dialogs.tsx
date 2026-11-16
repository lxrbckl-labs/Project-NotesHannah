import { kindNeedsMessage, type RequestKind } from "@notes/schema";
import { useState } from "react";
import { Button } from "../../../components/ui/button";
import { ConfirmDialog, Modal } from "../../../components/ui/dialog";
import { describeError } from "../../../lib/api";
import { headline, targetName } from "../model/wording";
import type { StudyRequestWithContext } from "../types";
import { KindPicker, MessageBox } from "./form";

function Failure({ error }: { error: unknown }) {
  if (!error) return null;
  const { message, hint } = describeError(error);
  return (
    <p role="alert" className="text-sm text-danger">
      {message}
      {hint ? ` ${hint}` : ""}
    </p>
  );
}

/** Change what a waiting request says. The target stays; to move it, cancel and ask again. */
export function EditRequestDialog(props: {
  request: StudyRequestWithContext | null;
  onClose: () => void;
  onSave: (id: string, change: { kind: RequestKind; message: string }) => Promise<void>;
}) {
  const { request, ...rest } = props;
  return request ? <EditInner key={request.id} request={request} {...rest} /> : null;
}

function EditInner({
  request,
  onClose,
  onSave,
}: {
  request: StudyRequestWithContext;
  onClose: () => void;
  onSave: (id: string, change: { kind: RequestKind; message: string }) => Promise<void>;
}) {
  const [kind, setKind] = useState<RequestKind | null>(
    request.kind === "other" ? null : request.kind,
  );
  const [message, setMessage] = useState(request.message);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);

  const effective: RequestKind = kind ?? "other";
  const invalid = kindNeedsMessage(effective) && message.trim().length === 0;
  return (
    <Modal
      open={request !== null}
      onOpenChange={(open) => !open && onClose()}
      title="Edit your request"
      description={
        request ? `About ${targetName(request)}. It has not been picked up yet.` : undefined
      }
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button
            variant="primary"
            data-testid="save-edit"
            disabled={invalid || busy}
            onClick={async () => {
              setBusy(true);
              setError(null);
              try {
                await onSave(request.id, { kind: effective, message: message.trim() });
              } catch (caught) {
                setError(caught);
                setBusy(false);
              }
            }}
          >
            {busy ? "Saving…" : "Save changes"}
          </Button>
        </>
      }
    >
      <div className="grid gap-5">
        <KindPicker targetType={request.target.type} value={kind} onChange={setKind} />
        <MessageBox
          label={kind ? "Anything to add?" : "What would you like?"}
          value={message}
          onChange={setMessage}
          required={kind === null}
          autoFocus
        />
        <Failure error={error} />
      </div>
    </Modal>
  );
}

/** Put a finished request back in the queue, with a note on what is still not right. */
export function ReopenDialog(props: {
  request: StudyRequestWithContext | null;
  onClose: () => void;
  onReopen: (id: string, note: string) => Promise<void>;
}) {
  const { request, ...rest } = props;
  return request ? <ReopenInner key={request.id} request={request} {...rest} /> : null;
}

function ReopenInner({
  request,
  onClose,
  onReopen,
}: {
  request: StudyRequestWithContext;
  onClose: () => void;
  onReopen: (id: string, note: string) => Promise<void>;
}) {
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  return (
    <Modal
      open
      onOpenChange={(open) => !open && onClose()}
      title="Reopen with a follow-up"
      description="It goes back in the queue and an agent sees your note and the earlier answer."
      footer={
        <>
          <Button onClick={onClose}>Not now</Button>
          <Button
            variant="primary"
            data-testid="confirm-reopen"
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              setError(null);
              try {
                await onReopen(request.id, note.trim());
              } catch (caught) {
                setError(caught);
                setBusy(false);
              }
            }}
          >
            {busy ? "Reopening…" : "Reopen"}
          </Button>
        </>
      }
    >
      <div className="grid gap-4">
        <p className="rounded-2xl bg-surface-muted px-3.5 py-3 text-sm text-text-muted">
          You asked: <span className="text-text">{headline(request)}</span>
        </p>
        <MessageBox
          label="What is still not right?"
          value={note}
          onChange={setNote}
          placeholder="For example: the card is fixed but the table still says the old thing."
          autoFocus
        />
        <Failure error={error} />
      </div>
    </Modal>
  );
}

export function CancelDialog({
  request,
  onClose,
  onCancel,
}: {
  request: StudyRequestWithContext | null;
  onClose: () => void;
  onCancel: (id: string) => Promise<void>;
}) {
  return (
    <ConfirmDialog
      open={request !== null}
      onOpenChange={(open) => !open && onClose()}
      title="Cancel this request?"
      description={
        request
          ? `“${headline(request)}” will be withdrawn. It stays in your list under Cancelled.${
              request.status === "in_progress"
                ? " An agent is working on it now, so it may already have made changes."
                : ""
            }`
          : ""
      }
      confirmLabel="Cancel request"
      danger
      onConfirm={() => {
        if (request) void onCancel(request.id);
      }}
    />
  );
}
