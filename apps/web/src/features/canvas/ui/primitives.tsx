import { createContext, type ReactNode, type Ref, useContext } from "react";
import { Button, IconButton } from "../../../components/ui/button";
import { Tooltip } from "../../../components/ui/tooltip";
import { cn } from "../../../lib/cn";
import { Icon, type IconName } from "./icons";

/**
 * Where the canvas's popovers and dialogs mount: inside the canvas root, so the touch guards and
 * the canvas's stacking stay with them. Colours come from the shared tokens either way.
 */
export const PortalContext = createContext<HTMLElement | null>(null);

/** The mount point for the shared Popover, ConfirmDialog and Sheet inside the canvas. */
export function useCanvasPortal(): HTMLElement | null {
  return useContext(PortalContext);
}

type ToolButtonProps = {
  icon?: IconName;
  label: string;
  /** Show the label next to the icon (a ghost Button) instead of only as a tooltip. */
  showLabel?: boolean;
  pressed?: boolean;
  danger?: boolean;
  children?: ReactNode;
  className?: string;
  ref?: Ref<HTMLButtonElement>;
} & Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, "aria-label">;

/**
 * A canvas tool: the shared IconButton with the canvas's line icon and a tooltip, or a ghost
 * Button with icon and text when `showLabel`. `nc-tool` keeps it 44px on any touch screen, the
 * large iPad included (the shared button turns compact from 1280px wide).
 */
export function ToolButton({
  icon,
  label,
  showLabel,
  pressed,
  danger,
  children,
  className,
  ...rest
}: ToolButtonProps) {
  if (showLabel)
    return (
      <Button
        variant={danger ? "ghostDanger" : "ghost"}
        aria-pressed={pressed}
        className={cn("nc-tool nc-tool-text", className)}
        {...rest}
      >
        {icon && <Icon name={icon} />}
        <span>{label}</span>
        {children}
      </Button>
    );
  return (
    <Tooltip content={label}>
      <IconButton
        label={label}
        pressed={pressed}
        // Bare: canvas tools sit inside the canvas's own bars, which are the edge.
        variant="bare"
        className={cn(
          "nc-tool",
          danger && "text-danger hover:bg-danger-soft hover:text-danger",
          className,
        )}
        {...rest}
      >
        {icon && <Icon name={icon} />}
        {children}
      </IconButton>
    </Tooltip>
  );
}
