import type { HomePage } from "@notes/schema";
import {
  BookMarked,
  BookOpen,
  Bot,
  CalendarDays,
  GraduationCap,
  Inbox,
  Lightbulb,
  type LucideIcon,
  MessageCirclePlus,
} from "lucide-react";

/**
 * The places the app's mark in the header can lead to (Settings, "Home page"): the sidebar's main places,
 * with the same names and icons as there. The ids are in the schema.
 */
export const HOME_DEFS: Record<HomePage, { to: string; label: string; icon: LucideIcon }> = {
  library: { to: "/library", label: "Library", icon: BookOpen },
  practice: { to: "/practice", label: "Practice", icon: GraduationCap },
  calendar: { to: "/calendar", label: "Calendar", icon: CalendarDays },
  inbox: { to: "/inbox", label: "Inbox", icon: Inbox },
  concepts: { to: "/concepts", label: "Concepts", icon: Lightbulb },
  references: { to: "/references", label: "References", icon: BookMarked },
  requests: { to: "/requests", label: "Requests", icon: MessageCirclePlus },
  activity: { to: "/activity", label: "Activity", icon: Bot },
};
