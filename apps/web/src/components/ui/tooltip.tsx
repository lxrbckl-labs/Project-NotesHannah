import { Tooltip as RadixTooltip } from "radix-ui";
import type { ReactNode } from "react";

/**
 * A short hint on hover or keyboard focus, for icon buttons on the computer layout. Touch
 * screens do not show tooltips, so never put anything here that is needed to use the app: the
 * control must already have an accessible name.
 */
export function Tooltip({
  content,
  side = "top",
  children,
  delay = 400,
}: {
  content: ReactNode;
  side?: "top" | "bottom" | "left" | "right";
  /** One focusable element. */
  children: ReactNode;
  delay?: number;
}) {
  return (
    <RadixTooltip.Provider delayDuration={delay} skipDelayDuration={200}>
      <RadixTooltip.Root>
        <RadixTooltip.Trigger asChild>{children}</RadixTooltip.Trigger>
        <RadixTooltip.Portal>
          <RadixTooltip.Content
            side={side}
            sideOffset={6}
            collisionPadding={8}
            className="anim-fade z-(--z-tooltip) max-w-64 rounded-control bg-text px-2.5 py-1.5 text-label font-medium text-bg shadow-pop"
          >
            {content}
          </RadixTooltip.Content>
        </RadixTooltip.Portal>
      </RadixTooltip.Root>
    </RadixTooltip.Provider>
  );
}
