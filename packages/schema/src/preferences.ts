import { z } from "zod";

/**
 * Per-person preferences: a small settings document kept on the server, so a choice follows her to
 * every device she signs in on and each account has its own. One document per person; a new
 * preference is a new optional field here, never a new table.
 */

/** Every tab the phone's bottom bar can show, by id. Add an id here when the app gains a tab. */
export const TAB_IDS = ["library", "practice", "search", "inbox", "settings"] as const;
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

/** What the server returns: every field resolved, so a client never has to fill in a default. */
export const Preferences = z.object({
  tabOrder: TabOrder,
});
export type Preferences = z.infer<typeof Preferences>;

/**
 * A change: only the fields sent are touched. `tabOrder` is a complete order, or `null` or `[]`
 * to go back to the default. Unknown fields are refused.
 */
export const PreferencesPatch = z
  .object({
    tabOrder: z.union([TabOrder, z.tuple([]), z.null()]).optional(),
  })
  .strict();
export type PreferencesPatch = z.infer<typeof PreferencesPatch>;

export const PreferencesResponse = z.object({ preferences: Preferences });
export type PreferencesResponse = z.infer<typeof PreferencesResponse>;
