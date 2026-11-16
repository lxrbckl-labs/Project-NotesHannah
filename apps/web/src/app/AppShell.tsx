import {
  BookMarked,
  BookOpen,
  Bot,
  GraduationCap,
  Inbox,
  LifeBuoy,
  Lightbulb,
  LogOut,
  MessageSquarePlus,
  NotebookPen,
  PanelLeft,
  PanelRight,
  Search,
  Settings,
  Trash2,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { NavLink, Outlet, useMatch } from "react-router";
import { Badge } from "../components/ui/badge";
import { IconButton } from "../components/ui/button";
import { useMe, useSignOut } from "../features/auth/useAuth";
import { LibraryDialogs, useLibraryDialogs } from "../features/library/dialogs";
import { LibraryTree } from "../features/library/LibraryTree";
import { PickNodesProvider } from "../features/library/pickNodes";
import { RightPanel } from "../features/library/RightPanel";
import { TreeStateProvider } from "../features/library/treeState";
import { AskProvider } from "../features/mounts/ask";
import { QuickFind } from "../features/search/QuickFind";
import { UploadProvider } from "../features/uploads/UploadProvider";
import { UploadTray } from "../features/uploads/UploadTray";
import { cn } from "../lib/cn";
import { readFlag, writeFlag } from "../lib/storage";
import { useLayout } from "../lib/useMedia";
import { NavBadge, useBadges } from "./badges";
import { tabDirection } from "./tabDirection";

const SIDEBAR_KEY = "notes-sidebar";
const PANEL_KEY = "notes-panel";

const isMac = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform);
export const MOD_KEY = isMac ? "⌘" : "Ctrl+";

/**
 * Three layouts. Phone: one pane and a bottom tab bar. Tablet: a collapsible sidebar tree beside
 * the content. Computer: sidebar, content and an optional right panel, with keyboard shortcuts.
 */
export function AppShell() {
  const me = useMe();
  return (
    <TreeStateProvider userId={me.data?.id ?? "unknown"}>
      <UploadProvider>
        <LibraryDialogs>
          <PickNodesProvider>
            <AskProvider>
              <Shell />
            </AskProvider>
          </PickNodesProvider>
          <UploadTray />
        </LibraryDialogs>
      </UploadProvider>
    </TreeStateProvider>
  );
}

