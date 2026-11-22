import type { GuideBlock, GuideTable } from "../help/content";
import {
  formatKeys,
  HOTKEY_BY_ID,
  HOTKEY_GROUPS,
  HOTKEYS,
  type HotkeyDef,
  type HotkeyGroup,
  PLACE_LABEL,
} from "./registry";

/**
 * The guide's keyboard tables, written from the registry so the guide (and its PDF) can never list a key
 * the app does not have. Keys are guide marks (`⌘K`), with the Windows spelling beside the Mac one where
 * they differ, since the PDF is read on either.
 */

/** "`⌘K` or `Ctrl+K` or `/`" for a hotkey. */
export function guideKeys(def: HotkeyDef): string {
  if (def.display) return def.display;
  const out: string[] = [];
  for (const text of def.keys) {
    const mac = formatKeys(text, true);
    const pc = formatKeys(text, false);
    out.push(mac === pc ? `\`${mac}\`` : `\`${mac}\` or \`${pc}\``);
  }
  return out.join(" or ");
}

/** One row: keys, then what it does. */
export function guideRow(id: string): string[] {
  const def = HOTKEY_BY_ID.get(id);
  if (!def) throw new Error(`No hotkey "${id}"`);
  return [guideKeys(def), def.label];
}

/** The hotkeys of one group, in registry order. */
export function hotkeysIn(group: HotkeyGroup): HotkeyDef[] {
  return HOTKEYS.filter((h) => h.group === group);
}

/** One table per group: keys, what it does, where it works. */
export function hotkeyGuideTable(group: HotkeyGroup): GuideTable {
  return {
    kind: "table",
    keys: true,
    // The group in the heading also keeps each table's key distinct (GuideBlocks keys tables by head).
    head: ["Keys", group, "Where"],
    rows: hotkeysIn(group).map((def) => [guideKeys(def), def.label, PLACE_LABEL[def.where]]),
  };
}

/** Every group as a heading and its table. */
export function hotkeyGuideBlocks(): GuideBlock[] {
  return HOTKEY_GROUPS.filter((g) => hotkeysIn(g).length > 0).flatMap((group): GuideBlock[] => [
    { kind: "h3", text: group },
    hotkeyGuideTable(group),
  ]);
}
