import {
  BookMarked,
  BookOpen,
  Bot,
  CalendarDays,
  GraduationCap,
  Inbox,
  LifeBuoy,
  Lightbulb,
  LogOut,
  MessageSquarePlus,
  PanelLeftClose,
  PanelLeftOpen,
  PanelRightOpen,
  Plus,
  Search,
  Settings,
  Trash2,
} from "lucide-react";
import type { CSSProperties } from "react";
import { useEffect, useRef, useState } from "react";
import { NavLink, Outlet, useMatch } from "react-router";
import { PillMark } from "../components/art/pills";
import { Badge } from "../components/ui/badge";
import { IconButton } from "../components/ui/button";
import { Tooltip } from "../components/ui/tooltip";
import { useMe, useSignOut } from "../features/auth/useAuth";
import { LoveLetter } from "../features/letter/LoveLetter";
import { LibraryDialogs, useLibraryDialogs } from "../features/library/dialogs";
import { LibraryTree } from "../features/library/LibraryTree";
import { PickNodesProvider } from "../features/library/pickNodes";
import { RightPanel } from "../features/library/RightPanel";
import { TreeStateProvider } from "../features/library/treeState";
import { AskProvider } from "../features/mounts/ask";
import { backgroundUrl, useBackground } from "../features/preferences/useBackground";
import { useTabOrder } from "../features/preferences/usePreferences";
import { QuickFind } from "../features/search/QuickFind";
import { UploadProvider } from "../features/uploads/UploadProvider";
import { UploadTray } from "../features/uploads/UploadTray";
import { cn } from "../lib/cn";
import { readFlag, writeFlag } from "../lib/storage";
import { useLayout } from "../lib/useMedia";
import { NavBadge, useBadges } from "./badges";
import { SideResize, useSideWidth } from "./SideResize";
import { SideSlide } from "./SideSlide";
import { tabDirection } from "./tabDirection";
import { TAB_DEFS } from "./tabs";
import { usePageSlide } from "./usePageSlide";

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

/** The widths the two sidebars start at (and return to on a double-click of their edge). */
const SIDEBAR_WIDTH = 264;
const PANEL_WIDTH = 288;

