import { defineConfig } from "@playwright/test";

/**
 * The requests specs on their own port, so another checkout's dev server is never reused by
 * mistake: `pnpm exec playwright test -c e2e/requests.config.ts`. They only need /requests-demo.html.
 */
const PORT = Number(process.env.REQUESTS_PORT ?? 5473);

export default defineConfig({
  testDir: ".",
  testMatch: "requests*.spec.ts",
  outputDir: "../test-results/requests",
  reporter: [["list"]],
  timeout: 60_000,
  expect: { timeout: 8_000 },
  use: { baseURL: `http://localhost:${PORT}`, browserName: "chromium", actionTimeout: 8_000 },
  webServer: {
    command: `pnpm exec vite ${process.env.REQUESTS_VITE_ARGS ?? ""} --port ${PORT} --strictPort`,
    cwd: "..",
    url: `http://localhost:${PORT}/requests-demo.html`,
    reuseExistingServer: !process.env.CI,
  },
  projects: [
    { name: "phone", use: { viewport: { width: 390, height: 844 }, hasTouch: true } },
    { name: "tablet", use: { viewport: { width: 834, height: 1194 }, hasTouch: true } },
    { name: "tablet-landscape", use: { viewport: { width: 1194, height: 834 }, hasTouch: true } },
    { name: "computer", use: { viewport: { width: 1440, height: 900 } } },
  ],
});
