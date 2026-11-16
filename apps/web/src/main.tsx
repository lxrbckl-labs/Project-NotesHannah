import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./app/App";
import "./app/styles.css";

const root = document.getElementById("root");
if (!root) throw new Error("Missing #root element");
const mountPoint = root;

async function start() {
  // Replaced at build time: in a normal build this branch (and the mock) is removed entirely.
  if (import.meta.env.VITE_MOCK_API === "1") {
    const { installMockApi } = await import("./mocks/install");
    installMockApi();
  }
  createRoot(mountPoint).render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
}

void start();
