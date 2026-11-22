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
  MessageCirclePlus,
  PanelLeftClose,
  PanelLeftOpen,
  PanelRightOpen,
  Plus,
  Search,
  Settings,
  Trash2,
} from "lucide-react";
import type { CSSProperties, ReactNode } from "react";
import { useEffect, useRef, useState } from "react";
import { NavLink, Outlet, useMatch, useNavigate } from "react-router";
import { PillMark } from "../components/art/pills";
import { Badge } from "../components/ui/badge";
import { IconButton } from "../components/ui/button";
import { Tooltip } from "../components/ui/tooltip";
import { useMe, useSignOut } from "../features/auth/useAuth";
import {
  HotkeyProvider,
  Kbd,
  ShortcutsDialog,
  useHotkey,
  useHotkeyAria,
} from "../features/hotkeys";
import { LoveLetter } from "../features/letter/LoveLetter";
import { LibraryDialogs, useLibraryDialogs } from "../features/library/dialogs";
import { LibraryTree } from "../features/library/LibraryTree";
import { PickNodesProvider } from "../features/library/pickNodes";
import { RightPanel } from "../features/library/RightPanel";
import { TreeStateProvider } from "../features/library/treeState";
import { AskProvider, useAsk } from "../features/mounts/ask";
import { backgroundUrl, useBackground } from "../features/preferences/useBackground";
import {
  useInstructions,
  useMarkTourSeen,
  usePreferences,
  useShortcutBadges,
  useTabOrder,
} from "../features/preferences/usePreferences";
import { InstructionsProvider } from "../features/requests/ui/instructions";
import { QuickFind } from "../features/search/QuickFind";
import { TourProvider, useTour } from "../features/tour/Tour";
import { UploadProvider, useUploadPicker } from "../features/uploads/UploadProvider";
import { UploadTray } from "../features/uploads/UploadTray";
import { cn } from "../lib/cn";
import { readFlag, writeFlag } from "../lib/storage";
import { useBack } from "../lib/useBack";
import { useLayout } from "../lib/useMedia";
import { NavBadge, useBadges } from "./badges";
import { SideResize, useSideWidth } from "./SideResize";
import { SideSlide } from "./SideSlide";
import { tabDirection } from "./tabDirection";
import { TAB_DEFS } from "./tabs";
import { usePageSlide } from "./usePageSlide";

const SIDEBAR_KEY = "notes-sidebar";
const PANEL_KEY = "notes-panel";

/**
 * Three layouts. Phone: one pane and a bottom tab bar. Tablet: a collapsible sidebar tree beside
 * the content. Computer: sidebar, content and an optional right panel. Tablet and computer answer to
 * keyboard shortcuts (features/hotkeys); the computer also shows their badges, unless she turned them off.
 */
export function AppShell() {
  const me = useMe();
  const layout = useLayout();
  const badges = useShortcutBadges();
  // Her saved instructions, handed to the request dialog wherever it opens.
  const instructions = useInstructions();
  const navigate = useNavigate();
  const markTourSeen = useMarkTourSeen();
  const tourSeen = () => markTourSeen.mutate();
  return (
    <HotkeyProvider enabled={layout !== "phone"} badges={layout === "computer" && badges}>
      <TreeStateProvider userId={me.data?.id ?? "unknown"}>
        <UploadProvider>
          <LibraryDialogs>
            <PickNodesProvider>
              <InstructionsProvider
                list={instructions}
                onManage={() => navigate("/settings#instructions")}
              >
                <AskProvider>
                  {/* The tour: started from the guide, and by itself the first time she signs in. */}
                  <TourProvider onEnd={tourSeen}>
                    <TourFirstTime />
                    <Shell />
                  </TourProvider>
                </AskProvider>
              </InstructionsProvider>
            </PickNodesProvider>
            <UploadTray />
          </LibraryDialogs>
        </UploadProvider>
      </TreeStateProvider>
    </HotkeyProvider>
  );
}

/** The widths the two sidebars start at (and return to on a double-click of their edge). */
const SIDEBAR_WIDTH = 264;
const PANEL_WIDTH = 288;