function Shell() {
  const layout = useLayout();
  const [sidebarOpen, setSidebarOpen] = useState(() => readFlag(SIDEBAR_KEY, true));
  const [panelOpen, setPanelOpen] = useState(() => readFlag(PANEL_KEY, true));
  const [findOpen, setFindOpen] = useState(false);
  usePageSlide();
  const backgroundAt = useBackground().data?.updatedAt ?? null;
  const [sidebarWidth, setSidebarWidth] = useSideWidth("notes-sidebar-width", SIDEBAR_WIDTH);
  const [panelWidth, setPanelWidth] = useSideWidth("notes-panel-width", PANEL_WIDTH);
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
      <SideSlide open={showSidebar} side="left">
        {/* Her width, dragged from the inner edge and remembered in this browser (app/SideResize). */}
        <div className="relative flex" style={{ width: sidebarWidth }}>
          <Sidebar onCollapse={() => setSidebarOpen(false)} />
          <SideResize
            side="left"
            width={sidebarWidth}
            initial={SIDEBAR_WIDTH}
            onWidth={setSidebarWidth}
            label="Resize the sidebar"
          />
        </div>
      </SideSlide>

      <div className="flex min-w-0 flex-1 flex-col print:block">
        {layout !== "phone" ? (
          // One row, one size, one gap: every control is 36px on a computer (44px on touch), with the
          // same 8px around and between them. The search fills whatever the toggles leave. A toggle
          // sits here only while its side is closed; while open it lives in that side's own header.
          <div className="px-safe border-b border-border bg-surface/80 backdrop-blur print:hidden">
            <div className="flex items-center gap-2 p-2">
              {!showSidebar ? (
                <IconButton aria-label="Show sidebar" onClick={() => setSidebarOpen(true)}>
                  <PanelLeftOpen size={20} />
                </IconButton>
              ) : null}
              <button
                type="button"
                onClick={() => setFindOpen(true)}
                className="relative flex h-11 min-w-0 flex-1 items-center justify-center gap-2.5 rounded-control border border-border-strong bg-surface px-3.5 text-ui text-text-muted transition-colors duration-(--duration-instant) hover:bg-surface-muted xl:h-9"
              >
                <Search size={16} aria-hidden />
                <span>Quick find</span>
                {layout === "computer" ? (
                  <kbd className="absolute right-2.5 rounded-inline border border-border bg-surface px-1.5 text-caption">
                    {MOD_KEY}K
                  </kbd>
                ) : null}
              </button>
              {layout === "computer" && inLibrary && !panelOpen ? (
                <IconButton aria-label="Show details panel" onClick={() => setPanelOpen(true)}>
                  <PanelRightOpen size={20} />
                </IconButton>
              ) : null}
            </div>
          </div>
        ) : null}

        <main
          id="main"
          tabIndex={-1}
          className={cn(
            // `relative`: anything positioned inside a page (a hidden table for screen readers, a popover) is then
            // measured and clipped by this scrolling area. Without it such an element escaped and made the whole
            // window scroll past the app.
            "relative min-h-0 flex-1 overflow-y-auto outline-none print:overflow-visible print:bg-none",
            // Her own picture when she has set one (Settings, Background), the dotted grid otherwise.
            backgroundAt === null ? "dot-grid" : "own-background",
            layout === "phone" && "px-safe clear-tabbar",
          )}
          style={
            backgroundAt === null
              ? undefined
              : ({ "--own-background": `url("${backgroundUrl(backgroundAt)}")` } as CSSProperties)
          }
        >
          <Outlet />
        </main>

        {layout === "phone" ? <TabBar /> : null}
      </div>

      <SideSlide open={showPanel} side="right">
        <div className="relative flex" style={{ width: panelWidth }}>
          <RightPanel nodeId={match?.params.nodeId} onCollapse={() => setPanelOpen(false)} />
          <SideResize
            side="right"
            width={panelWidth}
            initial={PANEL_WIDTH}
            onWidth={setPanelWidth}
            label="Resize the details panel"
          />
        </div>
      </SideSlide>
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
      // overflow-y-auto: in a very short window even the fixed parts (the links above and below the tree) do
      // not fit; then the whole sidebar scrolls, rather than growing past the window.
      className="pt-safe pb-safe flex w-full min-w-0 flex-col overflow-y-auto border-r border-border bg-surface print:hidden"
    >
      {/* The same height, padding and line as the header beside it, so the two read as one bar. */}
      <div className="flex items-center gap-2 border-b border-border p-2">
        <span className="flex size-11 shrink-0 items-center justify-center rounded-control bg-accent text-accent-contrast xl:size-9">
          <PillMark size={20} />
        </span>
        <span className="min-w-0 flex-1 truncate pl-0.5 font-display text-lg font-semibold">
          Notes
        </span>
        <IconButton aria-label="Hide sidebar" onClick={onCollapse}>
          <PanelLeftClose size={20} />
        </IconButton>
      </div>

      <nav aria-label="Main" className="grid gap-0.5 p-2">
        <NavLink to="/library" end className={linkClass}>
          <BookOpen size={18} aria-hidden /> Library
        </NavLink>
        <NavLink to="/practice" className={linkClass}>
          <GraduationCap size={18} aria-hidden /> Practice
          <NavBadge count={badges.practice} label="cards due" />
        </NavLink>
        <NavLink to="/calendar" className={linkClass}>
          <CalendarDays size={18} aria-hidden /> Calendar
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
        <Tooltip content="New term">
          <button
            type="button"
            onClick={() => dialogs.openCreate(null, "term")}
            aria-label="New term"
            className="hit-area flex size-6 items-center justify-center rounded-inline text-accent hover:bg-accent-soft"
          >
            <Plus size={16} aria-hidden />
          </button>
        </Tooltip>
      </div>
      {/* At least a few rows tall, so the tree is never squeezed to nothing. */}
      <div className="min-h-32 flex-1 overflow-y-auto pb-3">
        <LibraryTree />
      </div>

      <div className="grid gap-0.5 border-t border-border p-2">
        <NavLink to="/help" className={linkClass}>
          <LifeBuoy size={18} aria-hidden /> Guide
        </NavLink>
        <NavLink to="/settings" className={linkClass}>
          <Settings size={18} aria-hidden /> Settings
        </NavLink>
        {/* Sign out, and at the far right Alex's note to Hannah (features/letter). */}
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => void signOut()}
            className="flex min-h-11 min-w-0 flex-1 items-center gap-3 rounded-control px-3 text-left text-ui text-text-muted transition-colors duration-(--duration-instant) hover:bg-surface-muted hover:text-text xl:min-h-9"
          >
            <LogOut size={18} aria-hidden />
            <span className="min-w-0 flex-1 truncate">
              Sign out{me.data ? ` ${me.data.displayName}` : ""}
            </span>
          </button>
          <LoveLetter />
        </div>
      </div>
    </aside>
  );
}

/** Longer than the slide itself (260ms in styles.css), with room for a slow device to start it. */
const TAB_SLIDE_MS = 700;

function TabBar() {
  const badges = useBadges();
  // Her order, from Settings. The slide direction below is measured against the same list.
  const order = useTabOrder();
  const tabs = order.map((id) => ({ id, ...TAB_DEFS[id] }));
  const tabPaths = tabs.map((t) => t.to);
  const slideTimer = useRef<number | undefined>(undefined);
  const count: Record<string, number> = { "/practice": badges.practice, "/inbox": badges.inbox };
  return (
    <nav
      data-testid="tab-bar"
      aria-label="Primary"
      className="vt-tabbar pb-safe px-safe fixed inset-x-0 bottom-0 z-(--z-nav) border-t border-border bg-surface/95 backdrop-blur print:hidden"
    >
      <ul className="flex">
        {tabs.map(({ id, to, label, icon: Icon }) => (
          <li key={id} className="flex-1">
            <NavLink
              to={to}
              // The new page slides in from the side of the tab she tapped (styles.css, "Tab changes").
              viewTransition
              // The address bar, not React state: a tap during a transition must still read where she is now.
              onClick={() => {
                const root = document.documentElement;
                root.dataset.tabDir = tabDirection(tabPaths, window.location.pathname, to);
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
