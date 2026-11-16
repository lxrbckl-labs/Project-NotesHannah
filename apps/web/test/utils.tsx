import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { RouterProvider } from "react-router";
import { type Mock, vi } from "vitest";
import { createQueryClient, Providers } from "../src/app/providers";
import { createTestRouter } from "../src/app/routes";
import { api } from "../src/lib/api";
import { createMockBackend, type MockBackend } from "../src/mocks/backend";
import { MOCK_PASSWORD, MOCK_USERNAME } from "../src/mocks/seed";

export interface Harness {
  backend: MockBackend;
  fetch: Mock<(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>>;
  user: ReturnType<typeof userEvent.setup>;
}

/** An in-memory server behind window.fetch, optionally signed in. */
export async function startBackend(signedIn = true): Promise<Harness> {
  const backend = createMockBackend();
  const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) =>
    backend.fetch(input, init),
  );
  vi.stubGlobal("fetch", fetchMock);
  if (signedIn) await api.login({ username: MOCK_USERNAME, password: MOCK_PASSWORD });
  return { backend, fetch: fetchMock, user: userEvent.setup() };
}

export async function findByName(name: string, parentId: string | null = null) {
  const items = await api.children(parentId);
  const found = items.find((n) => n.name === name);
  if (!found) throw new Error(`No "${name}" under ${parentId}`);
  return found;
}

/** Render the whole app at a path, against the current fetch stub. */
export function renderApp(path: string) {
  const client = createQueryClient();
  client.setDefaultOptions({ queries: { retry: false, staleTime: 0 } });
  const router = createTestRouter([path]);
  const view = render(
    <Providers client={client}>
      <RouterProvider router={router} />
    </Providers>,
  );
  return { ...view, client, router };
}

/** Render a signed-in screen and wait until the app shell has appeared. */
export async function renderReady(path: string) {
  const result = renderApp(path);
  await screen.findByTestId("sidebar");
  return result;
}
