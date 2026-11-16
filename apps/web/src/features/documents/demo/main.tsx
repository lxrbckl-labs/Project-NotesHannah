import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "../../../app/styles.css";
import { DocumentView } from "../DocumentView";
import { GUIDE_ID } from "../store/fixture";
import { MockDocumentStore } from "../store/mock-store";

/**
 * Standalone page for the documents feature, used for development,
 * Playwright and screenshots. Query parameters:
 *   theme=light|dark   force a theme
 *   mode=read|edit     start reading or editing
 *   large=1            open the long copy of the guide (performance)
 *   fail=1             make every write fail (rollback)
 *   latency=ms         simulated network delay (default 120)
 *   full=1             let the page grow instead of scrolling inside (full-page screenshots)
 */
const params = new URLSearchParams(window.location.search);
const theme = params.get("theme");
if (theme === "light" || theme === "dark") document.documentElement.dataset.theme = theme;

declare global {
  interface Window {
    __docStore?: MockDocumentStore;
  }
}

// One store for the page (outside React, so StrictMode's double render cannot make two).
const store = new MockDocumentStore({
  latency: Number(params.get("latency") ?? 120),
  large: params.get("large") === "1",
  failWrites: params.get("fail") === "1",
});
window.__docStore = store;

function Demo() {
  const mode = params.get("mode");
  const documentId = params.get("large") === "1" ? (store.documentIds[1] ?? GUIDE_ID) : GUIDE_ID;
  return (
    <div className={params.get("full") === "1" ? "doc-no-cv min-h-dvh [&>*]:min-h-dvh" : "h-dvh"}>
      <DocumentView
        store={store}
        documentId={documentId}
        {...(mode === "read" || mode === "edit" ? { initialMode: mode } : {})}
      />
    </div>
  );
}

const root = document.getElementById("root");
if (!root) throw new Error("Missing #root");
createRoot(root).render(
  <StrictMode>
    <Demo />
  </StrictMode>,
);
