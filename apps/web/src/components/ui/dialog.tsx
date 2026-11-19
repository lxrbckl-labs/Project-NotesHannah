import { X } from "lucide-react";
import { AlertDialog, Dialog } from "radix-ui";
import type { ReactNode } from "react";
import { cn } from "../../lib/cn";
import { Button, IconButton } from "./button";

export const overlayClass = "fixed inset-0 z-(--z-overlay) bg-(--color-overlay) anim-fade";
const overlay = overlayClass;

function contentClass(sheet: "touch" | "phone") {
  const bottom =
    sheet === "touch"
      ? "inset-x-0 bottom-0 max-h-[88dvh] rounded-t-panel xl:inset-auto xl:left-1/2 xl:top-1/2 xl:max-h-[85dvh] xl:w-[30rem] xl:-translate-x-1/2 xl:-translate-y-1/2 xl:rounded-panel"
      : "inset-x-0 bottom-0 max-h-[88dvh] rounded-t-panel md:inset-auto md:left-1/2 md:top-1/2 md:max-h-[85dvh] md:w-[30rem] md:-translate-x-1/2 md:-translate-y-1/2 md:rounded-panel";
  return cn(
    "fixed z-(--z-modal) flex flex-col border border-border bg-surface text-text shadow-pop outline-none anim-sheet",
    bottom,
  );
}

/** A dialog that is a bottom sheet on touch layouts ("touch": phone and tablet; "phone": phone only). */
export function Modal({
  open,
  onOpenChange,
  title,
  description,
  children,
  footer,
  sheet = "phone",
  hideDescription,
  container,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: string;
  children?: ReactNode;
  footer?: ReactNode;
  sheet?: "touch" | "phone";
  hideDescription?: boolean;
  /** Where to mount; the document body by default. */
  container?: HTMLElement | null;
}) {
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal container={container ?? undefined}>
        <Dialog.Overlay className={overlay} />
        <Dialog.Content
          className={contentClass(sheet)}
          aria-describedby={description ? undefined : undefined}
        >
          <div className="flex items-start justify-between gap-3 px-5 pt-5">
            <div className="min-w-0">
              <Dialog.Title className="font-display text-title font-semibold">{title}</Dialog.Title>
              {description ? (
                <Dialog.Description
                  className={cn("mt-1 text-ui text-text-muted", hideDescription && "sr-only")}
                >
                  {description}
                </Dialog.Description>
              ) : null}
            </div>
            <Dialog.Close asChild>
              <IconButton aria-label="Close" className="-mr-2 -mt-2">
                <X size={18} />
              </IconButton>
            </Dialog.Close>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">{children}</div>
          {footer ? (
            // The bottom padding is the larger of the usual gap and the device's safe area. `pb-safe` beside `py-3`
            // replaced the gap with the safe area, which is nothing on a computer, so the buttons sat on the edge.
            <div className="flex flex-wrap justify-end gap-2 border-t border-border px-5 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
              {footer}
            </div>
          ) : (
            <div className="pb-safe" />
          )}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

/** A confirmation that names what it affects. */
export function ConfirmDialog({
  open,
  onOpenChange,
  title,
  description,
  confirmLabel,
  onConfirm,
  danger,
  busy,
  cancelLabel = "Cancel",
  container,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  /** What it affects, in a sentence or two. */
  description: ReactNode;
  confirmLabel: string;
  onConfirm: () => void;
  danger?: boolean;
  busy?: boolean;
  cancelLabel?: string;
  container?: HTMLElement | null;
}) {
  return (
    <AlertDialog.Root open={open} onOpenChange={onOpenChange}>
      <AlertDialog.Portal container={container ?? undefined}>
        <AlertDialog.Overlay className={overlay} />
        <AlertDialog.Content className={contentClass("phone")}>
          <div className="px-5 pt-5">
            <AlertDialog.Title className="font-display text-title font-semibold">
              {title}
            </AlertDialog.Title>
            <AlertDialog.Description asChild>
              <div className="mt-2 text-ui text-text-muted">{description}</div>
            </AlertDialog.Description>
          </div>
          <div className="mt-5 flex flex-wrap justify-end gap-2 px-5 pb-[max(1rem,env(safe-area-inset-bottom))]">
            <AlertDialog.Cancel asChild>
              <Button>{cancelLabel}</Button>
            </AlertDialog.Cancel>
            <Button
              variant={danger ? "danger" : "primary"}
              disabled={busy}
              onClick={() => {
                onConfirm();
              }}
            >
              {confirmLabel}
            </Button>
          </div>
        </AlertDialog.Content>
      </AlertDialog.Portal>
    </AlertDialog.Root>
  );
}
