import {
  type Chord,
  HOTKEY_BY_ID,
  type HotkeyDef,
  isSymbol,
  parseChord,
  parseKeys,
} from "./registry";

/**
 * The rules of the one hotkey listener, without React, so they are tested on plain events
 * (dispatch.test.ts). HotkeyProvider owns one `Dispatcher` and feeds it every keydown.
 */

/** How long the second key of a sequence ("g" then "l") may wait. */
export const SEQUENCE_MS = 1200;

/** The key an event names, in the registry's spelling (lower case; "space", "arrowleft"). */
export function eventKey(event: KeyboardEvent): string {
  // With Option (Alt) a Mac types a symbol instead of the letter ("ø" for O): read the key's place.
  if (event.altKey && event.code) {
    const letter = /^Key([A-Z])$/.exec(event.code);
    if (letter) return (letter[1] as string).toLowerCase();
    const digit = /^Digit(\d)$/.exec(event.code);
    if (digit) return digit[1] as string;
  }
  if (event.key === " ") return "space";
  return event.key.toLowerCase();
}

/** True when the event is that chord. */
export function matchChord(chord: Chord, event: KeyboardEvent): boolean {
  const mod = event.metaKey || event.ctrlKey;
  if (chord.mod !== mod || chord.alt !== event.altKey) return false;
  const key = eventKey(event);
  if (key !== chord.key) return false;
  // "?" already is Shift and /: compare shift only for letters, digits and named keys.
  if (isSymbol(chord.key) && !chord.shift) return true;
  return chord.shift === event.shiftKey;
}

/** True when the focus is somewhere she types: a text field, a select, an editable block. */
export function isTypingTarget(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  if (!el || typeof el.tagName !== "string") return false;
  if (el.isContentEditable || el.closest?.("[contenteditable='true'], [contenteditable='']"))
    return true;
  const tag = el.tagName;
  if (tag === "TEXTAREA" || tag === "SELECT") return true;
  if (tag === "INPUT") {
    const type = (el as HTMLInputElement).type;
    return !["checkbox", "radio", "button", "submit", "reset", "color", "file"].includes(type);
  }
  return false;
}

/** True when she has words selected on the page. */
export function hasSelection(): boolean {
  if (typeof window === "undefined") return false;
  const selection = window.getSelection();
  return Boolean(selection && !selection.isCollapsed && selection.toString().trim());
}

/** The dialog or menu that is open on the page, if any. */
export function openOverlay(doc: Document = document): Element | null {
  return doc.querySelector(
    '[role="dialog"], [role="alertdialog"], [role="menu"], [role="listbox"][data-state="open"]',
  );
}

export interface Registration {
  id: string;
  /** Read at the moment of the key, so a screen's latest state is used. */
  run: (event: KeyboardEvent) => void;
}

interface Entry extends Registration {
  order: number;
}

/**
 * The live handlers, by hotkey id, and the sequence in progress. When two screens register the same id
 * (the app's "Ask an agent", and a library page's own), the one registered last is used, and the
 * earlier one comes back when it leaves.
 */
export class Dispatcher {
  private handlers = new Map<string, Entry[]>();
  private order = 0;
  private pending: { chord: Chord; at: number } | null = null;
  private listeners = new Set<() => void>();
  /** The ids that have a handler now; replaced (never mutated) when that changes. */
  active: ReadonlySet<string> = new Set();

  constructor(
    private readonly defs: ReadonlyMap<string, HotkeyDef> = HOTKEY_BY_ID,
    private readonly now: () => number = () => Date.now(),
    private readonly overlay: () => Element | null = () =>
      typeof document === "undefined" ? null : openOverlay(document),
  ) {}

