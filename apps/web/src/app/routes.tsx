import { Compass } from "lucide-react";
import { createBrowserRouter, createMemoryRouter, Link, Navigate } from "react-router";
import { Page } from "../components/Page";
import { Button } from "../components/ui/button";
import { EmptyState } from "../components/ui/states";
import { AuthGate } from "../features/auth/AuthGate";
import { LoginPage } from "../features/auth/LoginPage";
import { InboxPage } from "../features/inbox/InboxPage";
import { FilePage } from "../features/library/FilePage";
import { LibraryHome } from "../features/library/LibraryHome";
import { NodePage } from "../features/library/NodePage";
import { TrashPage } from "../features/library/TrashPage";
import { SearchPage } from "../features/search/SearchPage";
import { SettingsPage } from "../features/settings/SettingsPage";
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

export const routes = [
  { path: "/login", element: <LoginPage /> },
  {
    element: <AuthGate />,
    children: [
      {
        element: <AppShell />,
        children: [
          { index: true, element: <Navigate to="/library" replace /> },
          { path: "library", element: <LibraryHome /> },
          { path: "library/:nodeId", element: <NodePage /> },
          { path: "files/:fileId", element: <FilePage /> },
          { path: "search", element: <SearchPage /> },
          { path: "inbox", element: <InboxPage /> },
          { path: "trash", element: <TrashPage /> },
          { path: "settings", element: <SettingsPage /> },
          { path: "*", element: <NotFound /> },
        ],
      },
    ],
  },
];

export const createAppRouter = () => createBrowserRouter(routes);
export const createTestRouter = (initialEntries: string[]) =>
  createMemoryRouter(routes, { initialEntries });
