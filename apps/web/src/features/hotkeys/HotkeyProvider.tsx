import {
  createContext,
  type ReactNode,
  use,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { Dispatcher } from "./dispatch";
import { ariaKeys, HOTKEY_BY_ID, hotkeyText } from "./registry";

interface HotkeyState {
  /** Keys work (every layout but the phone). */
  enabled: boolean;
  /** Badges and hints show (the computer layout, and her setting). */
  badges: boolean;
  /** The ids that have a handler on screen now. */
  active: ReadonlySet<string>;
}

const DispatcherContext = createContext<Dispatcher | null>(null);
const NONE: ReadonlySet<string> = new Set();
const StateContext = createContext<HotkeyState>({ enabled: false, badges: false, active: NONE });

/**
 * The one window keydown listener for app-level shortcuts. It hands each key to whichever screen has
 * registered that hotkey (`useHotkey`), by the rules in dispatch.ts. Outside this provider (a module's
 * own tests, the print page) `useHotkey` does nothing and no badge shows.
 */
export function HotkeyProvider({
  enabled,
  badges,
  children,
}: {
  enabled: boolean;
  badges: boolean;
  children: ReactNode;
}) {
  const [dispatcher] = useState(() => new Dispatcher());
  const active = useSyncExternalStore(
    (notify) => dispatcher.subscribe(notify),
    () => dispatcher.active,
    () => dispatcher.active,
  );
  const on = useRef(enabled);
  on.current = enabled;
  // Added once, before any screen's own listener (the canvas, the practice player), so a key the app
  // handles is stopped before those see it. Whether keys work is read at the moment of the key.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (on.current) dispatcher.handle(event);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [dispatcher]);
  return (
    <DispatcherContext value={dispatcher}>
      <StateContext value={{ enabled, badges: enabled && badges, active }}>{children}</StateContext>
    </DispatcherContext>
  );
}

/**
 * Give a hotkey its action while this component is on screen. The handler may change on every render;
 * the latest one runs. `enabled: false` takes the key away (the action is not available right now).
 */
export function useHotkey(
  id: string,
  handler: (event: KeyboardEvent) => void,
  { enabled = true }: { enabled?: boolean } = {},
) {
  const dispatcher = use(DispatcherContext);
  const latest = useRef(handler);
  latest.current = handler;
  useEffect(() => {
    if (!dispatcher || !enabled) return;
    return dispatcher.register({ id, run: (event) => latest.current(event) });
  }, [dispatcher, id, enabled]);
}

/** True when the hotkey does something right now: a screen has registered it, or it is a screen's own key. */
function works(state: HotkeyState, id: string): boolean {
  const def = HOTKEY_BY_ID.get(id);
  if (!def || !state.enabled) return false;
  return def.selfHandled === true || state.active.has(id);
}

/**
 * The key to show for a hotkey, for a tooltip's or a menu row's `shortcut`: undefined when badges are off,
 * off the computer layout, for an unknown id, or when the key does nothing on this screen.
 */
export function useHotkeyHint(id: string | undefined): string | undefined {
  const state = use(StateContext);
  if (!id || !state.badges || !works(state, id)) return undefined;
  return hotkeyText(id);
}

/** The `aria-keyshortcuts` value for the control the hotkey presses, whatever her badge setting. */
export function useHotkeyAria(id: string | undefined): string | undefined {
  const state = use(StateContext);
  if (!id || !works(state, id)) return undefined;
  return ariaKeys(id);
}

/** Whether the keys work at all here (false on the phone layout and outside the provider). */
export function useHotkeysEnabled(): boolean {
  return use(StateContext).enabled;
}

/** Whether shortcut badges and hints show at all right now (her setting, on the computer layout). */
export function useHotkeysShown(): boolean {
  return use(StateContext).badges;
}

/** The hotkeys that have a handler on screen now. */
export function useActiveHotkeys(): ReadonlySet<string> {
  return use(StateContext).active;
}