/**
 * Starts the tour once for an account that has never seen it. It waits for the server's answer (never
 * a guess), and it never starts under browser automation: the test suites sign in again and again,
 * and a tour over the page would be in the way of every one of them.
 */
function TourFirstTime() {
  const preferences = usePreferences();
  const tour = useTour();
  const started = useRef(false);
  const seen = preferences.isPlaceholderData ? true : (preferences.data?.tourSeen ?? true);
  useEffect(() => {
    if (seen || started.current || tour.running) return;
    if (typeof navigator !== "undefined" && navigator.webdriver) return;
    started.current = true;
    tour.start();
  }, [seen, tour]);
  return null;
}

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

  const showSidebar = layout !== "phone" && sidebarOpen;
  // Details belong to the library; a document, practice or the viewer want the width.
  const inLibraryPage = useMatch("/library/*");
  const inLibraryHome = useMatch("/library");
  const inLibrary = !!inLibraryPage || !!inLibraryHome;
  const showPanel = layout === "computer" && panelOpen && inLibrary;

  // The app's own shortcuts (features/hotkeys/registry.ts). The provider leaves them off on a phone.
  const [keysOpen, setKeysOpen] = useState(false);
  useHotkey("app.quickFind", () => setFindOpen((open) => !open));
  useHotkey("app.sidebar", () => setSidebarOpen((open) => !open));
  useHotkey("app.details", () => setPanelOpen((open) => !open), {
    enabled: layout === "computer" && inLibrary,
  });
  useHotkey("app.shortcuts", () => setKeysOpen((open) => !open));
  useAppHotkeys();
  const findKeys = useHotkeyAria("app.quickFind");

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
                <IconButton
                  aria-label="Show sidebar"
                  hotkey="app.sidebar"
                  onClick={() => setSidebarOpen(true)}
                >
                  <PanelLeftOpen size={20} />
                </IconButton>
              ) : null}
              <button
                type="button"
                onClick={() => setFindOpen(true)}
                aria-keyshortcuts={findKeys}
                className="relative flex h-11 min-w-0 flex-1 items-center justify-center gap-2.5 rounded-control border border-border-strong bg-surface px-3.5 text-ui text-text-muted transition-colors duration-(--duration-instant) hover:bg-surface-muted xl:h-9"
              >
                <Search size={16} aria-hidden />
                <span>Quick find</span>
                {/* The badge every other one copies (features/hotkeys/Kbd.tsx); computer layout only. */}
                <Kbd hotkey="app.quickFind" className="absolute right-2.5" />
              </button>
              {layout === "computer" && inLibrary && !panelOpen ? (
                <IconButton
                  aria-label="Show details panel"
                  hotkey="app.details"
                  onClick={() => setPanelOpen(true)}
                >
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
      <GoToHotkeys />
      <QuickFind open={findOpen} onOpenChange={setFindOpen} />
      <ShortcutsDialog open={keysOpen} onOpenChange={setKeysOpen} />
    </div>
  );
}

/** Where each "go to" pair leads. */
const GO_TO = [
  ["go.library", "/library"],
  ["go.practice", "/practice"],
  ["go.calendar", "/calendar"],
  ["go.search", "/search"],
  ["go.inbox", "/inbox"],
  ["go.settings", "/settings"],
  ["go.requests", "/requests"],
  ["go.concepts", "/concepts"],
  ["go.references", "/references"],
  ["go.activity", "/activity"],
  ["go.guide", "/help"],
  ["go.trash", "/trash"],
] as const;

/** The "go to" pairs, each a hotkey of its own while the shell is on screen. */
function GoToHotkeys() {
  return GO_TO.map(([id, to]) => <GoTo key={id} id={id} to={to} />);
}

function GoTo({ id, to }: { id: string; to: string }) {
  const navigate = useNavigate();
  useHotkey(id, () => navigate(to));
  return null;
}

/**
 * The shortcuts that work on every screen: back, a new request, uploads, the tour and a new term. A
 * screen with its own version (a library page asks about its item and uploads into it) registers the
 * same id, and its handler is used while it is open.
 */
