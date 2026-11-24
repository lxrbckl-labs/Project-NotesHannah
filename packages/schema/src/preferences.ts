import { z } from "zod";

/**
 * Per-person preferences: a small settings document kept on the server, so a choice follows her to
 * every device she signs in on and each account has its own. One document per person; a new
 * preference is a new optional field here, never a new table.
 */

/** Every tab the phone's bottom bar can show, by id. Add an id here when the app gains a tab. */
export const TAB_IDS = ["library", "practice", "calendar", "search", "inbox", "settings"] as const;
export const TabId = z.enum(TAB_IDS);
export type TabId = z.infer<typeof TabId>;

/** The order the bar has until she changes it (and the order new tabs are added in). */
export const DEFAULT_TAB_ORDER: readonly TabId[] = TAB_IDS;

/** A complete order: every tab exactly once. Unknown ids, repeats and missing tabs are refused. */
export const TabOrder = z
  .array(TabId)
  .length(TAB_IDS.length, `Give all ${TAB_IDS.length} tabs, each once.`)
  .refine((order) => new Set(order).size === TAB_IDS.length, {
    message: `Give each of ${TAB_IDS.join(", ")} exactly once.`,
  });

/**
 * Turn whatever was saved into a complete order over the tabs that exist now. Rule, applied on
 * every read (nothing is rewritten): keep the saved ids that are still tabs, in her order, first
 * occurrence only; then put every tab she has not placed (one added to the app after she saved)
 * at the end, in default order. A missing or empty value is the default order.
 */
export function resolveTabOrder(saved: readonly unknown[] | null | undefined): TabId[] {
  const known = new Set<string>(TAB_IDS);
  const out: TabId[] = [];
  for (const id of saved ?? []) {
    if (typeof id === "string" && known.has(id) && !out.includes(id as TabId)) {
      out.push(id as TabId);
    }
  }
  for (const id of TAB_IDS) if (!out.includes(id)) out.push(id);
  return out;
}

/**
 * One saved instruction: her standing rules for a kind of work she asks agents for, written once in
 * Settings and chosen in the request dialog. The limits are the request's (INSTRUCTION_LIMITS in
 * requests.ts), repeated here so this file stands alone.
 */
export const SavedInstruction = z.strictObject({
  id: z.string().min(1).max(40),
  title: z.string().trim().min(1).max(80),
  body: z.string().trim().min(1).max(4000),
});
export type SavedInstruction = z.infer<typeof SavedInstruction>;

/** The whole list, in her order. Ids are unique. */
export const SavedInstructions = z
  .array(SavedInstruction)
  .max(30, "Keep at most 30 saved instructions.")
  .refine((list) => new Set(list.map((i) => i.id)).size === list.length, {
    message: "Each saved instruction needs its own id.",
  });

/** Read whatever was stored tolerantly: keep the entries that are still valid, drop the rest. */
export function resolveInstructions(saved: unknown): SavedInstruction[] {
  if (!Array.isArray(saved)) return [];
  const out: SavedInstruction[] = [];
  for (const item of saved) {
    const parsed = SavedInstruction.safeParse(item);
    if (parsed.success && !out.some((i) => i.id === parsed.data.id) && out.length < 30) {
      out.push(parsed.data);
    }
  }
  return out;
}

/**
 * The page the app's mark in the header leads to (Settings, "Home page"): one of the sidebar's main places.
 * The library until she picks another.
 */
export const HOME_PAGES = [
  "library",
  "practice",
  "calendar",
  "inbox",
  "concepts",
  "references",
  "requests",
  "activity",
] as const;
export const HomePage = z.enum(HOME_PAGES);
export type HomePage = z.infer<typeof HomePage>;
export const DEFAULT_HOME_PAGE: HomePage = "library";

/** Read whatever was stored tolerantly: a place that still exists, or the default. */
export function resolveHomePage(saved: unknown): HomePage {
  const parsed = HomePage.safeParse(saved);
  return parsed.success ? parsed.data : DEFAULT_HOME_PAGE;
}

/** What the server returns: every field resolved, so a client never has to fill in a default. */
export const Preferences = z.object({
  tabOrder: TabOrder,
  /** Her saved instructions; empty until she writes one. */
  instructions: z.array(SavedInstruction).default([]),
  /** Whether she has finished or skipped the first-time tour; false until then. */
  tourSeen: z.boolean().default(false),
  /** Whether the small keyboard shortcut badges show beside buttons and in hints; on until she turns them off. */
  shortcutBadges: z.boolean().default(true),
  /** Where the app's mark in the header leads; the library until she picks another place. */
  homePage: HomePage.default(DEFAULT_HOME_PAGE),
});
export type Preferences = z.infer<typeof Preferences>;

/**
 * A change: only the fields sent are touched. `tabOrder` is a complete order, or `null` or `[]`
 * to go back to the default. Unknown fields are refused.
 */
export const PreferencesPatch = z
  .object({
    tabOrder: z.union([TabOrder, z.tuple([]), z.null()]).optional(),
    /** The whole list of saved instructions, replacing what was there. */
    instructions: SavedInstructions.optional(),
    /** Set once the tour has been finished or skipped, so it does not start by itself again. */
    tourSeen: z.boolean().optional(),
    /** Show (true) or hide (false) the keyboard shortcut badges. The shortcuts work either way. */
    shortcutBadges: z.boolean().optional(),
    /** The page the app's mark in the header leads to. */
    homePage: HomePage.optional(),
  })
  .strict();
export type PreferencesPatch = z.infer<typeof PreferencesPatch>;

export const PreferencesResponse = z.object({ preferences: Preferences });
export type PreferencesResponse = z.infer<typeof PreferencesResponse>;

/**
 * Her own background picture (Settings, "Background"). Kept apart from the preferences document:
 * it is bytes, not a setting. The app shrinks any picture she picks to at most
 * BACKGROUND_MAX_EDGE pixels on its longer side before sending, so the original may be any size.
 */
export const BACKGROUND_MIMES = ["image/jpeg", "image/png", "image/webp"] as const;
export type BackgroundMime = (typeof BACKGROUND_MIMES)[number];
/** The most the server keeps. A shrunk picture is far below this. */
export const BACKGROUND_MAX_BYTES = 8 * 1024 * 1024;
export const BACKGROUND_MAX_EDGE = 2560;
/** `updatedAt` is when it was saved (milliseconds), or null when she has none. */
export const BackgroundMeta = z.object({ updatedAt: z.number().nullable() });
export type BackgroundMeta = z.infer<typeof BackgroundMeta>;
