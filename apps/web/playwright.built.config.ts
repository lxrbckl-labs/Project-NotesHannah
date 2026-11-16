import { resolve } from "node:path";
import { defineConfig } from "@playwright/test";

/**
 * The app the way it is deployed: `pnpm build`, then the server in production mode serving `apps/web/dist`
 * (`tools/dev/built.mjs`), on its own port with its own throwaway data directory. No Vite dev server and no mock.
 * It catches what the other two suites cannot: a broken production build, a missing lazily loaded file, the
 * server's static serving and headers, and a tab left open across a redeploy.
 */
const PORT = Number(process.env.E2E_BUILT_PORT ?? 3460);
const DATA_DIR = resolve(process.env.E2E_BUILT_DIR ?? "../../data/e2e-built");

export default defineConfig({
  testDir: "./e2e/built",
  reporter: [["list"]],
  timeout: 60_000,
  expect: { timeout: 10_000 },
  workers: 1,
  fullyParallel: false,
  globalSetup: "./e2e/built/global-setup.ts",
  use: {
    baseURL: `http://localhost:${PORT}`,
    browserName: "chromium",
    actionTimeout: 10_000,
    navigationTimeout: 20_000,
  },
  webServer: process.env.E2E_BUILT_REUSE
    ? undefined
    : {
        command: "node tools/dev/built.mjs",
        cwd: "../..",
        env: { E2E_BUILT_PORT: String(PORT), E2E_BUILT_DIR: DATA_DIR },
        // "Ready" is printed after the build, the user and the seed
        wait: { stdout: /Ready\. Open/ },
        reuseExistingServer: false,
        timeout: 600_000,
        gracefulShutdown: { signal: "SIGTERM", timeout: 30_000 },
      },
  projects: [
    { name: "built-phone", use: { viewport: { width: 390, height: 844 }, hasTouch: true } },
    { name: "built-tablet", use: { viewport: { width: 834, height: 1194 }, hasTouch: true } },
    { name: "built-computer", use: { viewport: { width: 1440, height: 900 } } },
  ],
});
