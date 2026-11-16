/**
 * After the app is rebuilt on the server, a tab that was already open still runs the old build and will ask
 * for script files that no longer exist the first time she opens a screen it has not loaded yet. Vite reports
 * that as a `vite:preloadError`. The cure is to load the new build: reload once, quietly.
 */
const KEY = "notes-stale-reload";
/** Never reload twice within this window, so a file that is really missing cannot cause a reload loop. */
const WINDOW_MS = 60_000;

export function shouldReload(lastReload: string | null, now: number): boolean {
  const last = Number(lastReload);
  return !Number.isFinite(last) || last === 0 || now - last > WINDOW_MS;
}

export function installStaleBuildReload(
  target: Pick<Window, "addEventListener"> = window,
  storage: Pick<Storage, "getItem" | "setItem"> = window.sessionStorage,
  reload: () => void = () => window.location.reload(),
  now: () => number = Date.now,
): void {
  target.addEventListener("vite:preloadError", (event) => {
    if (!shouldReload(storage.getItem(KEY), now())) return;
    // Handled: without this the failed import is thrown into the page as an error screen.
    event.preventDefault();
    storage.setItem(KEY, String(now()));
    reload();
  });
}
