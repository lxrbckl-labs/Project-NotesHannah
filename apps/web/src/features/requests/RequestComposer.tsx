import type { RequestKind, RequestTarget, StudyRequest } from "@notes/schema";
import { CircleCheck, Info } from "lucide-react";
import { useEffect, useState } from "react";
import { Button } from "../../components/ui/button";
import { Modal } from "../../components/ui/dialog";
import { describeError } from "../../lib/api";
import { HONEST_NOTE, TARGET_NOUN } from "./model/wording";
import type { SubmitRequest } from "./types";
import { Examples, KindPicker, MessageBox } from "./ui/form";
import { Note, TargetIcon } from "./ui/parts";

export interface RequestComposerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** What the request is about; chosen by the screen that opens the composer. */
  target: RequestTarget;
  /** The target's name for display ("Beta blockers", "Question 14"). */
  targetLabel?: string;
  /** A quick action to start with. */
  defaultKind?: RequestKind;
  /** Words to start with, e.g. a list of drugs. */
  defaultMessage?: string;
  /** Leaves the request: the requests store's `create`, or any function with its shape. */
  submit: SubmitRequest;
  onCreated?: (request: StudyRequest) => void;
  /** When given, the confirmation offers a way to her list of requests. */
  onOpenRequests?: () => void;
}

/**
 * A sheet (phone) or dialog (tablet and computer) for asking an agent to do something about one
 * thing. Any screen can open it with a target; quick actions and ideas teach what is possible.
 */
export function RequestComposer({
  open,
  onOpenChange,
  target,
  targetLabel,
  defaultKind,
  defaultMessage,
  submit,
  onCreated,
  onOpenRequests,
}: RequestComposerProps) {
  const [kind, setKind] = useState<RequestKind | null>(defaultKind ?? null);
  const [message, setMessage] = useState(defaultMessage ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [created, setCreated] = useState<StudyRequest | null>(null);

  // Each time the dialog opens it starts fresh from what the caller preset.
  useEffect(() => {
    if (!open) return;
    setKind(defaultKind ?? null);
    setMessage(defaultMessage ?? "");
    setBusy(false);
    setError(null);
    setCreated(null);
  }, [open, defaultKind, defaultMessage]);

  const trimmed = message.trim();
  const canSend = kind !== null || trimmed.length > 0;
  const name = targetLabel ?? TARGET_NOUN[target.type];

  async function send() {
    if (!canSend || busy) return;
    setBusy(true);
    setError(null);
    try {
      const request = await submit({ target, kind: kind ?? "other", message: trimmed });
      setCreated(request);
      onCreated?.(request);
    } catch (caught) {
      setError(caught);
    } finally {
      setBusy(false);
    }
  }

  const failure = error ? describeError(error) : null;

  return (
    <Modal
      open={open}
      onOpenChange={onOpenChange}
      title={created ? "Request left" : "Ask an agent"}
      description={created ? undefined : `Tell an agent what you would like done about ${name}.`}
      footer={
        created ? (
          <>
            {onOpenRequests ? (
              <Button
                onClick={() => {
                  onOpenChange(false);
                  onOpenRequests();
                }}
              >
                See my requests
              </Button>
            ) : null}
            <Button variant="primary" onClick={() => onOpenChange(false)}>
              Done
            </Button>
          </>
        ) : (
          <>
            <Button onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button
              variant="primary"
              data-testid="send-request"
              disabled={!canSend || busy}
              onClick={() => void send()}
            >
              {busy ? "Leaving it…" : "Leave request"}
            </Button>
          </>
        )
      }
    >
      {created ? (
        <div className="flex flex-col items-center py-4 text-center" data-testid="composer-done">
          <div className="mb-4 flex size-14 items-center justify-center rounded-2xl bg-accent-soft text-accent">
            <CircleCheck size={26} aria-hidden />
          </div>
          <p className="text-base font-medium">It is waiting for an agent.</p>
          <p className="mt-1.5 max-w-sm text-sm text-text-muted">{HONEST_NOTE}</p>
        </div>
      ) : (
        <form
          className="grid gap-5"
          onSubmit={(event) => {
            event.preventDefault();
            void send();
          }}
        >
          <div
            className="flex items-center gap-2.5 rounded-2xl bg-surface-muted px-3.5 py-2.5 text-sm"
            data-testid="composer-target"
          >
            <span className="text-text-muted">
              <TargetIcon type={target.type} />
            </span>
            <span className="min-w-0">
              <span className="text-text-muted">About </span>
              <span className="font-medium [overflow-wrap:anywhere]">{name}</span>
            </span>
          </div>
          <KindPicker targetType={target.type} value={kind} onChange={setKind} />
          <MessageBox
            label={kind ? "Anything to add?" : "What would you like?"}
            value={message}
            onChange={setMessage}
            required={kind === null}
            placeholder={
              kind
                ? "Optional: say more about what you want."
                : "Write it the way you would say it."
            }
            autoFocus={!defaultMessage}
          />
          <Examples
            targetType={target.type}
            onPick={(text) => {
              setKind(null);
              setMessage(text);
            }}
          />
          <Note icon={<Info size={16} aria-hidden />}>{HONEST_NOTE}</Note>
          {failure ? (
            <p role="alert" className="text-sm text-danger">
              {failure.message}
              {failure.hint ? ` ${failure.hint}` : ""}
            </p>
          ) : null}
        </form>
      )}
    </Modal>
  );
}
