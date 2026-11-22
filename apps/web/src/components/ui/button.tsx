import type { ButtonHTMLAttributes, Ref } from "react";
import { useHotkeyAria } from "../../features/hotkeys/HotkeyProvider";
import { Kbd } from "../../features/hotkeys/Kbd";
import { cn } from "../../lib/cn";
import { Tooltip } from "./tooltip";

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
  // The three "ghost" variants are outlined on the surface color like `secondary`: a button with no edge and no
  // fill disappears on the dotted page. They differ from `secondary` only in the color of their text.
  ghost:
    "border border-border-strong bg-surface text-text hover:bg-surface-muted active:bg-surface-muted",
  ghostDanger:
    "border border-border-strong bg-surface text-danger hover:bg-danger-soft active:bg-danger-soft",
  ghostAccent:
    "border border-border-strong bg-surface text-accent hover:bg-accent-soft active:bg-accent-soft",
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
  /**
   * A hotkey id (features/hotkeys/registry.ts): its key shows as a quiet badge at the trailing edge
   * (hidden from screen readers, so the name stays the same) and goes in `aria-keyshortcuts`.
   */
  hotkey?: string | undefined;
}

const BASE =
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-control font-medium transition-colors duration-(--duration-instant) disabled:pointer-events-none disabled:opacity-50";

/** The button look as a class, for a link that should look like a button. */
export function buttonClass({
  variant = "secondary",
  size = "md",
  className,
}: {
  variant?: ButtonVariant;
  size?: ButtonSize;
  className?: string;
} = {}): string {
  return cn(BASE, SIZES[size], VARIANTS[variant], className);
}

/** 44px tall on touch layouts; compact on the computer layout. */
export function Button({
  variant = "secondary",
  size = "md",
  className,
  type = "button",
  hotkey,
  children,
  "aria-keyshortcuts": ariaGiven,
  ...props
}: ButtonProps) {
  const aria = useHotkeyAria(hotkey);
  return (
    <button
      type={type}
      className={buttonClass({ variant, size, className })}
      aria-keyshortcuts={ariaGiven ?? aria}
      {...props}
    >
      {children}
      {hotkey ? <Kbd hotkey={hotkey} /> : null}
    </button>
  );
}

/**
 * Every back arrow looks the same: a solid square with an edge, like the other buttons, so it reads as a
 * button on the dotted page and on a header bar alike (Alex, 2026-11-16). For a link; a button uses
 * `<IconButton variant="secondary">`, which draws the same.
 */
export const backButtonClass =
  // `nav-back`: the page then slides in from the left, like going back (app/usePageSlide).
  "nav-back flex size-11 shrink-0 items-center justify-center rounded-control border border-border-strong bg-surface text-text transition-colors duration-(--duration-instant) hover:bg-surface-muted active:bg-surface-muted xl:size-9";

type IconButtonVariant = "ghost" | "subtle" | "secondary" | "primary" | "ghostDanger" | "bare";

/**
 * An icon she can press is a solid square with an edge, like every other button (Alex, 2026-11-16): the
 * default (`ghost`) and `ghostDanger` are outlined on the surface colour, so a star or a "..." reads as a
 * button on the dotted page. `bare` has no edge or fill and is only for an icon that sits inside a bar
 * which is itself the edge: the editor ribbon, the canvas toolbars, a block's margin handles.
 */
const ICON_VARIANTS: Record<IconButtonVariant, string> = {
  ghost:
    "border border-border-strong bg-surface text-text-muted hover:bg-surface-muted hover:text-text active:bg-surface-muted",
  subtle: "bg-surface-muted text-text hover:bg-hue-gray-mark",
  secondary: "border border-border-strong bg-surface text-text hover:bg-surface-muted",
  primary: "bg-accent text-accent-contrast hover:brightness-110",
  ghostDanger:
    "border border-border-strong bg-surface text-danger hover:bg-danger-soft active:bg-danger-soft",
  bare: "text-text-muted hover:bg-surface-muted hover:text-text active:bg-surface-muted",
};

export type IconButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  ref?: Ref<HTMLButtonElement>;
  variant?: IconButtonVariant;
  /** "md": 44px on touch, 36px on the computer. "sm": 44px on touch, 32px on the computer. */
  size?: "sm" | "md";
  /** A toggle: shown filled with the accent while pressed. */
  pressed?: boolean;
  /**
   * The hint that names the button on hover, focus or a long press. On by default, from its label,
   * since an icon alone does not say what it does. Pass a side to place it, or `false` when
   * something around the button already shows a hint.
   */
  tooltip?: boolean | "top" | "bottom" | "left" | "right";
  /** A hotkey id: its key is shown in the tooltip and goes in `aria-keyshortcuts`. */
  hotkey?: string | undefined;
} & ({ "aria-label": string; label?: undefined } | { label: string; "aria-label"?: undefined });

/** An icon-only button. It always has a name: pass label (or aria-label). */
export function IconButton({
  className,
  variant = "ghost",
  size = "md",
  pressed,
  label,
  type = "button",
  tooltip = true,
  hotkey,
  ...props
}: IconButtonProps) {
  const name = label ?? props["aria-label"];
  const aria = useHotkeyAria(hotkey);
  const button = (
    <button
      type={type}
      aria-label={label ?? props["aria-label"]}
      aria-pressed={pressed}
      aria-keyshortcuts={aria}
      className={cn(
        "inline-flex size-11 shrink-0 items-center justify-center rounded-control transition-colors duration-(--duration-instant) disabled:pointer-events-none disabled:opacity-50",
        size === "sm" ? "xl:size-8" : "xl:size-9",
        ICON_VARIANTS[variant],
        "aria-pressed:border-transparent aria-pressed:bg-accent aria-pressed:text-accent-contrast",
        className,
      )}
      {...props}
    />
  );
  if (tooltip === false || !name) return button;
  return (
    <Tooltip content={name} side={tooltip === true ? "top" : tooltip} hotkey={hotkey}>
      {button}
    </Tooltip>
  );
}
