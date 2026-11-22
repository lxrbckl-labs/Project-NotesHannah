import { ArrowLeft } from "lucide-react";
import { useParams, useSearchParams } from "react-router";
import { Page } from "../../components/Page";
import { IconButton } from "../../components/ui/button";
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
      <SourceViewer
        fileId={fileId}
        pageId={params.get("page") ?? undefined}
        highlightQuote={quote}
        headerLead={
          <IconButton aria-label="Back" variant="secondary" onClick={back} className="nav-back">
            <ArrowLeft size={20} aria-hidden />
          </IconButton>
        }
        headerActions={
          <AskButton
            target={{
              type: "source",
              fileId,
              ...(params.get("page") ? { pageId: params.get("page") as string } : {}),
            }}
            label="this source"
            text="Ask an agent about this page"
          />
        }
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
