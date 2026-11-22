/**
 * Every app-level keyboard shortcut, as data: one list, so the "?" overlay, the guide, the badges and the
 * one listener (HotkeyProvider) all read the same thing and cannot drift. A screen that owns an action
 * registers its handler with `useHotkey(id, handler)`; a key works only while that screen is on show.
 *
 * Keys are written in one small language:
 * - a chord is modifiers and one key joined by "+": `mod+k`, `shift+t`, `alt+o`, `?`, `arrowleft`.
 *   `mod` is Command on a Mac and Ctrl elsewhere.
 * - a sequence is chords separated by a space: `g l` means press G, then L.
 *
 * Entries marked `selfHandled` are keys a screen's own code already reads (the document editor, the
 * practice player, the library tree). They are listed here so the overlay and the guide show them, but
 * the listener leaves them alone. The editor's text keys (bold, headings and the like) are not here at
 * all: they live on the document's own keyboard card (features/documents/editor/ShortcutHelp.tsx).
 */

export type HotkeyGroup =
  | "Go to"
  | "App"
  | "Library"
  | "Document"
  | "Source file"
  | "Practice"
  | "Calendar"
  | "Requests"
  | "References";

/** The order groups are listed in. */
export const HOTKEY_GROUPS: readonly HotkeyGroup[] = [
  "Go to",
  "App",
  "Library",
  "Document",
  "Source file",
  "Practice",
  "Calendar",
  "Requests",
  "References",
];

/**
 * Where a key works. Two places "overlap" when both can be on screen at once; a key may be reused only
 * between places that never overlap (see `placesOverlap`).
 */
export type HotkeyPlace =
  | "everywhere"
  | "library-home"
  | "library-item"
  | "library-tree"
  | "document"
  | "source"
  | "practice-home"
  | "practice-session"
  | "practice-choices"
  | "practice-card"
  | "calendar"
  | "requests"
  | "references";

export const PLACE_LABEL: Record<HotkeyPlace, string> = {
  everywhere: "Anywhere",
  "library-home": "Library home",
  "library-item": "A library page",
  "library-tree": "The library tree, on the focused row",
  document: "An open document",
  source: "A source file",
  "practice-home": "Practice",
  "practice-session": "A practice session",
  "practice-choices": "A multiple-choice question",
  "practice-card": "A flashcard",
  calendar: "Calendar",
  requests: "Requests",
  references: "References",
};

/** Places that sit inside a bigger one, so they overlap it (and everything it overlaps). */
const INSIDE: Partial<Record<HotkeyPlace, HotkeyPlace>> = {
  "practice-choices": "practice-session",
  "practice-card": "practice-session",
};

/** True when two places can be on screen at the same time. */
export function placesOverlap(a: HotkeyPlace, b: HotkeyPlace): boolean {
  if (a === b || a === "everywhere" || b === "everywhere") return true;
  return INSIDE[a] === b || INSIDE[b] === a;
}

export interface HotkeyDef {
  id: string;
  /** One or more ways to press it; the first is the one shown on badges. */
  keys: readonly string[];
  /** What it does, in a few words (also the row in the overlay and the guide). */
  label: string;
  group: HotkeyGroup;
  where: HotkeyPlace;
  /** Read by the screen's own code, not by the hotkey listener (see the note at the top). */
  selfHandled?: true;
  /** How to write the keys when the list of `keys` would not say it well ("1 to 9, or A to F"). */
  display?: string;
  /** Works while a dialog or menu is open (the dialog's own keys). */
  inDialog?: true;
  /** Keeps firing while the key is held down (zoom, paging). */
  repeat?: true;
  /**
   * A Command (Ctrl) key that still stays out of the way of typing and dialogs, so the editor keeps
   * copy, bold, italic and save, and copying a selection on a page still works (the "Go to" keys).
   */
  outsideText?: true;
}

const go = (id: string, key: string, label: string): HotkeyDef => ({
  id: `go.${id}`,
  keys: [`mod+${key}`],
  label,
  group: "Go to",
  where: "everywhere",
  outsideText: true,
});

