import { useCallback, useEffect, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router";
import {
  activateTab,
  canOpen,
  closeTab,
  HOME,
  inAppPath,
  initialTabs,
  openTab,
  parseTabs,
  setActivePath,
  setTitle,
  type TabsState,
} from "./model";

const key = (userId: string) => `notes-tabs:${userId}`;

function load(userId: string, here: string): TabsState {
  let saved: TabsState | null = null;
  try {
    saved = parseTabs(localStorage.getItem(key(userId)));
  } catch {
    // Blocked storage: tabs then last only as long as the window.
  }
  // The address she opened wins: the tab that was on screen moves to it.
  return saved ? setActivePath(saved, here) : initialTabs(here);
}

/** The scrolling area of the shell (AppShell's <main>). */
const scroller = () => document.getElementById("main");

/**
 * Her open tabs (model.ts), kept in step with the address bar and remembered in this browser, per
 * account. One instance, in the shell. `enabled` is off on a phone: one page at a time there.
 */
export function useTabs(userId: string | undefined, enabled: boolean) {
  const location = useLocation();
  const navigate = useNavigate();
  const here = location.pathname + location.search + location.hash;
  const [state, setState] = useState<TabsState>(() => initialTabs(here));
  const stateRef = useRef(state);
  stateRef.current = state;
  const loadedFor = useRef<string | null>(null);
  /** Where each tab was scrolled to when she left it. */
  const scroll = useRef(new Map<string, number>());
  const restore = useRef<string | null>(null);

  const apply = useCallback((next: TabsState) => {
    stateRef.current = next;
    setState(next);
  }, []);

  // Her saved tabs, once the account is known.
  // biome-ignore lint/correctness/useExhaustiveDependencies: read once per account, at the address of that moment
  useEffect(() => {
    if (!userId || loadedFor.current === userId) return;
    loadedFor.current = userId;
    apply(load(userId, here));
  }, [userId]);

  useEffect(() => {
    if (!userId || loadedFor.current !== userId) return;
    try {
      localStorage.setItem(key(userId), JSON.stringify(state));
    } catch {
      // ignore
    }
  }, [state, userId]);

  // The address changed: the active tab is now there. After a tab change, put its scroll position back.
  useEffect(() => {
    apply(setActivePath(stateRef.current, here));
    const id = restore.current;
    restore.current = null;
    const top = id ? scroll.current.get(id) : undefined;
    if (!top) return;
    // The page may still be loading its content: keep trying for a moment, until it is tall enough.
    let tries = 0;
    let frame = 0;
    const attempt = () => {
      const el = scroller();
      if (el) {
        el.scrollTop = top;
        if (Math.abs(el.scrollTop - top) < 2 || tries++ > 90) return;
      }
      frame = requestAnimationFrame(attempt);
    };
    frame = requestAnimationFrame(attempt);
    return () => cancelAnimationFrame(frame);
  }, [here, apply]);

  // The tab's name: the page's own heading, as soon as it has one.
  // biome-ignore lint/correctness/useExhaustiveDependencies: start again on every page and tab change
  useEffect(() => {
    if (!enabled) return;
    const el = scroller();
    if (!el) return;
    const id = stateRef.current.active;
    const read = () => {
      const heading = el.querySelector("h1")?.textContent;
      if (heading && stateRef.current.active === id) apply(setTitle(stateRef.current, id, heading));
    };
    read();
    const observer = new MutationObserver(read);
    observer.observe(el, { childList: true, subtree: true, characterData: true });
    return () => observer.disconnect();
  }, [here, state.active, enabled, apply]);

  const leave = useCallback(() => {
    const el = scroller();
    if (el) scroll.current.set(stateRef.current.active, el.scrollTop);
  }, []);

  const select = useCallback(
    (id: string) => {
      const tab = stateRef.current.tabs.find((t) => t.id === id);
      if (!tab || id === stateRef.current.active) return;
      leave();
      restore.current = id;
      apply(activateTab(stateRef.current, id));
      navigate(tab.path);
    },
    [apply, leave, navigate],
  );

  const open = useCallback(
    (path: string = HOME, options: { title?: string; activate?: boolean } = {}) => {
      const before = stateRef.current;
      if (!canOpen(before)) return;
      if (options.activate !== false) leave();
      apply(openTab(before, path, options));
      if (options.activate !== false) navigate(path);
    },
    [apply, leave, navigate],
  );

  const close = useCallback(
    (id: string) => {
      const before = stateRef.current;
      const next = closeTab(before, id);
      if (next === before) return;
      scroll.current.delete(id);
      apply(next);
      if (next.active !== before.active) {
        restore.current = next.active;
        const tab = next.tabs.find((t) => t.id === next.active);
        if (tab) navigate(tab.path);
      }
    },
    [apply, navigate],
  );

  // Command or Control and a click, or the middle button, on a link to a page of the app: open it in a tab
  // here, behind the current page, instead of a new browser tab.
  useEffect(() => {
    if (!enabled) return;
    const onClick = (event: MouseEvent) => {
      const middle = event.type === "auxclick" && event.button === 1;
      const withKey =
        event.type === "click" && event.button === 0 && (event.metaKey || event.ctrlKey);
      if (!middle && !withKey) return;
      if (event.defaultPrevented || event.shiftKey || event.altKey) return;
      const anchor = (event.target as Element | null)?.closest?.(
        "a[href]",
      ) as HTMLAnchorElement | null;
      if (!anchor || anchor.target === "_blank" || anchor.hasAttribute("download")) return;
      const path = inAppPath(anchor.href, window.location.origin);
      if (!path || !canOpen(stateRef.current)) return;
      event.preventDefault();
      event.stopPropagation();
      const name = (anchor.getAttribute("aria-label") ?? anchor.textContent ?? "").trim();
      open(path, {
        activate: false,
        title: name.length > 0 && name.length <= 80 ? name : undefined,
      });
    };
    document.addEventListener("click", onClick, true);
    document.addEventListener("auxclick", onClick, true);
    return () => {
      document.removeEventListener("click", onClick, true);
      document.removeEventListener("auxclick", onClick, true);
    };
  }, [enabled, open]);

  return { tabs: state.tabs, active: state.active, canOpen: canOpen(state), select, open, close };
}

export type TabsApi = ReturnType<typeof useTabs>;
