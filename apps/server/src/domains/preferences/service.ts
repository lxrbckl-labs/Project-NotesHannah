import {
  type Preferences,
  type PreferencesPatch,
  resolveInstructions,
  resolveTabOrder,
} from "@notes/schema";
import type { Db } from "../../db/client.js";

/** What is stored: only what she chose. Anything she never set is absent and resolved on read. */
interface StoredPreferences {
  tabOrder?: unknown;
  instructions?: unknown;
  tourSeen?: unknown;
  shortcutBadges?: unknown;
}

function readStored(db: Db, userId: string): StoredPreferences {
  const row = db.prepare("SELECT doc FROM user_preferences WHERE user_id = ?").get(userId) as
    | { doc: string }
    | undefined;
  if (!row) return {};
  try {
    const doc: unknown = JSON.parse(row.doc);
    return doc && typeof doc === "object" ? (doc as StoredPreferences) : {};
  } catch {
    return {};
  }
}

/** The stored document resolved against what exists now: every field present and valid. */
export function getPreferences(db: Db, userId: string): Preferences {
  const stored = readStored(db, userId);
  return {
    tabOrder: resolveTabOrder(Array.isArray(stored.tabOrder) ? stored.tabOrder : null),
    instructions: resolveInstructions(stored.instructions),
    tourSeen: stored.tourSeen === true,
    // On unless she turned them off: only `false` is ever stored.
    shortcutBadges: stored.shortcutBadges !== false,
  };
}

/** Merge a validated change into the stored document and return the resolved result. */
export function updatePreferences(
  db: Db,
  userId: string,
  patch: PreferencesPatch,
  now: number,
): Preferences {
  const doc = readStored(db, userId);
  if (patch.tabOrder !== undefined) {
    // null or [] means "the default": forget the choice rather than store a copy of the default,
    // so a tab added later then lands where the default puts it.
    if (patch.tabOrder === null || patch.tabOrder.length === 0) delete doc.tabOrder;
    else doc.tabOrder = patch.tabOrder;
  }
  if (patch.tourSeen !== undefined) {
    if (patch.tourSeen) doc.tourSeen = true;
    else delete doc.tourSeen;
  }
  if (patch.shortcutBadges !== undefined) {
    // The default (on) is never stored, so only "off" is kept.
    if (patch.shortcutBadges) delete doc.shortcutBadges;
    else doc.shortcutBadges = false;
  }
  if (patch.instructions !== undefined) {
    // An empty list is "none saved": forget the field rather than keep an empty array.
    if (patch.instructions.length === 0) delete doc.instructions;
    else doc.instructions = patch.instructions;
  }
  db.prepare(
    `INSERT INTO user_preferences (user_id, doc, updated_at) VALUES (?, ?, ?)
     ON CONFLICT (user_id) DO UPDATE SET doc = excluded.doc, updated_at = excluded.updated_at`,
  ).run(userId, JSON.stringify(doc), now);
  return getPreferences(db, userId);
}