function Shell() {
  const layout = useLayout();
  const [sidebarOpen, setSidebarOpen] = useState(() => readFlag(SIDEBAR_KEY, true));
  const [panelOpen, setPanelOpen] = useState(() => readFlag(PANEL_KEY, true));
  const [findOpen, setFindOpen] = useState(false);
  const match = useMatch("/library/:nodeId");

  useEffect(() => writeFlag(SIDEBAR_KEY, sidebarOpen), [sidebarOpen]);
  useEffect(() => writeFlag(PANEL_KEY, panelOpen), [panelOpen]);

  useEffect(() => {
    if (layout === "phone") return;
    function onKey(event: KeyboardEvent) {
      const mod = event.metaKey || event.ctrlKey;
      if (mod && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setFindOpen((open) => !open);
      } else if (mod && event.key === "\\") {
        event.preventDefault();
        setSidebarOpen((open) => !open);
      } else if (
        event.key === "/" &&
        !mod &&
        !(
          event.target instanceof HTMLElement &&
          /^(INPUT|TEXTAREA|SELECT)$/.test(event.target.tagName)
        ) &&
        !(event.target instanceof HTMLElement && event.target.isContentEditable)
      ) {
        event.preventDefault();
        setFindOpen(true);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [layout]);

  const showSidebar = layout !== "phone" && sidebarOpen;
  // Details belong to the library; a document, practice or the viewer want the width.
  const inLibraryPage = useMatch("/library/*");
  const inLibraryHome = useMatch("/library");
  const inLibrary = !!inLibraryPage || !!inLibraryHome;
  const showPanel = layout === "computer" && panelOpen && inLibrary;

  return (
    <div className="flex h-dvh overflow-hidden bg-bg print:block print:h-auto print:overflow-visible">
      <a
        href="#main"
        className="sr-only z-(--z-skip) rounded-control bg-accent px-4 py-2 text-accent-contrast focus:not-sr-only focus:fixed focus:left-3 focus:top-3"
      >
        Skip to content
      </a>
      {showSidebar ? <Sidebar onCollapse={() => setSidebarOpen(false)} /> : null}

      <div className="flex min-w-0 flex-1 flex-col print:block">
        {layout !== "phone" ? (
          <div className="px-safe flex items-center gap-2 print:hidden border-b border-border bg-surface/80 px-3 py-2 backdrop-blur">
            {!showSidebar ? (
              <IconButton aria-label="Show sidebar" onClick={() => setSidebarOpen(true)}>
                <PanelLeft size={20} />
              </IconButton>
            ) : null}
            <button
              type="button"
              onClick={() => setFindOpen(true)}
              className="flex min-h-11 max-w-md flex-1 items-center gap-2.5 rounded-control border border-border bg-bg px-3.5 text-ui text-text-muted transition-colors duration-(--duration-instant) hover:border-border-strong xl:min-h-9"
            >
              <Search size={16} aria-hidden />
              <span className="flex-1 text-left">Quick find</span>
              {layout === "computer" ? (
                <kbd className="rounded-inline border border-border bg-surface px-1.5 text-caption">
                  {MOD_KEY}K
                </kbd>
              ) : null}
            </button>
            <div className="flex-1" />
            {layout === "computer" && inLibrary ? (
              <IconButton
                aria-label={panelOpen ? "Hide details panel" : "Show details panel"}
                aria-pressed={panelOpen}
                onClick={() => setPanelOpen((open) => !open)}
              >
                <PanelRight size={20} />
              </IconButton>
            ) : null}
          </div>
        ) : null}

        <main
          id="main"
          tabIndex={-1}
          className={cn(
            "dot-grid min-h-0 flex-1 overflow-y-auto outline-none print:overflow-visible print:bg-none",
            layout === "phone" && "px-safe pb-24",
          )}
        >
          <Outlet />
        </main>

        {layout === "phone" ? <TabBar /> : null}
      </div>

      {showPanel ? <RightPanel nodeId={match?.params.nodeId} /> : null}
      <QuickFind open={findOpen} onOpenChange={setFindOpen} />
    </div>
  );
}

const linkClass = ({ isActive }: { isActive: boolean }) =>
  cn(
    "flex min-h-11 items-center gap-3 rounded-control px-3 text-ui font-medium transition-colors duration-(--duration-instant) xl:min-h-9",
    isActive ? "bg-accent-soft text-accent" : "text-text hover:bg-surface-muted",
  );

function Sidebar({ onCollapse }: { onCollapse: () => void }) {
  const me = useMe();
  const signOut = useSignOut();
  const dialogs = useLibraryDialogs();
  const badges = useBadges();
  return (
    <aside
      data-testid="sidebar"
      aria-label="Sidebar"
      className="pt-safe pb-safe flex w-72 shrink-0 flex-col border-r border-border bg-surface xl:w-64 print:hidden"
    >
      <div className="flex items-center gap-2.5 px-4 py-3">
        <span className="flex size-9 items-center justify-center rounded-control bg-accent text-accent-contrast">
          <NotebookPen size={18} aria-hidden />
        </span>
        <span className="flex-1 font-display text-lg font-semibold">Notes</span>
        <IconButton aria-label="Hide sidebar" onClick={onCollapse}>
          <PanelLeft size={20} />
        </IconButton>
      </div>

      <nav aria-label="Main" className="grid gap-0.5 px-2">
        <NavLink to="/library" end className={linkClass}>
          <BookOpen size={18} aria-hidden /> Library
        </NavLink>
        <NavLink to="/practice" className={linkClass}>
          <GraduationCap size={18} aria-hidden /> Practice
          <NavBadge count={badges.practice} label="cards due" />
        </NavLink>
        <NavLink to="/inbox" className={linkClass}>
          <Inbox size={18} aria-hidden /> Inbox
          <NavBadge count={badges.inbox} label="files in the inbox" />
        </NavLink>
        <NavLink to="/concepts" className={linkClass}>
          <Lightbulb size={18} aria-hidden /> Concepts
          <NavBadge count={badges.review} label="concepts to review" tone="warning" />
        </NavLink>
        <NavLink to="/references" className={linkClass}>
          <BookMarked size={18} aria-hidden /> References
        </NavLink>
        <NavLink to="/requests" className={linkClass}>
          <MessageSquarePlus size={18} aria-hidden /> Requests
          <NavBadge count={badges.requests} label="open requests" />
        </NavLink>
        <NavLink to="/activity" className={linkClass}>
          <Bot size={18} aria-hidden /> Activity
        </NavLink>
        <NavLink to="/trash" className={linkClass}>
          <Trash2 size={18} aria-hidden /> Trash
        </NavLink>
      </nav>

      <div className="mt-4 flex items-center justify-between px-5 pb-1.5">
        <h2 className="font-sans text-caption font-semibold uppercase tracking-wide text-text-muted">
          Terms and courses
        </h2>
        <button
          type="button"
          onClick={() => dialogs.openCreate(null, "term")}
          className="hit-area rounded-inline px-2 py-1 text-caption font-medium text-accent hover:bg-accent-soft"
        >
          New term
        </button>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto pb-3">
        <LibraryTree />
      </div>

      <div className="grid gap-0.5 border-t border-border p-2">
        <NavLink to="/help" className={linkClass}>
          <LifeBuoy size={18} aria-hidden /> Guide
        </NavLink>
        <NavLink to="/settings" className={linkClass}>
          <Settings size={18} aria-hidden /> Settings
        </NavLink>
        <button
          type="button"
          onClick={() => void signOut()}
          className="flex min-h-11 items-center gap-3 rounded-control px-3 text-left text-ui text-text-muted transition-colors duration-(--duration-instant) hover:bg-surface-muted hover:text-text xl:min-h-9"
        >
          <LogOut size={18} aria-hidden />
          <span className="min-w-0 flex-1 truncate">
            Sign out{me.data ? ` ${me.data.displayName}` : ""}
          </span>
        </button>
      </div>
    </aside>
  );
}

// Five at most on a phone: the things she opens most. Requests, Activity, Trash and the Guide live in Settings.
const TABS = [
  { to: "/library", label: "Library", icon: BookOpen },
  { to: "/practice", label: "Practice", icon: GraduationCap },
  { to: "/search", label: "Search", icon: Search },
  { to: "/inbox", label: "Inbox", icon: Inbox },
  { to: "/settings", label: "Settings", icon: Settings },
] as const;

const TAB_PATHS = TABS.map((t) => t.to);

/** Longer than the slide itself (260ms in styles.css), with room for a slow device to start it. */
const TAB_SLIDE_MS = 700;

function TabBar() {
  const badges = useBadges();
  const slideTimer = useRef<number | undefined>(undefined);
  const count: Record<string, number> = { "/practice": badges.practice, "/inbox": badges.inbox };
  return (
    <nav
      data-testid="tab-bar"
      aria-label="Primary"
      className="vt-tabbar pb-safe px-safe fixed inset-x-0 bottom-0 z-(--z-nav) border-t border-border bg-surface/95 backdrop-blur print:hidden"
    >
      <ul className="flex">
        {TABS.map(({ to, label, icon: Icon }) => (
          <li key={to} className="flex-1">
            <NavLink
              to={to}
              // The new page slides in from the side of the tab she tapped (styles.css, "Tab changes").
              viewTransition
              // The address bar, not React state: a tap during a transition must still read where she is now.
              onClick={() => {
                const root = document.documentElement;
                root.dataset.tabDir = tabDirection(TAB_PATHS, window.location.pathname, to);
                // The slide's layers exist only for the length of the slide.
                root.classList.add("tab-sliding");
                window.clearTimeout(slideTimer.current);
                slideTimer.current = window.setTimeout(
                  () => root.classList.remove("tab-sliding"),
                  TAB_SLIDE_MS,
                );
              }}
              className={({ isActive }) =>
                cn(
                  "flex min-h-14 flex-col items-center justify-center gap-0.5 text-caption font-medium",
                  isActive ? "text-accent" : "text-text-muted",
                )
              }
            >
              <span className="relative">
                <Icon size={22} aria-hidden />
                {(count[to] ?? 0) > 0 ? (
                  <span
                    aria-hidden="true"
                    title={`${count[to]} waiting`}
                    className="absolute -right-3 -top-1.5"
                  >
                    <Badge
                      variant="solid"
                      hue="accent"
                      size="sm"
                      className="min-w-4 justify-center px-1"
                    >
                      {count[to]}
                    </Badge>
                  </span>
                ) : null}
              </span>
              {label}
            </NavLink>
          </li>
        ))}
      </ul>
    </nav>
  );
}
