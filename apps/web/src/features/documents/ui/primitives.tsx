import { X } from "lucide-react";
import { AlertDialog, Dialog, DropdownMenu, Popover as RadixPopover } from "radix-ui";
import {
  type ButtonHTMLAttributes,
  createContext,
  forwardRef,
  type ReactNode,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
} from "react";

/**
 * Small UI primitives for the documents feature, built on Radix and the
 * colour tokens. Kept inside the feature so nothing collides with the
 * shell's components; the integrator can reconcile them later.
 */

export function cx(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(" ");
}

type Variant = "primary" | "subtle" | "ghost" | "danger" | "outline";

const VARIANTS: Record<Variant, string> = {
  primary: "bg-accent text-accent-contrast hover:brightness-105 shadow-sm",
  subtle: "bg-surface-muted text-text hover:bg-[var(--doc-gray-hl)]",
  ghost: "text-text-muted hover:bg-surface-muted hover:text-text",
  danger: "bg-[var(--doc-red-solid)] text-white hover:brightness-105",
  outline: "border border-border bg-surface text-text hover:bg-surface-muted",
};

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: "sm" | "md";
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = "subtle", size = "md", className, type = "button", ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type}
      className={cx(
        "inline-flex select-none items-center justify-center gap-1.5 whitespace-nowrap rounded-xl font-medium transition-colors disabled:pointer-events-none disabled:opacity-45",
        size === "sm"
          ? "min-h-8 px-2.5 text-[13px] pointer-coarse:min-h-11 pointer-coarse:px-3"
          : "min-h-10 px-3.5 text-sm pointer-coarse:min-h-11",
        VARIANTS[variant],
        className,
      )}
      {...rest}
    />
  );
});

export interface IconButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  label: string;
  variant?: Variant;
  size?: "sm" | "md";
}

/** An icon-only button with an accessible name; 44px on touch. */
export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(function IconButton(
  { label, variant = "ghost", size = "md", className, type = "button", children, ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type}
      aria-label={label}
      className={cx(
        "inline-flex shrink-0 select-none items-center justify-center rounded-xl transition-colors disabled:pointer-events-none disabled:opacity-40",
        size === "sm" ? "size-8 pointer-coarse:size-11" : "size-10 pointer-coarse:size-11",
        VARIANTS[variant],
        className,
      )}
      {...rest}
    >
      {children}
    </button>
  );
});

const panelSurface =
  "doc-portal doc-root z-50 rounded-2xl border border-border bg-surface text-text shadow-[var(--doc-pop-shadow)] outline-none";

export function Popover({
  trigger,
  children,
  side = "bottom",
  align = "center",
  className,
  open,
  onOpenChange,
  label,
}: {
  trigger: ReactNode;
  children: ReactNode;
  side?: "top" | "bottom" | "left" | "right";
  align?: "start" | "center" | "end";
  className?: string;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  label?: string;
}) {
  return (
    <RadixPopover.Root
      {...(open !== undefined ? { open } : {})}
      {...(onOpenChange ? { onOpenChange } : {})}
    >
      <RadixPopover.Trigger asChild>{trigger}</RadixPopover.Trigger>
      <RadixPopover.Portal>
        <RadixPopover.Content
          side={side}
          align={align}
          sideOffset={6}
          collisionPadding={12}
          aria-label={label}
          className={cx(
            panelSurface,
            "doc-anim-pop max-w-[min(22rem,calc(100vw-24px))] p-3 text-sm leading-relaxed",
            className,
          )}
        >
          {children}
        </RadixPopover.Content>
      </RadixPopover.Portal>
    </RadixPopover.Root>
  );
}

// ---------------------------------------------------------------------------
// Menus
// ---------------------------------------------------------------------------

export const Menu = DropdownMenu.Root;
export const MenuTrigger = DropdownMenu.Trigger;

export function MenuContent({
  children,
  align = "start",
  side = "bottom",
  label,
}: {
  children: ReactNode;
  align?: "start" | "center" | "end";
  side?: "top" | "bottom" | "left" | "right";
  label?: string;
}) {
  return (
    <DropdownMenu.Portal>
      <DropdownMenu.Content
        align={align}
        side={side}
        sideOffset={6}
        collisionPadding={12}
        aria-label={label}
        className={cx(
          panelSurface,
          "doc-anim-pop max-h-[min(70vh,var(--radix-dropdown-menu-content-available-height))] min-w-56 overflow-y-auto p-1.5 text-sm",
        )}
      >
        {children}
      </DropdownMenu.Content>
    </DropdownMenu.Portal>
  );
}

