import { PanelRightClose, Star } from "lucide-react";
import { Link } from "react-router";
import { Button, IconButton } from "../../components/ui/button";
import { formatDateTime } from "../../lib/format";
import { AskButton } from "../mounts/ask";
import { useNodeActions } from "./actions";
import { useCourseHue } from "./courseHue";
import { NodeTile } from "./NodeIcon";
import { nodeTitle } from "./NodeRow";
import { useNode } from "./queries";
import { KIND_NAME } from "./rules";

/** Computer layout only: details of the open item, and quick actions. */
export function RightPanel({
  nodeId,
  onCollapse,
}: {
  nodeId: string | undefined;
  /** Closes the panel; its button sits in the panel's own header while the panel is open. */
  onCollapse?: () => void;
}) {
  const node = useNode(nodeId);
  const actions = useNodeActions();
  const hue = useCourseHue(node.data);
  return (
    <aside
      data-testid="right-panel"
      aria-label="Details"
      className="flex w-full min-w-0 flex-col border-l border-border bg-surface"
    >
      {/* The same height, padding and line as the header beside it. */}
      <div className="flex items-center gap-2 border-b border-border p-2">
        {onCollapse ? (
          <IconButton aria-label="Hide details panel" onClick={onCollapse}>
            <PanelRightClose size={20} />
          </IconButton>
        ) : null}
        <h2 className="min-w-0 flex-1 px-1 font-sans text-caption font-semibold uppercase tracking-wide text-text-muted">
          Details
        </h2>
      </div>
      <div className="flex min-h-0 flex-1 flex-col overflow-y-auto p-5">
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
              {node.data.favourite ? "Favorited" : "Add to favorites"}
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
      </div>
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
