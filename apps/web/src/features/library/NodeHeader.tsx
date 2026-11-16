import type { NodeWithLinks } from "@notes/schema";
import { ArrowLeft, BookOpen, GraduationCap, MoreHorizontal, Plus, Star } from "lucide-react";
import { useState } from "react";
import { useNavigate } from "react-router";
import { Button, IconButton } from "../../components/ui/button";
import { ActionMenu } from "../../components/ui/menu";
import { cn } from "../../lib/cn";
import { useBack } from "../../lib/useBack";
import { UploadButton } from "../uploads/UploadButton";
import { useNodeActions } from "./actions";
import { Breadcrumbs } from "./Breadcrumbs";
import { useCourseHue } from "./courseHue";
import { useLibraryDialogs } from "./dialogs";
import { InlineName } from "./InlineName";
import { NodeTile } from "./NodeIcon";
import { nodeMeta, nodeTitle } from "./NodeRow";
import { canHoldFiles } from "./picker";
import { creatableIn, KIND_NAME } from "./rules";
import { useNodeMenu } from "./useNodeMenu";

const MOCK = import.meta.env.VITE_MOCK_API === "1";

/** Back link, breadcrumbs, title (renamable in place), favourite, New and the "..." menu. */
export function NodeHeader({ node }: { node: NodeWithLinks }) {
  const navigate = useNavigate();
  const hue = useCourseHue(node);
  const actions = useNodeActions();
  const dialogs = useLibraryDialogs();
  const [renaming, setRenaming] = useState(false);
  const back = useBack(node.parentId ? `/library/${node.parentId}` : "/library");
  const { entries } = useNodeMenu(node, {
    onRename: () => setRenaming(true),
    afterTrash: () => navigate(node.parentId ? `/library/${node.parentId}` : "/library"),
  });
  const creatable = creatableIn(node.kind);
  const fixed = node.kind === "section";

  return (
    <header data-hue={hue ?? undefined} className="mb-6">
      <div className="mb-3 flex items-center gap-1">
        <IconButton aria-label="Back" onClick={back} className="-ml-2 md:hidden">
          <ArrowLeft size={20} />
        </IconButton>
        <div className="min-w-0 flex-1 overflow-x-auto">
          <Breadcrumbs node={node} />
        </div>
      </div>

      <div className="flex items-start gap-3">
        <NodeTile kind={node.kind} section={node.section} hue={hue} size="lg" />
        <div className="min-w-0 flex-1">
          {renaming ? (
            <InlineName
              value={node.name}
              label={`Rename ${node.name}`}
              className="text-2xl font-semibold"
              onCancel={() => setRenaming(false)}
              onCommit={(name) => {
                setRenaming(false);
                void actions.rename(node, name);
              }}
            />
          ) : (
            <h1 className="break-words font-display text-heading font-semibold leading-tight md:text-display">
              {nodeTitle(node)}
            </h1>
          )}
          <p className="mt-1 text-ui text-text-muted">{nodeMeta(node)}</p>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <IconButton
            aria-label={node.favourite ? "Remove from favourites" : "Add to favourites"}
            pressed={node.favourite}
            onClick={() => void actions.setFavourite(node, !node.favourite)}
          >
            <Star size={20} className={cn(node.favourite && "fill-current")} />
          </IconButton>
          <ActionMenu
            trigger={
              <IconButton aria-label={`More actions for ${node.name}`}>
                <MoreHorizontal size={20} />
              </IconButton>
            }
            entries={entries}
          />
        </div>
      </div>

      {creatable.length > 0 || canHoldFiles(node) || node.kind === "document" ? (
        <div className="mt-5 flex flex-wrap gap-2">
          {creatable.map((kind, i) => (
            <Button
              key={kind}
              variant={i === 0 && !fixed ? "primary" : "secondary"}
              onClick={() => dialogs.openCreate(node, kind)}
            >
              <Plus size={16} aria-hidden />
              New {KIND_NAME[kind].toLowerCase()}
            </Button>
          ))}
          {!MOCK && (node.kind === "lecture" || node.kind === "document") ? (
            <Button variant="primary" onClick={() => navigate(`/doc/${node.id}`)}>
              <BookOpen size={16} aria-hidden />
              Open the page
            </Button>
          ) : null}
          {!MOCK && ["lecture", "folder", "course", "term"].includes(node.kind) ? (
            <Button onClick={() => navigate(`/practice?node=${node.id}`)}>
              <GraduationCap size={16} aria-hidden />
              Practise this
            </Button>
          ) : null}
          {canHoldFiles(node) ? (
            <UploadButton nodeId={node.id} target={node.name}>
              Upload files
            </UploadButton>
          ) : null}
        </div>
      ) : null}
    </header>
  );
}