const itemClass =
  "flex min-h-9 cursor-default select-none items-center gap-2.5 rounded-lg px-2.5 text-[14px] outline-none data-[disabled]:opacity-45 data-[highlighted]:bg-surface-muted pointer-coarse:min-h-11";

export function MenuItem({
  children,
  onSelect,
  icon,
  danger,
  disabled,
  shortcut,
}: {
  children: ReactNode;
  onSelect?: () => void;
  icon?: ReactNode;
  danger?: boolean;
  disabled?: boolean;
  shortcut?: string;
}) {
  return (
    <DropdownMenu.Item
      disabled={disabled}
      onSelect={onSelect}
      className={cx(itemClass, danger && "text-[var(--doc-red-fg)]")}
    >
      <span className="flex w-5 justify-center text-text-muted [&_svg]:size-4">{icon}</span>
      <span className="flex-1">{children}</span>
      {shortcut && <span className="text-xs text-text-muted">{shortcut}</span>}
    </DropdownMenu.Item>
  );
}

export function MenuSub({
  label,
  icon,
  children,
}: {
  label: string;
  icon?: ReactNode;
  children: ReactNode;
}) {
  return (
    <DropdownMenu.Sub>
      <DropdownMenu.SubTrigger className={cx(itemClass, "data-[state=open]:bg-surface-muted")}>
        <span className="flex w-5 justify-center text-text-muted [&_svg]:size-4">{icon}</span>
        <span className="flex-1">{label}</span>
        <span aria-hidden className="text-text-muted">
          ›
        </span>
      </DropdownMenu.SubTrigger>
      <DropdownMenu.Portal>
        <DropdownMenu.SubContent
          sideOffset={4}
          collisionPadding={12}
          className={cx(
            panelSurface,
            "doc-anim-pop max-h-[70vh] min-w-52 overflow-y-auto p-1.5 text-sm",
          )}
        >
          {children}
        </DropdownMenu.SubContent>
      </DropdownMenu.Portal>
    </DropdownMenu.Sub>
  );
}

export function MenuSeparator() {
  return <DropdownMenu.Separator className="my-1 h-px bg-border" />;
}

export function MenuLabel({ children }: { children: ReactNode }) {
  return (
    <DropdownMenu.Label className="px-2.5 pt-1.5 pb-1 text-[11px] font-semibold uppercase tracking-wide text-text-muted">
      {children}
    </DropdownMenu.Label>
  );
}

// ---------------------------------------------------------------------------
// Sheets and dialogs
// ---------------------------------------------------------------------------

export type SheetSide = "bottom" | "right" | "center";

/**
 * A modal surface: a bottom sheet on phones, a slide-over on tablets, a
 * centred dialog for confirmations and pickers.
 */
