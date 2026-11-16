import type { NodeWithLinks } from "@notes/schema";
import { isFixed, lectureLabel } from "@notes/schema";
import {
  Copy,
  FolderInput,
  MessageCirclePlus,
  Pencil,
  Plus,
  SlidersHorizontal,
  Star,
  StarOff,
  Trash2,
  Upload,
} from "lucide-react";
import type { MenuEntry } from "../../components/ui/menu";
import { useToast } from "../../components/ui/toast";
import { useAsk } from "../mounts/ask";
import { useUploadPicker } from "../uploads/UploadProvider";
import { useNodeActions } from "./actions";
import { useLibraryDialogs } from "./dialogs";
import { canHoldFiles } from "./picker";
import { creatableIn, isPending, KIND_NAME } from "./rules";

/** The actions on one library item, as menu entries (the same list for "...", right-click and long-press). */
export function useNodeMenu(
  node: NodeWithLinks,
  options: { onRename?: () => void; afterTrash?: () => void } = {},
) {
  const actions = useNodeActions();
  const dialogs = useLibraryDialogs();
  const pickFiles = useUploadPicker();
  const ask = useAsk();
  const toast = useToast();

  const fixed = isFixed(node.kind);
  const pending = isPending(node);

  function trash() {
    void actions.trash(node, () => {
      options.afterTrash?.();
      toast.show(`Moved "${node.name}" to the trash`, {
        label: "Undo",
        run: () => void actions.restore(node),
      });
    });
  }

  const entries: MenuEntry[] = [
    // The full name, for names the row had to cut short (and on touch, where there is no tooltip).
    {
      type: "label",
      text: node.kind === "lecture" ? lectureLabel(node.name, node.lecture) : node.name,
    },
    { type: "separator" },
  ];
  for (const kind of creatableIn(node.kind)) {
    entries.push({
      type: "item",
      label: `New ${KIND_NAME[kind].toLowerCase()}`,
      icon: <Plus size={16} />,
      disabled: pending,
      onSelect: () => dialogs.openCreate(node, kind),
    });
  }
  if (entries.length) entries.push({ type: "separator" });
  if (canHoldFiles(node)) {
    entries.push({
      type: "item",
      label: "Upload files here…",
      icon: <Upload size={16} />,
      disabled: pending,
      onSelect: () => pickFiles({ nodeId: node.id, label: node.name }),
    });
  }
  entries.push({
    type: "item",
    label: "Ask an agent…",
    icon: <MessageCirclePlus size={16} />,
    disabled: pending,
    onSelect: () => ask({ target: { type: "node", nodeId: node.id }, label: node.name }),
  });
  entries.push({
    type: "item",
    label: node.favourite ? "Remove from favourites" : "Add to favourites",
    icon: node.favourite ? <StarOff size={16} /> : <Star size={16} />,
    disabled: pending,
    onSelect: () => void actions.setFavourite(node, !node.favourite),
  });
  if (!fixed) {
    entries.push(
      {
        type: "item",
        label: "Rename",
        icon: <Pencil size={16} />,
        shortcut: "F2",
        disabled: pending || !options.onRename,
        onSelect: () => options.onRename?.(),
      },
      ...(node.kind === "lecture" || node.kind === "course"
        ? [
            {
              type: "item" as const,
              label: "Edit details…",
              icon: <SlidersHorizontal size={16} />,
              disabled: pending,
              onSelect: () => dialogs.openEdit(node),
            },
          ]
        : []),
      {
        type: "item",
        label: "Duplicate",
        icon: <Copy size={16} />,
        disabled: pending,
        onSelect: () => void actions.duplicate(node),
      },
      {
        type: "item",
        label: "Move to…",
        icon: <FolderInput size={16} />,
        disabled: pending,
        onSelect: () => dialogs.openMove(node),
      },
      { type: "separator" },
      {
        type: "item",
        label: "Move to trash",
        icon: <Trash2 size={16} />,
        danger: true,
        disabled: pending,
        shortcut: "Del",
        onSelect: trash,
      },
    );
  }
  return { entries, trash };
}
