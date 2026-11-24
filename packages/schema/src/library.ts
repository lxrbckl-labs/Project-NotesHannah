import { z } from "zod";
import { Timestamp } from "./common.js";
import { NodeId, UserId } from "./ids.js";

/**
 * The library is one tree per user:
 *
 *   term → course → section → (folder)* → lecture | document
 *
 * Every course gets the same five sections automatically. The tree lives in
 * the database, so renames and moves never touch a file on disk.
 */
export const NodeKind = z.enum(["term", "course", "section", "folder", "lecture", "document"]);
export type NodeKind = z.infer<typeof NodeKind>;

export const SectionKind = z.enum(["sources", "lectures", "study_guides", "practice", "exams"]);
export type SectionKind = z.infer<typeof SectionKind>;

/** Sections created for every new course, in display order. */
export const COURSE_SECTIONS: ReadonlyArray<{ section: SectionKind; name: string }> = [
  { section: "sources", name: "Sources" },
  { section: "lectures", name: "Lectures" },
  { section: "study_guides", name: "Study guides" },
  { section: "practice", name: "Practice" },
  { section: "exams", name: "Exams" },
];

/** What each kind of node may contain. `null` is the root of a user's library. */
const CONTAINS: Record<NodeKind | "root", ReadonlyArray<NodeKind>> = {
  root: ["term"],
  term: ["course"],
  course: ["section"],
  section: ["folder", "lecture", "document"],
  folder: ["folder", "lecture", "document"],
  lecture: ["document"],
  document: [],
};

export function canContain(parent: NodeKind | null, child: NodeKind): boolean {
  return CONTAINS[parent ?? "root"].includes(child);
}

/**
 * Folders nest as deep as she likes (Alex, 2026-11-17; the limit was 2 before). The number is only
 * a backstop against a runaway loop or a mistaken agent, far past anything a person would build.
 */
export const MAX_FOLDER_DEPTH = 50;

/** Sections are fixed: they cannot be renamed, moved, duplicated or trashed on their own. */
export function isFixed(kind: NodeKind): boolean {
  return kind === "section";
}

export const NodeName = z
  .string()
  .trim()
  .min(1)
  .max(200)
  .refine(
    (value) => [...value].every((char) => (char.codePointAt(0) ?? 0) >= 0x20),
    "No control characters",
  );

const LocalDate = z.iso.date();

export const LectureMeta = z.object({
  /** Teaching order within the course, e.g. 7. */
  number: z.number().int().min(0).max(999).nullable(),
  /** The day it was taught, e.g. "2026-10-14". */
  date: LocalDate.nullable(),
});
export type LectureMeta = z.infer<typeof LectureMeta>;

export const CourseMeta = z.object({
  /** Catalogue code, e.g. "PHAR 7340". */
  code: z.string().max(40).nullable(),
});
export type CourseMeta = z.infer<typeof CourseMeta>;

export const LibraryNode = z.object({
  id: NodeId,
  userId: UserId,
  parentId: NodeId.nullable(),
  kind: NodeKind,
  name: NodeName,
  /** Set only when kind is "section". */
  section: SectionKind.nullable(),
  /** Set only when kind is "course". */
  course: CourseMeta.nullable(),
  /** Set only when kind is "lecture". */
  lecture: LectureMeta.nullable(),
  /** Orders siblings; a fractional index string so a move rewrites one row. */
  sortKey: z.string().min(1).max(64),
  favourite: z.boolean(),
  createdAt: Timestamp,
  updatedAt: Timestamp,
  /** When set, the node and everything under it is in the trash. */
  trashedAt: Timestamp.nullable(),
});
export type LibraryNode = z.infer<typeof LibraryNode>;

/** A node as returned to clients: with the links needed to walk the tree from it. */
export const NodeWithLinks = LibraryNode.extend({
  /** Readable path from the root, e.g. "Fall 2026 / Pharmacology II / Lectures". */
  path: z.string(),
  childCount: z.number().int().min(0),
  /**
   * Source files filed directly under this node (not in the trash). Not part of `childCount`, which is
   * library items only; what the app shows as "N items" is the two together.
   */
  fileCount: z.number().int().min(0).default(0),
  /** IDs from the root down to the parent, for breadcrumbs. */
  ancestors: z.array(NodeId),
});
export type NodeWithLinks = z.infer<typeof NodeWithLinks>;

export const CreateNodeInput = z.object({
  parentId: NodeId.nullable(),
  kind: NodeKind.exclude(["section"]),
  name: NodeName,
  course: CourseMeta.optional(),
  lecture: LectureMeta.optional(),
});
export type CreateNodeInput = z.infer<typeof CreateNodeInput>;

export const UpdateNodeInput = z
  .object({
    name: NodeName,
    course: CourseMeta,
    lecture: LectureMeta,
    favourite: z.boolean(),
  })
  .partial();
export type UpdateNodeInput = z.infer<typeof UpdateNodeInput>;

export const MoveNodeInput = z.object({
  parentId: NodeId.nullable(),
  /** Place after this sibling; null puts it first. Omit to put it last. */
  afterId: NodeId.nullable().optional(),
});
export type MoveNodeInput = z.infer<typeof MoveNodeInput>;

/** How a lecture is shown in listings: "07 · Beta blockers · Oct 14". */
export function lectureLabel(name: string, meta: LectureMeta | null): string {
  const parts: string[] = [];
  if (meta?.number != null) parts.push(String(meta.number).padStart(2, "0"));
  parts.push(name);
  if (meta?.date) {
    const [, month, day] = meta.date.split("-").map(Number) as [number, number, number];
    const names = [
      "Jan",
      "Feb",
      "Mar",
      "Apr",
      "May",
      "Jun",
      "Jul",
      "Aug",
      "Sep",
      "Oct",
      "Nov",
      "Dec",
    ];
    parts.push(`${names[month - 1]} ${day}`);
  }
  return parts.join(" · ");
}
