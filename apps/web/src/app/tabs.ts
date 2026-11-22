import type { TabId } from "@notes/schema";
import type { LucideIcon } from "lucide-react";
import { ICON } from "../features/library/NodeIcon";

/**
 * The phone's bottom tabs, by id. Six: the things she opens most (Calendar joined on 2026-11-17). Requests, Activity, Trash and the
 * Guide live in Settings. The order they show in is hers (Settings, "Tab bar"); the ids are in the schema.
 */
export const TAB_DEFS: Record<TabId, { to: string; label: string; icon: LucideIcon }> = {
  library: { to: "/library", label: "Library", icon: ICON.library },
  practice: { to: "/practice", label: "Practice", icon: ICON.practice },
  calendar: { to: "/calendar", label: "Calendar", icon: ICON.calendar },
  search: { to: "/search", label: "Search", icon: ICON.search },
  inbox: { to: "/inbox", label: "Inbox", icon: ICON.inbox },
  settings: { to: "/settings", label: "Settings", icon: ICON.settings },
};

/** The paths in the order shown: what the slide direction is measured against. */
export function tabPaths(order: readonly TabId[]): string[] {
  return order.map((id) => TAB_DEFS[id].to);
}

/** The order with one tab taken out and put at `to` (clamped); the others keep their order. */
export function moveTab(order: readonly TabId[], id: TabId, to: number): TabId[] {
  const from = order.indexOf(id);
  if (from < 0) return [...order];
  const without = order.filter((x) => x !== id);
  const at = Math.max(0, Math.min(order.length - 1, to));
  return [...without.slice(0, at), id, ...without.slice(at)];
}

/**
 * Which slot a dragged tab is over: its left edge started in `startIndex`, it has moved `dx` pixels, and
 * every slot is `slotWidth` wide. Clamped to the bar.
 */
export function slotAt(startIndex: number, dx: number, slotWidth: number, count: number): number {
  if (slotWidth <= 0) return startIndex;
  return Math.max(0, Math.min(count - 1, Math.round(startIndex + dx / slotWidth)));
}

export function sameOrder(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((id, i) => id === b[i]);
}
