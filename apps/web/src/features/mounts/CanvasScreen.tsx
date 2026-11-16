import type { Block } from "@notes/schema";
import { useQuery } from "@tanstack/react-query";
import { ArrowLeft, BookOpen } from "lucide-react";
import { lazy, Suspense, useCallback } from "react";
import { Link, useNavigate } from "react-router";
import { ErrorState, Skeleton } from "../../components/ui/states";
import { appHttp } from "../../lib/api";
import type { CanvasStore } from "../canvas";
import { CanvasView, HttpCanvasStore, MemoryCanvasStore } from "../canvas";
import { useStores } from "./services";

const CanvasBlock = lazy(() => import("./CanvasBlocks"));

/**
 * The canvas of a document. The server's canvas (`GET /api/documents/:id/canvas`, with live updates)
 * is used whenever it answers; the in-browser fallback (derived from the blocks, pins kept in this
 * browser) only serves an older server. Its cards draw their blocks with the documents module's own
 * read-only renderers, loaded lazily so the canvas bundle does not pull in the editor.
 */
export default function CanvasScreen({
  documentId,
  nodeId,
  title,
  parentId,
}: {
  documentId: string;
  nodeId: string;
  title: string;
  parentId: string | null;
}) {
  const stores = useStores();
  const navigate = useNavigate();
  const canvas = useQuery({
    queryKey: ["canvas-store", documentId],
    gcTime: 0,
    staleTime: 0,
    queryFn: async (): Promise<CanvasStore> => {
      const actor = stores.documents.actor;
      try {
        await appHttp.get(`/documents/${documentId}/canvas`);
        return new HttpCanvasStore({ actor });
      } catch {
        const doc = await stores.documents.loadDocument(documentId);
        return new MemoryCanvasStore({
          actor,
          persistKey: "notes-canvas",
          documents: [{ id: documentId, title: doc.title, blocks: doc.blocks }],
        });
      }
    },
  });

  // The document's blocks, for numbering citations the same way the page does.
  const document = useQuery({
    queryKey: ["canvas-document", documentId],
    queryFn: () => stores.documents.loadDocument(documentId),
  });
  const doc = document.data;
  const renderBlock = useCallback(
    (block: Block) =>
      doc ? (
        <Suspense fallback={<Skeleton className="h-10" />}>
          <CanvasBlock
            block={block}
            document={doc}
            store={stores.documents}
            onOpenConcept={(id) => navigate(`/concepts/${id}`)}
            onOpenQuestion={(id) => navigate(`/question/${id}`)}
            onOpenCitation={(blockId) => navigate(`/doc/${nodeId}?block=${blockId}`)}
          />
        </Suspense>
      ) : (
        <Skeleton className="h-10" />
      ),
    [doc, stores.documents, navigate, nodeId],
  );

  if (canvas.isPending) return <Skeleton className="m-6 h-64" />;
  if (canvas.isError)
    return (
      <div className="p-6">
        <ErrorState error={canvas.error} onRetry={() => canvas.refetch()} />
      </div>
    );
  return (
    <div className="flex h-full min-h-0 flex-col" data-testid="canvas-screen">
      {/* The way back to the page, always there whatever the canvas's own bar is showing. */}
      <div className="flex items-center gap-2 border-b border-border bg-surface px-3 py-1.5">
        <Link
          to={parentId ? `/library/${parentId}` : "/library"}
          aria-label={`Back to the library from ${title}`}
          className="flex size-10 items-center justify-center rounded-lg text-text-muted hover:bg-surface-muted"
        >
          <ArrowLeft size={18} />
        </Link>
        <p className="min-w-0 flex-1 truncate text-sm font-medium">{title}</p>
        <Link
          to={`/doc/${nodeId}`}
          aria-label="Switch to the page view"
          className="flex min-h-10 items-center gap-2 rounded-xl border border-border px-3.5 text-sm font-medium hover:bg-surface-muted"
        >
          <BookOpen size={16} aria-hidden />
          Page view
        </Link>
      </div>
      <div className="min-h-0 flex-1">
        <CanvasView
          store={canvas.data}
          documentId={documentId}
          renderBlock={renderBlock}
          onOpenConcept={(id) => navigate(`/concepts/${id}`)}
          onSwitchToPage={() => navigate(`/doc/${nodeId}`)}
          onOpenBlock={(blockId) => navigate(`/doc/${nodeId}?block=${blockId}`)}
        />
      </div>
    </div>
  );
}
