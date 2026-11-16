import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useMediaQuery } from "../../ui/hooks";
import {
  arrange,
  type DockState,
  defaultDock,
  type LayoutClass,
  openPanel,
  type PanelId,
  parseDock,
  type Side,
  type SidebarMode,
  sideOf,
  storageKey,
} from "./layout";

/** Phone under 768 wide; computer from 1280; an iPad (or a narrow window) in between, either way up. */
export function useLayoutClass(): LayoutClass {
  const computer = useMediaQuery("(min-width: 1280px)");
  const tablet = useMediaQuery("(min-width: 768px)");
  const landscape = useMediaQuery("(orientation: landscape)");
  if (computer) return "computer";
  if (!tablet) return "phone";
  return landscape ? "tablet-landscape" : "tablet-portrait";
}

function load(layout: LayoutClass): DockState {
  try {
    const raw = localStorage.getItem(storageKey(layout));
    return raw ? parseDock(JSON.parse(raw), layout) : defaultDock(layout);
  } catch {
    // No storage (a private window, blocked site data): the defaults still work.
    return defaultDock(layout);
  }
}

function save(layout: LayoutClass, state: DockState) {
  try {
    localStorage.setItem(storageKey(layout), JSON.stringify(state));
  } catch {
    // Not remembered, but nothing breaks.
  }
}

export interface DockApi {
  layout: LayoutClass;
  state: DockState;
  modes: Record<Side, SidebarMode>;
  /** The sidebar shown as an overlay over the page (when it does not fit beside it), or null. */
  peek: Side | null;
  setPeek: (side: Side | null) => void;
  update: (change: (state: DockState) => DockState) => void;
  /**
   * Take a new arrangement after a move: the sidebar a panel landed in shows (as the overlay when it
   * cannot sit beside the page), and an overlay left empty closes.
   */
  commit: (next: DockState, landed?: Side) => void;
  /** Whether a sidebar is on screen, docked or as the overlay. */
  showing: (side: Side) => boolean;
  /** Show or hide a sidebar from the bar's buttons. */
  toggleSide: (side: Side) => void;
  /** Make sure a panel is on screen (opening, unfolding or peeking its sidebar as needed). */
  reveal: (id: PanelId) => void;
  /** The panel's sidebar is on screen and the panel is in it. */
  visible: (id: PanelId) => boolean;
  reset: () => void;
  /** Width of the area the sidebars and the page share. */
  setAvailable: (width: number) => void;
}

/**
 * The document page's sidebars: the arrangement she chose (remembered per kind of screen, not per
 * document), and how it fits the space there is right now.
 */
export function useDock(): DockApi {
  const layout = useLayoutClass();
  const [state, setState] = useState(() => load(layout));
  const [peek, setPeek] = useState<Side | null>(null);
  const [available, setAvailableState] = useState(0);
  const loadedFor = useRef(layout);

  // Turning the iPad round (or resizing a window across a breakpoint) brings back that layout's arrangement.
  useEffect(() => {
    if (loadedFor.current === layout) return;
    loadedFor.current = layout;
    setState(load(layout));
    setPeek(null);
  }, [layout]);

  const update = useCallback(
    (change: (s: DockState) => DockState) =>
      setState((s) => {
        const next = change(s);
        if (next !== s) save(loadedFor.current, next);
        return next;
      }),
    [],
  );

  // Before the first measurement, assume the window's width so the first paint is close.
  const width = available || (typeof window === "undefined" ? 1280 : window.innerWidth);
  const modes = useMemo(() => arrange(state, layout, width), [state, layout, width]);

  // An overlay closes when its sidebar can dock again or is emptied.
  useEffect(() => {
    if (peek && modes[peek] !== "auto") setPeek(null);
  }, [peek, modes]);

  const showing = useCallback(
    (side: Side) => modes[side] === "docked" || (modes[side] === "auto" && peek === side),
    [modes, peek],
  );

  const toggleSide = useCallback(
    (side: Side) => {
      if (modes[side] === "docked") {
        update((s) => ({ ...s, [side]: { ...s[side], collapsed: true } }));
        return;
      }
      if (modes[side] === "auto") {
        setPeek((p) => (p === side ? null : side));
        return;
      }
      // Hidden: unfold it; if it then would not fit, it shows as the overlay.
      const opened: DockState = { ...state, [side]: { ...state[side], collapsed: false } };
      if (opened[side].panels.length === 0) return;
      update(() => opened);
      if (arrange(opened, layout, width)[side] === "auto") setPeek(side);
    },
    [modes, state, layout, width, update],
  );

  const commit = useCallback(
    (next: DockState, landed?: Side) => {
      update(() => next);
      const fit = arrange(next, layout, width);
      if (landed && fit[landed] === "auto") setPeek(landed);
      else setPeek((p) => (p && fit[p] !== "auto" ? null : p));
    },
    [layout, width, update],
  );

  const reveal = useCallback(
    (id: PanelId) => {
      const next = openPanel(state, id);
      update(() => next);
      const side = sideOf(next, id);
      if (side && arrange(next, layout, width)[side] === "auto") setPeek(side);
    },
    [state, layout, width, update],
  );

  const visible = useCallback(
    (id: PanelId) => {
      const side = sideOf(state, id);
      return side !== null && showing(side);
    },
    [state, showing],
  );

  const reset = useCallback(() => {
    update(() => defaultDock(layout));
    setPeek(null);
  }, [layout, update]);

  const setAvailable = useCallback(
    (w: number) => setAvailableState((old) => (Math.abs(old - w) < 1 ? old : w)),
    [],
  );

  return {
    layout,
    state,
    modes,
    peek,
    setPeek,
    update,
    commit,
    showing,
    toggleSide,
    reveal,
    visible,
    reset,
    setAvailable,
  };
}
