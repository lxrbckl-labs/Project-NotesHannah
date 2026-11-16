import { defineConfig } from "@playwright/test";

const PORT = Number(process.env.E2E_PORT ?? 4173);

export default defineConfig({
  testDir: "./e2e",
  // e2e/real runs against the real server (playwright.real.config.ts), e2e/built against the built app
  // (playwright.built.config.ts)
  testIgnore: /e2e\/(real|built)\//,
  reporter: [["list"]],
  timeout: 60_000,
  expect: { timeout: 7_000 },
  use: {
    baseURL: `http://localhost:${PORT}`,
    browserName: "chromium",
    actionTimeout: 8_000,
    navigationTimeout: 15_000,
  },
  webServer: {
    // The mock API is switched on here and nowhere else in the e2e run.
    command: `pnpm exec vite --port ${PORT} --strictPort`,
    env: { VITE_MOCK_API: "1" },
    url: `http://localhost:${PORT}`,
    reuseExistingServer: false,
  },
  projects: [
    { name: "phone", use: { viewport: { width: 390, height: 844 }, hasTouch: true } },
    { name: "tablet", use: { viewport: { width: 834, height: 1194 }, hasTouch: true } },
    { name: "computer", use: { viewport: { width: 1440, height: 900 } } },
  ],
});
