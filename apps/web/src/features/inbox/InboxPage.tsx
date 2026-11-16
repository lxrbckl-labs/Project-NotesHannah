import { useQuery } from "@tanstack/react-query";
import { CircleAlert, Inbox } from "lucide-react";
import { Page } from "../../components/Page";
import { EmptyState, ErrorState, LoadingList } from "../../components/ui/states";
import { api } from "../../lib/api";
import { cn } from "../../lib/cn";
import { IN_PROGRESS } from "../../lib/messages";
import { useFinePointer } from "../../lib/useMedia";
import { fileKeys } from "../library/queries";
import { FileRow } from "../sources/FileRow";
import { UploadButton } from "../uploads/UploadButton";
import { useFileDrop } from "../uploads/useFileDrop";

/** The converter's health, as a quiet notice only when something is wrong. */
export function ConverterNotice() {
  const status = useQuery({
    queryKey: ["files", "converter"],
    queryFn: api.converterStatus,
    refetchInterval: 15_000,
    retry: false,
  });
  const state = status.data?.state;
  if (!state || state === "online") return null;
  return (
    <p
      role="status"
      data-testid="converter-notice"
      className="mb-4 flex items-start gap-2.5 rounded-2xl bg-surface-muted px-4 py-3 text-sm text-text-muted"
    >
      <CircleAlert size={16} className="mt-0.5 shrink-0" aria-hidden />
      {state === "offline"
        ? "The converter is not running right now. Uploads are saved and will be converted when it is back."
        : "The converter is running slowly. Uploads will be converted as soon as it catches up."}
    </p>
  );
}

export function InboxPage() {
  const fine = useFinePointer();
  const drop = useFileDrop({ nodeId: null, label: "the inbox" }, fine);
  // Poll while anything is converting; look again now and then for transcripts.
  const inbox = useQuery({
    queryKey: fileKeys.inbox,
    queryFn: api.inboxFiles,
    refetchInterval: (query) =>
      query.state.data?.some((f) => IN_PROGRESS.has(f.status)) ? 2000 : 15_000,
  });

  return (
    <Page>
      <div
        {...drop.props}
        data-drop={drop.over ? "into" : undefined}
        className={cn("rounded-3xl", drop.over && "outline-2 outline-accent outline-offset-4")}
      >
        <header className="mb-5 flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-3xl font-semibold">Inbox</h1>
            <p className="mt-1 text-sm text-text-muted">
              New uploads wait here until they are filed under a lecture or folder.
            </p>
          </div>
          <UploadButton nodeId={null} target="the inbox" variant="primary">
            Upload files
          </UploadButton>
        </header>

        <ConverterNotice />

        {inbox.isPending ? (
          <LoadingList label="Loading inbox" />
        ) : inbox.isError ? (
          <ErrorState error={inbox.error} onRetry={() => inbox.refetch()} />
        ) : inbox.data.length === 0 ? (
          <EmptyState
            icon={<Inbox size={26} />}
            title="Nothing waiting"
            action={
              <UploadButton nodeId={null} target="the inbox" variant="primary">
                Upload files
              </UploadButton>
            }
          >
            Upload slides, PDFs or photos of handwritten notes.{" "}
            {fine ? "You can also drop files here." : ""}
          </EmptyState>
        ) : (
          <ul className="grid gap-2.5" aria-label="Unfiled files">
            {inbox.data.map((f) => (
              <FileRow key={f.id} file={f} />
            ))}
          </ul>
        )}
      </div>
    </Page>
  );
}