export function Sheet({
  open,
  onOpenChange,
  title,
  description,
  side,
  children,
  wide,
  testId,
  headerExtra,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: string;
  side: SheetSide;
  children: ReactNode;
  wide?: boolean;
  testId?: string;
  headerExtra?: ReactNode;
}) {
  const position =
    side === "bottom"
      ? "doc-anim-sheet inset-x-0 bottom-0 max-h-[92dvh] rounded-t-3xl pb-[env(safe-area-inset-bottom)]"
      : side === "right"
        ? cx(
            "doc-anim-slide inset-y-0 right-0 rounded-l-3xl pr-[env(safe-area-inset-right)] pb-[env(safe-area-inset-bottom)]",
            wide ? "w-[min(40rem,100vw)]" : "w-[min(24rem,92vw)]",
          )
        : cx(
            "doc-anim-pop top-1/2 left-1/2 max-h-[88dvh] -translate-x-1/2 -translate-y-1/2 rounded-3xl",
            wide ? "w-[min(60rem,calc(100vw-32px))]" : "w-[min(28rem,calc(100vw-32px))]",
          );
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="doc-portal doc-anim-fade fixed inset-0 z-40 bg-[var(--doc-scrim)]" />
        <Dialog.Content
          data-testid={testId}
          aria-describedby={description ? undefined : undefined}
          className={cx(
            "doc-portal doc-root fixed z-50 flex flex-col border border-border bg-surface text-text shadow-[var(--doc-pop-shadow)] outline-none",
            position,
          )}
        >
          {side === "bottom" && (
            <div aria-hidden className="mx-auto mt-2 h-1.5 w-10 shrink-0 rounded-full bg-border" />
          )}
          <div className="flex shrink-0 items-center gap-2 px-5 pt-3 pb-2">
            <div className="min-w-0 flex-1">
              <Dialog.Title className="truncate text-[17px] font-semibold">{title}</Dialog.Title>
              {description ? (
                <Dialog.Description className="text-[13px] text-text-muted">
                  {description}
                </Dialog.Description>
              ) : (
                <Dialog.Description className="sr-only">{title}</Dialog.Description>
              )}
            </div>
            {headerExtra}
            <Dialog.Close asChild>
              <IconButton label="Close" size="sm">
                <X className="size-4.5" />
              </IconButton>
            </Dialog.Close>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">{children}</div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

export function ConfirmDialog({
  open,
  onOpenChange,
  title,
  body,
  confirmLabel,
  onConfirm,
  danger,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  body: ReactNode;
  confirmLabel: string;
  onConfirm: () => void;
  danger?: boolean;
}) {
  return (
    <AlertDialog.Root open={open} onOpenChange={onOpenChange}>
      <AlertDialog.Portal>
        <AlertDialog.Overlay className="doc-portal doc-anim-fade fixed inset-0 z-[60] bg-[var(--doc-scrim)]" />
        <AlertDialog.Content className="doc-portal doc-root doc-anim-pop fixed top-1/2 left-1/2 z-[61] w-[min(26rem,calc(100vw-32px))] -translate-x-1/2 -translate-y-1/2 rounded-3xl border border-border bg-surface p-5 text-text shadow-[var(--doc-pop-shadow)]">
          <AlertDialog.Title className="text-[17px] font-semibold">{title}</AlertDialog.Title>
          <AlertDialog.Description asChild>
            <div className="mt-2 text-sm leading-relaxed text-text-muted">{body}</div>
          </AlertDialog.Description>
          <div className="mt-5 flex justify-end gap-2">
            <AlertDialog.Cancel asChild>
              <Button variant="outline">Cancel</Button>
            </AlertDialog.Cancel>
            <AlertDialog.Action asChild>
              <Button variant={danger ? "danger" : "primary"} onClick={onConfirm}>
                {confirmLabel}
              </Button>
            </AlertDialog.Action>
          </div>
        </AlertDialog.Content>
      </AlertDialog.Portal>
    </AlertDialog.Root>
  );
}

// ---------------------------------------------------------------------------
// Toasts
// ---------------------------------------------------------------------------

interface Toast {
  id: number;
  message: string;
  tone: "info" | "success" | "error";
  action?: { label: string; run: () => void };
}

interface ToastApi {
  show: (message: string, options?: { tone?: Toast["tone"]; action?: Toast["action"] }) => void;
}

const ToastContext = createContext<ToastApi>({ show: () => {} });

export function useToast(): ToastApi {
  return useContext(ToastContext);
}

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const next = useRef(1);
  const dismiss = useCallback(
    (id: number) => setToasts((all) => all.filter((t) => t.id !== id)),
    [],
  );
  const show = useCallback<ToastApi["show"]>(
    (message, options = {}) => {
      const id = next.current++;
      setToasts((all) => [
        ...all.slice(-2),
        {
          id,
          message,
          tone: options.tone ?? "info",
          ...(options.action ? { action: options.action } : {}),
        },
      ]);
      setTimeout(() => dismiss(id), options.action ? 7000 : 3800);
    },
    [dismiss],
  );
  const api = useMemo(() => ({ show }), [show]);
  return (
    <ToastContext.Provider value={api}>
      {children}
      <div
        aria-live="polite"
        className="doc-portal pointer-events-none fixed inset-x-0 bottom-[calc(16px+env(safe-area-inset-bottom))] z-[70] flex flex-col items-center gap-2 px-4"
      >
        {toasts.map((toast) => (
          <div
            key={toast.id}
            role={toast.tone === "error" ? "alert" : "status"}
            className={cx(
              "doc-anim-pop pointer-events-auto flex max-w-md items-center gap-3 rounded-2xl border px-4 py-2.5 text-sm shadow-[var(--doc-pop-shadow)]",
              toast.tone === "error"
                ? "border-[var(--doc-red-border)] bg-[var(--doc-red-bg)] text-[var(--doc-red-fg)]"
                : toast.tone === "success"
                  ? "border-[var(--doc-green-border)] bg-[var(--doc-green-bg)] text-[var(--doc-green-fg)]"
                  : "border-border bg-surface text-text",
            )}
          >
            <span className="flex-1">{toast.message}</span>
            {toast.action && (
              <button
                type="button"
                className="min-h-9 rounded-lg px-2 font-semibold underline underline-offset-2"
                onClick={() => {
                  toast.action?.run();
                  dismiss(toast.id);
                }}
              >
                {toast.action.label}
              </button>
            )}
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}
