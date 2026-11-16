/**
 * Where screenshot specs write. By default everything goes to `screenshots-out/` (git-ignored), so
 * running a spec never dirties the repo. The curated set committed under `screenshots/` (the main
 * states at three sizes in both themes) is refreshed on purpose, by the integrated tour only:
 *
 *   SHOTS=curated pnpm e2e:real -g "integrated tour"
 */
export const WORK_DIR = "screenshots-out";
export const CURATED = process.env.SHOTS === "curated";
export const TOUR_DIR = CURATED ? "screenshots" : "screenshots-out/integrated";
