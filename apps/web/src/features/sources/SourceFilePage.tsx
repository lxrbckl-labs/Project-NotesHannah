import { ArrowLeft } from "lucide-react";
import { useParams, useSearchParams } from "react-router";
import { Page } from "../../components/Page";
import { buttonClass } from "../../components/ui/button";
import { useBack } from "../../lib/useBack";
import { AskButton } from "../mounts/ask";
import { SourceViewer } from "./SourceViewer";

/** `/files/:fileId?page=<pageId>&quote=<text>`: the viewer as a screen. */
export function SourceFilePage() {
  const { fileId = "" } = useParams();
  const [params, setParams] = useSearchParams();
  const back = useBack("/library");
  const quote = params.get("quote") ?? undefined;
  return (
    <Page className="max-w-7xl">
      <button type="button" onClick={back} className={buttonClass({ className: "mb-3" })}>
        <ArrowLeft size={18} aria-hidden /> Back
      </button>
      <div className="mb-3 flex justify-end">
        <AskButton
          target={{
            type: "source",
            fileId,
            ...(params.get("page") ? { pageId: params.get("page") as string } : {}),
          }}
          label="this source"
          text="Ask an agent about this page"
        />
      </div>
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
