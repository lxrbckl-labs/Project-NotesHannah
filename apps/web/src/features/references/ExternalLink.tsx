import { ExternalLink as ExternalIcon } from "lucide-react";
import type { AnchorHTMLAttributes, ReactNode } from "react";
import { cn } from "../../lib/cn";

/**
 * A link that leaves the app: a new tab, no opener and no referrer (the other site learns neither
 * this page nor the way back to it), a small "opens in a new tab" icon, and the same said to
 * screen readers.
 */
export function ExternalLink({
  href,
  children,
  className,
  icon = true,
  ...rest
}: Omit<AnchorHTMLAttributes<HTMLAnchorElement>, "target" | "rel"> & {
  href: string;
  children: ReactNode;
  /** Leave out the small icon when the surrounding control already shows one. */
  icon?: boolean;
}) {
  return (
    <a href={href} target="_blank" rel="noopener noreferrer" className={className} {...rest}>
      {children}
      {icon ? (
        <ExternalIcon size={14} aria-hidden className={cn("ml-1 inline shrink-0 align-[-2px]")} />
      ) : null}
      <span className="sr-only"> (opens in a new tab)</span>
    </a>
  );
}
