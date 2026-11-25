declare const __APP_VERSION__: string | undefined;

/**
 * The version of the build that is running, as "1.4.2". Vite writes it in from the repo's root
 * package.json (vite.config.ts); tools/version.mjs changes it and docs/deploy.md says when.
 */
export const APP_VERSION: string =
  typeof __APP_VERSION__ === "string" && __APP_VERSION__ ? __APP_VERSION__ : "0.0.0";
