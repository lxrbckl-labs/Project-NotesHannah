import { readFileSync } from "node:fs";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

const target = process.env.SERVER_URL ?? "http://localhost:3000";

// The in-memory mock API is for dev, unit tests and Playwright only: never let it into a build.
if (process.argv.includes("build") && process.env.VITE_MOCK_API === "1") {
  throw new Error("Refusing to build with VITE_MOCK_API=1: the mock API must not ship.");
}

/**
 * Local development only, and only when the local copy is served to the home network
 * (`NOTES_WEB_HOST`, set by hand for `pnpm local`). The server accepts changes from one address, the
 * one it was started with (APP_ORIGIN). A laptop's address changes from network to network, and the
 * same copy is opened as localhost on the laptop itself, so here the dev proxy presents every
 * request as coming from that one address. It never applies to a build: a built app is served by the
 * server itself, with no proxy in between.
 */
const lanOrigin = process.env.NOTES_WEB_HOST ? process.env.APP_ORIGIN : undefined;
const forward = (to: string) =>
  lanOrigin
    ? {
        target: to,
        configure: (proxy: {
          on: (
            event: "proxyReq",
            handler: (req: { setHeader: (name: string, value: string) => void }) => void,
          ) => void;
        }) => {
          proxy.on("proxyReq", (req) => req.setHeader("origin", lanOrigin));
        },
      }
    : to;

/**
 * The app's version, from the repo's root package.json (tools/version.mjs keeps it; docs/deploy.md,
 * "Version number"). Built into the app as `__APP_VERSION__` and shown in the home button's hint.
 */
const appVersion = (
  JSON.parse(readFileSync(new URL("../../package.json", import.meta.url), "utf8")) as {
    version?: string;
  }
).version;

export default defineConfig({
  plugins: [react(), tailwindcss()],
  define: { __APP_VERSION__: JSON.stringify(appVersion ?? "0.0.0") },
  server: {
    proxy: { "/api": forward(target), "/mcp": forward(target) },
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
