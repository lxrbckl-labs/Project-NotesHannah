/** Which way the page slides when she taps a tab: towards the side the tapped tab sits on. */
export type TabDirection = "forward" | "back" | "none";

/** The tab a path belongs to, or -1 for a screen that is under none of them (a document, the guide). */
export function tabIndex(tabs: readonly string[], pathname: string): number {
  return tabs.findIndex((to) => pathname === to || pathname.startsWith(`${to}/`));
}

/**
 * "forward" when the tapped tab is to the right of the one she is on (the new page comes in from the
 * right), "back" when it is to the left, "none" when it is the same tab. `tabs` is the paths in the order
 * the bar shows them, which is hers to choose. A screen under no tab counts as the library, wherever she has
 * put it, since that is where those screens are reached from.
 */
export function tabDirection(tabs: readonly string[], from: string, to: string): TabDirection {
  const found = tabIndex(tabs, from);
  const current = found >= 0 ? found : Math.max(0, tabs.indexOf("/library"));
  const target = tabIndex(tabs, to);
  if (target < 0 || target === current) return "none";
  return target > current ? "forward" : "back";
}
