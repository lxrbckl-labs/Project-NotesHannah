import { ArrowLeft } from "lucide-react";
import { useParams, useSearchParams } from "react-router";
import { Page } from "../../components/Page";
import { IconButton } from "../../components/ui/button";
import { useBack } from "../../lib/useBack";
import { useHotkey } from "../hotkeys";
import { AskButton, useAsk } from "../mounts/ask";
import { SourceViewer } from "./SourceViewer";

/** `/files/:fileId?page=<pageId>&quote=<text>`: the viewer as a screen. */
export function SourceFilePage() {
  const { fileId = "" } = useParams();
  const [params, setParams] = useSearchParams();
  const back = useBack("/library");
  const quote = params.get("quote") ?? undefined;
  const page = params.get("page");
  const target = { type: "source" as const, fileId, ...(page ? { pageId: page } : {}) };
  // The app's "ask an agent" key asks about this page while it is open.
  const ask = useAsk();
  useHotkey("app.ask", () => ask({ target, label: "this source" }));
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
            target={target}
            hotkey="app.ask"
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
