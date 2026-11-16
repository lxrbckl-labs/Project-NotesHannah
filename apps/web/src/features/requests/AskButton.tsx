import type { RequestKind, RequestTarget, StudyRequest } from "@notes/schema";
import { MessageCirclePlus } from "lucide-react";
import { useState } from "react";
import { Button } from "../../components/ui/button";
import { cn } from "../../lib/cn";
import { RequestComposer } from "./RequestComposer";
import type { SubmitRequest } from "./types";

export interface AskButtonProps {
  target: RequestTarget;
  targetLabel?: string;
  submit: SubmitRequest;
  /** The visible words; "Ask" by default. With `iconOnly` they become the accessible name. */
  label?: string;
  iconOnly?: boolean;
  defaultKind?: RequestKind;
  defaultMessage?: string;
  onCreated?: (request: StudyRequest) => void;
  onOpenRequests?: () => void;
  className?: string;
}

/** A compact button other screens drop next to an item: opens the composer for that target. */
export function AskButton({
  target,
  targetLabel,
  submit,
  label = "Ask",
  iconOnly,
  defaultKind,
  defaultMessage,
  onCreated,
  onOpenRequests,
  className,
}: AskButtonProps) {
  const [open, setOpen] = useState(false);
  const about = targetLabel ? `${label} an agent about ${targetLabel}` : `${label} an agent`;
  return (
    <>
      <Button
        variant="ghostAccent"
        data-testid="ask-button"
        aria-label={iconOnly || label === "Ask" ? about : undefined}
        title={about}
        onClick={() => setOpen(true)}
        className={cn("gap-1.5 px-3", iconOnly && "size-11 px-0 xl:size-9", className)}
      >
        <MessageCirclePlus size={17} aria-hidden />
        {iconOnly ? null : <span>{label}</span>}
      </Button>
      <RequestComposer
        open={open}
        onOpenChange={setOpen}
        target={target}
        {...(targetLabel ? { targetLabel } : {})}
        {...(defaultKind ? { defaultKind } : {})}
        {...(defaultMessage ? { defaultMessage } : {})}
        submit={submit}
        {...(onCreated ? { onCreated } : {})}
        {...(onOpenRequests ? { onOpenRequests } : {})}
      />
    </>
  );
}
