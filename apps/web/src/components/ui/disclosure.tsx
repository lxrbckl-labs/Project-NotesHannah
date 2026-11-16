import { ChevronDown } from "lucide-react";
import { Collapsible } from "radix-ui";
import type { ReactNode } from "react";
import { cn } from "../../lib/cn";

/** A section that opens and closes: "Show working", "More options". */
export function Disclosure({
  label,
  children,
  defaultOpen = false,
  open,
  onOpenChange,
  className,
}: {
  label: ReactNode;
  children: ReactNode;
  defaultOpen?: boolean;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  className?: string;
}) {
  return (
    <Collapsible.Root
      defaultOpen={defaultOpen}
      {...(open !== undefined ? { open } : {})}
      {...(onOpenChange ? { onOpenChange } : {})}
      className={className}
    >
      <Collapsible.Trigger className="group flex min-h-11 w-full items-center justify-between gap-2 rounded-control px-1 text-left text-ui font-medium text-text-muted hover:text-text xl:min-h-9">
        <span>{label}</span>
        <ChevronDown
          size={16}
          aria-hidden
          className={cn(
            "shrink-0 transition-transform duration-(--duration-fast) group-data-[state=open]:rotate-180",
          )}
        />
      </Collapsible.Trigger>
      <Collapsible.Content>{children}</Collapsible.Content>
    </Collapsible.Root>
  );
}
