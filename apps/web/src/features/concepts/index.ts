/**
 * Concepts: pages for drugs, classes and mechanisms, a small relationship graph, cross-course
 * questions, comparison tables and the brand and generic drill. Self-contained: the shell mounts
 * `ConceptView` at /concepts/:id and `ConceptsIndex` at /concepts and injects the store.
 * See apps/web/INTEGRATION.md.
 */
export { ComparisonTable } from "./Compare";
export { ConceptsIndex, type ConceptsIndexProps, listAllConcepts } from "./ConceptsIndex";
export { ConceptView } from "./ConceptView";
export { createHttpConceptsStore } from "./store/http";
export {
  createMockConceptsStore,
  type MockConceptsOptions,
  type MockConceptsStore,
} from "./store/mock";
export type {
  ConceptsMountContext,
  ConceptsNavigation,
  ConceptsStore,
  ConceptsViewProps,
  GraphOptions,
  ListQuery,
} from "./types";
