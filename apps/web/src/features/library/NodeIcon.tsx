import type { FileType, NodeKind, NodeWithLinks, SectionKind } from "@notes/schema";
import {
  ArrowLeft,
  BookMarked,
  BookOpen,
  Bot,
  CalendarDays,
  CalendarRange,
  ChevronDown,
  ChevronRight,
  ClipboardCheck,
  Copy,
  Download,
  Expand,
  FileText,
  Folder,
  FolderInput,
  GraduationCap,
  GripVertical,
  History,
  Image as ImageIcon,
  Inbox,
  LifeBuoy,
  Lightbulb,
  ListChecks,
  type LucideIcon,
  Maximize,
  MessageCirclePlus,
  MessageSquarePlus,
  MessageSquareText,
  MoreHorizontal,
  Pencil,
  PenLine,
  Plus,
  Presentation,
  RotateCcw,
  RotateCw,
  Search,
  Settings,
  Star,
  StarOff,
  Trash2,
  Upload,
  X,
} from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "../../lib/cn";
import { SLIDE_TYPES, TEXT_TYPES } from "../../lib/fileTypes";
import type { Hue } from "../../lib/hues";
import { courseHue } from "./courseHue";

/**
 * One concept, one icon, everywhere (docs/design.md, "Icons"). A screen that shows a thing or an
 * action listed here takes its icon from this map instead of choosing its own.
 */
export const ICON = {
  // Library items
  term: CalendarRange,
  course: GraduationCap,
  folder: Folder,
  lecture: Presentation,
  document: FileText,
  sources: Inbox,
  studyGuides: BookOpen,
  practiceSet: ListChecks,
  exam: ClipboardCheck,
  // Places
  library: BookOpen,
  inbox: Inbox,
  practice: GraduationCap,
  calendar: CalendarDays,
  concept: Lightbulb,
  reference: BookMarked,
  request: MessageCirclePlus,
  activity: Bot,
  search: Search,
  settings: Settings,
  guide: LifeBuoy,
  trash: Trash2,
  recent: History,
  history: History,
  sideNote: MessageSquareText,
  // Actions
  favorite: Star,
  unfavorite: StarOff,
  add: Plus,
  addSideNote: MessageSquarePlus,
  upload: Upload,
  download: Download,
  rename: Pencil,
  write: PenLine,
  move: FolderInput,
  copy: Copy,
  delete: Trash2,
  restore: RotateCcw,
  retry: RotateCw,
  close: X,
  back: ArrowLeft,
  expand: ChevronRight,
  disclosure: ChevronDown,
  more: MoreHorizontal,
  drag: GripVertical,
  fit: Maximize,
  fullScreen: Expand,
} as const satisfies Record<string, LucideIcon>;

const SECTION_ICON = {
  sources: ICON.sources,
  lectures: ICON.lecture,
  study_guides: ICON.studyGuides,
  practice: ICON.practiceSet,
  exams: ICON.exam,
} as const;

const KIND_ICON: Record<Exclude<NodeKind, "section">, LucideIcon> = {
  term: ICON.term,
  course: ICON.course,
  folder: ICON.folder,
  lecture: ICON.lecture,
  document: ICON.document,
};

/**
 * The tile colour rule: a course carries its own colour, a term carries none (neutral), and
 * everything under a course carries that course's colour (`inherited`, from the page or branch it
 * sits on, or useCourseHue). Every tile, row and tree item goes through this.
 */
export function nodeHue(
  node: Pick<NodeWithLinks, "id" | "kind">,
  inherited: Hue | null | undefined,
): Hue | null {
  if (node.kind === "course") return courseHue(node.id);
  if (node.kind === "term") return null;
  return inherited ?? null;
}

export function NodeIcon({
  kind,
  section,
  size = 20,
  className,
}: {
  kind: NodeKind;
  section?: SectionKind | null;
  size?: number;
  className?: string;
}) {
  const Icon =
    kind === "section" ? (section ? SECTION_ICON[section] : ICON.folder) : KIND_ICON[kind];
  return <Icon size={size} className={className} aria-hidden />;
}

/** A source file's icon by its type: slides, a text document, or (everything else) an image. */
export function FileTypeIcon({ type, size = 17 }: { type: FileType; size?: number }) {
  if (SLIDE_TYPES.has(type)) return <Presentation size={size} aria-hidden />;
  if (TEXT_TYPES.has(type)) return <FileText size={size} aria-hidden />;
  return <ImageIcon size={size} aria-hidden />;
}

type TileSize = "sm" | "md" | "lg";

const TILE_SIZE: Record<TileSize, string> = {
  sm: "size-6 rounded-inline",
  md: "size-10 rounded-control",
  lg: "size-12 rounded-card",
};
const TILE_ICON: Record<TileSize, number> = { sm: 15, md: 20, lg: 24 };

function Tile({
  hue,
  size,
  className,
  children,
}: {
  hue: Hue | null | undefined;
  size: TileSize;
  className?: string | undefined;
  children: ReactNode;
}) {
  return (
    <span
      data-hue={hue ?? "gray"}
      className={cn(
        "flex shrink-0 items-center justify-center bg-tone-soft text-tone-text",
        TILE_SIZE[size],
        className,
      )}
    >
      {children}
    </span>
  );
}

/**
 * An item's icon in a tinted square. `hue` is the course colour (see nodeHue); without one the
 * square is neutral gray, as for terms. Color never carries the meaning alone: the kind is also
 * the icon and the words beside it.
 */
export function NodeTile({
  kind,
  section,
  hue,
  size = "md",
  className,
}: {
  kind: NodeKind;
  section?: SectionKind | null;
  hue?: Hue | null | undefined;
  size?: TileSize;
  className?: string;
}) {
  return (
    <Tile hue={hue} size={size} className={className}>
      <NodeIcon kind={kind} section={section} size={TILE_ICON[size]} />
    </Tile>
  );
}

/** A source file's icon in the same tinted square, by the same colour rule as NodeTile. */
export function FileTile({
  type,
  hue,
  size = "md",
  className,
}: {
  type: FileType;
  hue?: Hue | null | undefined;
  size?: TileSize;
  className?: string;
}) {
  return (
    <Tile hue={hue} size={size} className={className}>
      <FileTypeIcon type={type} size={TILE_ICON[size]} />
    </Tile>
  );
}
