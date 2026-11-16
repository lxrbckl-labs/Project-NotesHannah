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
