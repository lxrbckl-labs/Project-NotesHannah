/** The documents feature: page view, block editor, citations, outline, history. */
export { DocumentView, type DocumentViewProps } from "./DocumentView";
export type { OperationCall, OperationResult } from "./model/ops";
export { HttpDocumentStore, type HttpStoreOptions } from "./store/http-store";
export { MockDocumentStore, type MockStoreOptions } from "./store/mock-store";
export {
  type BlockRequestInput,
  type CitationSource,
  type DocumentStore,
  type PageChoice,
  type PageImage,
  REQUEST_KINDS,
  type ReferenceWithStatus,
  type RequestKind,
  StoreError,
} from "./store/types";
