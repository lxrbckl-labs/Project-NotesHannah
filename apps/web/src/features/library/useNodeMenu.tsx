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
import { creatableIn, isPending, KIND_NAME, NEW_HOTKEY } from "./rules";

/**
 * The actions on one library item, as menu entries (the same list for "...", right-click and long-press).
 * `place` says whose keys the rows show: "page" for the open item's own "..." menu (its page has keys for
 * them), "row" for a row or card, where only the tree's F2 and Delete apply.
 */
export function useNodeMenu(
  node: NodeWithLinks,
  options: { onRename?: () => void; afterTrash?: () => void; place?: "page" | "row" } = {},
) {
  const page = options.place === "page";
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
      ...(page ? { hotkey: NEW_HOTKEY[kind] } : {}),
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
      ...(page ? { hotkey: "app.upload" } : {}),
      onSelect: () => pickFiles({ nodeId: node.id, label: node.name }),
    });
  }
  entries.push({
    type: "item",
    label: "Ask an agent…",
    icon: <MessageCirclePlus size={16} />,
    disabled: pending,
    ...(page ? { hotkey: "app.ask" } : {}),
    onSelect: () => ask({ target: { type: "node", nodeId: node.id }, label: node.name }),
  });
  entries.push({
    type: "item",
    label: node.favourite ? "Remove from favorites" : "Add to favorites",
    icon: node.favourite ? <StarOff size={16} /> : <Star size={16} />,
    disabled: pending,
    ...(page ? { hotkey: "library.favorite" } : {}),
    onSelect: () => void actions.setFavourite(node, !node.favourite),
  });
  if (!fixed) {
    entries.push(
      {
        type: "item",
        label: "Rename",
        icon: <Pencil size={16} />,
        hotkey: page ? "library.rename" : "tree.rename",
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
        ...(page ? { hotkey: "library.move" } : {}),
        onSelect: () => dialogs.openMove(node),
      },
      { type: "separator" },
      {
        type: "item",
        label: "Move to trash",
        icon: <Trash2 size={16} />,
        danger: true,
        disabled: pending,
        // No key on the open item's page: moving it away by a stray key would be a surprise.
        ...(page ? {} : { hotkey: "tree.trash" }),
        onSelect: trash,
      },
    );
  }
  return { entries, trash };
}
