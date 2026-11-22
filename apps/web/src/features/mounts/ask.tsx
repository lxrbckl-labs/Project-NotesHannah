import type { CreateRequestInput, RequestKind, RequestTarget } from "@notes/schema";
import { useQueryClient } from "@tanstack/react-query";
import { MessageCirclePlus } from "lucide-react";
import { createContext, type ReactNode, use, useCallback, useMemo, useState } from "react";
import { useNavigate } from "react-router";
import { Button } from "../../components/ui/button";
import { HotkeyTooltip } from "../../components/ui/tooltip";
import { appHttp } from "../../lib/api";
import { cn } from "../../lib/cn";
import { useHotkeyAria } from "../hotkeys";
import { RequestComposer } from "../requests/RequestComposer";

export interface AskOptions {
  target: RequestTarget;
  /** What she is asking about, in words ("Beta blockers"). */
  label?: string;
  /** A quick action to preselect. */
  kind?: RequestKind;
  message?: string;
}

const Context = createContext<((options: AskOptions) => void) | null>(null);

/** Open the real request composer for any target, from anywhere in the app. */
export function useAsk(): (options: AskOptions) => void {
  const value = use(Context);
  if (!value) throw new Error("useAsk needs AskProvider");
  return value;
}

/** One composer for the whole app: every "ask an agent" entry point opens it with its own target. */
export function AskProvider({ children }: { children: ReactNode }) {
  const [options, setOptions] = useState<AskOptions | null>(null);
  const [open, setOpen] = useState(false);
  const client = useQueryClient();
  const navigate = useNavigate();

  const ask = useCallback((next: AskOptions) => {
    setOptions(next);
    setOpen(true);
  }, []);

  const submit = useCallback(
    async (input: CreateRequestInput) => {
      const result = await appHttp.post<{ request: import("@notes/schema").StudyRequest }>(
        "/requests",
        input,
      );
      void client.invalidateQueries({ queryKey: ["badge", "requests"] });
      void client.invalidateQueries({ queryKey: ["requests"] });
      return result.request;
    },
    [client],
  );

  const value = useMemo(() => ask, [ask]);
  return (
    <Context value={value}>
      {children}
      {options ? (
        <RequestComposer
          open={open}
          onOpenChange={setOpen}
          target={options.target}
          {...(options.label ? { targetLabel: options.label } : {})}
          {...(options.kind ? { defaultKind: options.kind } : {})}
          {...(options.message ? { defaultMessage: options.message } : {})}
          submit={submit}
          onOpenRequests={() => {
            setOpen(false);
            navigate("/requests");
          }}
        />
      ) : null}
    </Context>
  );
}

/** A button that opens the composer for a target. */
export function AskButton({
  className,
  iconOnly,
  text = "Ask an agent",
  hotkey,
  ...options
}: AskOptions & {
  className?: string;
  iconOnly?: boolean;
  text?: string;
  /** The hotkey that does the same (the screen registers it with this target): shown as a badge. */
  hotkey?: string;
}) {
  const ask = useAsk();
  const keys = useHotkeyAria(hotkey);
  const button = (
    <Button
      variant="ghostAccent"
      data-testid="ask-button"
      aria-label={iconOnly ? `${text}${options.label ? ` about ${options.label}` : ""}` : undefined}
      onClick={() => ask(options)}
      // With its words the key is a badge inside; as an icon it shows in the hint instead.
      hotkey={iconOnly ? undefined : hotkey}
      aria-keyshortcuts={iconOnly ? keys : undefined}
      // cn only joins classes, so the icon-only padding must win over the button size's own px-4.
      className={cn("gap-1.5 px-3", iconOnly && "size-11 px-0! xl:size-9", className)}
    >
      <MessageCirclePlus size={17} aria-hidden className="shrink-0" />
      {iconOnly ? null : <span>{text}</span>}
    </Button>
  );
  return iconOnly && hotkey ? (
    <HotkeyTooltip hotkey={hotkey} content={text}>
      {button}
    </HotkeyTooltip>
  ) : (
    button
  );
}
