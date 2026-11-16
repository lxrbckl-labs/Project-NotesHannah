import { type DocumentKind, lectureLabel } from "@notes/schema";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ArrowLeft,
  BookOpen,
  GraduationCap,
  Layers,
  Paperclip,
  PenLine,
  Sparkles,
} from "lucide-react";
import { lazy, Suspense, useState } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router";
import { Button } from "../../components/ui/button";
import { EmptyState, ErrorState, Skeleton } from "../../components/ui/states";
import { useToast } from "../../components/ui/toast";
import { appHttp, isApiError } from "../../lib/api";
import { cn } from "../../lib/cn";
import { DocumentView } from "../documents";
import { useNode } from "../library/queries";
import { useStores } from "./services";

const CanvasScreen = lazy(() => import("./CanvasScreen"));

interface LightDocument {
  document: { id: string; title: string; kind: DocumentKind };
  blocks: unknown[];
  unverifiedCount?: number;
}

const kindFor = (nodeKind: string, section: string | null): DocumentKind =>
  nodeKind === "lecture" ? "lecture_note" : section === "practice" ? "practice_set" : "study_guide";

/**
 * A lecture or document node opened as its document. The server holds one document per node and
 * refuses a second one, so the first open creates it (the node's name is its title).
 */
function DocScreen({ mode }: { mode: "page" | "canvas" }) {
  const { nodeId = "" } = useParams();
  const [search] = useSearchParams();
  const node = useNode(nodeId);
  const stores = useStores();
  const client = useQueryClient();
  const navigate = useNavigate();
  const toast = useToast();
  const [writing, setWriting] = useState(false);

  const doc = useQuery({
    queryKey: ["document", "of-node", nodeId],
    enabled: !!node.data,
    gcTime: 0,
    queryFn: async (): Promise<LightDocument> => {
      const n = node.data;
      if (!n) throw new Error("no node");
      try {
        return await appHttp.get<LightDocument>(`/nodes/${nodeId}/document`);
      } catch (error) {
        if (!(isApiError(error) && error.code === "not_found")) throw error;
        if (n.kind !== "lecture" && n.kind !== "document") throw error;
        await appHttp.post("/documents", {
          nodeId,
          kind: kindFor(n.kind, n.section),
          title: n.name,
        });
        return appHttp.get<LightDocument>(`/nodes/${nodeId}/document`);
      }
    },
  });

  if (node.isPending || (node.data && doc.isPending)) {
    return (
      <div role="status" aria-label="Loading document" className="grid gap-4 p-6">
        <Skeleton className="h-10 w-72" />
        <Skeleton className="h-64" />
      </div>
    );
  }
  if (node.isError)
    return (
      <div className="p-6">
        <ErrorState error={node.error} onRetry={() => node.refetch()} />
      </div>
    );
  const n = node.data;
  if (n.kind !== "lecture" && n.kind !== "document") {
    return (
      <div className="p-6">
        <EmptyState icon={<BookOpen size={26} />} title="Only lectures and documents have a page">
          <Link className="text-accent underline" to={`/library/${n.id}`}>
            Open {n.name} in the library
          </Link>
        </EmptyState>
      </div>
    );
  }
  if (doc.isError)
    return (
      <div className="p-6">
        <ErrorState error={doc.error} onRetry={() => doc.refetch()} />
      </div>
    );

  const light = doc.data;
  if (!light) return <Skeleton className="m-6 h-64" />;
  const documentId = light.document.id;
  const empty = light.blocks.length === 0 && !writing;
  const title = n.kind === "lecture" ? lectureLabel(n.name, n.lecture) : n.name;
  const base = `/doc/${nodeId}`;

  async function askAgent() {
    try {
      await appHttp.post("/requests", {
        target: { type: "node", nodeId },
        kind: "other",
        message: `Write a study guide for ${title}`,
      });
      void client.invalidateQueries({ queryKey: ["requests"] });
      toast.show("Request left. An agent can pick it up from your requests.");
    } catch (error) {
      toast.error(error);
    }
  }

  return (
    <div className="flex h-full min-h-0 flex-col" data-testid="doc-screen" data-mode={mode}>
      {mode === "page" ? (
        <header className="flex flex-wrap items-center gap-x-3 gap-y-2 border-b border-border bg-surface/90 px-3 py-2 md:px-5">
          <Link
            to={n.parentId ? `/library/${n.parentId}` : "/library"}
            aria-label="Back to the library"
            className="flex size-11 items-center justify-center rounded-xl text-text-muted hover:bg-surface-muted xl:size-9"
          >
            <ArrowLeft size={20} />
          </Link>
          <div className="min-w-0 flex-1">
            <h1 className="truncate font-display text-lg font-semibold md:text-xl">{title}</h1>
            <p className="truncate text-xs text-text-muted">{n.path}</p>
          </div>
          <div
            role="tablist"
            aria-label="View"
            className="flex gap-1 rounded-xl border border-border bg-surface-muted p-1"
          >
            {[
              { label: "Page", to: base, on: true, icon: BookOpen },
              { label: "Canvas", to: `${base}/canvas`, on: false, icon: Layers },
            ].map((t) => (
              <Link
                key={t.label}
                role="tab"
                aria-selected={t.on}
                to={t.to}
                className={cn(
                  "flex min-h-9 items-center gap-1.5 rounded-lg px-3 text-sm font-medium",
                  t.on ? "bg-surface text-text shadow-sm" : "text-text-muted hover:text-text",
                )}
              >
                <t.icon size={15} aria-hidden />
                {t.label}
              </Link>
            ))}
          </div>
          <Link
            to={`/library/${n.id}`}
            className="flex min-h-9 items-center gap-1.5 rounded-xl px-3 text-sm text-text-muted hover:bg-surface-muted"
          >
            <Paperclip size={15} aria-hidden />
            Sources
          </Link>
          <Button onClick={() => navigate(`/practice?node=${n.id}`)} aria-label="Practise this">
            <GraduationCap size={16} aria-hidden />
            <span className="hidden sm:inline">Practise this</span>
          </Button>
        </header>
      ) : null}

      <div className="min-h-0 flex-1">
        {mode === "canvas" ? (
          <Suspense fallback={<Skeleton className="m-6 h-64" />}>
            <CanvasScreen
              documentId={documentId}
              nodeId={nodeId}
              title={title}
              parentId={n.parentId}
            />
          </Suspense>
        ) : empty ? (
          <div className="mx-auto max-w-xl p-6">
            <EmptyState icon={<Sparkles size={26} />} title="Nothing written here yet">
              An agent such as Claude Code can write this from your slides and notes, with every
              claim pointing back to the page it came from. You can also start writing yourself.
            </EmptyState>
            <div className="mt-5 flex flex-wrap justify-center gap-2">
              <Button variant="primary" onClick={askAgent}>
                <Sparkles size={16} aria-hidden />
                Write a study guide for this lecture
              </Button>
              <Button onClick={() => setWriting(true)}>
                <PenLine size={16} aria-hidden />
                Start writing
              </Button>
            </div>
          </div>
        ) : (
          <DocumentView
            store={stores.documents}
            documentId={documentId}
            focusBlockId={search.get("block") ?? undefined}
            onOpenQuestion={(id) => navigate(`/practice?question=${id}`)}
            onOpenConcept={(id) => navigate(`/concepts/${id}`)}
            className="h-full"
          />
        )}
      </div>
    </div>
  );
}

export const DocPageRoute = () => <DocScreen mode="page" />;
export const DocCanvasRoute = () => <DocScreen mode="canvas" />;

export default DocScreen;
