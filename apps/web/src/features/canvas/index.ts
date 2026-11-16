/** The canvas feature: a second view of a document (E1–E6). See docs/canvas.md. */
export { CanvasView, type CanvasViewProps } from "./CanvasView";
export { FallbackBlock } from "./render/FallbackBlock";
export { HttpCanvasStore, type HttpStoreOptions } from "./store/http-store";
export {
  MemoryCanvasStore,
  type MemoryDocument,
  type MemoryStoreOptions,
} from "./store/memory-store";
export type { ApplyOutcome, CanvasStore, LoadedCanvas, Placement } from "./store/types";
