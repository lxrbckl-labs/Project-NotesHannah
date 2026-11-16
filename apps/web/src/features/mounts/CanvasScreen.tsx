import { useQuery } from "@tanstack/react-query";
import { ArrowLeft, BookOpen } from "lucide-react";
import { Link, useNavigate } from "react-router";
import { ErrorState, Skeleton } from "../../components/ui/states";
import { appHttp } from "../../lib/api";
import type { CanvasStore } from "../canvas";
import { CanvasView, HttpCanvasStore, MemoryCanvasStore } from "../canvas";
import { useStores } from "./services";

/**
 * The canvas of a document. The canvas server does not exist yet, so the canvas is derived from the
 * real document's blocks (`deriveCanvas`) and the cards she pins are kept in this browser. As soon
 * as `GET /api/documents/:id/canvas` answers, the HTTP store takes over, with no change here.
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

  if (canvas.isPending) return <Skeleton className="m-6 h-64" />;
  if (canvas.isError)
    return (
      <div className="p-6">
        <ErrorState error={canvas.error} onRetry={() => canvas.refetch()} />
      </div>
    );
  return (
    <div className="relative h-full" data-testid="canvas-screen">
      {/* Always there, whatever the canvas's own bar is showing: the way back to the page. */}
      <Link
        to={`/doc/${nodeId}`}
        aria-label="Switch to the page view"
        className="absolute bottom-[max(0.75rem,env(safe-area-inset-bottom))] left-3 z-10 flex min-h-11 items-center gap-2 rounded-xl border border-border bg-surface px-3.5 text-sm font-medium shadow-card hover:bg-surface-muted"
      >
        <BookOpen size={16} aria-hidden />
        Page view
      </Link>
      <CanvasView
        store={canvas.data}
        documentId={documentId}
        onSwitchToPage={() => navigate(`/doc/${nodeId}`)}
        onOpenBlock={(blockId) => navigate(`/doc/${nodeId}?block=${blockId}`)}
        topBarExtras={
          <Link
            to={parentId ? `/library/${parentId}` : "/library"}
            aria-label={`Back to the library from ${title}`}
            className="flex size-9 items-center justify-center rounded-lg text-text-muted hover:bg-surface-muted"
          >
            <ArrowLeft size={18} />
          </Link>
        }
      />
    </div>
  );
}
