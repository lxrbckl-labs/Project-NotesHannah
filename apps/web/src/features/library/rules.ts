import {
  canContain,
  isFixed,
  MAX_FOLDER_DEPTH,
  type NodeKind,
  type NodeWithLinks,
} from "@notes/schema";

export type CreatableKind = Exclude<NodeKind, "section">;

export const CREATABLE: CreatableKind[] = ["term", "course", "folder", "lecture", "document"];

export const KIND_NAME: Record<NodeKind, string> = {
  term: "Term",
  course: "Course",
  section: "Section",
  folder: "Folder",
  lecture: "Lecture",
  document: "Document",
};

/** What can be created inside a parent (`null` is the top of the library). */
export function creatableIn(parentKind: NodeKind | null): CreatableKind[] {
  return CREATABLE.filter((kind) => canContain(parentKind, kind));
}

export function isPending(node: { id: string }): boolean {
  return node.id.startsWith("pending_");
}

export const NOT_ALLOWED = "Not allowed here.";

export interface Destination {
  id: string;
  kind: NodeKind;
  /** Folder levels at and including this destination (0 for a section or higher). */
  folderDepth: number;
  ancestors: string[];
}

/**
 * Can `node` be moved into `dest` (`null` = top of the library)? Mirrors the server rules so
 * the picker and drop targets can disable invalid places up front; the server stays the judge.
 */
export function moveBlockedReason(node: NodeWithLinks, dest: Destination | null): string | null {
  if (isFixed(node.kind)) return "Sections cannot be moved.";
  if (dest && (dest.id === node.id || dest.ancestors.includes(node.id))) {
    return "Cannot move something into itself.";
  }
  if (!canContain(dest?.kind ?? null, node.kind)) return NOT_ALLOWED;
  if (node.kind === "folder" && (dest?.folderDepth ?? 0) + 1 > MAX_FOLDER_DEPTH) {
    return "Folders can only nest two deep.";
  }
  return null;
}

/** Sort a course's sections the way the contract lists them (server order already is). */
export function toDestination(node: NodeWithLinks, folderDepth: number): Destination {
  return { id: node.id, kind: node.kind, folderDepth, ancestors: node.ancestors };
}
