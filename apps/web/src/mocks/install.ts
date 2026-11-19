import { ApiClientError, setUploadTransport, type UploadTransport } from "../lib/api";
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
    convertMs: 2500,
    onChange: (next) => {
      try {
        sessionStorage.setItem(KEY, JSON.stringify(next));
      } catch {
        // storage unavailable: the demo still works until reload
      }
    },
  });
  const pageImage = (id: string, size: string) => {
    const info = backend.pageInfo(id);
    const w = info?.width ?? 1280;
    const h = info?.height ?? 720;
    const lines = Array.from(
      { length: 7 },
      (_, i) =>
        `<rect x="${w * 0.08}" y="${h * (0.3 + i * 0.08)}" width="${w * (0.84 - (i % 3) * 0.14)}" height="${h * 0.018}" rx="${h * 0.009}" fill="#9a9a90" opacity="0.55"/>`,
    ).join("");
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}"><rect width="${w}" height="${h}" fill="${info?.handwritten ? "#fbf8ee" : "#ffffff"}"/><rect x="${w * 0.08}" y="${h * 0.08}" width="${w * 0.5}" height="${h * 0.05}" rx="8" fill="#2f6f5e"/><text x="${w * 0.08}" y="${h * 0.2}" font-family="sans-serif" font-size="${h * 0.05}" fill="#444">${info?.handwritten ? "Handwritten page" : "Slide"} ${info?.index ?? ""}</text>${lines}</svg>`;
    void size;
    return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
  };
  (window as unknown as { __mockPageImage: typeof pageImage }).__mockPageImage = pageImage;

  // Uploads: the real transport uses XMLHttpRequest, which the fetch stand-in cannot see.
  const simulated: UploadTransport = (file, nodeId, onProgress) => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let rejectNow: (error: unknown) => void = () => {};
    const promise = new Promise<Awaited<ReturnType<UploadTransport>["promise"]>>(
      (resolve, reject) => {
        rejectNow = reject;
        let done = 0;
        const step = () => {
          if (cancelled) return;
          done += 0.2;
          onProgress(Math.min(done, 0.95));
          if (done < 1) {
            timer = setTimeout(step, 180);
            return;
          }
          const form = new FormData();
          if (nodeId) form.append("nodeId", nodeId);
          form.append("file", file, file.name);
          window
            .fetch("/api/uploads", { method: "POST", body: form })
            .then(async (response) => {
              const json = (await response.json()) as {
                file?: never;
                error?: ConstructorParameters<typeof ApiClientError>[1];
              };
              if (!response.ok && json.error) throw new ApiClientError(response.status, json.error);
              onProgress(1);
              resolve(json.file as never);
            })
            .catch(reject);
        };
        timer = setTimeout(step, 180);
      },
    );
    return {
      promise,
      cancel: () => {
        cancelled = true;
        clearTimeout(timer);
        rejectNow(new ApiClientError(0, { code: "cancelled", message: "Upload canceled." }));
      },
    };
  };
  setUploadTransport(simulated);

  const realFetch = window.fetch.bind(window);
  window.fetch = (input, init) => {
    const url = new URL(input instanceof Request ? input.url : String(input), location.origin);
    return url.pathname.startsWith("/api/")
      ? backend.fetch(input instanceof Request ? input : url, init)
      : realFetch(input, init);
  };
  console.info("[notes] mock API enabled (VITE_MOCK_API=1): data is in memory, not on a server.");
}