function useAppHotkeys() {
  const back = useBack("/library");
  useHotkey("go.back", back);
  const ask = useAsk();
  useHotkey("app.ask", () => ask({ target: { type: "library" }, label: "your library" }));
  const pick = useUploadPicker();
  useHotkey("app.upload", () => pick({ nodeId: null, label: "the inbox" }));
  const tour = useTour();
  useHotkey("app.tour", () => tour.start());
  const dialogs = useLibraryDialogs();
  useHotkey("library.newTerm", () => dialogs.openCreate(null, "term"));
}

/** A sidebar link: icon, name, then at the trailing edge its count and its key. */
function NavItem({
  to,
  end,
  icon,
  hotkey,
  children,
  extra,
}: {
  to: string;
  end?: boolean;
  icon: ReactNode;
  hotkey: string;
  children: string;
  extra?: ReactNode;
}) {
  const keys = useHotkeyAria(hotkey);
  return (
    <NavLink to={to} end={end} className={linkClass} aria-keyshortcuts={keys}>
      {icon} {children}
      <span className="ml-auto flex items-center gap-1.5 empty:hidden">
        {extra}
        <Kbd hotkey={hotkey} />
      </span>
    </NavLink>
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
  const newTermKeys = useHotkeyAria("library.newTerm");
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
        <IconButton aria-label="Hide sidebar" hotkey="app.sidebar" onClick={onCollapse}>
          <PanelLeftClose size={20} />
        </IconButton>
      </div>

      <nav aria-label="Main" className="grid gap-0.5 p-2">
        <NavItem to="/library" end icon={<BookOpen size={18} aria-hidden />} hotkey="go.library">
          Library
        </NavItem>
        <NavItem
          to="/practice"
          icon={<GraduationCap size={18} aria-hidden />}
          hotkey="go.practice"
          extra={<NavBadge count={badges.practice} label="cards due" />}
        >
          Practice
        </NavItem>
        <NavItem to="/calendar" icon={<CalendarDays size={18} aria-hidden />} hotkey="go.calendar">
          Calendar
        </NavItem>
        <NavItem
          to="/inbox"
          icon={<Inbox size={18} aria-hidden />}
          hotkey="go.inbox"
          extra={<NavBadge count={badges.inbox} label="files in the inbox" />}
        >
          Inbox
        </NavItem>
        <NavItem
          to="/concepts"
          icon={<Lightbulb size={18} aria-hidden />}
          hotkey="go.concepts"
          extra={<NavBadge count={badges.review} label="concepts to review" tone="warning" />}
        >
          Concepts
        </NavItem>
        <NavItem
          to="/references"
          icon={<BookMarked size={18} aria-hidden />}
          hotkey="go.references"
        >
          References
        </NavItem>
        <NavItem
          to="/requests"
          icon={<MessageCirclePlus size={18} aria-hidden />}
          hotkey="go.requests"
          extra={<NavBadge count={badges.requests} label="open requests" />}
        >
          Requests
        </NavItem>
        <NavItem to="/activity" icon={<Bot size={18} aria-hidden />} hotkey="go.activity">
          Activity
        </NavItem>
        <NavItem to="/trash" icon={<Trash2 size={18} aria-hidden />} hotkey="go.trash">
          Trash
        </NavItem>
      </nav>

      <div className="mt-4 flex items-center justify-between px-5 pb-1.5">
        <h2 className="font-sans text-caption font-semibold uppercase tracking-wide text-text-muted">
          Terms and courses
        </h2>
        <Tooltip content="New term" hotkey="library.newTerm">
          <button
            type="button"
            onClick={() => dialogs.openCreate(null, "term")}
            aria-label="New term"
            aria-keyshortcuts={newTermKeys}
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
        <NavItem to="/help" icon={<LifeBuoy size={18} aria-hidden />} hotkey="go.guide">
          Guide
        </NavItem>
        <NavItem to="/settings" icon={<Settings size={18} aria-hidden />} hotkey="go.settings">
          Settings
        </NavItem>
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
