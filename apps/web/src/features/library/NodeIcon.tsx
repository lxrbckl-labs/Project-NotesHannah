import type { NodeKind, SectionKind } from "@notes/schema";
import {
  BookOpen,
  CalendarRange,
  ClipboardCheck,
  FileText,
  Folder,
  GraduationCap,
  Inbox,
  ListChecks,
  Presentation,
} from "lucide-react";
import { cn } from "../../lib/cn";
import type { Hue } from "../../lib/hues";

const SECTION_ICON = {
  sources: Inbox,
  lectures: Presentation,
  study_guides: BookOpen,
  practice: ListChecks,
  exams: ClipboardCheck,
} as const;

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
  const props = { size, className, "aria-hidden": true } as const;
  switch (kind) {
    case "term":
      return <CalendarRange {...props} />;
    case "course":
      return <GraduationCap {...props} />;
    case "section": {
      const Icon = section ? SECTION_ICON[section] : Folder;
      return <Icon {...props} />;
    }
    case "folder":
      return <Folder {...props} />;
    case "lecture":
      return <Presentation {...props} />;
    case "document":
      return <FileText {...props} />;
  }
}

/**
 * An item's icon in a tinted square. `hue` is the course colour (see courseHue); without one
 * the square is neutral gray, as for terms. Color never carries the meaning alone: the kind is
 * also the icon and the words beside it.
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
  size?: "sm" | "md" | "lg";
  className?: string;
}) {
  return (
    <span
      data-hue={hue ?? undefined}
      className={cn(
        "flex shrink-0 items-center justify-center bg-tone-soft text-tone-text",
        size === "sm" && "size-6 rounded-inline",
        size === "md" && "size-10 rounded-control",
        size === "lg" && "size-12 rounded-card",
        className,
      )}
    >
      <NodeIcon kind={kind} section={section} size={size === "sm" ? 15 : size === "lg" ? 24 : 20} />
    </span>
  );
}
