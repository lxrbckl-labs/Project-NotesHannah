/**
 * Open tabs: several pages of the app kept side by side in one window, so she can hold a lecture note
 * open while she looks something else up. Each tab remembers the address it was last on. This file is
 * the rules only (no React, no storage).
 */
export interface Tab {
  id: string;
  /** Path, query and hash: where this tab was last. */
  path: string;
  title: string;
}

export interface TabsState {
  tabs: Tab[];
  /** The id of the tab on screen. Always one of `tabs`. */
  active: string;
}

/** More than this and the strip is unreadable; a new tab is refused instead. */
export const MAX_TABS = 12;
export const HOME = "/library";

const SECTION_TITLES: Record<string, string> = {
  library: "Library",
  practice: "Practice",
  exams: "Exams",
  calendar: "Calendar",
  search: "Search",
  inbox: "Inbox",
  settings: "Settings",
  help: "Guide",
  references: "References",
  activity: "Activity",
  requests: "Requests",
  concepts: "Concepts",
  trash: "Trash",
  doc: "Document",
  files: "File",
  question: "Question",
  design: "Design",
};

/** A name for a page before its own heading is known. */
export function titleForPath(path: string): string {
  const first = path.split(/[?#]/)[0]?.split("/").filter(Boolean)[0] ?? "";
  return SECTION_TITLES[first] ?? "Notes";
}

function nextId(tabs: readonly Tab[]): string {
  const used = tabs.map((t) => Number(t.id.slice(1))).filter(Number.isFinite);
  return `t${Math.max(0, ...used) + 1}`;
}

export function initialTabs(path: string): TabsState {
  return { tabs: [{ id: "t1", path, title: titleForPath(path) }], active: "t1" };
}

export function canOpen(state: TabsState): boolean {
  return state.tabs.length < MAX_TABS;
}

/**
 * A new tab, placed right after the active one. `activate: false` opens it behind the page she is on.
 * At the limit nothing changes.
 */
export function openTab(
  state: TabsState,
  path: string,
  options: { title?: string; activate?: boolean } = {},
): TabsState {
  if (!canOpen(state)) return state;
  const tab: Tab = {
    id: nextId(state.tabs),
    path,
    title: options.title?.trim() || titleForPath(path),
  };
  const at = state.tabs.findIndex((t) => t.id === state.active) + 1;
  const tabs = [...state.tabs.slice(0, at), tab, ...state.tabs.slice(at)];
  return { tabs, active: options.activate === false ? state.active : tab.id };
}

/** Closes a tab. The last tab cannot be closed. Closing the active one shows its right neighbour, else the left. */
export function closeTab(state: TabsState, id: string): TabsState {
  const index = state.tabs.findIndex((t) => t.id === id);
  if (index < 0 || state.tabs.length === 1) return state;
  const tabs = state.tabs.filter((t) => t.id !== id);
  if (state.active !== id) return { tabs, active: state.active };
  const next = tabs[index] ?? tabs[index - 1];
  return { tabs, active: (next as Tab).id };
}

export function activateTab(state: TabsState, id: string): TabsState {
  return state.tabs.some((t) => t.id === id) && state.active !== id
    ? { ...state, active: id }
    : state;
}

/** The active tab moved to a new address (she followed a link inside it). */
export function setActivePath(state: TabsState, path: string): TabsState {
  const tab = state.tabs.find((t) => t.id === state.active);
  if (!tab || tab.path === path) return state;
  // A new page: its old heading no longer applies.
  const samePage = tab.path.split(/[?#]/)[0] === path.split(/[?#]/)[0];
  return {
    ...state,
    tabs: state.tabs.map((t) =>
      t.id === tab.id ? { ...t, path, title: samePage ? t.title : titleForPath(path) } : t,
    ),
  };
}

export function setTitle(state: TabsState, id: string, title: string): TabsState {
  const clean = title.replace(/\s+/g, " ").trim().slice(0, 80);
  const tab = state.tabs.find((t) => t.id === id);
  if (!tab || !clean || tab.title === clean) return state;
  return { ...state, tabs: state.tabs.map((t) => (t.id === id ? { ...t, title: clean } : t)) };
}

/** What was saved in the browser, checked piece by piece; anything odd is dropped. */
export function parseTabs(raw: string | null): TabsState | null {
  if (!raw) return null;
  try {
    const value = JSON.parse(raw) as { tabs?: unknown; active?: unknown };
    if (!Array.isArray(value.tabs)) return null;
    const tabs: Tab[] = [];
    for (const t of value.tabs as Array<Partial<Tab>>) {
      if (
        typeof t?.id === "string" &&
        /^t\d+$/.test(t.id) &&
        typeof t.path === "string" &&
        t.path.startsWith("/") &&
        !t.path.startsWith("//") &&
        typeof t.title === "string" &&
        !tabs.some((x) => x.id === t.id)
      ) {
        tabs.push({ id: t.id, path: t.path, title: t.title.slice(0, 80) });
      }
    }
    if (tabs.length === 0) return null;
    const kept = tabs.slice(0, MAX_TABS);
    const active = kept.some((t) => t.id === value.active) ? (value.active as string) : kept[0]?.id;
    return active ? { tabs: kept, active } : null;
  } catch {
    return null;
  }
}

/**
 * A link she asked to open in a new tab (Command or Control and a click, or the middle button): the in-app
 * address it leads to, or null when the link is not a page of this app.
 */
export function inAppPath(href: string, origin: string): string | null {
  let url: URL;
  try {
    url = new URL(href, origin);
  } catch {
    return null;
  }
  if (url.origin !== origin) return null;
  if (url.pathname.startsWith("/api/") || url.pathname === "/login" || url.pathname === "/mcp") {
    return null;
  }
  return url.pathname + url.search + url.hash;
}