export const HOTKEYS: readonly HotkeyDef[] = [
  // ---- Go to: Command (Ctrl) and a letter, anywhere outside a text field. Alex chose Command over the
  // browser's own use of these keys (2026-11-22). T, H, N, W and Q never reach a page, so Trash is D, Guide is G.
  // ---- ------------------------------------------------------
  go("library", "l", "Library"),
  go("practice", "p", "Practice"),
  go("calendar", "c", "Calendar"),
  go("search", "/", "Search"),
  go("inbox", "i", "Inbox"),
  go("settings", "s", "Settings"),
  go("requests", "r", "Requests"),
  go("concepts", "o", "Concepts"),
  go("references", "e", "References"),
  go("activity", "a", "Agent activity"),
  go("guide", "g", "Guide"),
  go("trash", "d", "Trash"),
  go("back", "b", "Go back"),

  // ---- App ---------------------------------------------------------------------------------
  {
    id: "app.quickFind",
    keys: ["mod+k", "/"],
    label: "Quick find",
    group: "App",
    where: "everywhere",
    inDialog: true,
  },
  {
    id: "app.sidebar",
    keys: ["mod+\\", "["],
    label: "Show or hide the sidebar",
    group: "App",
    where: "everywhere",
  },
  {
    id: "app.details",
    keys: ["]"],
    label: "Show or hide the details panel (library)",
    group: "App",
    where: "everywhere",
  },
  {
    id: "app.ask",
    keys: ["r"],
    label: "Ask an agent (about the page you are on)",
    group: "App",
    where: "everywhere",
  },
  {
    id: "app.upload",
    keys: ["u"],
    label: "Upload files (here, or to the inbox)",
    group: "App",
    where: "everywhere",
  },
  {
    id: "app.shortcuts",
    keys: ["?"],
    label: "Show all keyboard shortcuts",
    group: "App",
    where: "everywhere",
  },
  { id: "app.tour", keys: ["shift+g"], label: "Start the tour", group: "App", where: "everywhere" },

  // ---- Library ------------------------------------------------------------------------------
  {
    id: "library.newTerm",
    keys: ["shift+t"],
    label: "New term",
    group: "Library",
    where: "everywhere",
  },
  {
    id: "library.newCourse",
    keys: ["shift+c"],
    label: "New course",
    group: "Library",
    where: "library-item",
  },
  {
    id: "library.newFolder",
    keys: ["shift+f"],
    label: "New folder",
    group: "Library",
    where: "library-item",
  },
  {
    id: "library.newLecture",
    keys: ["shift+l"],
    label: "New lecture",
    group: "Library",
    where: "library-item",
  },
  {
    id: "library.newDocument",
    keys: ["shift+d"],
    label: "New document",
    group: "Library",
    where: "library-item",
  },
  {
    id: "library.favorite",
    keys: ["s"],
    label: "Add to or remove from favorites",
    group: "Library",
    where: "library-item",
  },
  {
    id: "library.rename",
    keys: ["shift+r"],
    label: "Rename this item",
    group: "Library",
    where: "library-item",
  },
  { id: "library.move", keys: ["m"], label: "Move to…", group: "Library", where: "library-item" },
  {
    id: "library.openPage",
    keys: ["o"],
    label: "Open the page",
    group: "Library",
    where: "library-item",
  },
  {
    id: "library.practice",
    keys: ["p"],
    label: "Practice this",
    group: "Library",
    where: "library-item",
  },
  {
    id: "library.expandAll",
    keys: ["shift+e"],
    label: "Expand all",
    group: "Library",
    where: "library-home",
  },
  {
    id: "library.collapseAll",
    keys: ["shift+x"],
    label: "Collapse all",
    group: "Library",
    where: "library-home",
  },
  {
    id: "library.foldRecents",
    keys: ["shift+h"],
    label: "Fold or unfold Recently Opened",
    group: "Library",
    where: "library-home",
  },
  {
    id: "library.foldFavorites",
    keys: ["shift+s"],
    label: "Fold or unfold Favorites",
    group: "Library",
    where: "library-home",
  },
  {
    id: "tree.move",
    keys: ["arrowup", "arrowdown", "arrowleft", "arrowright"],
    display: "Arrow keys",
    label: "Move through the tree, open and close a branch",
    group: "Library",
    where: "library-tree",
    selfHandled: true,
  },
  {
    id: "tree.rename",
    keys: ["f2"],
    label: "Rename the focused item",
    group: "Library",
    where: "library-tree",
    selfHandled: true,
  },
  {
    id: "tree.trash",
    keys: ["delete"],
    label: "Move the focused item to the trash",
    group: "Library",
    where: "library-tree",
    selfHandled: true,
  },

  // ---- Document -----------------------------------------------------------------------------
  {
    id: "doc.mode",
    keys: ["e"],
    label: "Switch between Read and Edit",
    group: "Document",
    where: "document",
  },
  {
    id: "doc.outline",
    keys: ["alt+o"],
    label: "Show or hide the outline",
    group: "Document",
    where: "document",
    selfHandled: true,
  },
  {
    id: "doc.resources",
    keys: ["alt+r"],
    label: "Show or hide resources",
    group: "Document",
    where: "document",
  },
  {
    id: "doc.notes",
    keys: ["alt+n"],
    label: "Show or hide side notes",
    group: "Document",
    where: "document",
  },
  {
    id: "doc.history",
    keys: ["h"],
    label: "Version history",
    group: "Document",
    where: "document",
  },
  {
    id: "doc.sideNote",
    keys: ["mod+alt+m"],
    label: "Add a side note on this block (Edit)",
    group: "Document",
    where: "document",
    selfHandled: true,
  },
  {
    id: "doc.nextUnverified",
    keys: ["alt+arrowdown"],
    label: "Jump to the next block to review",
    group: "Document",
    where: "document",
    selfHandled: true,
  },
  {
    id: "doc.markReviewed",
    keys: ["mod+shift+enter"],
    label: "Mark this block as reviewed",
    group: "Document",
    where: "document",
    selfHandled: true,
  },

  // ---- Source file --------------------------------------------------------------------------
  {
    id: "source.prevPage",
    keys: ["arrowleft", "p"],
    label: "Previous page",
    group: "Source file",
    where: "source",
    repeat: true,
  },
  {
    id: "source.nextPage",
    keys: ["arrowright", "n"],
    label: "Next page",
    group: "Source file",
    where: "source",
    repeat: true,
  },
  {
    id: "source.zoomIn",
    keys: ["=", "+"],
    label: "Zoom in",
    group: "Source file",
    where: "source",
    repeat: true,
  },
  {
    id: "source.zoomOut",
    keys: ["-"],
    label: "Zoom out",
    group: "Source file",
    where: "source",
    repeat: true,
  },
  { id: "source.fit", keys: ["0"], label: "Fit the page", group: "Source file", where: "source" },
  {
    id: "source.fullScreen",
    keys: ["f"],
    label: "Full screen, or leave it",
    group: "Source file",
    where: "source",
  },
  {
    id: "source.leaveFullScreen",
    keys: ["escape"],
    label: "Leave full screen",
    group: "Source file",
    where: "source",
    selfHandled: true,
  },
  {
    id: "source.download",
    keys: ["d"],
    label: "Download the original",
    group: "Source file",
    where: "source",
  },

  // ---- Practice -----------------------------------------------------------------------------
  {
    id: "practice.start",
    keys: ["s"],
    label: "Start the session",
    group: "Practice",
    where: "practice-home",
  },
  {
    id: "practice.pick",
    keys: ["1", "a"],
    display: "1 to 9, or A to F",
    label: "Pick an answer",
    group: "Practice",
    where: "practice-choices",
    selfHandled: true,
  },
  {
    id: "practice.continue",
    keys: ["enter"],
    label: "Check the answer, then go to the next question",
    group: "Practice",
    where: "practice-session",
    selfHandled: true,
  },
  {
    id: "practice.skip",
    keys: ["s"],
    label: "Skip this question",
    group: "Practice",
    where: "practice-session",
  },
  {
    id: "practice.focusAids",
    keys: ["o"],
    label: "Focus aids",
    group: "Practice",
    where: "practice-session",
  },
  {
    id: "practice.pause",
    keys: ["escape"],
    label: "Pause, or resume",
    group: "Practice",
    where: "practice-session",
    selfHandled: true,
  },
  {
    id: "practice.flip",
    keys: ["space"],
    label: "Turn a flashcard over",
    group: "Practice",
    where: "practice-card",
    selfHandled: true,
  },
  {
    id: "practice.rate",
    keys: ["1"],
    display: "1 to 4",
    label: "Rate a flashcard: Again, Hard, Good, Easy",
    group: "Practice",
    where: "practice-card",
    selfHandled: true,
  },

  // ---- Calendar -----------------------------------------------------------------------------
  {
    id: "calendar.prev",
    keys: ["arrowleft", "p"],
    label: "Previous month",
    group: "Calendar",
    where: "calendar",
    repeat: true,
  },
  {
    id: "calendar.next",
    keys: ["arrowright", "n"],
    label: "Next month",
    group: "Calendar",
    where: "calendar",
    repeat: true,
  },
  { id: "calendar.today", keys: ["t"], label: "Today", group: "Calendar", where: "calendar" },

  // ---- Requests -----------------------------------------------------------------------------
  { id: "requests.new", keys: ["n"], label: "New request", group: "Requests", where: "requests" },
  ...(
    [
      ["all", "All"],
      ["waiting", "Waiting"],
      ["in_progress", "In progress"],
      ["done", "Done"],
      ["declined", "Needs a change"],
      ["cancelled", "Canceled"],
    ] as const
  ).map(
    ([filter, name], i): HotkeyDef => ({
      id: `requests.filter.${filter}`,
      keys: [String(i + 1)],
      label: `Show ${filter === "all" ? "all requests" : name}`,
      group: "Requests",
      where: "requests",
    }),
  ),

  // ---- References ---------------------------------------------------------------------------
  {
    id: "references.new",
    keys: ["n"],
    label: "Save a reference",
    group: "References",
    where: "references",
  },
];

