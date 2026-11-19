import type { NodeWithLinks } from "@notes/schema";
import {
  ArrowLeft,
  BookOpen,
  BookPlus,
  CalendarPlus,
  FilePlus,
  FolderPlus,
  GraduationCap,
  MoreHorizontal,
  Presentation,
  Star,
  Upload,
} from "lucide-react";
import { useState } from "react";
import { useNavigate } from "react-router";
import { ActionBar, ActionButton, ActionDivider } from "../../components/ui/action-bar";
import { IconButton } from "../../components/ui/button";
import { ActionMenu } from "../../components/ui/menu";
import { cn } from "../../lib/cn";
import { useBack } from "../../lib/useBack";
import { useUploadPicker } from "../uploads/UploadProvider";
import { useNodeActions } from "./actions";
import { Breadcrumbs } from "./Breadcrumbs";
import { useCourseHue } from "./courseHue";
import { useLibraryDialogs } from "./dialogs";
import { InlineName } from "./InlineName";
import { NodeTile } from "./NodeIcon";
import { nodeMeta, nodeTitle } from "./NodeRow";
import { canHoldFiles } from "./picker";
import { type CreatableKind, creatableIn, KIND_NAME } from "./rules";
import { useNodeMenu } from "./useNodeMenu";

const MOCK = import.meta.env.VITE_MOCK_API === "1";

/** What each "New ..." action looks like in the bar. */
function KindIcon({ kind }: { kind: CreatableKind }) {
  const Icon = {
    term: CalendarPlus,
    course: BookPlus,
    folder: FolderPlus,
    lecture: Presentation,
    document: FilePlus,
  }[kind];
  return <Icon aria-hidden />;
}

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
  const pick = useUploadPicker();
  const opensAsPage = !MOCK && (node.kind === "lecture" || node.kind === "document");
  const canPractise = !MOCK && ["lecture", "folder", "course", "term"].includes(node.kind);

  return (
    <header data-hue={hue ?? undefined} className="mb-6">
      <div className="mb-3 flex items-center gap-1">
        <IconButton
          aria-label="Back"
          variant="secondary"
          onClick={back}
          className="nav-back mr-1 md:hidden"
        >
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
            aria-label={node.favourite ? "Remove from favorites" : "Add to favorites"}
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
        // One bar, one line, an icon for every action (components/ui/action-bar).
        <ActionBar label={`Actions for ${node.name}`} className="mt-5">
          {creatable.map((kind, i) => (
            <ActionButton
              key={kind}
              icon={<KindIcon kind={kind} />}
              label={`New ${KIND_NAME[kind].toLowerCase()}`}
              primary={i === 0 && !fixed && !opensAsPage}
              onClick={() => dialogs.openCreate(node, kind)}
            />
          ))}
          {opensAsPage ? (
            <>
              {creatable.length > 0 ? <ActionDivider /> : null}
              <ActionButton
                icon={<BookOpen aria-hidden />}
                label="Open the page"
                primary
                onClick={() => navigate(`/doc/${node.id}`)}
              />
            </>
          ) : null}
          {canPractise || canHoldFiles(node) ? <ActionDivider /> : null}
          {canPractise ? (
            <ActionButton
              icon={<GraduationCap aria-hidden />}
              label="Practice this"
              onClick={() => navigate(`/practice?node=${node.id}`)}
            />
          ) : null}
          {canHoldFiles(node) ? (
            <ActionButton
              icon={<Upload aria-hidden />}
              label="Upload files"
              onClick={() => pick({ nodeId: node.id, label: node.name })}
            />
          ) : null}
        </ActionBar>
      ) : null}
    </header>
  );
}
