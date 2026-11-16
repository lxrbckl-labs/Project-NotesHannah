import { ArrowLeft } from "lucide-react";
import { useParams, useSearchParams } from "react-router";
import { Page } from "../../components/Page";
import { useBack } from "../../lib/useBack";
import { SourceViewer } from "./SourceViewer";

/** `/files/:fileId?page=<pageId>&quote=<text>`: the viewer as a screen. */
export function SourceFilePage() {
  const { fileId = "" } = useParams();
  const [params, setParams] = useSearchParams();
  const back = useBack("/library");
  const quote = params.get("quote") ?? undefined;
  return (
    <Page className="max-w-7xl">
      <button
        type="button"
        onClick={back}
        className="-ml-2 mb-3 inline-flex min-h-11 items-center gap-2 rounded-xl px-3 text-sm text-text-muted hover:bg-surface-muted hover:text-text"
      >
        <ArrowLeft size={18} aria-hidden /> Back
      </button>
      <SourceViewer
        fileId={fileId}
        pageId={params.get("page") ?? undefined}
        highlightQuote={quote}
        onPageChange={(pageId) => {
          const next = new URLSearchParams(params);
          next.set("page", pageId);
          next.delete("quote");
          setParams(next, { replace: true });
        }}
      />
    </Page>
  );
}
