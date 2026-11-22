import type { NodeWithLinks, SourceFile } from "@notes/schema";
import { useQuery } from "@tanstack/react-query";
import { RotateCcw, Trash2 } from "lucide-react";
import { useState } from "react";
import { Page } from "../../components/Page";
import { Button } from "../../components/ui/button";
import { Card } from "../../components/ui/card";
import { ConfirmDialog } from "../../components/ui/dialog";
import { PageHeader } from "../../components/ui/page-header";
import { EmptyState, ErrorState, LoadingList } from "../../components/ui/states";
import { useToast } from "../../components/ui/toast";
import { api } from "../../lib/api";
import { formatAgo } from "../../lib/format";
import { useNodeActions } from "./actions";
import { useCourseHue } from "./courseHue";
import { useFileActions } from "./fileActions";
import { FileTile, NodeTile } from "./NodeIcon";
import { nodeTitle } from "./NodeRow";
import { fileKeys, useTrash } from "./queries";

export function TrashPage() {
  const query = useTrash();
  const trashedFiles = useQuery({ queryKey: fileKeys.trashed, queryFn: api.trashedFiles });
  const actions = useNodeActions();
  const toast = useToast();
  const [confirming, setConfirming] = useState<NodeWithLinks | null>(null);

  return (
    <Page>
      <PageHeader
        title="Trash"
        description="Restore things you removed by mistake. Deleting from here is permanent."
        icon={<Trash2 />}
        hue="gray"
      />

      <TrashedFiles files={trashedFiles.data ?? []} />

      {query.isPending ? (
        <LoadingList label="Loading trash" />
      ) : query.isError ? (
        <ErrorState error={query.error} onRetry={() => query.refetch()} />
      ) : query.data.length === 0 && (trashedFiles.data?.length ?? 0) === 0 ? (
        <EmptyState icon={<Trash2 size={26} />} title="The trash is empty">
          Anything you move to the trash waits here until you delete it for good.
        </EmptyState>
      ) : query.data.length === 0 ? null : (
        <ul className="grid gap-2.5" aria-label="Trashed items">
          {query.data.map((node) => (
            <Card
              as="li"
              key={node.id}
              data-testid="trash-row"
              padding="sm"
              className="flex flex-wrap items-center gap-3"
            >
              <TrashTile node={node} />
              <div className="min-w-0 flex-1 basis-48">
                <p className="truncate font-medium">{nodeTitle(node)}</p>
                <p className="truncate text-ui text-text-muted">
                  From {node.path.split(" / ").slice(0, -1).join(" / ") || "the top of the library"}
                  {node.trashedAt ? ` · ${formatAgo(node.trashedAt)}` : ""}
                </p>
              </div>
              <div className="flex gap-2">
                <Button
                  aria-label={`Restore ${node.name}`}
                  onClick={async () => {
                    const ok = await actions.restore(node);
                    if (ok) toast.show(`Restored "${node.name}"`);
                  }}
                >
                  <RotateCcw size={16} aria-hidden />
                  Restore
                </Button>
                <Button
                  variant="ghostDanger"
                  aria-label={`Delete ${node.name} forever`}
                  onClick={() => setConfirming(node)}
                >
                  Delete forever
                </Button>
              </div>
            </Card>
          ))}
        </ul>
      )}

      <ConfirmDialog
        open={!!confirming}
        onOpenChange={(open) => !open && setConfirming(null)}
        title={confirming ? `Delete "${confirming.name}" forever?` : ""}
        description={
          confirming
            ? `"${confirming.name}" and anything inside it will be deleted for good. This cannot be undone.`
            : ""
        }
        confirmLabel="Delete forever"
        danger
        onConfirm={() => {
          const target = confirming;
          setConfirming(null);
          if (target) void actions.deleteForever(target);
        }}
      />
    </Page>
  );
}

/** Source files in the trash: restore, or delete for good (only from here, only by her). */
/** A trashed item keeps the colour it had in the library: its course's, or none for a term. */
function TrashTile({ node }: { node: NodeWithLinks }) {
  const hue = useCourseHue(node);
  return <NodeTile kind={node.kind} section={node.section} hue={hue} />;
}

function TrashedFiles({ files: list }: { files: SourceFile[] }) {
  const actions = useFileActions();
  const [confirming, setConfirming] = useState<SourceFile | null>(null);
  if (list.length === 0) return null;
  return (
    <section aria-labelledby="trashed-files-title" className="mb-8">
      <h2 id="trashed-files-title" className="mb-3 text-body font-semibold">
        Files
      </h2>
      <ul className="grid gap-2.5" aria-label="Trashed files">
        {list.map((file) => (
          <Card
            as="li"
            key={file.id}
            data-testid="trash-file-row"
            padding="sm"
            className="flex flex-wrap items-center gap-3"
          >
            <FileTile type={file.type} />
            <div className="min-w-0 flex-1 basis-48">
              <p className="break-words font-medium [overflow-wrap:anywhere]">
                {file.originalName}
              </p>
              <p className="text-ui text-text-muted">
                {file.trashedAt ? formatAgo(file.trashedAt) : ""}
              </p>
            </div>
            <div className="flex gap-2">
              <Button
                aria-label={`Restore ${file.originalName}`}
                onClick={() => void actions.restore(file)}
              >
                <RotateCcw size={16} aria-hidden />
                Restore
              </Button>
              <Button
                variant="ghostDanger"
                aria-label={`Delete ${file.originalName} forever`}
                onClick={() => setConfirming(file)}
              >
                Delete forever
              </Button>
            </div>
          </Card>
        ))}
      </ul>
      <ConfirmDialog
        open={!!confirming}
        onOpenChange={(open) => !open && setConfirming(null)}
        title={confirming ? `Delete "${confirming.originalName}" forever?` : ""}
        description={
          confirming
            ? `"${confirming.originalName}", its pages and its transcripts will be deleted for good. This cannot be undone.`
            : ""
        }
        confirmLabel="Delete forever"
        danger
        onConfirm={() => {
          const target = confirming;
          setConfirming(null);
          if (target) void actions.deleteForever(target);
        }}
      />
    </section>
  );
}
