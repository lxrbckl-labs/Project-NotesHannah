import { createMockBackend, type MockSnapshot } from "./backend";

const KEY = "notes-mock-state";

/**
 * Replace window.fetch with the in-memory backend. Only reached when VITE_MOCK_API=1
 * (see main.tsx); the state survives reloads within the tab so e2e tests can navigate by URL.
 */
export function installMockApi(): void {
  let snapshot: MockSnapshot | undefined;
  try {
    const stored = sessionStorage.getItem(KEY);
    if (stored) snapshot = JSON.parse(stored) as MockSnapshot;
  } catch {
    snapshot = undefined;
  }
  const backend = createMockBackend({
    snapshot,
    latencyMs: 120,
    onChange: (next) => {
      try {
        sessionStorage.setItem(KEY, JSON.stringify(next));
      } catch {
        // storage unavailable: the demo still works until reload
      }
    },
  });
  const realFetch = window.fetch.bind(window);
  window.fetch = (input, init) => {
    const url = new URL(input instanceof Request ? input.url : String(input), location.origin);
    return url.pathname.startsWith("/api/")
      ? backend.fetch(input instanceof Request ? input : url, init)
      : realFetch(input, init);
  };
  console.info("[notes] mock API enabled (VITE_MOCK_API=1): data is in memory, not on a server.");
}
