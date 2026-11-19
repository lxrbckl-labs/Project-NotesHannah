/**
 * The arrangement of the document page's side panels (P5): which panel sits in which sidebar, in
 * what order, how wide each sidebar is and whether it is collapsed. Pure functions, so the rules
 * are tested without a browser; `useDock` keeps the state and remembers it per device.
 */

export const PANEL_IDS = ["outline", "resources", "notes"] as const;
export type PanelId = (typeof PANEL_IDS)[number];
export type Side = "left" | "right";
export const SIDES: readonly Side[] = ["left", "right"];

/**
 * Remembered separately: a computer, an iPad held either way and a phone want different things,
 * and the same iPad turned round should not undo what she set for the other way.
 */
export type LayoutClass = "computer" | "tablet-landscape" | "tablet-portrait" | "phone";

export interface SidebarState {
  /** Panels in this sidebar, top to bottom. */
  panels: PanelId[];
  /** Folded away by her (or by default); the panels keep their place. */
  collapsed: boolean;
  width: number;
}

export interface DockState {
  left: SidebarState;
  right: SidebarState;
  /** Panels folded to just their header inside a stack. */
  folded: PanelId[];
  /**
   * Each panel's share of its sidebar's height, once she has dragged the line between two panels.
   * A plain weight (the height in pixels at the time), so the shares hold when the window changes
   * size. A panel with no entry takes its usual share.
   */
  sizes?: Partial<Record<PanelId, number>>;
}

/** The share a panel takes until she resizes it: side notes line up with the page, so they get more. */
export const DEFAULT_PANEL_SHARE: Record<PanelId, number> = { outline: 2, resources: 2, notes: 3 };
/** The least height a panel can be dragged to. */
export const MIN_PANEL_HEIGHT = 96;

/** Give some panels new shares (their heights in pixels), keeping the others as they are. */
export function setPanelSizes(
  state: DockState,
  sizes: Partial<Record<PanelId, number>>,
): DockState {
  const next: Partial<Record<PanelId, number>> = { ...state.sizes };
  for (const id of PANEL_IDS) {
    const value = sizes[id];
    if (typeof value === "number" && Number.isFinite(value) && value > 0) {
      next[id] = Math.round(value);
    }
  }
  return { ...state, sizes: next };
}

/** Forget the dragged shares of the panels in one sidebar: back to the usual split. */
export function resetPanelSizes(state: DockState, side: Side): DockState {
  const next: Partial<Record<PanelId, number>> = { ...state.sizes };
  for (const id of state[side].panels) delete next[id];
  return { ...state, sizes: next };
}

/** Sidebar widths she can drag between. */
export const SIDEBAR_WIDTH = { min: 240, max: 440 } as const;
/**
 * The narrowest page column a sidebar may leave beside it. About 60 characters of reading text
 * after the page's own margins; below that a sidebar floats over the page instead of squeezing it.
 */
export const MIN_COLUMN = 460;

/** Where a panel goes when it is opened again after being closed. */
export const HOME_SIDE: Record<PanelId, Side> = {
  outline: "left",
  resources: "right",
  notes: "right",
};

export function defaultDock(layout: LayoutClass): DockState {
  switch (layout) {
    case "computer":
      return {
        left: { panels: ["outline"], collapsed: false, width: 248 },
        // Notes on top: they sit level with the page, so they want the sidebar's upper part.
        right: { panels: ["notes", "resources"], collapsed: false, width: 320 },
        folded: [],
      };
    case "tablet-landscape":
      return {
        left: { panels: ["outline"], collapsed: true, width: 260 },
        right: { panels: ["notes"], collapsed: false, width: 288 },
        folded: [],
      };
    case "tablet-portrait":
      return {
        left: { panels: ["outline"], collapsed: true, width: 300 },
        right: { panels: ["notes"], collapsed: true, width: 320 },
        folded: [],
      };
    case "phone":
      // No sidebars on a phone: the panels open in a bottom sheet. Kept for a phone turned sideways.
      return {
        left: { panels: ["outline"], collapsed: true, width: 260 },
        right: { panels: ["resources", "notes"], collapsed: true, width: 300 },
        folded: [],
      };
  }
}

const clampWidth = (w: number) =>
  Math.round(Math.max(SIDEBAR_WIDTH.min, Math.min(SIDEBAR_WIDTH.max, w)));

export function sideOf(state: DockState, id: PanelId): Side | null {
  if (state.left.panels.includes(id)) return "left";
  if (state.right.panels.includes(id)) return "right";
  return null;
}

export function closedPanels(state: DockState): PanelId[] {
  return PANEL_IDS.filter((id) => sideOf(state, id) === null);
}

function without(state: DockState, id: PanelId): DockState {
  return {
    ...state,
    left: { ...state.left, panels: state.left.panels.filter((p) => p !== id) },
    right: { ...state.right, panels: state.right.panels.filter((p) => p !== id) },
  };
}

/** Put a panel in a sidebar at an index (clamped), taking it out of wherever it was. Opens that sidebar. */
export function movePanel(state: DockState, id: PanelId, side: Side, index: number): DockState {
  const from = sideOf(state, id);
  const fromIndex = from ? state[from].panels.indexOf(id) : -1;
  const next = without(state, id);
  // Moving down within one sidebar: the index was counted with the panel still in place.
  const at = from === side && fromIndex >= 0 && fromIndex < index ? index - 1 : index;
  const panels = [...next[side].panels];
  panels.splice(Math.max(0, Math.min(at, panels.length)), 0, id);
  return { ...next, [side]: { ...next[side], panels, collapsed: false } };
}

