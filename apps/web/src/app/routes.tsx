import { Compass } from "lucide-react";
import {
  createBrowserRouter,
  createMemoryRouter,
  Link,
  Navigate,
  type RouteObject,
} from "react-router";
import { Page } from "../components/Page";
import { Button } from "../components/ui/button";
import { EmptyState, Skeleton } from "../components/ui/states";
import { AuthGate } from "../features/auth/AuthGate";
import { LoginPage } from "../features/auth/LoginPage";
import { AppShell } from "./AppShell";

function NotFound() {
  return (
    <Page>
      <EmptyState
        icon={<Compass size={26} />}
        title="This page does not exist"
        action={
          <Link to="/library">
            <Button variant="primary">Go to library</Button>
          </Link>
        }
      >
        Check the address, or head back to your library.
      </EmptyState>
    </Page>
  );
}

function Loading() {
  return (
    <Page>
      <div role="status" aria-label="Loading" className="grid gap-4">
        <Skeleton className="h-10 w-56" />
        <Skeleton className="h-40" />
      </div>
    </Page>
  );
}

// Every screen but sign-in and the shell is loaded when first opened, so the first paint is small.
const screens = {
  library: () =>
    import("../features/library/LibraryHome").then((m) => ({ Component: m.LibraryHome })),
  node: () => import("../features/library/NodePage").then((m) => ({ Component: m.NodePage })),
  trash: () => import("../features/library/TrashPage").then((m) => ({ Component: m.TrashPage })),
  inbox: () => import("../features/inbox/InboxPage").then((m) => ({ Component: m.InboxPage })),
  file: () =>
    import("../features/sources/SourceFilePage").then((m) => ({ Component: m.SourceFilePage })),
  search: () => import("../features/search/SearchPage").then((m) => ({ Component: m.SearchPage })),
  settings: () =>
    import("../features/settings/SettingsPage").then((m) => ({ Component: m.SettingsPage })),
  activity: () =>
    import("../features/activity/ActivityPage").then((m) => ({ Component: m.ActivityPage })),
};

const mount =
  (name: keyof typeof import("../features/mounts/Mount")): RouteObject["lazy"] =>
  async () => {
    const module = await import("../features/mounts/Mount");
    return { Component: module[name] as () => React.JSX.Element };
  };

export const routes: RouteObject[] = [
  { path: "/login", element: <LoginPage /> },
  {
    element: <AuthGate />,
    HydrateFallback: Loading,
    children: [
      {
        element: <AppShell />,
        children: [
          { index: true, element: <Navigate to="/library" replace /> },
          { path: "library", lazy: screens.library, HydrateFallback: Loading },
          { path: "library/:nodeId", lazy: screens.node, HydrateFallback: Loading },
          { path: "files/:fileId", lazy: screens.file, HydrateFallback: Loading },
          { path: "search", lazy: screens.search, HydrateFallback: Loading },
          { path: "inbox", lazy: screens.inbox, HydrateFallback: Loading },
          { path: "trash", lazy: screens.trash, HydrateFallback: Loading },
          { path: "settings", lazy: screens.settings, HydrateFallback: Loading },
          { path: "activity", lazy: screens.activity, HydrateFallback: Loading },
          // Mount points for the feature modules (see apps/web/INTEGRATION.md).
          { path: "doc/:nodeId", lazy: mount("DocumentsMount") },
          { path: "doc/:nodeId/canvas", lazy: mount("CanvasMount") },
          { path: "practice", lazy: mount("PracticeMount") },
          { path: "practice/session/:id", lazy: mount("PracticeSessionMount") },
          { path: "exams", lazy: mount("ExamsMount") },
          { path: "requests", lazy: mount("RequestsMount") },
          { path: "concepts/:id", lazy: mount("ConceptsMount") },
          { path: "*", element: <NotFound /> },
        ],
      },
    ],
  },
];

export const createAppRouter = () => createBrowserRouter(routes);
export const createTestRouter = (initialEntries: string[]) =>
  createMemoryRouter(routes, { initialEntries });
