import { defineConfig } from "@playwright/test";

/**
 * The concepts specs on their own port, so another checkout's dev server is never reused by
 * mistake: `pnpm exec playwright test -c e2e/concepts.config.ts`. They only need /concepts-demo.html.
 */
const PORT = Number(process.env.CONCEPTS_PORT ?? 5474);

export default defineConfig({
  testDir: ".",
  testMatch: "concepts*.spec.ts",
  outputDir: "../test-results/concepts",
  reporter: [["list"]],
  timeout: 60_000,
  expect: { timeout: 8_000 },
  use: { baseURL: `http://localhost:${PORT}`, browserName: "chromium", actionTimeout: 8_000 },
  webServer: {
    command: `pnpm exec vite ${process.env.CONCEPTS_VITE_ARGS ?? ""} --port ${PORT} --strictPort`,
    cwd: "..",
    url: `http://localhost:${PORT}/concepts-demo.html`,
    reuseExistingServer: !process.env.CI,
  },
  projects: [
    { name: "phone", use: { viewport: { width: 390, height: 844 }, hasTouch: true } },
    { name: "tablet", use: { viewport: { width: 834, height: 1194 }, hasTouch: true } },
    { name: "tablet-landscape", use: { viewport: { width: 1194, height: 834 }, hasTouch: true } },
    { name: "computer", use: { viewport: { width: 1440, height: 900 } } },
  ],
});