/** One step up or down in its own sidebar. */
export function movePanelBy(state: DockState, id: PanelId, delta: -1 | 1): DockState {
  const side = sideOf(state, id);
  if (!side) return state;
  const panels = [...state[side].panels];
  const i = panels.indexOf(id);
  const j = i + delta;
  if (j < 0 || j >= panels.length) return state;
  [panels[i], panels[j]] = [panels[j] as PanelId, panels[i] as PanelId];
  return { ...state, [side]: { ...state[side], panels } };
}

export function closePanel(state: DockState, id: PanelId): DockState {
  return without(state, id);
}

/** Show a panel: back in its home sidebar if it was closed, and its sidebar unfolded. */
export function openPanel(state: DockState, id: PanelId): DockState {
  const side = sideOf(state, id);
  const unfold = { ...state, folded: state.folded.filter((p) => p !== id) };
  if (side) return { ...unfold, [side]: { ...unfold[side], collapsed: false } };
  const home = HOME_SIDE[id];
  return movePanel(unfold, id, home, unfold[home].panels.length);
}

export function setCollapsed(state: DockState, side: Side, collapsed: boolean): DockState {
  return { ...state, [side]: { ...state[side], collapsed } };
}

export function setWidth(state: DockState, side: Side, width: number): DockState {
  return { ...state, [side]: { ...state[side], width: clampWidth(width) } };
}

export function toggleFolded(state: DockState, id: PanelId): DockState {
  return {
    ...state,
    folded: state.folded.includes(id)
      ? state.folded.filter((p) => p !== id)
      : [...state.folded, id],
  };
}

/**
 * How each sidebar shows:
 * - "docked": beside the page, taking its width;
 * - "auto": she wants it open but the page would get too narrow, so it waits folded away and opens
 *   as an overlay when she asks for it;
 * - "hidden": collapsed by her, or empty.
 * On a phone both are hidden (the bottom sheet takes over); an iPad held upright never docks.
 * When both do not fit, the left one gives way first: the outline matters least while reading.
 */
export type SidebarMode = "docked" | "auto" | "hidden";

export function arrange(
  state: DockState,
  layout: LayoutClass,
  available: number,
): Record<Side, SidebarMode> {
  const wants = (side: Side) => state[side].panels.length > 0 && !state[side].collapsed;
  if (layout === "phone") return { left: "hidden", right: "hidden" };
  if (layout === "tablet-portrait") {
    return {
      left: wants("left") ? "auto" : "hidden",
      right: wants("right") ? "auto" : "hidden",
    };
  }
  const width = (side: Side) => (wants(side) ? state[side].width : 0);
  const fits = (w: number) => available - w >= MIN_COLUMN;
  let left: SidebarMode = wants("left") ? "docked" : "hidden";
  let right: SidebarMode = wants("right") ? "docked" : "hidden";
  if (!fits(width("left") + width("right"))) {
    if (left === "docked") left = "auto";
    if (right === "docked" && !fits(width("right"))) right = "auto";
  }
  if (left === "docked" && right !== "docked" && !fits(width("left"))) left = "auto";
  return { left, right };
}

/** Read a remembered arrangement, keeping only what still makes sense (panels known, each once). */
export function parseDock(raw: unknown, layout: LayoutClass): DockState {
  const fallback = defaultDock(layout);
  if (!raw || typeof raw !== "object") return fallback;
  const r = raw as Partial<Record<keyof DockState, unknown>>;
  const seen = new Set<PanelId>();
  const side = (value: unknown, base: SidebarState): SidebarState => {
    if (!value || typeof value !== "object") return base;
    const v = value as Partial<Record<keyof SidebarState, unknown>>;
    const panels: PanelId[] = [];
    for (const p of Array.isArray(v.panels) ? v.panels : base.panels) {
      if (!(PANEL_IDS as readonly unknown[]).includes(p) || seen.has(p as PanelId)) continue;
      seen.add(p as PanelId);
      panels.push(p as PanelId);
    }
    return {
      panels,
      collapsed: typeof v.collapsed === "boolean" ? v.collapsed : base.collapsed,
      width:
        typeof v.width === "number" && Number.isFinite(v.width) ? clampWidth(v.width) : base.width,
    };
  };
  const left = side(r.left, fallback.left);
  const right = side(r.right, fallback.right);
  const folded = Array.isArray(r.folded)
    ? (r.folded.filter((p) => (PANEL_IDS as readonly unknown[]).includes(p)) as PanelId[])
    : [];
  const sizes: Partial<Record<PanelId, number>> = {};
  if (r.sizes && typeof r.sizes === "object") {
    for (const id of PANEL_IDS) {
      const value = (r.sizes as Record<string, unknown>)[id];
      if (typeof value === "number" && Number.isFinite(value) && value > 0) sizes[id] = value;
    }
  }
  return { left, right, folded, sizes };
}

export const storageKey = (layout: LayoutClass) => `notes.sidebars.v1.${layout}`;