  register(registration: Registration): () => void {
    const def = this.defs.get(registration.id);
    if (!def || def.selfHandled) {
      if (import.meta.env?.DEV) console.warn(`No hotkey "${registration.id}" to register.`);
      return () => {};
    }
    const entry: Entry = { ...registration, order: ++this.order };
    const list = this.handlers.get(registration.id) ?? [];
    list.push(entry);
    this.handlers.set(registration.id, list);
    this.changed();
    return () => {
      const now = this.handlers.get(registration.id);
      if (!now) return;
      const left = now.filter((e) => e !== entry);
      if (left.length) this.handlers.set(registration.id, left);
      else this.handlers.delete(registration.id);
      this.changed();
    };
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private changed() {
    this.active = new Set(this.handlers.keys());
    for (const listener of this.listeners) listener();
  }

  /** The newest handler for each registered hotkey whose keys pass `test`. */
  private live(): Array<{ def: HotkeyDef; entry: Entry }> {
    const out: Array<{ def: HotkeyDef; entry: Entry }> = [];
    for (const [id, list] of this.handlers) {
      const def = this.defs.get(id);
      const entry = list[list.length - 1];
      if (def && entry) out.push({ def, entry });
    }
    return out.sort((a, b) => b.entry.order - a.entry.order);
  }

  /** May this key fire for this hotkey, given where the focus is and what is open? */
  private allowed(def: HotkeyDef, chord: Chord, event: KeyboardEvent): boolean {
    if (event.repeat && !def.repeat) return false;
    // Combinations with Command or Ctrl are meant to work from anywhere, a text field included.
    if (chord.mod && !def.outsideText) return true;
    if (isTypingTarget(event.target)) return false;
    // Command and C with words selected is a copy, not a trip to the Calendar.
    if (chord.mod && chord.key === "c" && hasSelection()) return false;
    // Enter and Space on a button or a link belong to that control.
    const el = event.target as HTMLElement | null;
    if (
      (chord.key === "enter" || chord.key === "space") &&
      el?.closest?.("button, a, [role='button']")
    )
      return false;
    if (!def.inDialog && this.overlay()) return false;
    return true;
  }

  /** Feed one keydown. Returns the id that ran, "pending" for the first key of a sequence, or null. */
  handle(event: KeyboardEvent): string | null {
    if (event.defaultPrevented || event.isComposing) return null;
    if (["Shift", "Control", "Alt", "Meta"].includes(event.key)) return null;
    const live = this.live();

    // The second key of a sequence.
    const pending = this.pending;
    this.pending = null;
    if (pending && this.now() - pending.at <= SEQUENCE_MS) {
      for (const { def, entry } of live) {
        for (const text of def.keys) {
          const chords = parseKeys(text);
          if (
            chords.length === 2 &&
            sameChord(chords[0] as Chord, pending.chord) &&
            matchChord(chords[1] as Chord, event) &&
            this.allowed(def, chords[0] as Chord, event)
          ) {
            return this.fire(entry, event);
          }
        }
      }
    }

    // A single chord.
    for (const { def, entry } of live) {
      for (const text of def.keys) {
        if (text.trim().includes(" ")) continue;
        const chord = parseChord(text.trim());
        if (matchChord(chord, event) && this.allowed(def, chord, event)) {
          return this.fire(entry, event);
        }
      }
    }

    // The first key of a sequence: wait for the next one.
    for (const { def } of live) {
      for (const text of def.keys) {
        const chords = parseKeys(text);
        const first = chords[0] as Chord;
        if (chords.length === 2 && matchChord(first, event) && this.allowed(def, first, event)) {
          this.pending = { chord: first, at: this.now() };
          event.preventDefault();
          event.stopImmediatePropagation();
          return "pending";
        }
      }
    }
    return null;
  }

  private fire(entry: Entry, event: KeyboardEvent): string {
    event.preventDefault();
    // A screen's own listener (the canvas, the practice player) must not act on the same key too.
    event.stopImmediatePropagation();
    entry.run(event);
    return entry.id;
  }
}

function sameChord(a: Chord, b: Chord): boolean {
  return a.key === b.key && a.mod === b.mod && a.alt === b.alt && a.shift === b.shift;
}
