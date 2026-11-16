import { useMemo } from "react";
import { appHttp } from "../../lib/api";
import { useMe } from "../auth/useAuth";
import { HttpDocumentStore } from "../documents";
import type { PracticeStore } from "../practice";
import { createRealPracticeStore } from "./practiceStore";

/** The stores the mounted modules run on, built once per signed-in person. */
export function useStores(): {
  documents: HttpDocumentStore;
  practice: PracticeStore;
  userId: string;
} {
  const me = useMe();
  const userId = me.data?.id ?? "";
  return useMemo(
    () => ({
      documents: new HttpDocumentStore({ actor: { type: "user", userId } }),
      practice: createRealPracticeStore(appHttp),
      userId,
    }),
    [userId],
  );
}
