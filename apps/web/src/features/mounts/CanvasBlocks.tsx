import type { Block, DocumentWithBlocks } from "@notes/schema";
import { useMemo } from "react";
import { BlockBoundary, BlockContent } from "../documents/blocks/registry";
import {
  ActionsContext,
  type DocActions,
  type DocView,
  Signal,
  ViewContext,
} from "../documents/context";
import { buildReferenceIndex } from "../documents/model/references";
import type { DocumentStore } from "../documents/store/types";
import { useLayout } from "../documents/ui/hooks";

/**
 * The documents module's REAL block renderers, read-only, for the cards of the canvas. This file is
 * loaded lazily (`React.lazy` in CanvasScreen), so the canvas bundle does not carry the editor until
 * a card is actually drawn with real content.
 */
export interface CanvasBlocksProps {
  block: Block;
  document: DocumentWithBlocks;
  store: DocumentStore;
  onOpenConcept: (conceptId: string) => void;
  onOpenQuestion: (questionId: string) => void;
  onOpenCitation: (blockId: string) => void;
}

const nothing = () => {};

export default function CanvasBlock({
  block,
  document: doc,
  store,
  onOpenConcept,
  onOpenQuestion,
  onOpenCitation,
}: CanvasBlocksProps) {
  const layout = useLayout();
  const view = useMemo<DocView>(
    () => ({
      editing: false,
      isTouch: layout !== "computer",
      layout,
      refs: buildReferenceIndex(doc.blocks),
      status: new Map(),
      activeCitation: null,
    }),
    [doc.blocks, layout],
  );
  const actions = useMemo(
    () =>
      ({
        store,
        documentId: doc.id,
        openConcept: onOpenConcept,
        openQuestion: onOpenQuestion,
        openCitation: () => onOpenCitation(block.id),
        askAbout: nothing,
        perform: () => false,
        justDragged: () => false,
        startDrag: nothing,
        requestFocus: nothing,
        setActive: nothing,
        openInsertMenu: nothing,
        notify: nothing,
        pickPage: nothing,
        active: new Signal<string | null>(null),
        focus: new Signal(null),
        activeEditor: new Signal(null),
        slashQuery: new Signal(null),
        slashKeyHandler: { current: null },
        docRef: { current: doc },
      }) as unknown as DocActions,
    [store, doc, block.id, onOpenConcept, onOpenQuestion, onOpenCitation],
  );
  return (
    <ActionsContext.Provider value={actions}>
      <ViewContext.Provider value={view}>
        <BlockBoundary type={String(block.type)} content={block.content}>
          <BlockContent block={block} />
        </BlockBoundary>
      </ViewContext.Provider>
    </ActionsContext.Provider>
  );
}