export const HOTKEY_BY_ID: ReadonlyMap<string, HotkeyDef> = new Map(HOTKEYS.map((h) => [h.id, h]));

export function hotkeyById(id: string): HotkeyDef | undefined {
  return HOTKEY_BY_ID.get(id);
}

// ---- Parsing ----------------------------------------------------------------------------------

export interface Chord {
  mod: boolean;
  alt: boolean;
  shift: boolean;
  /** Lower case: a letter, a digit, a symbol, or a name such as "arrowleft", "enter", "space", "f2". */
  key: string;
}

/** `mod+shift+k` -> its parts. A lone "+" is the plus key. */
export function parseChord(text: string): Chord {
  const parts = text === "+" ? ["+"] : text.toLowerCase().split("+");
  // "mod++" (mod and the plus key) splits into an empty last part.
  const key = parts[parts.length - 1] === "" ? "+" : (parts[parts.length - 1] as string);
  const mods = new Set(parts.slice(0, -1));
  return { mod: mods.has("mod"), alt: mods.has("alt"), shift: mods.has("shift"), key };
}

/** A key's chords: one for a chord, two or more for a sequence. */
export function parseKeys(text: string): Chord[] {
  return text.trim().split(/\s+/).map(parseChord);
}

/** Keys whose shift is part of the character itself ("?" is Shift and /): shift is not compared. */
export function isSymbol(key: string): boolean {
  return key.length === 1 && !/[a-z0-9]/.test(key);
}

