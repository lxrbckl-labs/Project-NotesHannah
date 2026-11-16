import type {
  BrandGenericPair,
  Citation,
  ComparisonInput,
  ComparisonResult,
  Concept,
  ConceptFilter,
  ConceptPage,
  ConceptSummary,
  ConceptType,
  CreateRequestInput,
  FilterResult,
  GraphResult,
  RelationType,
  ReviewStatus,
  StudyRequest,
} from "@notes/schema";

export type {
  BrandGenericPair,
  Citation,
  ComparisonInput,
  ComparisonResult,
  Concept,
  ConceptFilter,
  ConceptPage,
  ConceptSummary,
  ConceptType,
  FilterResult,
  GraphResult,
  RelationType,
};

export interface ListQuery {
  type?: ConceptType;
  q?: string;
  cursor?: string;
  limit?: number;
}

export interface GraphOptions {
  hops: 1 | 2;
  maxNodes?: number;
  relationTypes?: RelationType[];
}

/** What the concept screens need from the server. Plain object: tests and the demo fake it. */
export interface ConceptsStore {
  list(query?: ListQuery): Promise<{ items: ConceptSummary[]; nextCursor: string | null }>;
  search(q: string, options?: { type?: ConceptType; limit?: number }): Promise<ConceptSummary[]>;
  page(id: string): Promise<ConceptPage>;
  graph(id: string, options: GraphOptions): Promise<GraphResult>;
  query(filter: ConceptFilter): Promise<FilterResult>;
  compare(input: ComparisonInput): Promise<ComparisonResult>;
  brandGeneric(options?: { classId?: string; limit?: number }): Promise<BrandGenericPair[]>;
  review(id: string, status: ReviewStatus): Promise<Concept>;
  merge(keepId: string, mergeId: string): Promise<{ concept: Concept; mergedId: string }>;
  /** Leaves a request (the composer's `submit`). */
  createRequest(input: CreateRequestInput): Promise<StudyRequest>;
}

/** What the shell hands every module (mirrors `MountContext` in features/mounts/modules.ts). */
export interface ConceptsMountContext {
  params: Record<string, string | undefined>;
  search: URLSearchParams;
  openSource: (target: { fileId: string; pageId?: string; quote?: string }) => void;
  openNode: (nodeId: string) => void;
  /** Unused here: citations open through `openSource`. */
  SourceViewer?: unknown;
}

/**
 * Navigation the module needs beyond the mount context. All optional: the defaults push the
 * browser URL (`/concepts/:id`, `/concepts`, `/doc/:nodeId?block=`) and fire `popstate` so the
 * shell's router follows. The demo page overrides them.
 */
export interface ConceptsNavigation {
  onOpenConcept?: (conceptId: string) => void;
  onOpenIndex?: () => void;
  onOpenDocument?: (target: { nodeId: string; blockId?: string | null }) => void;
  onOpenQuestion?: (target: { questionId: string; nodeId: string | null }) => void;
}

export type ConceptsViewProps = { store: ConceptsStore } & ConceptsMountContext &
  ConceptsNavigation;
