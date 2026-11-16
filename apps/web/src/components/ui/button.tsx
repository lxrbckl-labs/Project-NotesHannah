import type { ButtonHTMLAttributes, Ref } from "react";
import { cn } from "../../lib/cn";

export type ButtonVariant =
  | "primary"
  | "secondary"
  | "subtle"
  | "ghost"
  | "danger"
  | "ghostDanger"
  | "ghostAccent";

const VARIANTS: Record<ButtonVariant, string> = {
  primary: "bg-accent text-accent-contrast hover:brightness-110 active:brightness-95",
  secondary:
    "border border-border-strong bg-surface text-text hover:bg-surface-muted active:bg-surface-muted",
  subtle: "bg-surface-muted text-text hover:bg-hue-gray-mark active:bg-hue-gray-mark",
  ghost: "text-text hover:bg-surface-muted active:bg-surface-muted",
  ghostDanger: "text-danger hover:bg-danger-soft active:bg-danger-soft",
  ghostAccent: "text-accent hover:bg-accent-soft active:bg-accent-soft",
  danger: "bg-danger text-accent-contrast hover:brightness-110 active:brightness-95",
};

export type ButtonSize = "sm" | "md" | "lg";

/** Heights: 44px on touch layouts always; on the computer layout sm is 32, md 36, lg 48. */
const SIZES: Record<ButtonSize, string> = {
  sm: "min-h-11 px-3 text-label xl:min-h-8",
  md: "min-h-11 px-4 text-ui xl:min-h-9",
  lg: "min-h-12 px-6 text-body xl:min-h-12",
};

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  ref?: Ref<HTMLButtonElement>;
}

/** 44px tall on touch layouts; compact on the computer layout. */
export function Button({
  variant = "secondary",
  size = "md",
  className,
  type = "button",
  ...props
}: ButtonProps) {
  return (
    <button
      type={type}
      className={cn(
        "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-control font-medium transition-colors duration-(--duration-instant) disabled:pointer-events-none disabled:opacity-50",
        SIZES[size],
        VARIANTS[variant],
        className,
      )}
      {...props}
    />
  );
}

type IconButtonVariant = "ghost" | "subtle" | "secondary" | "primary" | "ghostDanger";

const ICON_VARIANTS: Record<IconButtonVariant, string> = {
  ghost: "text-text-muted hover:bg-surface-muted hover:text-text active:bg-surface-muted",
  subtle: "bg-surface-muted text-text hover:bg-hue-gray-mark",
  secondary: "border border-border-strong bg-surface text-text hover:bg-surface-muted",
  primary: "bg-accent text-accent-contrast hover:brightness-110",
  ghostDanger: "text-danger hover:bg-danger-soft",
};

export type IconButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  ref?: Ref<HTMLButtonElement>;
  variant?: IconButtonVariant;
  /** "md": 44px on touch, 36px on the computer. "sm": 44px on touch, 32px on the computer. */
  size?: "sm" | "md";
  /** A toggle: shown filled with the accent while pressed. */
  pressed?: boolean;
} & ({ "aria-label": string; label?: undefined } | { label: string; "aria-label"?: undefined });

/** An icon-only button. It always has a name: pass label (or aria-label). */
export function IconButton({
  className,
  variant = "ghost",
  size = "md",
  pressed,
  label,
  type = "button",
  ...props
}: IconButtonProps) {
  return (
    <button
      type={type}
      aria-label={label ?? props["aria-label"]}
      aria-pressed={pressed}
      className={cn(
        "inline-flex size-11 shrink-0 items-center justify-center rounded-control transition-colors duration-(--duration-instant) disabled:pointer-events-none disabled:opacity-50",
        size === "sm" ? "xl:size-8" : "xl:size-9",
        ICON_VARIANTS[variant],
        "aria-pressed:bg-accent aria-pressed:text-accent-contrast",
        className,
      )}
      {...props}
    />
  );
}