// ---- Showing keys -------------------------------------------------------------------------------

export const IS_MAC =
  typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform);

/** The Command key on a Mac, Ctrl elsewhere, ready to put in front of a key ("⌘K", "Ctrl+K"). */
export const MOD_KEY = IS_MAC ? "⌘" : "Ctrl+";

const NAMES: Record<string, string> = {
  arrowleft: "←",
  arrowright: "→",
  arrowup: "↑",
  arrowdown: "↓",
  enter: "Enter",
  escape: "Esc",
  space: "Space",
  delete: "Del",
  backspace: "Backspace",
  tab: "Tab",
};

/** One chord as she sees it: "⌘ + K", "⇧ + T" on a Mac; "Ctrl + K", "Shift + T" elsewhere. The plus says "hold, then press". */
export function formatChord(chord: Chord, mac = IS_MAC): string {
  const key = NAMES[chord.key] ?? chord.key.toUpperCase();
  const mods: string[] = [];
  if (mac) {
    // The order a Mac menu uses: Control, Option, Shift, Command; we only have Option, Shift, Command.
    if (chord.alt) mods.push("⌥");
    if (chord.shift) mods.push("⇧");
    if (chord.mod) mods.push("⌘");
    return mods.join("") + key;
  }
  if (chord.mod) mods.push("Ctrl");
  if (chord.alt) mods.push("Alt");
  if (chord.shift) mods.push("Shift");
  return [...mods, key].join("+");
}

