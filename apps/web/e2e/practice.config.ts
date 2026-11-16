import { defineConfig } from "@playwright/test";

/**
 * The practice specs on their own port, so a dev server of another checkout on 4173 is never reused
 * by mistake: `pnpm exec playwright test -c e2e/practice.config.ts`. Same three device projects as
 * the main config, which also runs these specs (they only need /practice-demo.html).
 */
const PORT = Number(process.env.PRACTICE_PORT ?? 4273);

export default defineConfig({
  testDir: ".",
  testMatch: "practice*.spec.ts",
  outputDir: "../test-results/practice",
  reporter: [["list"]],
  use: { baseURL: `http://localhost:${PORT}`, browserName: "chromium" },
  webServer: {
    command: `pnpm exec vite --port ${PORT} --strictPort`,
    cwd: "..",
    url: `http://localhost:${PORT}/practice-demo.html`,
    reuseExistingServer: !process.env.CI,
  },
  projects: [
    { name: "phone", use: { viewport: { width: 390, height: 844 }, hasTouch: true } },
    { name: "tablet", use: { viewport: { width: 834, height: 1194 }, hasTouch: true } },
    { name: "computer", use: { viewport: { width: 1440, height: 900 } } },
  ],
});
