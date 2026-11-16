import { resolve } from "node:path";
import { defineConfig } from "@playwright/test";

/**
 * The main journeys against the REAL server, with no mock: `tools/dev/local.mjs` starts the real
 * server, the web dev server and (when Docker is running) the real converter container, on their
 * own ports and in their own data directory (wiped before each run).
 */
const SERVER_PORT = Number(process.env.E2E_REAL_SERVER_PORT ?? 3430);
const WEB_PORT = Number(process.env.E2E_REAL_WEB_PORT ?? 5430);
const DATA_DIR = resolve(process.env.E2E_REAL_DIR ?? "../../data/e2e-real");

export default defineConfig({
  testDir: "./e2e/real",
  reporter: [["list"]],
  timeout: 120_000,
  expect: { timeout: 15_000 },
  workers: 1,
  fullyParallel: false,
  use: {
    baseURL: `http://localhost:${WEB_PORT}`,
    browserName: "chromium",
    actionTimeout: 15_000,
    navigationTimeout: 30_000,
  },
  metadata: { dataDir: DATA_DIR },
  webServer: {
    command: `rm -rf "${DATA_DIR}" && node tools/dev/local.mjs`,
    cwd: "../..",
    env: {
      NOTES_LOCAL_DIR: DATA_DIR,
      NOTES_SERVER_PORT: String(SERVER_PORT),
      NOTES_WEB_PORT: String(WEB_PORT),
    },
    url: `http://localhost:${WEB_PORT}/login`,
    reuseExistingServer: false,
    // The first run builds the converter image.
    timeout: 900_000,
    gracefulShutdown: { signal: "SIGTERM", timeout: 60_000 },
  },
  projects: [
    { name: "real-phone", use: { viewport: { width: 390, height: 844 }, hasTouch: true } },
    { name: "real-tablet", use: { viewport: { width: 834, height: 1194 }, hasTouch: true } },
    { name: "real-computer", use: { viewport: { width: 1440, height: 900 } } },
  ],
});
