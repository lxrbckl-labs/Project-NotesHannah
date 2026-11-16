import { createContext, type ReactNode, useContext, useMemo } from "react";
import type { OpenAction } from "../model/wording";
import type { RequestsMountContext, RequestsNavigation, RequestsStore } from "../types";

export interface RequestsEnv {
  store: RequestsStore;
  open: (action: OpenAction) => void;
}

const Env = createContext<RequestsEnv | null>(null);

export function useRequestsEnv(): RequestsEnv {
  const env = useContext(Env);
  if (!env) throw new Error("Request screens must sit inside <RequestsProvider>.");
  return env;
}

/** Push a path to the browser history and tell the router (the shell's router listens to popstate). */
export function pushPath(path: string): void {
  window.history.pushState({}, "", path);
  window.dispatchEvent(new PopStateEvent("popstate"));
}

/** Wires props to the screens: each link falls back to a URL push when the prop is not given. */
export function RequestsProvider({
  store,
  context,
  navigation,
  children,
}: {
  store: RequestsStore;
  context: Pick<RequestsMountContext, "openSource" | "openNode">;
  navigation: RequestsNavigation;
  children: ReactNode;
}) {
  const { openSource, openNode } = context;
  const { onOpenDocument, onOpenQuestion, onOpenConcept } = navigation;
  const env = useMemo<RequestsEnv>(
    () => ({
      store,
      open(action) {
        switch (action.kind) {
          case "node":
            return openNode(action.nodeId);
          case "source":
            return openSource(
              action.pageId
                ? { fileId: action.fileId, pageId: action.pageId }
                : { fileId: action.fileId },
            );
          case "document": {
            const target = {
              documentId: action.documentId,
              nodeId: action.nodeId,
              ...(action.blockId ? { blockId: action.blockId } : {}),
            };
            if (onOpenDocument) return onOpenDocument(target);
            const base = `/doc/${action.nodeId ?? action.documentId}`;
            return pushPath(action.blockId ? `${base}?block=${action.blockId}` : base);
          }
          case "question":
            if (onOpenQuestion)
              return onOpenQuestion({ questionId: action.questionId, nodeId: action.nodeId });
            return pushPath(`/practice?question=${action.questionId}`);
          case "concept":
            if (onOpenConcept) return onOpenConcept(action.conceptId);
            return pushPath(`/concepts/${action.conceptId}`);
        }
      },
    }),
    [store, openSource, openNode, onOpenDocument, onOpenQuestion, onOpenConcept],
  );
  return <Env.Provider value={env}>{children}</Env.Provider>;
}