/** A key as she sees it: "⌘ + K", or "G + L" for a sequence (one key after the other; Alex chose the plus for both, 2026-11-22). */
export function formatKeys(text: string, mac = IS_MAC): string {
  return parseKeys(text)
    .map((c) => formatChord(c, mac))
    .join(" ");
}

/** The badge text for a hotkey: its first key. */
export function hotkeyText(id: string, mac = IS_MAC): string | undefined {
  const def = HOTKEY_BY_ID.get(id);
  const first = def?.keys[0];
  return first ? formatKeys(first, mac) : undefined;
}

/** Every way to press a hotkey, for the overlay and the guide: "⌘ + K or /". */
export function hotkeyAllText(def: HotkeyDef, mac = IS_MAC): string {
  return def.display ?? def.keys.map((k) => formatKeys(k, mac)).join(" or ");
}

/** The `aria-keyshortcuts` value for a control (the WAI-ARIA spelling: "Meta+K", "G L"). */
export function ariaKeys(id: string, mac = IS_MAC): string | undefined {
  const def = HOTKEY_BY_ID.get(id);
  if (!def) return undefined;
  return def.keys
    .map((text) =>
      parseKeys(text)
        .map((c) => {
          const parts: string[] = [];
          if (c.mod) parts.push(mac ? "Meta" : "Control");
          if (c.alt) parts.push("Alt");
          if (c.shift) parts.push("Shift");
          const named: Record<string, string> = {
            arrowleft: "ArrowLeft",
            arrowright: "ArrowRight",
            arrowup: "ArrowUp",
            arrowdown: "ArrowDown",
            enter: "Enter",
            escape: "Escape",
            space: "Space",
            delete: "Delete",
          };
          parts.push(named[c.key] ?? (c.key.length === 1 ? c.key.toUpperCase() : c.key));
          return parts.join("+");
        })
        .join(" "),
    )
    .join(" ");
}

// ---- Rules the list must keep (checked in registry.test.ts) -------------------------------------

/** Letters the browser or the system keep for themselves with Command or Ctrl. */
const OWNED_MOD_LETTERS = new Set(["t", "w", "n", "r", "l", "q", "p", "f", "s", "h", "m"]);
/** Editing keys every text field already has. */
const EDITING_MOD_LETTERS = new Set(["a", "c", "v", "x", "z", "y"]);

/** Command (Ctrl) keys that never reach a page: new tab, close, new window, quit; hide on a Mac. */
export const UNREACHABLE_MOD_LETTERS: ReadonlySet<string> = new Set(["t", "w", "n", "q", "h"]);

/** Why a chord may not be bound, or null when it may. */
export function forbiddenReason(chord: Chord): string | null {
  if (/^f\d{1,2}$/.test(chord.key)) return "function keys belong to the browser and the system";
  if (chord.mod && OWNED_MOD_LETTERS.has(chord.key)) return "the browser owns this combination";
  if (chord.mod && EDITING_MOD_LETTERS.has(chord.key)) return "text fields use this combination";
  if (chord.mod && /^\d$/.test(chord.key)) return "the browser switches tabs with it";
  if (chord.mod && chord.key.startsWith("arrow")) return "the system moves the caret with it";
  if (chord.alt && (chord.key === "arrowleft" || chord.key === "arrowright"))
    return "the browser goes back and forward with it";
  if (chord.key === "tab") return "Tab moves the focus";
  return null;
}
