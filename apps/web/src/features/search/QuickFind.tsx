import { Dialog } from "radix-ui";
import { SearchPanel } from "./SearchPanel";

/** Cmd/Ctrl+K quick-find: a palette-style dialog over the current screen. */
export function QuickFind({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="anim-fade fixed inset-0 z-40 bg-(--color-overlay)" />
        <Dialog.Content
          aria-describedby={undefined}
          className="anim-pop fixed left-1/2 top-[12dvh] z-50 max-h-[76dvh] w-[min(36rem,calc(100vw-2rem))] -translate-x-1/2 overflow-y-auto rounded-3xl border border-border bg-surface p-4 shadow-pop outline-none"
        >
          <Dialog.Title className="sr-only">Quick find</Dialog.Title>
          <SearchPanel autoFocus onPick={() => onOpenChange(false)} />
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
