import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

const target = process.env.SERVER_URL ?? "http://localhost:3000";

// The in-memory mock API is for dev, unit tests and Playwright only: never let it into a build.
if (process.argv.includes("build") && process.env.VITE_MOCK_API === "1") {
  throw new Error("Refusing to build with VITE_MOCK_API=1: the mock API must not ship.");
}

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    proxy: { "/api": target, "/mcp": target },
  },
  test: {
    environment: "jsdom",
    setupFiles: ["./test/setup.ts"],
    include: ["test/**/*.test.{ts,tsx}", "src/**/*.test.{ts,tsx}"],
    css: false,
    // Whole-app tests load screens lazily; allow for a busy machine.
    testTimeout: 20_000,
    hookTimeout: 20_000,
  },
});
