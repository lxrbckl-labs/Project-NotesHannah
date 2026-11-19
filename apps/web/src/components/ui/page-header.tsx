import { ArrowLeft } from "lucide-react";
import type { ReactNode } from "react";
import { Link } from "react-router";
import { cn } from "../../lib/cn";
import type { Tone } from "../../lib/hues";
import { backButtonClass } from "./button";
import { Tooltip } from "./tooltip";

/**
 * The top of a screen: an optional back link, an eyebrow, the title, a line of description and
 * the screen's actions. Actions wrap under the title on the phone.
 */
export function PageHeader({
  title,
  description,
  eyebrow,
  back,
  actions,
  art,
  icon,
  hue,
  className,
}: {
  title: ReactNode;
  description?: ReactNode;
  /** A small line above the title, e.g. the course name. */
  eyebrow?: ReactNode;
  /** Where the back arrow goes, and what it is called for screen readers. */
  back?: { to: string; label: string };
  actions?: ReactNode;
  /** A decorative drawing beside the title, shown from tablet width up (components/art/pills). */
  art?: ReactNode;
  /** An icon in a tinted square beside the title. */
  icon?: ReactNode;
  hue?: Tone | undefined;
  className?: string;
}) {
  return (
    <header className={cn("mb-6 flex flex-wrap items-start gap-x-4 gap-y-3", className)}>
      {back ? (
        <Tooltip content={back.label}>
          <Link to={back.to} aria-label={back.label} className={backButtonClass}>
            <ArrowLeft size={20} aria-hidden />
          </Link>
        </Tooltip>
      ) : null}
      {icon ? (
        <div
          data-hue={hue ?? "accent"}
          aria-hidden
          className="flex size-11 shrink-0 items-center justify-center rounded-card bg-tone-soft text-tone-text [&_svg]:size-5"
        >
          {icon}
        </div>
      ) : null}
      <div className="min-w-0 flex-1 basis-60">
        {eyebrow ? (
          <p className="mb-0.5 truncate text-label font-medium text-text-muted">{eyebrow}</p>
        ) : null}
        <h1 className="font-display text-heading font-semibold md:text-display">{title}</h1>
        {description ? (
          <p className="mt-1 max-w-prose text-ui text-text-muted">{description}</p>
        ) : null}
      </div>
      {art ? <div className="self-center max-md:hidden">{art}</div> : null}
      {actions ? (
        // On a phone the actions take a row of their own at full width, so a button can fill it (`max-md:w-full`).
        <div className="flex flex-wrap items-center gap-2 max-md:w-full">{actions}</div>
      ) : null}
    </header>
  );
}
