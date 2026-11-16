import { AlertDialog, Popover as RadixPopover } from "radix-ui";
import {
  type ButtonHTMLAttributes,
  createContext,
  forwardRef,
  type ReactNode,
  useContext,
} from "react";
import { Icon, type IconName } from "./icons";

/** Where popovers and dialogs mount: inside the canvas, so its colour tokens apply. */
export const PortalContext = createContext<HTMLElement | null>(null);

/** A 44px-tall button with an icon and an accessible name. */
export const IconButton = forwardRef<
  HTMLButtonElement,
  {
    icon?: IconName;
    label: string;
    showLabel?: boolean;
    pressed?: boolean;
    danger?: boolean;
    children?: ReactNode;
  } & ButtonHTMLAttributes<HTMLButtonElement>
>(function IconButton(
  { icon, label, showLabel, pressed, danger, children, className, ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      type="button"
      className={`nc-btn${danger ? " nc-danger" : ""}${className ? ` ${className}` : ""}`}
      aria-label={showLabel ? undefined : label}
      aria-pressed={pressed}
      title={showLabel ? undefined : label}
      {...rest}
    >
      {icon && <Icon name={icon} />}
      {showLabel && <span>{label}</span>}
      {children}
    </button>
  );
});

/** A popover in the canvas chrome style. */
export function Popover({
  trigger,
  children,
  side = "top",
  open,
  onOpenChange,
  label,
}: {
  trigger: ReactNode;
  children: ReactNode;
  side?: "top" | "bottom" | "left" | "right";
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  label: string;
}) {
  const container = useContext(PortalContext);
  return (
    <RadixPopover.Root open={open} onOpenChange={onOpenChange}>
      <RadixPopover.Trigger asChild>{trigger}</RadixPopover.Trigger>
      <RadixPopover.Portal container={container}>
        <RadixPopover.Content
          side={side}
          sideOffset={10}
          collisionPadding={12}
          className="nc-popover nc-chrome nc-portal"
          aria-label={label}
          onOpenAutoFocus={(e) => e.preventDefault()}
        >
          {children}
        </RadixPopover.Content>
      </RadixPopover.Portal>
    </RadixPopover.Root>
  );
}

/** Ask before something hard to undo. */
export function ConfirmDialog({
  open,
  title,
  body,
  confirm,
  onConfirm,
  onCancel,
}: {
  open: boolean;
  title: string;
  body: string;
  confirm: string;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const container = useContext(PortalContext);
  return (
    <AlertDialog.Root open={open} onOpenChange={(next) => !next && onCancel()}>
      <AlertDialog.Portal container={container}>
        <AlertDialog.Overlay className="nc-dialog-overlay" />
        <AlertDialog.Content className="nc-dialog nc-chrome nc-portal">
          <AlertDialog.Title asChild>
            <h2>{title}</h2>
          </AlertDialog.Title>
          <AlertDialog.Description asChild>
            <p>{body}</p>
          </AlertDialog.Description>
          <div className="nc-dialog-actions">
            <AlertDialog.Cancel asChild>
              <button type="button" className="nc-btn">
                Cancel
              </button>
            </AlertDialog.Cancel>
            <AlertDialog.Action asChild>
              <button type="button" className="nc-btn nc-primary" onClick={onConfirm}>
                {confirm}
              </button>
            </AlertDialog.Action>
          </div>
        </AlertDialog.Content>
      </AlertDialog.Portal>
    </AlertDialog.Root>
  );
}
