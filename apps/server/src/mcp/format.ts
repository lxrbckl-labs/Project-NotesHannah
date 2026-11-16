import {
  canContain,
  lectureLabel,
  MAX_FOLDER_DEPTH,
  NodeKind,
  type NodeWithLinks,
} from "@notes/schema";

/** A node as listed: light, with what an agent needs to walk on. */
export interface NodeItem {
  id: string;
  kind: NodeWithLinks["kind"];
  name: string;
  /** Display label; lectures read "07 · Beta blockers · Oct 14". */
  label: string;
  path: string;
  parentId: string | null;
  childCount: number;
  section?: string;
  lecture?: { number: number | null; date: string | null };
  course?: { code: string | null };
  favourite?: true;
  trashedAt?: string;
}

export function nodeItem(node: NodeWithLinks): NodeItem {
  return {
    id: node.id,
    kind: node.kind,
    name: node.name,
    label: node.kind === "lecture" ? lectureLabel(node.name, node.lecture) : node.name,
    path: node.path,
    parentId: node.parentId,
    childCount: node.childCount,
    ...(node.section ? { section: node.section } : {}),
    ...(node.lecture ? { lecture: node.lecture } : {}),
    ...(node.course ? { course: node.course } : {}),
    ...(node.favourite ? { favourite: true as const } : {}),
    ...(node.trashedAt ? { trashedAt: node.trashedAt } : {}),
  };
}

export function nodeLine(item: NodeItem): string {
  const extra: string[] = [];
  if (item.course?.code) extra.push(item.course.code);
  if (item.childCount > 0) extra.push(`${item.childCount} inside`);
  if (item.trashedAt) extra.push(`trashed ${item.trashedAt}`);
  return `- ${item.id} ${item.kind} "${item.label}"${extra.length ? ` (${extra.join(", ")})` : ""}`;
}

/** What may be created directly inside a node of this kind (null: the top level). */
export function childKindsOf(kind: NodeKind | null): NodeKind[] {
  return NodeKind.options.filter((k) => k !== "section" && canContain(kind, k));
}

export function placementRule(kind: NodeKind | null): string {
  const kinds = childKindsOf(kind);
  const where = kind === null ? "At the top level" : `Inside a ${kind}`;
  if (kind === "course") return `${where} there are only its five fixed sections.`;
  if (kinds.length === 0) return `${where} nothing can be created.`;
  const folderNote =
    kind === "section" || kind === "folder"
      ? ` Folders nest at most ${MAX_FOLDER_DEPTH} deep below a section.`
      : "";
  return `${where} you can create: ${kinds.join(", ")}.${folderNote}`;
}

/** Cut text to a budget, saying so. */
export function clip(text: string, max: number): { text: string; clipped: boolean } {
  if (text.length <= max) return { text, clipped: false };
  return { text: `${text.slice(0, max)}…`, clipped: true };
}

export const json = (value: unknown): string => JSON.stringify(value);
