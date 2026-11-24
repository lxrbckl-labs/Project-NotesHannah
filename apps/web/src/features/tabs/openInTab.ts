/**
 * Ask the shell to open a page of the app in a new tab and show it (features/tabs/useTabs.ts listens).
 * For code that is not inside the shell's tree of hooks, such as the document viewer, which also runs on
 * its own demo page. On a phone, where there are no tabs, the shell goes to the page instead. With no
 * shell at all (the demo page) the browser goes there.
 */
export const OPEN_TAB_EVENT = "notes:open-tab";

export interface OpenTabDetail {
  path: string;
  title?: string;
  /** Set by the shell when it took the request. */
  handled?: boolean;
}

export function openInTab(path: string, title?: string): void {
  const detail: OpenTabDetail = { path, ...(title ? { title } : {}) };
  window.dispatchEvent(new CustomEvent<OpenTabDetail>(OPEN_TAB_EVENT, { detail }));
  if (!detail.handled) window.location.assign(path);
}
