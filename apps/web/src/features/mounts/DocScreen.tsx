import { type DocumentKind, lectureLabel } from "@notes/schema";
import { useQuery } from "@tanstack/react-query";
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
import { Button, backButtonClass } from "../../components/ui/button";
import { segmentItemClass } from "../../components/ui/segmented";
import { EmptyState, ErrorState, Skeleton } from "../../components/ui/states";
import { Tooltip } from "../../components/ui/tooltip";
import { appHttp, isApiError } from "../../lib/api";
import { DocumentView } from "../documents";
import { useNode } from "../library/queries";
import { ReferencesButton } from "../references/ReferencesStrip";
import { AskButton, useAsk } from "./ask";
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
  const navigate = useNavigate();
  const ask = useAsk();
  // `?write=1` comes from "New document": she just made it to write in it.
  const [writing, setWriting] = useState(search.get("write") === "1");

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
  // A document she created has nothing to offer but writing; only a lecture's page shows the choice
  // between asking an agent and writing herself.
  const blank = light.blocks.length === 0;
  const empty = blank && !writing && n.kind === "lecture";
  const title = n.kind === "lecture" ? lectureLabel(n.name, n.lecture) : n.name;
  const base = `/doc/${nodeId}`;

  const askAgent = () =>
    ask({
      target: { type: "node", nodeId },
      label: title,
      kind: "other",
      message: `Write a study guide for ${title}`,
    });

  return (
    <div className="flex h-full min-h-0 flex-col" data-testid="doc-screen" data-mode={mode}>
      {mode === "page" ? (
        <header className="flex flex-wrap items-center gap-x-3 gap-y-2 border-b border-border bg-surface px-3 py-2 md:px-5">
          <Tooltip content="Back to the library">
            <Link
              to={n.parentId ? `/library/${n.parentId}` : "/library"}
              aria-label="Back to the library"
              className={backButtonClass}
            >
              <ArrowLeft size={20} />
            </Link>
          </Tooltip>
          <div className="min-w-0 flex-1">
            <h1 className="truncate font-display text-lg font-semibold md:text-xl">{title}</h1>
            <p className="truncate text-xs text-text-muted">{n.path}</p>
          </div>
          {/* One bar for the lecture's actions, so they read as a set: the view switch, then where its
              material is (sources, references, ask), then Practice. Every control is the same height
              (44px on touch, 32px on a computer; `.doc-head-bar` in styles.css) with no edge of its own
              inside the bar. It stays on one line on a phone (down to 375 wide) and on a tablet with
              the sidebar open: only the current view keeps its word, and Sources and Practice are
              icons (names kept) until the computer layout. */}
          <div
            role="toolbar"
            aria-label="This page"
            data-testid="doc-head-bar"
            className="doc-head-bar order-last flex basis-full items-center gap-0.5 rounded-card border border-border-strong bg-surface p-1 shadow-card md:order-none md:basis-auto"
          >
            <div
              role="tablist"
              aria-label="View"
              className="inline-flex gap-0.5 rounded-control bg-surface-muted p-0.5 max-sm:p-0"
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
                  aria-label={t.label}
                  className={`${segmentItemClass(t.on)} max-sm:px-2.5 xl:min-h-7!`}
                >
                  <t.icon size={15} aria-hidden />
                  {/* On a phone only the current view keeps its word: five actions share this row. */}
                  <span className={t.on ? undefined : "max-sm:hidden"}>{t.label}</span>
                </Link>
              ))}
            </div>
            <span aria-hidden className="mx-0.5 h-5 w-px shrink-0 bg-border max-sm:hidden" />
            <Link
              to={`/library/${n.id}`}
              aria-label="Sources"
              className="flex min-w-11 items-center justify-center gap-1.5 rounded-control px-2 text-ui font-medium text-text transition-colors duration-(--duration-instant) hover:bg-surface-muted xl:px-3"
            >
              <Paperclip size={15} aria-hidden />
              <span className="hidden xl:inline">Sources</span>
            </Link>
            <ReferencesButton place={{ nodeId: n.id, name: title, path: n.path }} />
            <AskButton
              target={{ type: "document", documentId }}
              label={title}
              iconOnly
              text="Ask an agent"
            />
            <span aria-hidden className="mx-0.5 h-5 w-px shrink-0 bg-border max-sm:hidden" />
            <Button
              variant="primary"
              onClick={() => navigate(`/practice?node=${n.id}`)}
              aria-label="Practice this"
              className="doc-head-main ml-auto max-xl:w-11 max-xl:px-0"
            >
              <GraduationCap size={16} aria-hidden />
              <span className="hidden xl:inline">Practice this</span>
            </Button>
          </div>
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
            focusNoteId={search.get("note") ?? undefined}
            startWriting={blank}
            onAskAboutBlock={({ blockId, kind }) =>
              ask({
                target: { type: "block", documentId, blockId },
                label: "this block",
                kind,
              })
            }
            onOpenQuestion={(id) => navigate(`/question/${id}`)}
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
