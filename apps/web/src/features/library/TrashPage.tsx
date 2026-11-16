import type { NodeWithLinks } from "@notes/schema";
import { RotateCcw, Trash2 } from "lucide-react";
import { useState } from "react";
import { Page } from "../../components/Page";
import { Button } from "../../components/ui/button";
import { ConfirmDialog } from "../../components/ui/dialog";
import { EmptyState, ErrorState, LoadingList } from "../../components/ui/states";
import { useToast } from "../../components/ui/toast";
import { formatAgo } from "../../lib/format";
import { useNodeActions } from "./actions";
import { NodeIcon } from "./NodeIcon";
import { nodeTitle } from "./NodeRow";
import { useTrash } from "./queries";

export function TrashPage() {
  const query = useTrash();
  const actions = useNodeActions();
  const toast = useToast();
  const [confirming, setConfirming] = useState<NodeWithLinks | null>(null);

  return (
    <Page>
      <header className="mb-6">
        <h1 className="text-3xl font-semibold">Trash</h1>
        <p className="mt-1 text-sm text-text-muted">
          Restore things you removed by mistake. Deleting from here is permanent.
        </p>
      </header>

      {query.isPending ? (
        <LoadingList label="Loading trash" />
      ) : query.isError ? (
        <ErrorState error={query.error} onRetry={() => query.refetch()} />
      ) : query.data.length === 0 ? (
        <EmptyState icon={<Trash2 size={26} />} title="The trash is empty">
          Anything you move to the trash waits here until you delete it for good.
        </EmptyState>
      ) : (
        <ul className="grid gap-2.5" aria-label="Trashed items">
          {query.data.map((node) => (
            <li
              key={node.id}
              data-testid="trash-row"
              className="flex flex-wrap items-center gap-3 rounded-2xl border border-border bg-surface p-3 shadow-card"
            >
              <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-surface-muted text-text-muted">
                <NodeIcon kind={node.kind} section={node.section} />
              </span>
              <div className="min-w-0 flex-1 basis-48">
                <p className="truncate font-medium">{nodeTitle(node)}</p>
                <p className="truncate text-sm text-text-muted">
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
            </li>
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
