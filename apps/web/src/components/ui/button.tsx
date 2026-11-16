import type { ButtonHTMLAttributes, Ref } from "react";
import { cn } from "../../lib/cn";

type Variant = "primary" | "secondary" | "ghost" | "danger" | "ghostDanger" | "ghostAccent";

const VARIANTS: Record<Variant, string> = {
  primary: "bg-accent text-accent-contrast hover:brightness-110 active:brightness-95",
  secondary:
    "border border-border-strong bg-surface text-text hover:bg-surface-muted active:bg-surface-muted",
  ghost: "text-text hover:bg-surface-muted active:bg-surface-muted",
  ghostDanger: "text-danger hover:bg-danger-soft active:bg-danger-soft",
  ghostAccent: "text-accent hover:bg-accent-soft active:bg-accent-soft",
  danger: "bg-danger text-accent-contrast hover:brightness-110 active:brightness-95",
};

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  ref?: Ref<HTMLButtonElement>;
}

/** 44px tall on touch layouts; compact on the computer layout. */
export function Button({
  variant = "secondary",
  className,
  type = "button",
  ...props
}: ButtonProps) {
  return (
    <button
      type={type}
      className={cn(
        "inline-flex min-h-11 items-center justify-center gap-2 rounded-xl px-4 text-sm font-medium transition-colors disabled:pointer-events-none disabled:opacity-50 xl:min-h-9",
        VARIANTS[variant],
        className,
      )}
      {...props}
    />
  );
}

export function IconButton({
  className,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  "aria-label": string;
  ref?: Ref<HTMLButtonElement>;
}) {
  return (
    <button
      type="button"
      className={cn(
        "inline-flex size-11 shrink-0 items-center justify-center rounded-xl text-text-muted transition-colors hover:bg-surface-muted hover:text-text active:bg-surface-muted disabled:opacity-50 xl:size-9",
        className,
      )}
      {...props}
    />
  );
}
