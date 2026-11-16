import { useQuery } from "@tanstack/react-query";
import { Sparkles } from "lucide-react";
import { useMemo } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router";
import { Page } from "../../components/Page";
import { EmptyState, Skeleton } from "../../components/ui/states";
import { appHttp } from "../../lib/api";
import { SourceViewer } from "../sources/SourceViewer";
import {
  CONTRACT,
  type FeatureKey,
  type LoadedFeature,
  loadFeature,
  type MountContext,
} from "./modules";

const BLURB: Record<FeatureKey, string> = {
  documents: "Study guides and notes you can read and edit will open here.",
  canvas: "The canvas view of a document, with cards and connectors, will open here.",
  practice: "Practice questions, flashcards and your notebook of missed questions will live here.",
  practiceSession: "A practice session will run here.",
  exams: "Your exams, their dates and what each one covers will be listed here.",
  requests: "Things you ask an agent to make for you will be listed here.",
  concepts: "Drugs and drug classes, gathered from all your courses, will open here.",
};

/** Mount point for a feature built as its own module. Shows "coming soon" until the module exists. */
export function Mount({ feature }: { feature: FeatureKey }) {
  const loaded = useQuery({
    queryKey: ["mount", feature],
    queryFn: () => loadFeature(feature),
    staleTime: Number.POSITIVE_INFINITY,
  });

  if (loaded.isPending) {
    return (
      <Page>
        <Skeleton className="h-10 w-56" />
      </Page>
    );
  }
  if (loaded.isError || !loaded.data?.ok) {
    const reason =
      loaded.data && !loaded.data.ok ? loaded.data.reason : "The module could not be loaded.";
    return (
      <Page>
        <h1 className="mb-5 text-3xl font-semibold">{CONTRACT[feature].title}</h1>
        <EmptyState icon={<Sparkles size={26} />} title="Coming soon">
          {BLURB[feature]}
          {loaded.data && !loaded.data.ok && !loaded.data.missing ? ` ${reason}` : ""}
        </EmptyState>
      </Page>
    );
  }

  return <Loaded feature={loaded.data.feature} />;
}

function Loaded({ feature }: { feature: LoadedFeature }) {
  const params = useParams();
  const [search] = useSearchParams();
  const navigate = useNavigate();
  const { Root, createStore } = feature;
  const store = useMemo(() => createStore(appHttp), [createStore]);
  const context: MountContext = {
    params,
    search,
    openSource: ({ fileId, pageId, quote }) => {
      const q = new URLSearchParams();
      if (pageId) q.set("page", pageId);
      if (quote) q.set("quote", quote);
      navigate(`/files/${fileId}${q.size ? `?${q}` : ""}`);
    },
    openNode: (nodeId) => navigate(`/library/${nodeId}`),
    SourceViewer,
  };
  return <Root store={store} {...context} />;
}

export const DocumentsMount = () => <Mount feature="documents" />;
export const CanvasMount = () => <Mount feature="canvas" />;
export const PracticeMount = () => <Mount feature="practice" />;
export const PracticeSessionMount = () => <Mount feature="practiceSession" />;
export const ExamsMount = () => <Mount feature="exams" />;
export const RequestsMount = () => <Mount feature="requests" />;
export const ConceptsMount = () => <Mount feature="concepts" />;
