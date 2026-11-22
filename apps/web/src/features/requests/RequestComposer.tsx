import type { RequestKind, RequestTarget, StudyRequest } from "@notes/schema";
import { CircleCheck, Info } from "lucide-react";
import { useEffect, useState } from "react";
import { Button } from "../../components/ui/button";
import { Notice } from "../../components/ui/notice";
import { Sheet } from "../../components/ui/sheet";
import { describeError } from "../../lib/api";
import { REQUEST_STATUS_HUE } from "../../lib/roles";
import { HONEST_NOTE, TARGET_NOUN } from "./model/wording";
import type { SubmitRequest } from "./types";
import { Examples, KindPicker, MessageBox } from "./ui/form";
import { InstructionPicker, useSavedInstructions } from "./ui/instructions";
import { TargetIcon } from "./ui/parts";

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
  // Her saved instructions (Settings), and the one chosen for this request.
  const saved = useSavedInstructions();
  const [instructionId, setInstructionId] = useState<string | null>(null);
  const instruction = saved.list.find((i) => i.id === instructionId) ?? null;

  // Each time the dialog opens it starts fresh from what the caller preset.
  useEffect(() => {
    if (!open) return;
    setKind(defaultKind ?? null);
    setMessage(defaultMessage ?? "");
    setBusy(false);
    setError(null);
    setCreated(null);
    setInstructionId(null);
  }, [open, defaultKind, defaultMessage]);

  const trimmed = message.trim();
  // Instructions say what she wants on their own, so they are enough to send.
  const canSend = kind !== null || trimmed.length > 0 || instruction !== null;
  const name = targetLabel ?? TARGET_NOUN[target.type];

  async function send() {
    if (!canSend || busy) return;
    setBusy(true);
    setError(null);
    try {
      const request = await submit({
        target,
        kind: kind ?? "other",
        message: trimmed,
        // A copy of the instruction as it reads now travels with the request.
        ...(instruction
          ? { instructions: { title: instruction.title, body: instruction.body } }
          : {}),
      });
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
    <Sheet
      open={open}
      onOpenChange={onOpenChange}
      placement="center"
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
          <div
            data-hue={REQUEST_STATUS_HUE.done}
            className="mb-4 flex size-14 items-center justify-center rounded-card bg-tone-soft text-tone-text"
          >
            <CircleCheck size={26} aria-hidden />
          </div>
          <p className="text-body font-medium">It is waiting for an agent.</p>
          <p className="mt-1.5 max-w-sm text-ui text-text-muted">{HONEST_NOTE}</p>
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
            className="flex items-center gap-2.5 rounded-card bg-surface-muted px-3.5 py-2.5 text-ui"
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
            required={kind === null && instruction === null}
            placeholder={
              kind
                ? "Optional: say more about what you want."
                : "Write it the way you would say it."
            }
            autoFocus={!defaultMessage}
          />
          <InstructionPicker
            list={saved.list}
            value={instructionId}
            onChange={setInstructionId}
            onManage={
              saved.onManage
                ? () => {
                    onOpenChange(false);
                    saved.onManage?.();
                  }
                : undefined
            }
          />
          <Examples
            targetType={target.type}
            onPick={(text) => {
              setKind(null);
              setMessage(text);
            }}
          />
          <Notice tone="accent" icon={<Info size={18} />}>
            {HONEST_NOTE}
          </Notice>
          {failure ? (
            <p role="alert" className="text-ui text-danger">
              {failure.message}
              {failure.hint ? ` ${failure.hint}` : ""}
            </p>
          ) : null}
        </form>
      )}
    </Sheet>
  );
}
