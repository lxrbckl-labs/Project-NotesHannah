import { X } from "lucide-react";
import { Dialog } from "radix-ui";
import type { ReactNode } from "react";
import { cn } from "../../lib/cn";
import { IconButton } from "./button";
import { overlayClass } from "./dialog";

/**
 * Where the sheet goes on a tablet or computer. On the phone every sheet is a bottom sheet.
 * - "side": a panel sliding in from the right (details, outlines, sources).
 * - "center": a centred dialog (pickers, forms).
 * - "bottom": a bottom sheet everywhere.
 */
export type SheetPlacement = "side" | "center" | "bottom";

const PHONE = "inset-x-0 bottom-0 max-h-[92dvh] rounded-t-panel";

function placementClass(placement: SheetPlacement, wide: boolean): string {
  if (placement === "side") {
    return cn(
      PHONE,
      "anim-sheet-side md:inset-x-auto md:top-0 md:right-0 md:bottom-0 md:max-h-none md:rounded-none md:rounded-l-panel md:pr-[env(safe-area-inset-right)]",
      wide ? "md:w-[min(40rem,100vw)]" : "md:w-[min(24rem,92vw)]",
    );
  }
  if (placement === "center") {
    return cn(
      PHONE,
      "anim-sheet-center md:inset-auto md:top-1/2 md:left-1/2 md:max-h-[88dvh] md:-translate-x-1/2 md:-translate-y-1/2 md:rounded-panel",
      wide ? "md:w-[min(60rem,calc(100vw-32px))]" : "md:w-[min(30rem,calc(100vw-32px))]",
    );
  }
  return cn(PHONE, "anim-sheet md:mx-auto md:max-w-2xl");
}

/**
 * A modal surface that suits the screen: a bottom sheet on the phone, a side panel or a centered
 * dialog on larger screens. Escape, the close button and a tap on the backdrop close it.
 */
export function Sheet({
  open,
  onOpenChange,
  title,
  description,
  placement = "side",
  wide = false,
  headerExtra,
  footer,
  container,
  testId,
  flush = false,
  children,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  /** Shown under the title; screen readers get the title when it is left out. */
  description?: string;
  placement?: SheetPlacement;
  wide?: boolean;
  /** Extra controls beside the close button. */
  headerExtra?: ReactNode;
  footer?: ReactNode;
  container?: HTMLElement | null;
  testId?: string;
  /** No padding around the body, for lists that run edge to edge. */
  flush?: boolean;
  children: ReactNode;
}) {
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal container={container ?? undefined}>
        <Dialog.Overlay className={overlayClass} />
        <Dialog.Content
          data-testid={testId}
          data-placement={placement}
          className={cn(
            "fixed z-(--z-modal) flex flex-col border border-border bg-surface text-text shadow-pop outline-none",
            placementClass(placement, wide),
          )}
        >
          <div
            aria-hidden
            className={cn(
              "mx-auto mt-2 h-1.5 w-10 shrink-0 rounded-pill bg-border-strong",
              placement !== "bottom" && "md:hidden",
            )}
          />
          <div className="flex shrink-0 items-start gap-2 px-5 pt-3 pb-2">
            <div className="min-w-0 flex-1">
              <Dialog.Title className="font-display text-title font-semibold">{title}</Dialog.Title>
              {description ? (
                <Dialog.Description className="mt-0.5 text-ui text-text-muted">
                  {description}
                </Dialog.Description>
              ) : (
                <Dialog.Description className="sr-only">{title}</Dialog.Description>
              )}
            </div>
            {headerExtra}
            <Dialog.Close asChild>
              <IconButton label="Close" className="-mr-2">
                <X size={18} />
              </IconButton>
            </Dialog.Close>
          </div>
          <div
            className={cn(
              "min-h-0 flex-1 overflow-y-auto overscroll-contain",
              !flush && "px-5 pb-4",
            )}
          >
            {children}
          </div>
          {footer ? (
            // The bottom padding is the larger of the usual gap and the device's safe area. `pb-safe` beside `py-3`
            // replaced the gap with the safe area, which is nothing on a computer, so the buttons sat on the edge.
            <div className="flex shrink-0 flex-wrap justify-end gap-2 border-t border-border px-5 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
              {footer}
            </div>
          ) : (
            <div className="pb-safe shrink-0" />
          )}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
