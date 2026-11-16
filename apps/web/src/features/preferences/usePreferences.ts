import { DEFAULT_TAB_ORDER, type Preferences, resolveTabOrder, type TabId } from "@notes/schema";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";
import { useToast } from "../../components/ui/toast";
import { api } from "../../lib/api";
import { useMe } from "../auth/useAuth";

export const preferencesKey = ["preferences"] as const;

/**
 * The saved order is also kept in this browser, one entry per account, so the tab bar can draw in her order
 * on the very first frame, before the request for her preferences has come back. The server stays the truth:
 * whatever it answers replaces this copy.
 */
const mirrorKey = (userId: string) => `notes-tab-order:${userId}`;

export function readTabOrderMirror(userId: string | undefined): TabId[] | null {
  if (!userId) return null;
  try {
    const raw = localStorage.getItem(mirrorKey(userId));
    const parsed: unknown = raw ? JSON.parse(raw) : null;
    return Array.isArray(parsed) ? resolveTabOrder(parsed) : null;
  } catch {
    return null;
  }
}

function writeTabOrderMirror(userId: string | undefined, order: readonly TabId[]): void {
  if (!userId) return;
  try {
    localStorage.setItem(mirrorKey(userId), JSON.stringify(order));
  } catch {
    // storage blocked: the server copy still follows her
  }
}

/** Her preferences: cached, and shown from the local copy while the first answer is on its way. */
export function usePreferences() {
  const me = useMe();
  const userId = me.data?.id;
  const mirrored = readTabOrderMirror(userId);
  const query = useQuery({
    queryKey: preferencesKey,
    queryFn: api.preferences,
    staleTime: 5 * 60_000,
    ...(mirrored ? { placeholderData: { tabOrder: mirrored } satisfies Preferences } : {}),
  });
  const data = query.data;
  const real = !query.isPlaceholderData;
  useEffect(() => {
    if (data && real) writeTabOrderMirror(userId, data.tabOrder);
  }, [data, real, userId]);
  return query;
}

/** The order the phone's tab bar is drawn in. Always complete; the default until she has chosen. */
export function useTabOrder(): readonly TabId[] {
  return usePreferences().data?.tabOrder ?? DEFAULT_TAB_ORDER;
}

/**
 * Save her tab order (`null` puts the default back). The bar changes at once; if the server refuses, the
 * old order comes back and a toast says why.
 */
export function useSaveTabOrder() {
  const client = useQueryClient();
  const toast = useToast();
  const me = useMe();
  const userId = me.data?.id;
  return useMutation({
    mutationFn: (order: readonly TabId[] | null) =>
      api.updatePreferences({ tabOrder: order ? [...order] : null }),
    onMutate: async (order) => {
      await client.cancelQueries({ queryKey: preferencesKey });
      const before = client.getQueryData<Preferences>(preferencesKey);
      const next = resolveTabOrder(order);
      client.setQueryData<Preferences>(preferencesKey, { tabOrder: next });
      writeTabOrderMirror(userId, next);
      return { before };
    },
    onError: (error, _order, context) => {
      if (context?.before) {
        client.setQueryData(preferencesKey, context.before);
        writeTabOrderMirror(userId, context.before.tabOrder);
      } else {
        void client.invalidateQueries({ queryKey: preferencesKey });
      }
      toast.error(error);
    },
    onSuccess: (saved) => {
      client.setQueryData(preferencesKey, saved);
      writeTabOrderMirror(userId, saved.tabOrder);
    },
  });
}
