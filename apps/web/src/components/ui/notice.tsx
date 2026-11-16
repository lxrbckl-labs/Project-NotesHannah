import { CircleAlert, CircleCheck, Info, TriangleAlert } from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "../../lib/cn";
import type { Tone } from "../../lib/hues";
import { STATUS_TONE, type StatusTone } from "../../lib/roles";

const ICON: Partial<Record<StatusTone, ReactNode>> = {
  success: <CircleCheck size={18} />,
  warning: <TriangleAlert size={18} />,
  info: <Info size={18} />,
  danger: <CircleAlert size={18} />,
};

/**
 * An inline message in the flow of a page: a soft tinted box with an icon, an optional title,
 * the text and an optional action. Danger notices are announced (role="alert"); the rest are
 * plain text. For messages that come and go, use the toast instead.
 */
export function Notice({
  tone = "info",
  hue,
  icon,
  title,
  action,
  className,
  children,
}: {
  tone?: StatusTone;
  /** A palette hue instead of a semantic tone. */
  hue?: Tone;
  /** Replaces the tone's icon; pass null for none. */
  icon?: ReactNode | null;
  title?: ReactNode;
  action?: ReactNode;
  className?: string;
  children?: ReactNode;
}) {
  const shown = icon === undefined ? ICON[tone] : icon;
  return (
    <div
      role={tone === "danger" && !hue ? "alert" : undefined}
      data-hue={hue ?? STATUS_TONE[tone]}
      className={cn(
        "flex items-start gap-3 rounded-card border border-tone-border bg-tone-soft px-4 py-3 text-ui text-text",
        className,
      )}
    >
      {shown ? (
        <span aria-hidden className="mt-px shrink-0 text-tone-text">
          {shown}
        </span>
      ) : null}
      <div className="min-w-0 flex-1">
        {title ? <p className="font-semibold text-tone-text">{title}</p> : null}
        {children ? <div className={title ? "mt-0.5" : ""}>{children}</div> : null}
      </div>
      {action ? <div className="-my-1.5 shrink-0">{action}</div> : null}
    </div>
  );
}
