import { Star } from "lucide-react";
import { Link } from "react-router";
import { Button } from "../../components/ui/button";
import { formatDateTime } from "../../lib/format";
import { AskButton } from "../mounts/ask";
import { useNodeActions } from "./actions";
import { useCourseHue } from "./courseHue";
import { NodeTile } from "./NodeIcon";
import { nodeTitle } from "./NodeRow";
import { useNode } from "./queries";
import { KIND_NAME } from "./rules";

/** Computer layout only: details of the open item, and quick actions. */
export function RightPanel({ nodeId }: { nodeId: string | undefined }) {
  const node = useNode(nodeId);
  const actions = useNodeActions();
  const hue = useCourseHue(node.data);
  return (
    <aside
      data-testid="right-panel"
      aria-label="Details"
      className="flex w-72 shrink-0 flex-col overflow-y-auto border-l border-border bg-surface p-5"
    >
      <h2 className="mb-4 font-sans text-caption font-semibold uppercase tracking-wide text-text-muted">
        Details
      </h2>
      {!nodeId ? (
        <p className="text-sm text-text-muted">
          Open a course or lecture and its details show up here.
        </p>
      ) : node.isPending ? (
        <div className="skeleton h-24" role="status" aria-label="Loading details" />
      ) : node.isError ? (
        <p className="text-sm text-danger">Details could not load.</p>
      ) : (
        <div data-hue={hue ?? undefined} className="grid gap-4 text-ui">
          <div className="flex items-center gap-3">
            <NodeTile kind={node.data.kind} section={node.data.section} hue={hue} size="lg" />
            <div className="min-w-0">
              <p className="truncate font-semibold">{nodeTitle(node.data)}</p>
              <p className="text-text-muted">
                {node.data.section ? "Section" : KIND_NAME[node.data.kind]}
              </p>
            </div>
          </div>
          <dl className="grid gap-3">
            <Row label="Location" value={node.data.path} />
            <Row label="Items inside" value={String(node.data.childCount)} />
            <Row label="Created" value={formatDateTime(node.data.createdAt)} />
            <Row label="Changed" value={formatDateTime(node.data.updatedAt)} />
          </dl>
          <Button
            aria-pressed={node.data.favourite}
            onClick={() => void actions.setFavourite(node.data, !node.data.favourite)}
          >
            <Star
              size={16}
              className={node.data.favourite ? "fill-accent text-accent" : ""}
              aria-hidden
            />
            {node.data.favourite ? "Favourited" : "Add to favourites"}
          </Button>
          <AskButton
            target={{ type: "node", nodeId: node.data.id }}
            label={node.data.name}
            text="Ask an agent about this"
            className="justify-start"
          />
          <Link to="/trash" className="text-text-muted underline-offset-2 hover:underline">
            Open trash
          </Link>
        </div>
      )}
    </aside>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-caption text-text-muted">{label}</dt>
      <dd className="mt-0.5 break-words">{value}</dd>
    </div>
  );
}
