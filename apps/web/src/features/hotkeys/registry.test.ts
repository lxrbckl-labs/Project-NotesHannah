import { describe, expect, test } from "vitest";
import { STATUS_ORDER } from "../requests/model/wording";
import {
  type Chord,
  forbiddenReason,
  formatKeys,
  HOTKEY_GROUPS,
  HOTKEYS,
  hotkeyAllText,
  parseChord,
  parseKeys,
  placesOverlap,
} from "./registry";

const chordText = (c: Chord) =>
  `${c.mod ? "mod+" : ""}${c.alt ? "alt+" : ""}${c.shift ? "shift+" : ""}${c.key}`;

describe("the hotkey registry", () => {
  test("every id is unique and every entry is complete", () => {
    const ids = HOTKEYS.map((h) => h.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const h of HOTKEYS) {
      expect(h.keys.length).toBeGreaterThan(0);
      expect(h.label.trim().length).toBeGreaterThan(2);
      expect(HOTKEY_GROUPS).toContain(h.group);
    }
  });

  test("no key the browser or the system owns (the screens' own existing keys aside)", () => {
    for (const h of HOTKEYS) {
      if (h.selfHandled) continue;
      for (const text of h.keys) {
        for (const chord of parseKeys(text)) {
          expect(forbiddenReason(chord), `${h.id}: ${text}`).toBeNull();
        }
      }
    }
  });

  test("the forbidden list catches what it should", () => {
    for (const text of ["mod+t", "mod+w", "mod+n", "mod+r", "mod+l", "mod+q", "mod+p", "mod+f"]) {
      expect(forbiddenReason(parseChord(text)), text).not.toBeNull();
    }
    for (const text of ["mod+s", "mod+1", "mod+9", "mod+arrowleft", "f5", "f12", "alt+arrowleft"]) {
      expect(forbiddenReason(parseChord(text)), text).not.toBeNull();
    }
    for (const text of ["mod+k", "mod+\\", "shift+t", "g", "?", "alt+o"]) {
      expect(forbiddenReason(parseChord(text)), text).toBeNull();
    }
  });

  test("no two hotkeys share a key where both can be on screen", () => {
    const seen: Array<{ id: string; key: string; where: (typeof HOTKEYS)[number]["where"] }> = [];
    for (const h of HOTKEYS) {
      for (const text of h.keys) {
        const key = parseKeys(text).map(chordText).join(" ");
        for (const other of seen) {
          if (other.key === key && placesOverlap(other.where, h.where)) {
            throw new Error(`${h.id} and ${other.id} both use "${text}"`);
          }
        }
        seen.push({ id: h.id, key, where: h.where });
      }
    }
  });

  test("no single key is also the first key of a pair in the same place", () => {
    const singles = HOTKEYS.flatMap((h) =>
      h.keys
        .filter((k) => parseKeys(k).length === 1)
        .map((k) => ({ id: h.id, where: h.where, key: chordText(parseChord(k)) })),
    );
    for (const h of HOTKEYS) {
      for (const text of h.keys) {
        const chords = parseKeys(text);
        if (chords.length < 2) continue;
        expect(chords.length, `${h.id}: pairs only`).toBe(2);
        const first = chordText(chords[0] as Chord);
        const clash = singles.find((s) => s.key === first && placesOverlap(s.where, h.where));
        expect(clash, `${h.id} starts with ${first}`).toBeUndefined();
      }
    }
  });

  test("global single keys leave the canvas's and the practice player's own letters alone", () => {
    // The canvas reads v, h, n, c, f (with or without Shift) and the practice player a to f and digits;
    // a key that works everywhere must not be one of them.
    const theirs = new Set(["v", "h", "n", "c", "f", "a", "b", "d", "e", "=", "-", "+"]);
    for (const h of HOTKEYS.filter((x) => x.where === "everywhere")) {
      for (const text of h.keys) {
        const chords = parseKeys(text);
        if (chords.length !== 1) continue;
        const chord = chords[0] as Chord;
        if (chord.mod) continue;
        expect(theirs.has(chord.key) || /^\d$/.test(chord.key), `${h.id}: ${text}`).toBe(false);
      }
    }
  });

  test("there is a filter key for every request status", () => {
    for (const status of ["all", ...STATUS_ORDER]) {
      expect(
        HOTKEYS.some((h) => h.id === `requests.filter.${status}`),
        status,
      ).toBe(true);
    }
  });

  test("the app-wide keys from before are in the list", () => {
    const byId = new Map(HOTKEYS.map((h) => [h.id, h]));
    expect(byId.get("app.quickFind")?.keys).toEqual(["mod+k", "/"]);
    expect(byId.get("app.sidebar")?.keys).toContain("mod+\\");
    expect(byId.get("app.shortcuts")?.keys).toEqual(["?"]);
  });
});

describe("showing keys", () => {
  test("Mac symbols and the Windows spelling", () => {
    expect(formatKeys("mod+k", true)).toBe("⌘ + K");
    expect(formatKeys("mod+k", false)).toBe("Ctrl + K");
    expect(formatKeys("shift+t", true)).toBe("⇧ + T");
    expect(formatKeys("shift+t", false)).toBe("Shift + T");
    expect(formatKeys("mod+alt+m", true)).toBe("⌥ + ⌘ + M");
    expect(formatKeys("alt+o", false)).toBe("Alt + O");
    expect(formatKeys("mod+\\", true)).toBe("⌘ + \\");
  });

  test("pairs show both keys, and named keys read as symbols", () => {
    expect(formatKeys("g l", true)).toBe("G then L");
    expect(formatKeys("g /", false)).toBe("G then /");
    expect(formatKeys("arrowleft", true)).toBe("←");
    expect(formatKeys("?", true)).toBe("?");
  });

  test("every way to press a hotkey, or its own wording", () => {
    const find = (id: string) => HOTKEYS.find((h) => h.id === id);
    expect(hotkeyAllText(find("app.quickFind") as never, true)).toBe("⌘ + K or /");
    expect(hotkeyAllText(find("practice.pick") as never, true)).toBe("1 to 9, or A to F");
  });

  test("parsing", () => {
    expect(parseChord("mod+shift+enter")).toEqual({
      mod: true,
      alt: false,
      shift: true,
      key: "enter",
    });
    expect(parseChord("+")).toEqual({ mod: false, alt: false, shift: false, key: "+" });
    expect(parseKeys("g l").map((c) => c.key)).toEqual(["g", "l"]);
  });
});
