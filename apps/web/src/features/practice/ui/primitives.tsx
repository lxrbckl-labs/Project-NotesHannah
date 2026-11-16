import { AlertDialog, Collapsible, Progress as RadixProgress } from "radix-ui";
import type { ReactNode } from "react";
import { type ButtonProps, Button as ShellButton } from "../../../components/ui/button";

type Variant = "primary" | "secondary" | "ghost" | "quiet";

const MAP = { primary: "primary", secondary: "secondary", ghost: "ghost", quiet: "ghost" } as const;

/** The shell's button, with the practice module's sizes (and a quieter ghost). */
export function Button({
  variant = "secondary",
  size = "md",
  className = "",
  ...rest
}: Omit<ButtonProps, "variant"> & { variant?: Variant; size?: "md" | "lg" | "sm" }) {
  const sizes = {
    sm: "px-3",
    md: "px-4",
    lg: "min-h-13 px-6 text-base xl:min-h-13",
  } as const;
  return (
    <ShellButton
      variant={MAP[variant]}
      className={`${sizes[size]} ${variant === "quiet" ? "text-text-muted hover:text-text" : ""} ${className}`}
      {...rest}
    />
  );
}

export function Card({
  className = "",
  children,
  as: Tag = "div",
  ...rest
}: {
  className?: string;
  children: ReactNode;
  as?: "div" | "section" | "li" | "article";
} & Omit<React.HTMLAttributes<HTMLElement>, "className" | "children">) {
  return (
    <Tag className={`pr-card ${className}`} {...(rest as object)}>
      {children}
    </Tag>
  );
}

export function Chip({
  children,
  tone = "neutral",
  className = "",
}: {
  children: ReactNode;
  tone?: "neutral" | "ok" | "bad" | "part" | "accent";
  className?: string;
}) {
  const tones = {
    neutral: "border-border bg-surface-muted text-text-muted",
    ok: "pr-ok",
    bad: "pr-bad",
    part: "pr-part",
    accent: "border-transparent bg-[var(--pr-accent-soft)] text-accent",
  } as const;
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-xs font-medium ${tones[tone]} ${className}`}
    >
      {children}
    </span>
  );
}

export function ProgressBar({
  value,
  max,
  label,
  className = "",
  color,
}: {
  value: number;
  max: number;
  label: string;
  className?: string;
  /** Bar colour; the accent by default. */
  color?: string;
}) {
  const pct = max > 0 ? Math.min(100, Math.round((value / max) * 100)) : 0;
  return (
    <RadixProgress.Root
      value={value}
      max={max}
      aria-label={label}
      className={`relative h-1.5 w-full overflow-hidden rounded-full bg-surface-muted ${className}`}
    >
      <RadixProgress.Indicator
        className="h-full rounded-full bg-accent transition-[width] duration-300 motion-reduce:transition-none"
        style={{ width: `${pct}%`, ...(color ? { background: color } : {}) }}
      />
    </RadixProgress.Root>
  );
}

export function ConfirmDialog({
  open,
  onOpenChange,
  title,
  description,
  confirmLabel,
  cancelLabel,
  onConfirm,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description: string;
  confirmLabel: string;
  cancelLabel: string;
  onConfirm: () => void;
}) {
  return (
    <AlertDialog.Root open={open} onOpenChange={onOpenChange}>
      <AlertDialog.Portal>
        <AlertDialog.Overlay className="pr-fade fixed inset-0 z-[70] bg-black/40" />
        <AlertDialog.Content className="pr-rise pr-card fixed inset-x-4 bottom-[max(1rem,env(safe-area-inset-bottom))] z-[71] mx-auto max-w-md p-6 md:bottom-auto md:top-1/2 md:-translate-y-1/2">
          <AlertDialog.Title className="text-lg font-semibold">{title}</AlertDialog.Title>
          <AlertDialog.Description className="mt-2 text-[0.95rem] text-text-muted">
            {description}
          </AlertDialog.Description>
          <div className="mt-6 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <AlertDialog.Cancel asChild>
              <Button variant="secondary">{cancelLabel}</Button>
            </AlertDialog.Cancel>
            <AlertDialog.Action asChild>
              <Button variant="primary" onClick={onConfirm}>
                {confirmLabel}
              </Button>
            </AlertDialog.Action>
          </div>
        </AlertDialog.Content>
      </AlertDialog.Portal>
    </AlertDialog.Root>
  );
}

export function Disclosure({
  label,
  children,
  defaultOpen = false,
  className = "",
}: {
  label: string;
  children: ReactNode;
  defaultOpen?: boolean;
  className?: string;
}) {
  return (
    <Collapsible.Root defaultOpen={defaultOpen} className={className}>
      <Collapsible.Trigger className="group flex min-h-11 w-full items-center justify-between gap-2 rounded-xl px-1 text-left text-sm font-medium text-text-muted hover:text-text">
        <span>{label}</span>
        <span aria-hidden className="transition-transform group-data-[state=open]:rotate-180">
          ⌄
        </span>
      </Collapsible.Trigger>
      <Collapsible.Content>{children}</Collapsible.Content>
    </Collapsible.Root>
  );
}

export function Empty({
  title,
  children,
  action,
}: {
  title: string;
  children?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="pr-card flex flex-col items-center gap-2 px-6 py-10 text-center">
      <h3 className="text-base font-semibold">{title}</h3>
      {children && <div className="max-w-md text-sm text-text-muted">{children}</div>}
      {action && <div className="mt-3">{action}</div>}
    </div>
  );
}

/** A visually hidden polite live region. */
export function Announce({ message }: { message: string }) {
  return (
    <div className="sr-only" aria-live="polite" aria-atomic="true" data-testid="announcer">
      {message}
    </div>
  );
}

export function Spinner({ label = "Loading" }: { label?: string }) {
  return (
    <div role="status" className="flex items-center justify-center gap-2 py-12 text-text-muted">
      <span
        aria-hidden
        className="size-4 animate-spin rounded-full border-2 border-border border-t-accent motion-reduce:animate-none"
      />
      <span className="text-sm">{label}</span>
    </div>
  );
}

export function ErrorNote({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div
      role="alert"
      className="pr-bad flex items-center justify-between gap-3 rounded-2xl border p-4 text-sm"
    >
      <span>{message}</span>
      {onRetry && (
        <Button size="sm" variant="secondary" onClick={onRetry}>
          Try again
        </Button>
      )}
    </div>
  );
}
