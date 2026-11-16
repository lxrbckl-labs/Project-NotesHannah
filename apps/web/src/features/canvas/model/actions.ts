import type { Block } from "@notes/schema";
import { createContext, type ReactNode, useContext } from "react";

/**
 * Callbacks the node and edge components use. The object is stable for the
 * life of the view (it reads current state through refs), so a change in
 * one card never re-renders the other 299.
 */
export interface CanvasActions {
  renderBlock(block: Block): ReactNode;
  saveNote(cardId: string, text: string): void;
  stopEditing(): void;
  stopReading(): void;
  longPress(cardId: string): void;
  editConnector(edgeId: string): void;
  renameFrame(frameId: string, title: string): void;
  isCoarse(): boolean;
}

export const CanvasActionsContext = createContext<CanvasActions | null>(null);

export function useCanvasActions(): CanvasActions {
  const actions = useContext(CanvasActionsContext);
  if (!actions) throw new Error("Canvas nodes must render inside CanvasView");
  return actions;
}
