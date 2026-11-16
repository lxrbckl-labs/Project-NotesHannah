import type { ComponentType } from "react";
import type { AppHttp } from "../../lib/api";

/** What the app gives every feature module's root component, beside its store. */
export interface MountContext {
  /** Route parameters (`nodeId`, `id`) and the query string, already read. */
  params: Record<string, string | undefined>;
  search: URLSearchParams;
  /** Open the source viewer at a page, with a passage highlighted (a citation was clicked). */
  openSource: (target: { fileId: string; pageId?: string; quote?: string }) => void;
  /** Open a library item. */
  openNode: (nodeId: string) => void;
  /** The embeddable source viewer, for citation popovers. Same props as `SourceViewer`. */
  SourceViewer: ComponentType<{
    fileId: string;
    pageId?: string | undefined;
    highlightQuote?: string | undefined;
    region?: { x: number; y: number; width: number; height: number } | undefined;
    onPageChange?: ((pageId: string) => void) | undefined;
  }>;
}

export type FeatureKey =
  | "documents"
  | "canvas"
  | "practice"
  | "practiceSession"
  | "exams"
  | "requests"
  | "concepts"
  | "conceptsIndex";

/**
 * What each module must export from its `index.ts(x)`. The mount reads these names, builds the
 * store with the module's own `createHttp...Store(http)` and renders the root component with
 * `{ store, ...MountContext }`. See apps/web/INTEGRATION.md.
 */
export const CONTRACT: Record<
  FeatureKey,
  { folder: string; root: string; store: string; title: string }
> = {
  documents: {
    folder: "documents",
    root: "DocumentView",
    store: "createHttpDocumentStore",
    title: "Documents",
  },
  canvas: { folder: "canvas", root: "CanvasView", store: "createHttpCanvasStore", title: "Canvas" },
  practice: {
    folder: "practice",
    root: "PracticeHome",
    store: "createHttpPracticeStore",
    title: "Practice",
  },
  practiceSession: {
    folder: "practice",
    root: "PracticeSessionView",
    store: "createHttpPracticeStore",
    title: "Practice session",
  },
  exams: { folder: "exams", root: "ExamsView", store: "createHttpPracticeStore", title: "Exams" },
  requests: {
    folder: "requests",
    root: "RequestsView",
    store: "createHttpRequestsStore",
    title: "Requests",
  },
  concepts: {
    folder: "concepts",
    root: "ConceptView",
    store: "createHttpConceptsStore",
    title: "Concepts",
  },
  conceptsIndex: {
    folder: "concepts",
    root: "ConceptsIndex",
    store: "createHttpConceptsStore",
    title: "Concepts",
  },
};

type Loader = () => Promise<Record<string, unknown>>;

// The feature folders are built by other workers; a missing one is just "coming soon".
// Vite resolves this glob at build time, so a module that appears later is picked up without edits here.
const found = import.meta.glob<Record<string, unknown>>(
  "../{documents,canvas,practice,exams,requests,concepts}/index.{ts,tsx}",
);

export interface LoadedFeature {
  Root: ComponentType<Record<string, unknown>>;
  createStore: (http: AppHttp) => unknown;
}

/** Load a feature module, or say why it cannot be mounted (`missing` = not built yet). */
export async function loadFeature(
  key: FeatureKey,
): Promise<{ ok: true; feature: LoadedFeature } | { ok: false; missing: boolean; reason: string }> {
  const spec = CONTRACT[key];
  const loader: Loader | undefined =
    found[`../${spec.folder}/index.tsx`] ?? found[`../${spec.folder}/index.ts`];
  if (!loader) return { ok: false, missing: true, reason: `${spec.title} is not built yet.` };
  const module = await loader();
  const Root = module[spec.root];
  const createStore = module[spec.store];
  if (typeof Root !== "function" || typeof createStore !== "function") {
    return {
      ok: false,
      missing: false,
      reason: `The ${spec.folder} module must export \`${spec.root}\` and \`${spec.store}\` (see apps/web/INTEGRATION.md).`,
    };
  }
  return {
    ok: true,
    feature: {
      Root: Root as LoadedFeature["Root"],
      createStore: createStore as LoadedFeature["createStore"],
    },
  };
}
