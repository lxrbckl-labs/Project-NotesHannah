import type { ReactElement, ReactNode } from "react";
import { useHotkeyHint } from "../../features/hotkeys/HotkeyProvider";
import WarmTooltip, { WarmTooltipGroup } from "../bits/WarmTooltip";

/**
 * A short hint on hover, keyboard focus or a long press: the name of a button that is only an icon.
 * It is React Bits' Warm Tooltip (components/bits/WarmTooltip.tsx): the first hint waits a moment,
 * and while she keeps moving along a row of buttons the next ones open at once.
 *
 * Never put anything here that is needed to use the app: the control must already have an
 * accessible name. `IconButton` and the action bar's buttons add this themselves from their label,
 * so reach for it directly only for an icon-only control built by hand.
 */
export function Tooltip({
  content,
  side = "top",
  children,
  delay,
  shortcut: given,
  hotkey,
}: {
  content: ReactNode;
  side?: "top" | "bottom" | "left" | "right";
  /** One focusable element. */
  children: ReactNode;
  delay?: number;
  /** A keyboard shortcut shown beside the words, e.g. "⌘K". */
  shortcut?: ReactNode;
  /**
   * A hotkey id from the registry (features/hotkeys/registry.ts): its key is shown beside the words
   * while badges are on, on the computer layout, and only where the key works.
   */
  hotkey?: string | undefined;
}) {
  const hint = useHotkeyHint(hotkey);
  const shortcut = given ?? hint;
  return (
    <WarmTooltip
      content={content}
      side={side}
      size="sm"
      // Inverted against the page, like a label: the text color as the surface, the page color as the ink.
      surfaceColor="var(--color-text)"
      inkColor="var(--color-bg)"
      {...(delay === undefined ? {} : { delay })}
      {...(shortcut === undefined ? {} : { shortcut })}
    >
      {children as ReactElement<Record<string, unknown>>}
    </WarmTooltip>
  );
}

/**
 * One shared "warmth" for a part of the screen: put it once around the app, so moving from one icon
 * button to another, anywhere, opens the next hint without the wait.
 */
export function TooltipGroup({ children }: { children: ReactNode }) {
  return (
    <WarmTooltipGroup delay={450} warmWindow={400}>
      {children}
    </WarmTooltipGroup>
  );
}

/**
 * A hint that exists only to show a hotkey: for a control that already shows its words (Read, Edit),
 * where an inline badge would crowd a tight bar. With no key to show (badges off, not on a computer, or
 * the key does nothing here) it is just the control.
 */
export function HotkeyTooltip({
  hotkey,
  content,
  side,
  children,
}: {
  hotkey: string;
  content: ReactNode;
  side?: "top" | "bottom" | "left" | "right";
  children: ReactNode;
}) {
  const hint = useHotkeyHint(hotkey);
  if (!hint) return children;
  return (
    <Tooltip content={content} side={side} shortcut={hint}>
      {children}
    </Tooltip>
  );
}
