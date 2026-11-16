import { createContext, type ReactNode, useContext, useMemo } from "react";
import type { ConceptsMountContext, ConceptsNavigation, ConceptsStore } from "../types";

export interface ConceptsEnv {
  store: ConceptsStore;
  openConcept: (id: string) => void;
  openIndex: () => void;
  openSource: ConceptsMountContext["openSource"];
  openNode: (nodeId: string) => void;
  openDocument: (target: { nodeId: string; blockId?: string | null }) => void;
  openQuestion: (target: { questionId: string; nodeId: string | null }) => void;
}

const Env = createContext<ConceptsEnv | null>(null);

export function useConcepts(): ConceptsEnv {
  const env = useContext(Env);
  if (!env) throw new Error("Concept screens must sit inside <ConceptsProvider>.");
  return env;
}

/** Push a path to the browser history and tell the router (the shell's router listens to popstate). */
export function pushPath(path: string): void {
  window.history.pushState({}, "", path);
  window.dispatchEvent(new PopStateEvent("popstate"));
}

/** Wires props to the screens: every navigation falls back to a URL push when no prop is given. */
export function ConceptsProvider({
  store,
  context,
  navigation,
  children,
}: {
  store: ConceptsStore;
  context: Pick<ConceptsMountContext, "openSource" | "openNode">;
  navigation: ConceptsNavigation;
  children: ReactNode;
}) {
  const { openSource, openNode } = context;
  const { onOpenConcept, onOpenIndex, onOpenDocument, onOpenQuestion } = navigation;
  const env = useMemo<ConceptsEnv>(
    () => ({
      store,
      openSource,
      openNode,
      openConcept: onOpenConcept ?? ((id) => pushPath(`/concepts/${id}`)),
      openIndex: onOpenIndex ?? (() => pushPath("/concepts")),
      openDocument:
        onOpenDocument ??
        (({ nodeId, blockId }) =>
          blockId ? pushPath(`/doc/${nodeId}?block=${blockId}`) : openNode(nodeId)),
      openQuestion: onOpenQuestion ?? (({ nodeId }) => (nodeId ? openNode(nodeId) : undefined)),
    }),
    [store, openSource, openNode, onOpenConcept, onOpenIndex, onOpenDocument, onOpenQuestion],
  );
  return <Env.Provider value={env}>{children}</Env.Provider>;
}
